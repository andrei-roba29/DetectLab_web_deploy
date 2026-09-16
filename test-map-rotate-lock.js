// Unit and integration tests for map rotation sensitivity fix + tap compass lock
// Usage: node test-map-rotate-lock.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running test-map-rotate-lock.js...\n');

const localStorageMock = {
    _data: {},
    getItem(k) { return this._data[k] !== undefined ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

function createMockElement(tag, className) {
    let _innerHtml = '';
    const el = {
        tagName: (tag || 'div').toUpperCase(),
        className: className || '',
        classList: {
            _set: new Set((className || '').split(' ').filter(Boolean)),
            add(c) { this._set.add(c); el.className = Array.from(this._set).join(' '); },
            remove(c) { this._set.delete(c); el.className = Array.from(this._set).join(' '); },
            toggle(c, force) {
                if (force === undefined) force = !this._set.has(c);
                if (force) this.add(c); else this.remove(c);
                return force;
            },
            contains(c) { return this._set.has(c); }
        },
        style: {},
        children: [],
        attributes: {},
        get innerHTML() { return _innerHtml; },
        set innerHTML(html) {
            _innerHtml = html;
            this.children = [];
            // Parse top-level/nested mock elements from html string
            const tagRegex = /<([a-z0-9-]+)\b([^>]*)>([\s\S]*?)<\/\1>|<([a-z0-9-]+)\b([^>]*)\/>/gi;
            let match;
            while ((match = tagRegex.exec(html)) !== null) {
                const tagName = match[1] || match[4];
                const attrs = match[2] || match[5] || '';
                const inner = match[3] || '';
                const classMatch = attrs.match(/class=["']([^"']+)["']/i);
                const cls = classMatch ? classMatch[1] : '';
                const child = createMockElement(tagName, cls);
                if (inner) child.innerHTML = inner;
                this.appendChild(child);
            }
        },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k]; },
        appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
            return child;
        },
        querySelector(sel) {
            function match(node) {
                if (!node) return null;
                if (sel.startsWith('.') && node.classList && node.classList.contains(sel.slice(1))) return node;
                if (sel.startsWith('#') && node.id === sel.slice(1)) return node;
                for (let c of (node.children || [])) {
                    const found = match(c);
                    if (found) return found;
                }
                return null;
            }
            return match(this);
        },
        querySelectorAll(sel) {
            const results = [];
            function traverse(node) {
                if (!node) return;
                if (sel.startsWith('.') && node.classList && node.classList.contains(sel.slice(1))) results.push(node);
                for (let c of (node.children || [])) traverse(c);
            }
            traverse(this);
            return results;
        },
        addEventListener(event, fn) {
            this._listeners = this._listeners || {};
            this._listeners[event] = this._listeners[event] || [];
            this._listeners[event].push(fn);
        },
        removeEventListener(event, fn) {
            if (!this._listeners || !this._listeners[event]) return;
            this._listeners[event] = this._listeners[event].filter(l => l !== fn);
        },
        dispatchEvent(evt) {
            const list = (this._listeners && this._listeners[evt.type]) || [];
            for (let l of list) l.call(this, evt);
        }
    };
    return el;
}

// Minimal mock of Leaflet 1.9 core structures for testing rotation + compass
function createLeafletMock() {
    function Class() {}
    Class.extend = function (props) {
        function Sub() {
            if (this.initialize) this.initialize.apply(this, arguments);
        }
        Sub.prototype = Object.create(this.prototype);
        Sub.prototype.constructor = Sub;
        for (let k in props) Sub.prototype[k] = props[k];
        Sub.extend = Class.extend;
        Sub.include = function (extra) {
            for (let k in extra) Sub.prototype[k] = extra[k];
        };
        Sub.mergeOptions = function (opts) {
            Sub.prototype.options = Object.assign(Sub.prototype.options || {}, opts);
        };
        Sub.addInitHook = function (fn) {
            Sub._initHooks = Sub._initHooks || [];
            Sub._initHooks.push(fn);
        };
        return Sub;
    };

    const Evented = Class.extend({
        on(types, fn, ctx) {
            this._events = this._events || {};
            for (let t of types.split(' ')) {
                this._events[t] = this._events[t] || [];
                this._events[t].push({ fn, ctx });
            }
            return this;
        },
        off(types, fn) {
            this._events = this._events || {};
            for (let t of types.split(' ')) {
                if (!this._events[t]) continue;
                this._events[t] = this._events[t].filter(e => e.fn !== fn);
            }
            return this;
        },
        fire(type, data) {
            this._events = this._events || {};
            const list = this._events[type] || [];
            const evt = Object.assign({ type, target: this }, data);
            for (let l of list) l.fn.call(l.ctx || this, evt);
            return this;
        }
    });

    function Point(x, y) { this.x = x; this.y = y; }
    Point.prototype = {
        clone() { return new Point(this.x, this.y); },
        add(p) { return new Point(this.x + p.x, this.y + p.y); },
        subtract(p) { return new Point(this.x - p.x, this.y - p.y); },
        _divideBy(num) { return new Point(this.x / num, this.y / num); },
        distanceTo(p) {
            const dx = this.x - p.x;
            const dy = this.y - p.y;
            return Math.sqrt(dx * dx + dy * dy);
        }
    };

    const MapClass = Evented.extend({
        initialize(container, options) {
            this._container = container;
            this.options = Object.assign({}, this.options, options);
            this._handlers = {};
            this._mapPane = createMockElement('div', 'leaflet-map-pane');
            if (MapClass._initHooks) {
                for (let hook of MapClass._initHooks) hook.call(this);
            }
        },
        addHandler(name, HandlerClass) {
            this._handlers[name] = new HandlerClass(this);
            this[name] = this._handlers[name];
        },
        whenReady(fn) { fn.call(this); },
        getSize() { return new Point(800, 600); },
        _getMapPanePos() { return new Point(0, 0); },
        mouseEventToContainerPoint(e) {
            return new Point(e.clientX || 0, e.clientY || 0);
        }
    });

    const Handler = Class.extend({
        initialize(map) { this._map = map; this._enabled = false; },
        enable() { this._enabled = true; if (this.addHooks) this.addHooks(); return this; },
        disable() { this._enabled = false; if (this.removeHooks) this.removeHooks(); return this; },
        enabled() { return this._enabled; }
    });

    const Control = Class.extend({
        options: { position: 'topright' },
        initialize(opts) { this.options = Object.assign({}, this.options, opts); },
        addTo(map) {
            this._map = map;
            this._container = this.onAdd(map);
            return this;
        }
    });

    const DomUtil = {
        create(tag, className, parent) {
            const el = createMockElement(tag, className);
            if (parent) parent.appendChild(el);
            return el;
        },
        setPosition(el, point) {
            el._leaflet_pos = point;
        },
        getPosition(el) {
            return el._leaflet_pos || new Point(0, 0);
        },
        disableTextSelection() {},
        enableTextSelection() {},
        addClass(el, c) { if (el && el.classList) el.classList.add(c); },
        removeClass(el, c) { if (el && el.classList) el.classList.remove(c); },
        TRANSFORM: 'transform'
    };

    const DomEvent = {
        on(el, types, fn, ctx) {
            for (let t of types.split(' ')) {
                if (el.addEventListener) {
                    const handler = ctx ? fn.bind(ctx) : fn;
                    el.addEventListener(t, handler);
                }
            }
        },
        off(el, types, fn) {
            for (let t of types.split(' ')) {
                if (el.removeEventListener) el.removeEventListener(t, fn);
            }
        },
        stop(e) {
            if (e && e.stopPropagation) e.stopPropagation();
            if (e && e.preventDefault) e.preventDefault();
            return this;
        },
        preventDefault(e) { if (e && e.preventDefault) e.preventDefault(); return this; },
        stopPropagation(e) { if (e && e.stopPropagation) e.stopPropagation(); return this; },
        disableClickPropagation() {},
        disableScrollPropagation() {}
    };

    const Util = {
        requestAnimFrame: (cb) => setTimeout(cb, 16),
        cancelAnimFrame: (id) => clearTimeout(id)
    };

    return {
        Class,
        Evented,
        Map: MapClass,
        Handler,
        Control,
        control: (opts) => new Control(opts),
        point: (x, y) => new Point(x, y),
        Point,
        DomUtil,
        DomEvent,
        Util,
        Browser: { any3d: true },
        bind: (fn, ctx) => fn.bind(ctx),
        latLngBounds: (bounds) => bounds
    };
}

const L = createLeafletMock();
global.L = L;
global.localStorage = localStorageMock;
global.window = global;
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.PointerEvent = function () {};

const rotateCode = fs.readFileSync(path.join(__dirname, 'js/map-rotate.js'), 'utf8');
const rotateFn = new Function('L', 'window', 'document', rotateCode);
rotateFn(L, global, {
    documentElement: { style: {} },
    body: createMockElement('body'),
    addEventListener: () => {},
    removeEventListener: () => {}
});

// -------------------------------------------------------------
// Test 1: Bearing calculations and Snap-to-North threshold
// -------------------------------------------------------------
console.log('[1] Bearing calculations & Snap-to-North threshold');
const mapEl = createMockElement('div');
const map = new L.Map(mapEl, {
    rotate: true,
    touchRotate: true,
    keyRotate: true,
    bearing: 0
});

assert.strictEqual(map.getBearing(), 0, 'initial bearing is 0°');

map.setBearing(45);
assert.strictEqual(map.getBearing(), 45, 'bearing set to 45°');

// Snapping to North within 3.0 degrees
map.setBearing(2.8);
assert.strictEqual(map.getBearing(), 0, 'bearing of 2.8° snaps to 0°');

map.setBearing(-2.9);
assert.strictEqual(map.getBearing(), 0, 'bearing of -2.9° snaps to 0°');

map.setBearing(15);
assert.strictEqual(map.getBearing(), 15, 'bearing outside snap range stays 15°');

// An unrotated map pane must keep Leaflet's 0 0 transform-origin. A
// centre origin makes tiles and vector overlays (heritage, LIDAR,
// archeo) scale around the wrong point while zooming, so dots slide
// off their geographic sites.
map.setBearing(0);
assert.strictEqual(
    String(map._mapPane.style.transformOrigin),
    '0px 0px',
    'unrotated map pane must use transform-origin 0 0 so zoom animation stays locked'
);
map.setBearing(15);
const origin15 = String(map._mapPane.style.transformOrigin);
assert(
    origin15 !== '0px 0px' && origin15.indexOf('px') !== -1,
    'rotated map pane may pivot around the viewport centre, got ' + origin15
);
console.log('  ✔ snap-to-north works within 3.0°');
console.log('  ✔ transform-origin is 0 0 when the map is not rotated');

// -------------------------------------------------------------
// Test 2: Rotation Lock API on L.Map
// -------------------------------------------------------------
console.log('\n[2] Rotation Lock API on L.Map');
assert.strictEqual(map.isRotateLocked(), false, 'initially unlocked');

let lockEventReceived = null;
map.on('rotatelockchange', (e) => { lockEventReceived = e.locked; });

map.setRotateLocked(true);
assert.strictEqual(map.isRotateLocked(), true, 'isRotateLocked returns true when locked');
assert.strictEqual(lockEventReceived, true, 'rotatelockchange fired with locked: true');
assert.strictEqual(localStorageMock.getItem('detectlab_rotation_locked'), 'true', 'persists locked=true in localStorage');

// When locked, interactive setBearing is blocked without {force: true}
map.setBearing(80);
assert.strictEqual(map.getBearing(), 15, 'bearing unchanged while locked');

// Forced programmatic setBearing still works
map.setBearing(80, { force: true });
assert.strictEqual(map.getBearing(), 80, 'forced bearing succeeds even when locked');

map.setRotateLocked(false);
assert.strictEqual(map.isRotateLocked(), false, 'isRotateLocked returns false when unlocked');
assert.strictEqual(lockEventReceived, false, 'rotatelockchange fired with locked: false');
assert.strictEqual(localStorageMock.getItem('detectlab_rotation_locked'), 'false', 'persists locked=false in localStorage');

map.setBearing(95);
assert.strictEqual(map.getBearing(), 95, 'bearing updates normally when unlocked');
console.log('  ✔ map.setRotateLocked(true/false) works and blocks rotation when locked');

// -------------------------------------------------------------
// -------------------------------------------------------------
// Test 3: Compass Control DOM Structure (tap buttons, no slide)
// -------------------------------------------------------------
console.log('\n[3] Compass Control DOM Structure');
const compass = L.control.compass({ position: 'bottomleft' });
const compassWrap = compass.onAdd(map);

assert(compassWrap.classList.contains('detectlab-compass'), 'compass container has detectlab-compass class');
const col = compassWrap.querySelector('.detectlab-compass-col');
assert(col, 'compass button column exists');
assert.strictEqual(col.id, 'compassCol', 'column carries the compassCol id');

const btn = compassWrap.querySelector('.detectlab-compass-btn');
assert(btn, 'compass button exists');
assert.strictEqual(btn.tagName, 'BUTTON', 'compass is a real <button>');
assert(btn.querySelector('.detectlab-compass-rose'), 'compass rose needle exists inside button');

const lock = compassWrap.querySelector('.detectlab-compass-lock');
assert(lock, 'rotation lock button exists');
assert.strictEqual(lock.tagName, 'BUTTON', 'lock is a real <button>');
assert.strictEqual(lock.id, 'compassLockBtn', 'lock button carries the compassLockBtn id');
assert(lock.querySelector('.dl-lock-icon-unlocked'), 'unlocked lock icon exists in lock button');
assert(lock.querySelector('.dl-lock-icon-locked'), 'locked lock icon exists in lock button');

const det = compassWrap.querySelector('.compass-detect-btn');
assert(det, 'detect toggle button exists under the compass');
assert.strictEqual(det.tagName, 'BUTTON', 'detect toggle is a real <button>');
assert.strictEqual(det.id, 'pwaDetectBtn', 'detect button carries the pwaDetectBtn id');

// Vertical order inside the column: compass, lock, detect.
const colKids = col.children.filter((c) => c.tagName === 'BUTTON');
assert.strictEqual(colKids.length, 3, 'column holds exactly three buttons');
assert(colKids[0].classList.contains('detectlab-compass-btn'), 'compass is first');
assert(colKids[1].classList.contains('detectlab-compass-lock'), 'lock is second');
assert(colKids[2].classList.contains('compass-detect-btn'), 'detect is third');

// The old slide-to-lock chrome is gone.
assert(!compassWrap.querySelector('.detectlab-compass-track'), 'no sliding track anymore');
assert(!compassWrap.querySelector('.detectlab-compass-lock-dock'), 'no lock dock anymore');
assert(!compassWrap.querySelector('.detectlab-compass-guide'), 'no guide arrow anymore');
assert(!compassWrap.querySelector('.dl-compass-mini-lock'), 'no mini lock badge anymore');
assert(!compassWrap.querySelector('.dl-lock-dock-label'), 'no LOCK text label anymore');
console.log('  ✔ compass column holds compass + lock + detect tap buttons in order');

// -------------------------------------------------------------
// Test 4: Tap Locking / Unlocking
// -------------------------------------------------------------
console.log('\n[4] Tap Locking / Unlocking');
assert.strictEqual(compass._isLocked, false, 'initially unlocked');
assert(!col.classList.contains('is-locked'), 'column starts without is-locked');

// Tap the lock button -> locked.
lock.dispatchEvent({ type: 'click' });
assert.strictEqual(compass._isLocked, true, 'tap locks the compass');
assert.strictEqual(map.isRotateLocked(), true, 'map rotation is locked');
assert(col.classList.contains('is-locked'), 'column has is-locked class');
assert(
    String(lock.getAttribute('aria-label')).indexOf('locked') !== -1,
    'lock aria-label announces the locked state, got ' + lock.getAttribute('aria-label')
);

// Tap again -> unlocked.
lock.dispatchEvent({ type: 'click' });
assert.strictEqual(compass._isLocked, false, 'second tap unlocks');
assert.strictEqual(map.isRotateLocked(), false, 'map is unlocked');
assert(!col.classList.contains('is-locked'), 'column is-locked removed');

// Lock state also follows the map: an external setRotateLocked(true)
// reaches the control through the rotatelockchange event.
map.setRotateLocked(true);
assert.strictEqual(compass._isLocked, true, 'control follows map lock events');
assert(col.classList.contains('is-locked'), 'column reflects map lock events');
map.setRotateLocked(false);
assert.strictEqual(compass._isLocked, false, 'control follows map unlock events');
console.log('  ✔ tapping the lock toggles map rotation lock both ways');

// -------------------------------------------------------------
// Test 5: Compass tap resets north, rose tracks bearing, detect relays taps
// -------------------------------------------------------------
console.log('\n[5] Reset north, rose rotation & detect relay');
map.setRotateLocked(false);
map.setBearing(45);
const rose = btn.querySelector('.detectlab-compass-rose');
assert.strictEqual(rose.style.transform, 'rotate(-45deg)', 'rose counter-rotates the bearing');
assert(btn.classList.contains('is-rotated'), 'compass shows is-rotated while off-north');

// Tap the compass with a sub-degree bearing -> synchronous reset to 0.
// (Larger bearings animate back via requestAnimFrame, which is async.)
map._bearing = 0.5;
btn.dispatchEvent({ type: 'click' });
assert.strictEqual(map.getBearing(), 0, 'compass tap resets bearing to north');
assert.strictEqual(rose.style.transform, 'rotate(0deg)', 'rose returns upright');
assert(!btn.classList.contains('is-rotated'), 'is-rotated clears at north');

// Tapping detect relays to the PWA detection toggle (index.html).
let detectRelayed = false;
global.togglePwaDetection = function () { detectRelayed = true; };
det.dispatchEvent({ type: 'click' });
assert.strictEqual(detectRelayed, true, 'detect tap relays to window.togglePwaDetection');
delete global.togglePwaDetection;
console.log('  ✔ compass tap resets north, rose tracks bearing, detect relays taps');

// -------------------------------------------------------------
// Test 6: CSS File Coverage
// -------------------------------------------------------------
console.log('\n[6] CSS Stylesheet Coverage');
const cssContent = fs.readFileSync(path.join(__dirname, 'css/styles.css'), 'utf8');
assert(cssContent.includes('.detectlab-compass-col'), 'css includes .detectlab-compass-col');
assert(cssContent.includes('.detectlab-compass-col.is-locked'), 'css includes locked column state');
assert(cssContent.includes('.detectlab-compass-btn'), 'css includes .detectlab-compass-btn');
assert(cssContent.includes('.detectlab-compass-lock'), 'css includes .detectlab-compass-lock');
assert(cssContent.includes('.compass-detect-btn'), 'css includes .compass-detect-btn');
assert(cssContent.includes('.compass-detect-btn.detect-active'), 'css includes detect-active state');
assert(cssContent.includes('.dl-lock-icon-unlocked'), 'css includes .dl-lock-icon-unlocked');
assert(cssContent.includes('.dl-lock-icon-locked'), 'css includes .dl-lock-icon-locked');
assert(cssContent.includes('.btn-nearby-pwa'), 'css includes .btn-nearby-pwa');
assert(!cssContent.includes('.detectlab-compass-track'), 'css drops .detectlab-compass-track');
assert(!cssContent.includes('.detectlab-compass-lock-dock'), 'css drops .detectlab-compass-lock-dock');
assert(!cssContent.includes('.dl-compass-mini-lock'), 'css drops .dl-compass-mini-lock');
console.log('  ✔ all required CSS rules are present and the slide chrome is gone');

console.log('\n\u2705 ALL MAP ROTATION & COMPASS LOCK TESTS PASSED\n');
