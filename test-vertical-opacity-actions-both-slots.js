// Regression test — layer quick actions must render under the slider in BOTH
// on-screen vertical mirrors (primary #verticalOpacityActions and secondary
// #verticalOpacityActionsSecondary), never beside/overlapping it.
//
// Bug: the docked-icon rules in css/styles.css were scoped to
// `#verticalOpacityActions …`. When a layer (APM 2.0, Josephine Map + /
// „Harta Iosefină Premium”) was mirrored into the SECOND slider, its buttons
// were moved physically into #verticalOpacityActionsSecondary but no longer
// matched any docked rule, so they fell back to their floating bottom-center
// geometry (position:absolute; bottom:76px; left:50%; translateX(±112px)) —
// out of the flex column, overlapping each other and off to the left of the
// slider.
//
// Usage: node test-vertical-opacity-actions-both-slots.js
// (no dependencies; run `npm install jsdom` in the repo root to also get the
//  real cascade check against index.html + css/styles.css — otherwise that
//  last section is skipped and the static + behaviour checks still run)
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const css = fs.readFileSync(path.join(__dirname, 'css/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const ACTION_IDS = ['apm20SearchHelpBtn', 'iosBldSearchHelpBtn', 'iosBldSettingsBtn', 'iosBldSuggestBtn'];

/* ───────────────────────── 1. static CSS cascade ───────────────────────── */

/* Minimal CSS block reader: returns { selector, declarations, inside } for
   every simple rule, with `inside` naming the @-rule it sits in. Enough for
   this stylesheet (no nested rules besides @media / @supports). */
function parseCss(text, inside) {
    const out = [];
    let i = 0;
    const scope = inside || '';
    while (i < text.length) {
        const comment = text.indexOf('/*', i);
        const nextSpecial = text.indexOf('{', i);
        if (comment !== -1 && comment < nextSpecial) {
            const end = text.indexOf('*/', comment + 2);
            i = end === -1 ? text.length : end + 2;
            continue;
        }
        if (nextSpecial === -1) break;
        const header = text.slice(i, nextSpecial).trim();
        /* Braces nest (@media wraps plain rules), so find the matching close
           instead of the first '}'. */
        let depth = 1;
        let close = -1;
        for (let j = nextSpecial + 1; j < text.length; j++) {
            if (text[j] === '{') depth++;
            else if (text[j] === '}' && --depth === 0) { close = j; break; }
        }
        if (close === -1) break;
        const body = text.slice(nextSpecial + 1, close);
        if (header.startsWith('@')) {
            /* Nested rules remember the @-rule they sit in. */
            const atName = header.split(/[\s{]/)[0];
            parseCss(body, scope ? scope + ' ' + atName : atName).forEach(rule => out.push(rule));
        } else if (header) {
            const declarations = {};
            /* Comments also live INSIDE a declaration block (before a
               property), so strip them before splitting on ';'. */
            const cleanBody = body.replace(/\/\*[\s\S]*?\*\//g, ' ');
            cleanBody.split(';').forEach(part => {
                const idx = part.indexOf(':');
                if (idx === -1) return;
                declarations[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
            });
            out.push({ selector: header.replace(/\s+/g, ' '), declarations, inside: scope });
        }
        i = close + 1;
    }
    return out;
}

const rules = parseCss(css);
assert(rules.length > 500, 'the stylesheet should parse into hundreds of rules, got ' + rules.length);

/* Does this selector target #<id> while it sits inside a docked actions slot?
   `.vertical-opacity-actions #id` matches both mirrors; the historical
   `#verticalOpacityActions #id` only ever matched the first one. */
function targetsDockedAction(selector, id) {
    return selector.split(',').some(part => {
        const s = part.trim();
        if (!s.endsWith('#' + id)) return false;
        const head = s.slice(0, s.length - id.length - 1).trim();
        if (!head) return false; // a bare `#id` rule is the floating variant
        const ancestor = head.split(/\s+/).pop();
        return ancestor === '.vertical-opacity-actions' || ancestor === '#verticalOpacityActions' ||
            ancestor === '#verticalOpacityActionsSecondary';
    });
}

function scopedToPrimaryOnly(selector, id) {
    return selector.split(',').some(part => {
        const s = part.trim();
        if (!s.endsWith('#' + id)) return false;
        const head = s.slice(0, s.length - id.length - 1).trim();
        return head.split(/\s+/).pop() === '#verticalOpacityActions';
    });
}

const DOCKED_GEOMETRY = {
    position: 'relative',
    bottom: 'auto',
    left: 'auto',
    transform: 'none'
};

/* The docked rules override the floating ones with !important; compare on the
   value itself. */
const valueOf = v => String(v || '').replace(/\s*!important\s*$/i, '').trim();

ACTION_IDS.forEach(id => {
    const docked = rules.filter(r => r.inside === '' && targetsDockedAction(r.selector, id));
    assert(docked.length > 0, 'no docked-icon rule found for #' + id);
    const merged = {};
    docked.forEach(r => Object.assign(merged, r.declarations));
    Object.keys(DOCKED_GEOMETRY).forEach(prop => {
        assert.strictEqual(
            valueOf(merged[prop]), DOCKED_GEOMETRY[prop],
            '#' + id + ' must leave the floating geometry when docked (' + prop + ')'
        );
    });
    assert(/^\d+px/.test(valueOf(merged.width)), '#' + id + ' must be a fixed square icon when docked');
    assert.strictEqual(
        rules.filter(r => scopedToPrimaryOnly(r.selector, id)).length, 0,
        '#' + id + ' must not be styled only for the primary mirror — the secondary ' +
        'mirror (#verticalOpacityActionsSecondary) hosts the same buttons'
    );
});

/* The label must become a bubble in both slots too. */
const tipRule = rules.find(r => r.inside === '' && /\.vertical-opacity-actions \.vo-action-tip$/.test(r.selector));
assert(tipRule, 'the .vo-action-tip bubble rule must key off the container class');
assert.strictEqual(tipRule.declarations.position, 'absolute', 'the tip is a bubble, not inline text');

/* The dock container itself is shared by both mirrors: centred under the card,
   icons stacked vertically. */
const dockRule = rules.find(r => r.inside === '' && r.selector === '.vertical-opacity-actions');
assert(dockRule, '.vertical-opacity-actions must exist as a shared container rule');
assert.strictEqual(dockRule.declarations['flex-direction'], 'column', 'actions stack vertically under the slider');
assert.strictEqual(dockRule.declarations['align-items'], 'center', 'actions stay centred under the slider');
assert.strictEqual(dockRule.declarations.left, '50%', 'the dock is centred on the slider card');

/* Both mirrors really ship the container in index.html. */
['verticalOpacityActions', 'verticalOpacityActionsSecondary'].forEach(id => {
    assert(
        new RegExp('class="vertical-opacity-actions" id="' + id + '"').test(html),
        'index.html must keep .vertical-opacity-actions#' + id
    );
});

/* The Josephine settings panel anchors beside the mirror that owns the buttons:
   the base anchor (primary mirror) plus a wider one for the secondary mirror. */
const panelRules = rules.filter(r => /#iosBldSettingsPanel/.test(r.selector) && /vo-josephine-docked/.test(r.selector));
assert(panelRules.some(r => /vo-josephine-docked-secondary/.test(r.selector) && r.declarations.right),
    'the settings panel needs its own anchor while Josephine sits in the secondary mirror');

/* ── a lone mirror keeps the right-most anchor ──
   The secondary slot sits one mirror-width to the left so two sliders fit side
   by side. When the right-hand slider is closed the remaining one must take the
   primary anchor, otherwise a single slider floats off to the left with an
   empty band next to the map edge. */
const SOLE_SELECTOR = '.vertical-opacity-control.mirror-sole';
const PRIMARY_RIGHT_DESKTOP = 'calc(38px + env(safe-area-inset-right, 0px))';
const PRIMARY_RIGHT_MOBILE = 'calc(34px + env(safe-area-inset-right, 0px))';
const SECONDARY_SELECTOR = '.vertical-opacity-control.vertical-opacity-secondary';

const topRules = rules.filter(r => !r.inside);
const soleDesktopIdx = topRules.findIndex(r => r.selector === SOLE_SELECTOR);
const secondaryDesktopIdx = topRules.findIndex(r => r.selector === SECONDARY_SELECTOR);
assert(secondaryDesktopIdx !== -1, 'the desktop secondary anchor must exist');
assert(soleDesktopIdx > secondaryDesktopIdx,
    'the sole-mirror rule must come after the secondary anchor (same specificity)');
assert.strictEqual(topRules[soleDesktopIdx].declarations.right, PRIMARY_RIGHT_DESKTOP,
    'a lone mirror sits on the primary anchor');

const mobileRules = rules.filter(r => /@media/.test(r.inside || ''));
const secondaryMobileIdx = mobileRules.findIndex(r => r.selector === SECONDARY_SELECTOR);
assert(secondaryMobileIdx !== -1, 'the narrow-screen block re-states the secondary anchor');
const soleMobileIdx = mobileRules.findIndex(r => r.selector === SOLE_SELECTOR);
assert(soleMobileIdx > secondaryMobileIdx,
    'the narrow-screen block needs the sole-mirror anchor too, after the secondary one');
assert.strictEqual(mobileRules[soleMobileIdx].declarations.right, PRIMARY_RIGHT_MOBILE,
    'a lone mirror sits on the narrow-screen primary anchor');
const mirrorBase = rules.find(r => !r.inside && r.selector === '.vertical-opacity-control');
assert(mirrorBase && /right/.test(mirrorBase.declarations.transition || ''),
    'the mirror animates `right`, so taking over the right-most anchor glides instead of jumping');

/* ──────────────── 2. behaviour: buttons follow the active mirror ──────────────── */

class ClassList {
    constructor(classes) { this._set = new Set(classes || []); }
    add(...names) { names.forEach(name => this._set.add(name)); }
    remove(...names) { names.forEach(name => this._set.delete(name)); }
    contains(name) { return this._set.has(name); }
    toggle(name, force) {
        const on = force === undefined ? !this.contains(name) : !!force;
        if (on) this.add(name); else this.remove(name);
        return on;
    }
}

class MockElement extends EventTarget {
    constructor(tag, id, classes) {
        super();
        this.tagName = String(tag || 'div').toUpperCase();
        this.id = id || '';
        this.classList = new ClassList(classes);
        this.parentElement = null;
        this.children = [];
        this.attributes = {};
        this.style = {};
        this.textContent = '';
        this.value = '';
        this.min = '0';
        this.max = '100';
        this.step = '1';
        this.title = '';
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    insertBefore(child, ref) {
        child.parentElement = this;
        const at = this.children.indexOf(ref);
        if (at < 0) this.children.push(child); else this.children.splice(at, 0, child);
        return child;
    }
    removeChild(child) {
        const at = this.children.indexOf(child);
        if (at >= 0) this.children.splice(at, 1);
        child.parentElement = null;
        return child;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] || null; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelector(selector) {
        if (selector === '.vo-action-tip') {
            return this.children.find(c => c.classList && c.classList.contains('vo-action-tip')) || null;
        }
        return null;
    }
    querySelectorAll() { return []; }
    click() { this.dispatchEvent(new Event('click', { bubbles: true })); }
}

function range(id, value) {
    const el = new MockElement('input', id, ['transp-slider']);
    el.value = String(value);
    return el;
}

const byId = {};
const add = el => { byId[el.id] = el; return el; };

function mirror(prefix) {
    const root = add(new MockElement('div', prefix + 'Control', ['vertical-opacity-control']));
    const close = add(new MockElement('button', prefix + 'Close'));
    const title = add(new MockElement('span', prefix + 'Title'));
    const caption = add(new MockElement('span', prefix + 'Caption'));
    const label = add(new MockElement('span', prefix + 'Layer'));
    const slider = add(range(prefix + 'Slider', 80));
    const output = add(new MockElement('output', prefix + 'Value'));
    const actions = add(new MockElement('div', prefix + 'Actions', ['vertical-opacity-actions']));
    root.appendChild(close); root.appendChild(title); title.appendChild(caption); title.appendChild(label);
    root.appendChild(slider); root.appendChild(output); root.appendChild(actions);
    return { root, close, caption, label, slider, output, actions };
}

const panel = add(new MockElement('div', 'transpPanel', ['open']));
const primary = mirror('verticalOpacity');
const secondary = mirror('verticalOpacitySecondary');
/* The real secondary markup keeps the primary id and appends "Secondary". */
byId.verticalOpacityControlSecondary = secondary.root;
byId.verticalOpacityCloseSecondary = secondary.close;
byId.verticalOpacityCaptionSecondary = secondary.caption;
byId.verticalOpacityLayerSecondary = secondary.label;
byId.verticalOpacitySliderSecondary = secondary.slider;
byId.verticalOpacityValueSecondary = secondary.output;
byId.verticalOpacityActionsSecondary = secondary.actions;

const mapWrapper = add(new MockElement('div', 'mapWrapper', ['map-wrapper']));
const actionButtons = ACTION_IDS.map(id => {
    const btn = add(new MockElement('button', id));
    const tip = new MockElement('span', id + 'Label', ['t', 'vo-action-tip']);
    tip.textContent = 'label ' + id;
    btn.appendChild(tip);
    mapWrapper.appendChild(btn);
    return btn;
});

const apm20Owner = new MockElement('div', 'apm20Owner', ['opacity-layer-selectable']);
const josephineOwner = new MockElement('div', 'josephineOwner', ['opacity-layer-selectable']);
const lidarOwner = new MockElement('div', 'lidarOwner', ['opacity-layer-selectable']);
const apm20 = add(range('apm20OpacitySlider', 80));
const josephine = add(range('josephineOpacitySlider', 70));
const lidarHd = add(range('lidarHdOpacitySlider', 35));
apm20Owner.appendChild(apm20);
josephineOwner.appendChild(josephine);
lidarOwner.appendChild(lidarHd);
panel.appendChild(apm20Owner);
panel.appendChild(josephineOwner);
panel.appendChild(lidarOwner);
const allOwners = [apm20Owner, josephineOwner, lidarOwner];

const documentMock = new (class extends EventTarget {
    constructor() { super(); this.readyState = 'complete'; this.body = new MockElement('body'); }
    getElementById(id) { return byId[id] || null; }
    createElement(tag) { return new MockElement(tag); }
    querySelectorAll(selector) {
        if (selector.indexOf('[id*="Opacity"]') !== -1) return [apm20, josephine, lidarHd];
        if (selector === '#transpPanel .opacity-layer-selectable') return allOwners;
        return [];
    }
})();

const intervals = new Map();
const timeouts = new Map();
let nextId = 0;
const windowMock = {
    setInterval(fn) { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { const id = ++nextId; timeouts.set(id, fn); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    addEventListener() {}
};
windowMock.window = windowMock;
windowMock.document = documentMock;

const sandbox = { window: windowMock, document: documentMock, Event, console, Number, String, Math, isFinite };
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, 'js/vertical-opacity-control.js'), 'utf8'),
    sandbox,
    { filename: 'vertical-opacity-control.js' }
);

const api = windowMock.DetectLabVerticalOpacity;
assert(api, 'the mirror API should initialise');
const body = documentMock.body;

const LAYER_ACTIONS = {
    apm20OpacitySlider: ['apm20SearchHelpBtn'],
    josephineOpacitySlider: ['iosBldSearchHelpBtn', 'iosBldSettingsBtn', 'iosBldSuggestBtn']
};
const buttonById = {};
actionButtons.forEach(btn => { buttonById[btn.id] = btn; });

/* syncLayerActions() docks ONLY the buttons of the active layer and sends the
   other layers' buttons back to .map-wrapper. */
function assertActions(sliderId, container, label) {
    const wanted = LAYER_ACTIONS[sliderId];
    wanted.forEach(id => {
        const btn = buttonById[id];
        assert.strictEqual(btn.parentElement.id, container.id,
            label + ': #' + id + ' must live in ' + container.id);
        assert(btn.classList.contains('vo-docked'), label + ': #' + id + ' keeps the docked hook class');
    });
    ACTION_IDS.filter(id => wanted.indexOf(id) === -1).forEach(id => {
        const btn = buttonById[id];
        assert.strictEqual(btn.parentElement.id, mapWrapper.id,
            label + ': #' + id + ' belongs to another layer and stays in .map-wrapper');
        assert(!btn.classList.contains('vo-docked'), label + ': #' + id + ' drops the docked class');
    });
}

function assertActionsAtHome(label) {
    ACTION_IDS.forEach(id => {
        const btn = buttonById[id];
        assert.strictEqual(btn.parentElement.id, mapWrapper.id,
            label + ': #' + id + ' must return to .map-wrapper');
        assert(!btn.classList.contains('vo-docked'), label + ': #' + id + ' drops the docked class');
    });
}

/* APM 2.0 alone → primary mirror. */
api.select('apm20OpacitySlider');
assert(primary.root.classList.contains('visible'), 'APM 2.0 opens the primary mirror');
assertActions('apm20OpacitySlider', primary.actions, 'APM 2.0 in the primary mirror');
assert(body.classList.contains('vo-josephine-docked') === false, 'Josephine is not docked yet');
assert(body.classList.contains('vo-josephine-docked-secondary') === false,
    'no secondary anchor while APM 2.0 owns the actions');

/* Josephine selected second → its own buttons in the SECONDARY mirror. */
api.select('josephineOpacitySlider');
assert(secondary.root.classList.contains('visible'), 'Josephine opens the secondary mirror');
assert.strictEqual(api.getActiveSliderId(), 'josephineOpacitySlider', 'Josephine is the active mirror');
assertActions('josephineOpacitySlider', secondary.actions, 'Josephine in the secondary mirror');
assert(body.classList.contains('vo-josephine-docked'), 'Josephine docks its settings panel');
assert(body.classList.contains('vo-josephine-docked-secondary'),
    'the settings panel must follow Josephine into the secondary mirror');

/* Josephine leaves the screen → buttons go home, the anchors drop. */
api.close();
assert(!secondary.root.classList.contains('visible'), 'the secondary mirror closes');
assertActionsAtHome('after closing every mirror');
assert(!body.classList.contains('vo-josephine-docked'), 'the panel anchor is released');
assert(!body.classList.contains('vo-josephine-docked-secondary'), 'the secondary anchor is released');

/* Josephine first → primary mirror, so the extra anchor must NOT be set. */
api.select('josephineOpacitySlider');
assertActions('josephineOpacitySlider', primary.actions, 'Josephine alone uses the primary mirror');
assert(body.classList.contains('vo-josephine-docked'), 'Josephine docks its settings panel');
assert(!body.classList.contains('vo-josephine-docked-secondary'),
    'the primary mirror keeps the base panel anchor');

/* Selecting APM 2.0 on top of it moves the actions to the secondary mirror. */
api.select('apm20OpacitySlider');
assertActions('apm20OpacitySlider', secondary.actions, 'APM 2.0 in the secondary mirror');
assert(!body.classList.contains('vo-josephine-docked'), 'Josephine is no longer the active layer');
assert(!body.classList.contains('vo-josephine-docked-secondary'), 'its anchor is released with it');

console.log('OK — layer quick actions dock under the slider in both mirrors (CSS + behaviour).');

/* ─────────── 2b. a lone mirror takes the right-most position ─────────── */

function assertSole(control, label) {
    assert(control.classList.contains('mirror-sole'), label + ': the lone mirror gets .mirror-sole');
}

function assertNotSole(control, label) {
    assert(!control.classList.contains('mirror-sole'), label + ': ' + control.id + ' is not alone on screen');
}

api.close();
api.select('apm20OpacitySlider');
api.select('josephineOpacitySlider');
assert(primary.root.classList.contains('visible') && secondary.root.classList.contains('visible'),
    'both mirrors are on screen');
assertNotSole(primary.root, 'two mirrors');
assertNotSole(secondary.root, 'two mirrors');

/* Close the RIGHT-hand slider → the remaining one takes its place. */
primary.close.click();
assert(!primary.root.classList.contains('visible'), 'the right-hand mirror is closed');
assert(secondary.root.classList.contains('visible'), 'the other mirror stays on screen');
assertSole(secondary.root, 'the remaining mirror moves to the right-most anchor');
assert(!body.classList.contains('vo-josephine-docked-secondary'),
    'the Josephine panel follows the mirror back to the primary anchor');

/* Closing it too leaves no mirror (and no stale class). */
secondary.close.click();
assertNotSole(secondary.root, 'after closing the last mirror');
assertNotSole(primary.root, 'after closing the last mirror');

/* Close the LEFT-hand slider instead → the primary stays where it is. */
api.select('apm20OpacitySlider');
api.select('josephineOpacitySlider');
secondary.close.click();
assertSole(primary.root, 'the primary mirror keeps the right-most anchor');
assertNotSole(secondary.root, 'the closed mirror carries no anchor class');

/* A further selection refills the freed slot, so two mirrors share the screen
   again and neither is "sole". */
api.select('lidarHdOpacitySlider');
assert(primary.root.classList.contains('visible') && secondary.root.classList.contains('visible'),
    'a third selection reuses the freed slot');
assertNotSole(primary.root, 'two mirrors again');
assertNotSole(secondary.root, 'two mirrors again');
api.close();

/* ───────── 3. optional: real cascade against index.html + styles.css ───────── */

function resolveJsdom() {
    const candidates = ['jsdom', path.join(__dirname, 'node_modules', 'jsdom')];
    for (const c of candidates) {
        try { return require(c); } catch (e) { /* try the next candidate */ }
    }
    /* Not installed (node_modules/ is git-ignored). `npm install jsdom` in the
       repo root enables this section; without it the test skips the
       computed-style check and still runs parts 1 and 2 with zero deps. */
    return null;
}

const jsdom = resolveJsdom();
if (!jsdom) {
    console.log('jsdom not resolvable — computed-style check skipped.');
    process.exit(0);
}

/* Reuse the real markup: cut the four buttons and both mirrors out of
   index.html (comments mention the same ids, so only real tags count). */
function cutElement(source, id) {
    const anchor = new RegExp('id=["\']' + id + '["\']');
    const tagRe = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
    let m;
    let start = -1;
    let startTag = '';
    while ((m = tagRe.exec(source)) !== null) {
        if (m[0][1] === '/' || m[0].endsWith('/>')) continue;
        if (anchor.test(m[2])) { start = m.index; startTag = m[1].toLowerCase(); break; }
    }
    assert(start >= 0, 'index.html must contain #' + id);
    let depth = 1;
    tagRe.lastIndex = start + m[0].length;
    while ((m = tagRe.exec(source)) !== null) {
        if (m[1].toLowerCase() !== startTag) continue;
        if (m[0][1] === '/') depth--;
        else if (!m[0].endsWith('/>')) depth++;
        if (depth === 0) return source.slice(start, m.index + m[0].length);
    }
    throw new Error('unbalanced element: ' + id);
}

const cleanHtml = html.replace(/<!--[\s\S]*?-->/g, c => ' '.repeat(c.length));
const fragment =
    ACTION_IDS.map(id => cutElement(cleanHtml, id)).join('\n') +
    cutElement(cleanHtml, 'verticalOpacityControl') +
    cutElement(cleanHtml, 'verticalOpacityControlSecondary');

const dom = new jsdom.JSDOM('<!DOCTYPE html><html><body><div class="map-frame"><div class="map-wrapper">' +
    fragment + '</div></div></body></html>');
const win = dom.window;
const doc = win.document;
const styleEl = doc.createElement('style');
styleEl.textContent = css;
doc.head.appendChild(styleEl);

const primaryDock = doc.getElementById('verticalOpacityActions');
const secondaryDock = doc.getElementById('verticalOpacityActionsSecondary');

function checkDock(container, label) {
    ACTION_IDS.forEach(id => {
        const btn = doc.getElementById(id);
        container.appendChild(btn);          // what syncLayerActions() does
        btn.classList.add('vo-docked');
        btn.style.display = 'flex';         // what map-app.js does when the layer is on
        const cs = win.getComputedStyle(btn);
        ['position', 'bottom', 'left', 'transform', 'width', 'height'].forEach(prop => {
            const expected = { position: 'relative', bottom: 'auto', left: 'auto', transform: 'none', width: '38px', height: '38px' }[prop];
            assert.strictEqual(cs[prop], expected, label + ': #' + id + ' ' + prop + ' should be ' + expected + ', got ' + cs[prop]);
        });
        const tip = btn.querySelector('.vo-action-tip');
        assert(tip, '#' + id + ' keeps its label element');
        assert.strictEqual(win.getComputedStyle(tip).position, 'absolute',
            label + ': the label of #' + id + ' must be a bubble, not inline text');
    });
}

checkDock(primaryDock, 'primary mirror');
checkDock(secondaryDock, 'secondary mirror');

/* ── the lone mirror keeps the right-most anchor (real cascade) ── */
const primaryControl = doc.getElementById('verticalOpacityControl');
const secondaryControl = doc.getElementById('verticalOpacityControlSecondary');
const rightOf = el => win.getComputedStyle(el).right;
const primaryAnchor = rightOf(primaryControl);
const pairAnchor = rightOf(secondaryControl);
assert(pairAnchor !== primaryAnchor,
    'the secondary slot starts one mirror-width to the left (' + pairAnchor + ' vs ' + primaryAnchor + ')');
secondaryControl.classList.add('mirror-sole');      // what refreshSoleMirrorAnchor() does
secondaryControl.classList.add('visible');
assert.strictEqual(rightOf(secondaryControl), primaryAnchor,
    'a lone mirror must sit exactly on the primary anchor (' + primaryAnchor +
    '), got ' + rightOf(secondaryControl));
secondaryControl.classList.remove('mirror-sole');
assert.strictEqual(rightOf(secondaryControl), pairAnchor,
    'with two mirrors on screen the secondary slot returns to its own anchor');
assert(!primaryControl.classList.contains('mirror-sole'), 'the primary mirror keeps its anchor');

console.log('OK — real cascade (jsdom): docked icons are identical in both mirrors, ' +
    'and a lone mirror sits on the right-most anchor.');
