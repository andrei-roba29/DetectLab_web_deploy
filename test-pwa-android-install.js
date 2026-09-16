// Source + behaviour tests for the DetectLab PWA install flow on Android.
//
// Context: Android browsers that mint their own WebAPK (Samsung Internet and
// several OEM browsers) produce a wrapper APK that Google Play Protect reports
// as "built for an older version of Android" and blocks with "Unsafe app
// blocked". Chrome's minting service produces a signed, up-to-date WebAPK, so
// the install flow must route users on those browsers to Chrome instead of
// telling them to use the current browser's "Add to Home screen".
//
// Usage: node test-pwa-android-install.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function read(rel) {
    return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

const html = read('index.html');
const css = read('css/styles.css');
const translationsSrc = read('js/translations.js');
const swSrc = read('sw.js');
const manifest = JSON.parse(read('manifest.json'));

console.log('[Test] PWA install flow (Android / Samsung Internet → Chrome)...\n');

// -------------------------------------------------------------
// Test 1: Extract the inline install script
// -------------------------------------------------------------
console.log('[1] Inline install script');

let installScript = null;
const scriptRe = /<script>([\s\S]*?)<\/script>/g;
let match;
while ((match = scriptRe.exec(html)) !== null) {
    if (match[1].includes('function installAndroidPWA')) {
        installScript = match[1];
        break;
    }
}
assert(installScript, 'index.html must contain the inline PWA install script');
assert(installScript.includes('function pwaT('), 'install script must define the pwaT translation helper');
console.log('  ✔ install script found (' + installScript.length + ' chars)');

// -------------------------------------------------------------
// Test 2: Browser detection on realistic Android user agents
// -------------------------------------------------------------
console.log('\n[2] Android browser detection');

function makeEl(id) {
    const classes = new Set();
    const el = {
        id: id,
        innerHTML: '',
        textContent: '',
        disabled: false,
        _children: {},
        scrollIntoView() {},
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
            toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
        },
        querySelector(sel) {
            if (!this._children[sel]) this._children[sel] = makeEl(sel);
            return this._children[sel];
        },
    };
    return el;
}

function createSandbox(userAgent) {
    const elements = {
        'pwa-install-help': makeEl('pwa-install-help'),
        'pwa-install-banner': makeEl('pwa-install-banner'),
        'pwa-install-toast': makeEl('pwa-install-toast'),
        'pwaBannerInstall': makeEl('pwaBannerInstall'),
    };

    const windowListeners = {};
    const documentListeners = {};

    const documentStub = {
        addEventListener: (type, fn) => { (documentListeners[type] = documentListeners[type] || []).push(fn); },
        getElementById: (id) => elements[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
    };

    const windowStub = {
        location: {
            origin: 'https://detectlab.ro',
            protocol: 'https:',
            host: 'detectlab.ro',
            pathname: '/',
            search: '',
            hash: '',
            href: '',
        },
        history: { replaceState() {} },
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        navigator: { userAgent: userAgent, standalone: false },
        addEventListener: (type, fn) => { (windowListeners[type] = windowListeners[type] || []).push(fn); },
        removeEventListener: () => {},
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
    };

    const sandbox = {
        window: windowStub,
        document: documentStub,
        navigator: windowStub.navigator,
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval,
        URLSearchParams: URLSearchParams,
        Promise: Promise,
        elements: elements,
        fireWindow: (type, event) => (windowListeners[type] || []).forEach((fn) => fn(event)),
        fireDocument: (type, event) => (documentListeners[type] || []).forEach((fn) => fn(event)),
    };
    sandbox.globalThis = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(installScript, sandbox, { filename: 'index.html#pwa-install' });
    return sandbox;

    // (elements/windowListeners are exposed through the returned sandbox)
}

const UA = {
    samsung: 'Mozilla/5.0 (Linux; Android 15; SM-S921B Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    chrome: 'Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    xiaomi: 'Mozilla/5.0 (Linux; U; Android 13; MI 9) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 XiaoMi/MiuiBrowser/18.0.13',
    firefox: 'Mozilla/5.0 (Android 13; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0',
    desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

const samsung = createSandbox(UA.samsung);
assert.strictEqual(samsung.detectAndroidBrowser(), 'samsung', 'SamsungBrowser UA must be detected');
assert.strictEqual(samsung.browserNeedsChrome('samsung'), true, 'Samsung Internet must be routed to Chrome');

const chrome = createSandbox(UA.chrome);
assert.strictEqual(chrome.detectAndroidBrowser(), 'chrome', 'Chrome for Android UA must be detected');
assert.strictEqual(chrome.browserNeedsChrome('chrome'), false, 'Chrome must keep the native install prompt');

const xiaomi = createSandbox(UA.xiaomi);
assert.strictEqual(xiaomi.detectAndroidBrowser(), 'oem', 'MiuiBrowser must be treated as an OEM browser');
assert.strictEqual(xiaomi.browserNeedsChrome('oem'), true, 'OEM browsers must be routed to Chrome');

const firefox = createSandbox(UA.firefox);
assert.strictEqual(firefox.detectAndroidBrowser(), 'firefox', 'Firefox UA must be detected');
assert.strictEqual(firefox.browserNeedsChrome('firefox'), true, 'Firefox cannot install a WebAPK, so it routes to Chrome');
console.log('  ✔ Samsung Internet / OEM / Firefox route to Chrome, Chrome keeps the prompt');

// -------------------------------------------------------------
// Test 3: Samsung Internet tap shows the Chrome redirect card
// -------------------------------------------------------------
console.log('\n[3] Samsung Internet install tap');

samsung.installAndroidPWA();
const samsungHelp = samsung.elements['pwa-install-help'];
assert(samsungHelp.classList.contains('visible'), 'help card must be visible after tapping Android App in Samsung Internet');
assert(/Open in Chrome/.test(samsungHelp.innerHTML), 'help card must offer the Open in Chrome action');
assert(/Install anyway/.test(samsungHelp.innerHTML), 'help card must explain the Play Protect "Install anyway" workaround');
assert(/Samsung Internet/.test(samsungHelp.innerHTML), 'help card must name the browser the user is on');
assert(/onclick="openInChrome\(\)"/.test(samsungHelp.innerHTML), 'help card must wire the Chrome redirect button');
console.log('  ✔ Chrome redirect card rendered (browser named, bypass tip, action wired)');

// -------------------------------------------------------------
// Test 4: Chrome install tap uses the real beforeinstallprompt event
// -------------------------------------------------------------
console.log('\n[4] Chrome install tap');

let promptCalled = false;
const fakePromptEvent = {
    preventDefault() {},
    prompt() { promptCalled = true; },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
};
chrome.fireWindow('beforeinstallprompt', fakePromptEvent);
chrome.installAndroidPWA();
assert.strictEqual(promptCalled, true, 'Chrome must call prompt() from the stashed beforeinstallprompt event');
assert(!chrome.elements['pwa-install-help'].classList.contains('visible'), 'Chrome must not be sent to the redirect card');
console.log('  ✔ Chrome uses the native install prompt (no redirect)');

// -------------------------------------------------------------
// Test 5: appinstalled + already-installed handling
// -------------------------------------------------------------
console.log('\n[5] Installed-state handling');

chrome.fireWindow('appinstalled', {});
const toast = chrome.elements['pwa-install-toast'];
assert(toast.classList.contains('visible'), 'a confirmation toast must be shown after install');
assert(/installed/i.test(toast.innerHTML), 'install confirmation must mention the app being installed');
assert(!chrome.elements['pwa-install-banner'].classList.contains('visible'), 'banner must be hidden after install');
assert(!chrome.elements['pwa-install-help'].classList.contains('visible'), 'help card must be hidden after install');

const standalone = createSandbox(UA.chrome);
standalone.window.navigator.standalone = true;
standalone.installAndroidPWA();
assert(/already installed/i.test(standalone.elements['pwa-install-toast'].innerHTML), 'tapping install inside the installed app must say it is already installed');
assert(!standalone.elements['pwa-install-help'].classList.contains('visible'), 'already-installed must not open the help card');
console.log('  ✔ appinstalled toast + already-installed short-circuit');

// -------------------------------------------------------------
// Test 6: Chrome hand-off URL (intent://)
// -------------------------------------------------------------
console.log('\n[6] Chrome hand-off URL');

const intent = samsung.buildChromeIntentUrl();
assert(intent.startsWith('intent://detectlab.ro/?pwa=install#Intent;'), 'intent URL must target the DetectLab page');
assert(intent.includes('scheme=https'), 'intent URL must keep the https scheme');
assert(intent.includes('package=com.android.chrome'), 'intent URL must target the Chrome package');
assert(intent.includes('S.browser_fallback_url='), 'intent URL must define a fallback for devices without Chrome');
assert(intent.includes(encodeURIComponent('https://detectlab.ro/?pwa=install')), 'fallback URL must be URL-encoded');
console.log('  ✔ intent://…package=com.android.chrome + fallback URL');

// -------------------------------------------------------------
// Test 7: Banner shown only for the ?pwa=install landing
// -------------------------------------------------------------
console.log('\n[7] Chrome landing banner');

assert(html.includes('id="pwa-install-banner"'), 'index.html must contain the sticky install banner');
assert(html.includes('id="pwaBannerInstall"'), 'banner must contain the install button');
assert(installScript.includes("params.get('pwa') !== 'install'"), 'banner must be gated on ?pwa=install');
assert(installScript.includes('history.replaceState'), 'the ?pwa=install marker must be dropped after handling');
assert(html.includes('id="pwa-install-help"'), 'index.html must contain the install help card');
console.log('  ✔ banner gated on ?pwa=install and rendered into #pwa-install-help');

// -------------------------------------------------------------
// Test 8: Every pwaT() key exists in EN and RO
// -------------------------------------------------------------
console.log('\n[8] Translations (EN + RO)');

const usedKeys = new Set();
const keyRe = /pwaT\('([a-z0-9_]+)'/g;
let keyMatch;
while ((keyMatch = keyRe.exec(installScript)) !== null) usedKeys.add(keyMatch[1]);
assert(usedKeys.size >= 15, 'expected the install flow to use the shared translation keys');

const missing = [];
usedKeys.forEach((key) => {
    const occurrences = translationsSrc.split(key + ':').length - 1;
    if (occurrences < 2) missing.push(key + ' (' + occurrences + ' language/s)');
});
assert.strictEqual(missing.length, 0, 'keys missing from EN or RO: ' + missing.join(', '));
assert(/pwa_help_tip_protect:/.test(translationsSrc), 'the Play Protect bypass tip must be translated');
console.log('  ✔ ' + usedKeys.size + ' install keys present in both languages');

// -------------------------------------------------------------
// Test 9: CSS + manifest + service worker
// -------------------------------------------------------------
console.log('\n[9] CSS / manifest / service worker');

['.pwa-help-card', '.pwa-help-card.visible', '.pwa-help-tip', '.pwa-help-btn.primary',
 '.pwa-install-banner', '.pwa-install-banner.visible', '.pwa-banner-btn'].forEach((rule) => {
    assert(css.includes(rule), 'css/styles.css must define ' + rule);
});

assert.strictEqual(manifest.display, 'standalone', 'manifest must stay standalone');
assert.strictEqual(manifest.id, '/', 'manifest must pin a stable WebAPK id');
assert.strictEqual(manifest.scope, '/', 'manifest must declare its scope');
assert(!Object.prototype.hasOwnProperty.call(manifest, 'screenshots'), 'empty screenshots array must not be shipped');
assert(manifest.icons.some((i) => i.sizes === '192x192'), 'manifest needs a 192px icon');
assert(manifest.icons.some((i) => i.sizes === '512x512'), 'manifest needs a 512px icon');

// The cache name is re-bumped by every release (a pinned string went stale at
// v78 while the app already shipped v88). Keep the guarantee — the install
// flow's bump happened, and no later release may go backwards — without
// freezing a version that rots on the next release.
const cacheName = (swSrc.match(/const CACHE_NAME = '([^']+)'/) || [])[1] || '';
const cacheVersion = Number((cacheName.match(/-v(\d+)-/) || [])[1] || 0);
assert(cacheVersion >= 78,
    'service worker cache must be bumped so installed PWAs pick up the new install flow (found ' +
    (cacheName || '<none>') + ')');
console.log('  ✔ styles, manifest (id/scope) and SW cache bump in place');

console.log('\n✅ ALL PWA ANDROID INSTALL TESTS PASSED\n');

// The install toasts keep their own 6s auto-hide timers alive, which would
// otherwise delay the process exit of this source/behaviour test.
process.exit(0);
