// Regression checks for the installed iOS keyboard path.
// Run: node test-pwa-ios-keyboard.js   (npm i --no-save jsdom)
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('css/pwa-keyboard.css', 'utf8');
const auth = fs.readFileSync('js/auth.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const source = fs.readFileSync('js/pwa-keyboard.js', 'utf8');

function functionSource(text, name) {
    const start = text.indexOf('function ' + name + '(');
    assert(start >= 0, name + ' must exist');
    let depth = 0, seen = false;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') { depth++; seen = true; }
        else if (text[i] === '}') {
            depth--;
            if (seen && depth === 0) return text.slice(start, i + 1);
        }
    }
    throw new Error('Unclosed function ' + name);
}

// The shell may block a two-finger pan, but never the start of a tap/focus.
{
    const sandbox = {
        document: { activeElement: null },
        isLeafletMapGestureTarget: target => target.kind === 'map'
    };
    vm.createContext(sandbox);
    vm.runInContext(functionSource(html, 'isTextEditingTarget') + '\n' +
        functionSource(html, 'blockNonMapPinch'), sandbox);
    const input = { nodeType: 1, closest: sel => sel.includes('input') ? {} : null };
    const plain = { nodeType: 1, closest: () => null, kind: 'plain' };
    const map = { nodeType: 1, closest: () => null, kind: 'map' };
    function fire(type, target, touches) {
        const event = { type, target, touches: { length: touches }, cancelable: true, prevented: false,
            preventDefault() { this.prevented = true; } };
        sandbox.blockNonMapPinch(event);
        return event.prevented;
    }
    assert.equal(fire('touchstart', plain, 1), false, 'a normal tap must keep its native focus path');
    assert.equal(fire('gesturestart', plain, 2), false, 'gesturestart is not a text-focus blocker');
    assert.equal(fire('touchmove', input, 2), false, 'a pinch starting in a field is left to the browser');
    sandbox.document.activeElement = input;
    assert.equal(fire('touchmove', plain, 2), false, 'an active editor is never interrupted');
    sandbox.document.activeElement = null;
    assert.equal(fire('touchmove', plain, 2), true, 'non-map pinch protection still works');
    assert.equal(fire('touchmove', plain, 1), false);
    assert.equal(fire('touchmove', map, 2), false, 'map gestures still belong to Leaflet');
    assert(html.includes("document.addEventListener('touchmove', blockNonMapPinch"));
    assert(!html.includes("['touchstart', 'touchmove'].forEach"));
    console.log('✓ native tap/focus is preserved; non-map pinch protection remains');
}

// Touch devices must not receive the old delayed auth autofocus.
{
    const openAuth = auth.match(/window\.openAuth = function \(tab\) \{[\s\S]*?\n\};/)[0];
    function run(coarse) {
        let focused = 0;
        const field = { focus() { focused++; } };
        const sandbox = {
            window: { matchMedia: () => ({ matches: coarse }), navigator: { maxTouchPoints: coarse ? 5 : 0 },
                location: { hash: '', search: '', pathname: '/', origin: 'https://detectlab.ro' } },
            document: { querySelector: () => field, getElementById: () => ({ classList: { add() {} } }) },
            switchAuthTab() {}, _clearMsg() {}, setTimeout() { throw new Error('no delayed focus'); }
        };
        vm.createContext(sandbox);
        vm.runInContext(openAuth + '\nwindow.openAuth("login");', sandbox);
        return focused;
    }
    assert.equal(run(true), 0, 'iOS/Android focus the field through the real tap');
    assert.equal(run(false), 1, 'desktop keeps immediate autofocus');
    console.log('✓ auth autofocus is immediate on desktop and native on touch devices');
}

// CSS keeps editable text selectable even inside a Leaflet pane.
assert(/user-select:\s*text\s*!important/.test(css));
assert(/-webkit-user-select:\s*text\s*!important/.test(css));
assert(/\.leaflet-pane:focus-within/.test(css));
assert(/\.pwa-keyboard-help-modal\[hidden\]\s*\{\s*display:\s*none/.test(css));
assert(!/caches\.delete|localStorage\.clear|serviceWorker\.unregister/.test(source),
    'keyboard recovery must not delete offline data or the session');
console.log('✓ editable fields keep text selection; recovery is non-destructive');

let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch (_) {
    console.log('SKIP — jsdom is not installed; DOM recovery checks were not run.');
    process.exit(0);
}

function boot(options) {
    const dom = new JSDOM(`<!doctype html><html lang="ro"><body>
        <button id="authHelp" data-pwa-keyboard-help></button>
        <button id="menuHelp" data-pwa-keyboard-help></button>
        <input id="email" type="email"><input id="range" type="range">
        <input id="disabled" type="text" disabled><input id="readonly" type="text" readonly>
        <textarea id="note"></textarea><select id="select"><option>x</option></select>
        <div id="editable" contenteditable="true"></div>
    </body></html>`, { url: 'https://detectlab.ro/?pwa=1&lang=ro#map-section', pretendToBeVisual: true, runScripts: 'outside-only' });
    const win = dom.window;
    Object.defineProperty(win.navigator, 'userAgent', { value: options.ios ? 'iPhone' : 'Android', configurable: true });
    Object.defineProperty(win.navigator, 'standalone', { value: !!options.standalone, configurable: true });
    Object.defineProperty(win.navigator, 'maxTouchPoints', { value: options.ios ? 5 : 0, configurable: true });
    win.matchMedia = query => ({ matches: !!options.standalone && /standalone|fullscreen/.test(query) });
    const listeners = {};
    win.visualViewport = { height: 620, offsetTop: 40,
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); } };
    win.eval(source);
    return { win, doc: win.document, listeners };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    const ios = boot({ ios: true, standalone: true });
    const api = ios.win.DLPwaKeyboard;
    assert(api.isIOS() && api.isPWA());
    assert(ios.doc.body.classList.contains('is-ios'));
    assert(ios.doc.body.classList.contains('is-installed-pwa'));
    assert.equal(ios.doc.getElementById('authHelp').textContent, 'Tastatura nu apare? Ajutor iOS');
    assert(api.isEditable(ios.doc.getElementById('email')));
    assert(api.isEditable(ios.doc.getElementById('note')));
    assert(api.isEditable(ios.doc.getElementById('editable')));
    ['range', 'disabled', 'readonly', 'select'].forEach(id => {
        assert(!api.isEditable(ios.doc.getElementById(id)), id + ' is not a soft-keyboard field');
    });

    ios.doc.getElementById('email').focus();
    assert(ios.doc.body.classList.contains('pwa-keyboard-open'));
    assert.equal(ios.doc.documentElement.style.getPropertyValue('--pwa-visible-height'), '620px');
    assert.equal(ios.doc.documentElement.style.getPropertyValue('--pwa-visible-top'), '40px');
    ios.doc.getElementById('note').focus();
    await wait(30);
    assert(ios.doc.body.classList.contains('pwa-keyboard-open'), 'field-to-field focus keeps editing mode');
    ios.doc.getElementById('note').blur();
    await wait(30);
    assert(!ios.doc.body.classList.contains('pwa-keyboard-open'));

    ios.doc.getElementById('authHelp').click();
    const dialog = ios.doc.getElementById('pwaKeyboardHelpModal');
    assert(dialog && !dialog.hidden);
    assert.equal(dialog.getAttribute('role'), 'dialog');
    const link = dialog.querySelector('a');
    assert.equal(link.href, 'https://detectlab.ro/?lang=ro#map-section');
    assert.equal(link.target, '_blank');
    assert(dialog.textContent.includes('Nu șterge datele site-ului din Safari'));
    dialog.querySelector('button').click();
    assert(dialog.hidden);
    assert.equal(ios.doc.activeElement.id, 'authHelp', 'closing help returns focus to its trigger');

    const browser = boot({ ios: true, standalone: false });
    assert(browser.win.DLPwaKeyboard.isIOS());
    assert(!browser.win.DLPwaKeyboard.isPWA());
    assert(!browser.doc.body.classList.contains('is-installed-pwa'));
    const android = boot({ ios: false, standalone: true });
    assert(!android.win.DLPwaKeyboard.isIOS());
    assert(!android.doc.body.classList.contains('is-ios'));
    console.log('✓ iOS-only recovery dialog, Safari fallback, focus cleanup and data-safety warning');

    assert(sw.includes("detectlab-v369-ios-pwa-keyboard"));
    ['css/pwa-keyboard.css?v=20261101-ios-keyboard', 'js/pwa-keyboard.js?v=20261101-ios-keyboard',
        'js/auth.js?v=20261101-ios-keyboard'].forEach(url => {
        assert(html.includes(url), 'shell loads ' + url);
        assert(sw.includes("'" + url + "'"), 'service worker precaches ' + url);
    });
    console.log('✓ the keyboard fix is versioned into the installed PWA shell');
    console.log('\nOK — iOS keyboard safeguards keep native focus and offer non-destructive recovery.');
})().catch(error => { console.error(error); process.exitCode = 1; });
