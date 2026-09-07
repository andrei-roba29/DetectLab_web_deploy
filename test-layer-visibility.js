// Coverage-highlight regression tests. No network, account or npm dependencies.
// Run: node test-layer-visibility.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const source = read('js/map-app.js');
const html = read('index.html');
const css = read('css/styles.css');
const sw = read('sw.js');
const ROW_CLASS = 'layer-visible-highlight';
const ARROW_CLASS = 'layer-group-arrow-highlight';
const groups = ['hist', 'lidar', 'roman', 'histPremium'];
const OUTSIDE = [[50, 32], [51, 33]];
const BANAT = [[45, 21], [45.1, 21.1]];
const BUCOVINA = [[48.35, 25], [48.4, 25.1]];
const ALL = [[40, 15], [52, 35]];

function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert(from >= 0 && to > from, 'production section must exist: ' + start);
    return source.slice(from, to);
}

const coverageConfig = section('var premiumMapCoverageBounds = {', '// Create coverage polygons');
const visibilityCode = section('// ── LAYER VISIBILITY HIGHLIGHT', '// ── BUCOVINA 1861-1864 (XYZ tiles');

// Leaflet-compatible rectangle intersection, including edge contact. Browser
// smoke checks use the actual bundled Leaflet; this keeps the unit test offline.
function latLngBounds(points) {
    if (points && typeof points.intersects === 'function') return points;
    const south = Math.min(points[0][0], points[1][0]);
    const west = Math.min(points[0][1], points[1][1]);
    const north = Math.max(points[0][0], points[1][0]);
    const east = Math.max(points[0][1], points[1][1]);
    return {
        south, west, north, east,
        intersects(other) {
            return other.north >= south && other.south <= north &&
                other.east >= west && other.west <= east;
        }
    };
}

class MapMock {
    constructor(points) {
        this.bounds = latLngBounds(points);
        this.listeners = {};
        this.reads = 0;
    }
    getBounds() { this.reads++; return this.bounds; }
    setBounds(points) { this.bounds = latLngBounds(points); }
    on(types, callback) {
        types.split(' ').forEach(type => (this.listeners[type] ||= new Set()).add(callback));
    }
    off(types, callback) {
        types.split(' ').forEach(type => this.listeners[type]?.delete(callback));
    }
    fire(type) { [...(this.listeners[type] || [])].forEach(callback => callback()); }
}

class ElementMock extends EventTarget {
    constructor(tag, attrs, parent) {
        super();
        this.tagName = tag;
        this.id = attrs.id || '';
        this.parentElement = parent;
        this.style = {};
        this.dataset = { category: attrs['data-category'], tab: attrs['data-tab'] };
        const classes = new Set((attrs.class || '').split(/\s+/));
        this.classList = {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name),
            toggle(name, on = !classes.has(name)) {
                if (on) classes.add(name); else classes.delete(name);
                return on;
            }
        };
    }
    closest(selector) {
        for (let el = this; el; el = el.parentElement) {
            if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) return el;
        }
        return null;
    }
}

// Read the actual row ancestry/IDs from index.html so PWA tests cannot silently
// pass with invented IDs or a different panel structure. Only element structure
// is needed; scripts, comments, text and CSS are intentionally not interpreted.
function makeDocument() {
    const document = new EventTarget();
    document.ids = new Map();
    document.elements = [];
    document.hidden = false;
    const stack = [];
    const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const markup = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    const tags = /<(\/?)([\w-]+)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
    for (const match of markup.matchAll(tags)) {
        const [, closing, tag, rawAttrs] = match;
        if (closing) {
            const index = stack.map(el => el.tagName).lastIndexOf(tag);
            if (index >= 0) stack.length = index;
            continue;
        }
        const attrs = {};
        for (const attr of rawAttrs.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
            attrs[attr[1]] = attr[2] ?? attr[3];
        }
        const el = new ElementMock(tag, attrs, stack.at(-1) || null);
        document.elements.push(el);
        if (el.id && !document.ids.has(el.id)) document.ids.set(el.id, el);
        if (tag === 'body') document.body = el;
        if (!voidTags.has(tag) && !rawAttrs.endsWith('/')) stack.push(el);
    }
    document.getElementById = id => document.ids.get(id) || null;
    document.querySelectorAll = selector => document.elements.filter(el => {
        if (selector === '[data-category]') return !!el.dataset.category;
        if (selector === '.transp-panel-tabs button') {
            return el.tagName === 'button' && !!el.closest('.transp-panel-tabs');
        }
        throw new Error('Unsupported test selector: ' + selector);
    });
    return document;
}

function setup({ local = new MapMock(OUTSIDE), exposed, legacy, pwa = false, visualViewport = true } = {}) {
    const document = makeDocument();
    document.body.classList.toggle('is-pwa', pwa);
    const window = new EventTarget();
    Object.assign(window, { _dlMap: exposed, map: legacy });
    if (visualViewport) window.visualViewport = new EventTarget();
    const frames = [];
    const intervals = [];
    const timeouts = [];
    window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
    const context = vm.createContext({
        window, document, map: local, L: { latLngBounds },
        setInterval: (callback, delay) => intervals.push({ callback, delay }),
        setTimeout: (callback, delay) => timeouts.push({ callback, delay })
    });
    vm.runInContext(source.match(/var ROMANIA_BOUNDS = [^;]+;/)[0], context);
    vm.runInContext(source.match(/var APM_BOUNDS = [^;]+;/)[0], context);
    vm.runInContext(coverageConfig + visibilityCode, context);
    return {
        window, document, context, local, intervals, timeouts,
        row: id => document.getElementById(id),
        check: () => window.checkLayerVisibility(),
        flushFrames: () => frames.splice(0).forEach(callback => callback()),
        flushTimeouts: () => timeouts.splice(0).forEach(({ callback }) => callback())
    };
}

function highlighted(h, id, className = ROW_CLASS) {
    const el = h.row(id);
    assert(el, id + ' exists in the shared desktop/PWA DOM');
    return el.classList.contains(className);
}

function assertGroupsUnoutlined(h) {
    groups.forEach(group => {
        const row = h.row(group + 'ExpandIcon').closest('.transp-layer-row');
        assert.equal(row.classList.contains(ROW_CLASS), false, group + ': only arrow, not parent row');
    });
}

function premiumRows(h) {
    return h.document.elements.filter(el => el.parentElement?.id === 'histPremiumSubLayers' && el.classList.contains(ROW_CLASS))
        .map(el => el.id).sort();
}

test('desktop: Banat highlights its leaf, not Bucovina or the whole historical group', () => {
    const h = setup({ local: new MapMock(BANAT) });
    // WWII also covers all of Banat. Excluding it would break intersects semantics.
    assert.deepEqual(premiumRows(h), ['banatRow', 'ww2Row']);
    assert.equal(highlighted(h, 'bucovinaRow'), false);
    assert.equal(highlighted(h, 'satellite60sRow'), true);
    assert.equal(highlighted(h, 'histPremiumExpandIcon', ARROW_CLASS), true);
    assertGroupsUnoutlined(h);
});

test('PWA: _dlMap takes precedence over a stale local map and window.map', () => {
    const active = new MapMock(BUCOVINA);
    const local = new MapMock(BANAT);
    const legacy = new MapMock(ALL);
    const h = setup({ exposed: active, local, legacy, pwa: true });
    assert.deepEqual(premiumRows(h), ['bucovinaRow', 'ww2Row']);
    assert.equal(active.reads, 1);
    assert.equal(local.reads + legacy.reads, 0);
    assert.equal(highlighted(h, 'histPremiumExpandIcon', ARROW_CLASS), true);
    assert.equal(h.row('transpPanel').classList.contains('open'), false);
    assertGroupsUnoutlined(h);
});

test('local map and legacy window.map fallbacks work; unavailable/unready maps are safe', () => {
    const legacy = new MapMock(BANAT);
    const h = setup({ local: null, legacy, visualViewport: false });
    assert.equal(highlighted(h, 'banatRow'), true);
    h.window.map = null;
    assert.doesNotThrow(h.check);
    h.window._dlMap = {};
    assert.doesNotThrow(h.check);
    h.window._dlMap = { getBounds() { throw new Error('not loaded'); } };
    assert.doesNotThrow(h.check);
    h.window._dlMap = new MapMock(BUCOVINA);
    h.check();
    assert.equal(highlighted(h, 'bucovinaRow'), true);
});

test('partial overlaps and boundary contact count; leaving coverage removes highlights', () => {
    const h = setup();
    h.local.setBounds([[44.5, 20.8], [44.6, 20.9]]); // only Banat's SW corner overlaps
    h.local.fire('moveend');
    assert.equal(highlighted(h, 'banatRow'), true);
    h.local.setBounds([[46.35, 22.45], [46.4, 22.5]]); // touches NE corner
    h.local.fire('zoomend');
    assert.equal(highlighted(h, 'banatRow'), true);
    h.local.setBounds(OUTSIDE);
    h.local.fire('moveend');
    assert.equal(highlighted(h, 'banatRow'), false);
    groups.forEach(group => assert.equal(highlighted(h, group + 'ExpandIcon', ARROW_CLASS), false));
});

test('moveend, zoomend and resize listen on the active map, without duplicate subscriptions', () => {
    const active = new MapMock(OUTSIDE);
    const h = setup({ exposed: active, pwa: true });
    ['moveend', 'zoomend', 'resize'].forEach(type => {
        active.setBounds(BUCOVINA);
        active.fire(type);
        assert.equal(highlighted(h, 'bucovinaRow'), true, type);
        active.setBounds(OUTSIDE);
        active.fire(type);
        assert.equal(highlighted(h, 'bucovinaRow'), false, type);
        assert.equal(active.listeners[type].size, 1);
        assert.equal(h.local.listeners[type], undefined);
    });
    const replacement = new MapMock(BANAT);
    h.window._dlMap = replacement;
    h.check();
    h.check();
    ['moveend', 'zoomend', 'resize'].forEach(type => {
        assert.equal(active.listeners[type].size, 0, 'detach old ' + type);
        assert.equal(replacement.listeners[type].size, 1, 'bind new ' + type + ' once');
    });
});

test('PWA periodic refresh runs with the panel closed, including when is-pwa is added later', () => {
    const h = setup();
    assert.equal(h.intervals.length, 1);
    assert.equal(h.intervals[0].delay, 2000);
    const tick = h.intervals[0].callback;
    h.local.setBounds(BUCOVINA);
    tick();
    assert.equal(highlighted(h, 'bucovinaRow'), false, 'desktop closed panel skips polling');
    h.document.body.classList.add('is-pwa');
    tick();
    assert.equal(highlighted(h, 'bucovinaRow'), true);
    h.document.body.classList.remove('is-pwa');
    h.row('transpPanel').classList.add('open');
    h.local.setBounds(OUTSIDE);
    tick();
    assert.equal(highlighted(h, 'bucovinaRow'), false, 'desktop open panel refreshes');
});

test('visualViewport/window resize and auth changes refresh after layout; bursts coalesce', () => {
    const h = setup({ pwa: true });
    h.window.visualViewport.dispatchEvent(new Event('resize'));
    h.window.dispatchEvent(new Event('resize'));
    h.window.dispatchEvent(new Event('detectlab:authchange'));
    assert.equal(h.local.reads, 1, 'defer until all handlers have updated the UI');
    h.local.setBounds(BUCOVINA);
    h.flushFrames();
    assert.equal(h.local.reads, 2, 'one check per frame');
    assert.equal(highlighted(h, 'bucovinaRow'), true);
    h.local.setBounds(OUTSIDE);
    h.window.dispatchEvent(new Event('detectlab:authchange'));
    h.flushFrames();
    assert.equal(highlighted(h, 'bucovinaRow'), false, 'logout refreshes too');
});

test('PWA bottom-bar click/change re-check after togglePwa actions without early function wrapping', () => {
    const h = setup({ pwa: true });
    assert.equal(h.window.togglePwaDetection, undefined, 'inline PWA functions are defined later');
    ['click', 'change'].forEach(type => {
        h.local.setBounds(OUTSIDE);
        h.check();
        h.row('pwaBottomBar').dispatchEvent(new Event(type));
        h.local.setBounds(BUCOVINA); // inline control/layout handler
        h.flushFrames();
        assert.equal(highlighted(h, 'bucovinaRow'), true, type);
    });
});

test('pageshow/foreground refresh a resumed PWA', () => {
    const h = setup({ pwa: true });
    h.local.setBounds(BUCOVINA);
    h.window.dispatchEvent(new Event('pageshow'));
    h.flushFrames();
    assert.equal(highlighted(h, 'bucovinaRow'), true);
    h.local.setBounds(OUTSIDE);
    h.document.hidden = true;
    h.document.dispatchEvent(new Event('visibilitychange'));
    h.flushFrames();
    assert.equal(highlighted(h, 'bucovinaRow'), true, 'do not schedule while hidden');
    h.document.hidden = false;
    h.document.dispatchEvent(new Event('visibilitychange'));
    h.flushFrames();
    assert.equal(highlighted(h, 'bucovinaRow'), false);
});

test('all real historical, LIDAR and Roman rows resolve in the shared PWA panel', () => {
    const h = setup({ local: new MapMock(ALL), pwa: true });
    const leafRows = h.document.elements.filter(el =>
        ['histSubLayers', 'lidarSubLayers', 'romanSubLayers', 'histPremiumSubLayers'].includes(el.parentElement?.id) &&
        h.document.elements.some(control => {
            if (control.tagName !== 'input') return false;
            for (let parent = control.parentElement; parent; parent = parent.parentElement) {
                if (parent === el) return true;
            }
            return false;
        }));
    assert.equal(leafRows.length, 53, '4 historical + 11 LIDAR + 28 Roman + 10 premium rows');
    // These optional Roman definitions have no row in this deployment.
    assert.equal(h.row('roman_shade_herod'), null);
    assert.equal(h.row('roman_shade_hasmonean'), null);
    leafRows.forEach(row => {
        assert.equal(row.classList.contains(ROW_CLASS), true, row.id || 'anonymous LIDAR/Roman row');
        assert.equal(row.closest('.transp-panel'), h.row('transpPanel'));
        assert.equal(row.closest('.pwa-bottom-bar'), null);
    });
    assertGroupsUnoutlined(h);
});

test('missing/late rows are safe and do not suppress the group arrow', () => {
    const h = setup({ local: new MapMock(OUTSIDE), pwa: true });
    const lateRows = ['bucovinaRow', 'ww2Row'].map(id => h.row(id));
    lateRows.forEach(row => h.document.ids.delete(row.id));
    h.local.setBounds(BUCOVINA);
    assert.doesNotThrow(h.check);
    assert.equal(highlighted(h, 'histPremiumExpandIcon', ARROW_CLASS), true);
    lateRows.forEach(row => h.document.ids.set(row.id, row));
    h.window.dispatchEvent(new Event('detectlab:authchange'));
    h.flushFrames();
    assert.equal(highlighted(h, 'bucovinaRow'), true);
});

test('group rows lose stale highlights both inside and outside coverage', () => {
    const h = setup();
    [OUTSIDE, ALL].forEach(bounds => {
        groups.forEach(group => h.row(group + 'ExpandIcon').closest('.transp-layer-row').classList.add(ROW_CLASS));
        h.local.setBounds(bounds);
        h.check();
        assertGroupsUnoutlined(h);
    });
});

test('tab switching and all five direct expand/panel hooks remain functional', () => {
    const h = setup();
    vm.runInContext(section('function switchLayerTab', '// Initialize with'), h.context);
    h.local.setBounds(BUCOVINA);
    h.context.switchLayerTab('premium');
    assert.equal(highlighted(h, 'bucovinaRow'), true);
    vm.runInContext('var _expanded = false, _lidarSubExpandedState = false, _histPremiumSubExpanded = false, transpPanelOpen = false;', h.context);
    ['toggleHistSubLayers', 'toggleLidarSubLayers', 'toggleRomanSubLayers', 'toggleHistPremiumSubLayers', 'toggleTranspPanel'].forEach(name => {
        const match = source.match(new RegExp('window\\.' + name + ' = function\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\s*\\};'));
        assert(match, name + ' has a direct implementation');
        assert(match[0].includes('window.checkLayerVisibility()'), name + ' retains its direct refresh');
        vm.runInContext(match[0], h.context);
        h.local.setBounds(OUTSIDE);
        h.check();
        h.local.setBounds(BUCOVINA);
        h.window[name]();
        h.flushTimeouts();
        h.flushFrames();
        assert.equal(highlighted(h, 'bucovinaRow'), true, name);
    });
});

test('highlight CSS never changes geometry, keeps rotations and uses only a small arrow glow', () => {
    const styles = css.slice(css.indexOf('/* ── Layer coverage highlight'));
    const rowRules = [...styles.matchAll(/\.layer-visible-highlight\s*\{([^}]+)\}/g)].map(match => match[1]);
    assert.equal(rowRules.length, 2);
    rowRules.forEach(rule => {
        assert(!/(?:^|[;\n])\s*(?:border|border-width|border-left|padding|margin|width|height)\s*:/m.test(rule), 'no layout-affecting declarations');
    });
    assert.match(styles, /outline:\s*1px solid rgba\(57,255,20,0\.85\)/);
    assert.match(styles, /outline-offset:\s*-1px/);
    assert.match(styles, /box-shadow:\s*-2px 0 0 #39ff14/);
    const arrowRule = styles.match(/\.layer-group-arrow-highlight\s*\{([^}]+)\}/)[1];
    assert.equal((arrowRule.match(/drop-shadow\(/g) || []).length, 1);
    assert.match(arrowRule, /drop-shadow\(0 0 3px rgba\(57,255,20,0\.6\)\)/);
    assert.match(styles, /transition: transform 0\.25s ease, color 0\.25s ease, filter 0\.25s ease !important/);
    assert.match(styles, /prefers-reduced-motion: reduce/);
    assert.match(styles, /outline: 1px solid transparent/, 'outline can fade out without losing its solid style');
    assert.match(styles, /#transpPanel \.layer-visible-highlight:focus-visible\s*\{[^}]*outline: 2px solid rgba\(184,216,240,0\.75\) !important/,
        'coverage must not hide the existing keyboard focus indicator');
});

test('PWA asset URLs are versioned together and pre-cached under a refreshed cache name', () => {
    const cssURL = html.match(/href="(css\/styles\.css\?v=[^"]+)"/)[1];
    const jsURL = html.match(/src="(js\/map-app\.js\?v=[^"]+)"/)[1];
    [cssURL, jsURL].forEach(url => {
        assert(!['css/styles.css?v=20260907-nearby-popup', 'js/map-app.js?v=20260902-satbase-native18'].includes(url),
            'do not reuse the pre-fix asset URLs');
        assert(sw.includes("'" + url + "'"), url + ' must be pre-cached exactly');
    });
    const cacheVersion = sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/);
    assert(cacheVersion && Number(cacheVersion[1]) >= 74, 'installed PWAs must invalidate the previous v73 cache');
});
