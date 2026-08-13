// Unit and integration tests for map rotation sensitivity fix + sliding compass lock
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
console.log('  ✔ snap-to-north works within 3.0°');

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
// Test 3: Compass Control DOM Structure
// -------------------------------------------------------------
console.log('\n[3] Compass Control DOM Structure');
const compass = L.control.compass({ position: 'bottomleft' });
const compassWrap = compass.onAdd(map);

assert(compassWrap.classList.contains('detectlab-compass'), 'compass container has detectlab-compass class');
const track = compassWrap.querySelector('.detectlab-compass-track');
assert(track, 'compass track exists');

const dock = compassWrap.querySelector('.detectlab-compass-lock-dock');
assert(dock, 'lock dock exists under compass');
assert(dock.querySelector('.dl-lock-icon-unlocked'), 'unlocked lock icon exists in dock');
assert(dock.querySelector('.dl-lock-icon-locked'), 'locked lock icon exists in dock');
assert(dock.querySelector('.dl-lock-dock-label'), 'dock lock label exists');

const guide = compassWrap.querySelector('.detectlab-compass-guide');
assert(guide, 'guide arrow exists');

const btn = compassWrap.querySelector('.detectlab-compass-btn');
assert(btn, 'sliding compass button exists');
assert(btn.querySelector('.detectlab-compass-rose'), 'compass rose needle exists inside button');
assert(btn.querySelector('.dl-compass-mini-lock'), 'mini lock badge exists inside button');
console.log('  ✔ compass control has full track, lock dock, sliding button, and badges');

// -------------------------------------------------------------
// Test 4: Sliding Compass Locking / Unlocking
// -------------------------------------------------------------
console.log('\n[4] Sliding Compass Locking / Unlocking');
assert.strictEqual(compass._isLocked, false, 'initially unlocked');
assert.strictEqual(btn.style.transform, 'translateY(0px)', 'button starts at upper position Y=0px');

// Slide down over lock: setLocked(true)
compass.setLocked(true);
assert.strictEqual(compass._isLocked, true, 'compass is locked');
assert.strictEqual(map.isRotateLocked(), true, 'map rotation is locked');
assert.strictEqual(btn.style.transform, 'translateY(44px)', 'button slid down over lock to Y=44px');
assert(track.classList.contains('is-locked'), 'track has is-locked class');
assert(btn.classList.contains('is-locked'), 'btn has is-locked class');

// Tapping when locked -> unlocks and springs back to upper position
compass._isDragging = true;
compass._dragMoved = false;
compass._startY = 44;
compass._dragStartTime = Date.now();
compass._startPosY = 44;
compass._onDragEnd({ clientY: 44, stopPropagation: () => {}, preventDefault: () => {} });

assert.strictEqual(compass._isLocked, false, 'tapping when locked unlocks');
assert.strictEqual(map.isRotateLocked(), false, 'map is unlocked');
assert.strictEqual(btn.style.transform, 'translateY(0px)', 'button returned to upper position Y=0px');
assert(!track.classList.contains('is-locked'), 'track is-locked removed');
assert(!btn.classList.contains('is-locked'), 'btn is-locked removed');
console.log('  ✔ sliding down locks (Y=44px) and tapping unlocks (Y=0px)');

// -------------------------------------------------------------
// Test 5: Drag Sliding Physics & Thresholds
// -------------------------------------------------------------
console.log('\n[5] Drag Physics & Snap Thresholds');
// Drag down from top > 45% of 44px (e.g. from 10 to 35 -> delta 25 >= 19.8)
compass._isDragging = true;
compass._startY = 10;
compass._startPosY = 0;
compass._dragStartTime = Date.now() - 500;
compass._onDragMove({ clientY: 35, preventDefault: () => {}, stopPropagation: () => {} });
assert.strictEqual(compass._currentY, 25, 'currentY tracked dynamically');
compass._onDragEnd({ clientY: 35, stopPropagation: () => {}, preventDefault: () => {} });

assert.strictEqual(compass._isLocked, true, 'drag down > 45% snaps to locked');
assert.strictEqual(btn.style.transform, 'translateY(44px)', 'button snaps to Y=44px');

// Drag up from bottom > 45% towards top (e.g. from 50 to 25 -> nextY = 19 <= 24.2)
compass._isDragging = true;
compass._startY = 50;
compass._startPosY = 44;
compass._dragStartTime = Date.now() - 500;
compass._onDragMove({ clientY: 25, preventDefault: () => {}, stopPropagation: () => {} });
assert.strictEqual(compass._currentY, 19, 'currentY tracked upwards');
compass._onDragEnd({ clientY: 25, stopPropagation: () => {}, preventDefault: () => {} });

assert.strictEqual(compass._isLocked, false, 'drag up > 45% snaps to unlocked');
assert.strictEqual(btn.style.transform, 'translateY(0px)', 'button snaps to Y=0px');
console.log('  ✔ drag physics correctly snaps to locked (>45% down) and unlocked (<55% up)');

// -------------------------------------------------------------
// Test 6: CSS File Coverage
// -------------------------------------------------------------
console.log('\n[6] CSS Stylesheet Coverage');
const cssContent = fs.readFileSync(path.join(__dirname, 'css/styles.css'), 'utf8');
assert(cssContent.includes('.detectlab-compass-track'), 'css includes .detectlab-compass-track');
assert(cssContent.includes('.detectlab-compass-lock-dock'), 'css includes .detectlab-compass-lock-dock');
assert(cssContent.includes('.detectlab-compass-btn.is-locked'), 'css includes .detectlab-compass-btn.is-locked');
assert(cssContent.includes('.dl-compass-mini-lock'), 'css includes .dl-compass-mini-lock');
assert(cssContent.includes('.dl-lock-icon-unlocked'), 'css includes .dl-lock-icon-unlocked');
assert(cssContent.includes('.dl-lock-icon-locked'), 'css includes .dl-lock-icon-locked');
console.log('  ✔ all required CSS rules and transitions are present');

console.log('\n✅ ALL MAP ROTATION & COMPASS LOCK TESTS PASSED\n');
