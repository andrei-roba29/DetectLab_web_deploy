/* DetectLab map rotation + compass with sliding rotation lock
 *
 * Leaflet 1.9 has no built-in bearing. This module:
 *  - rotates the map pane around the viewport centre
 *  - keeps click / pan / pinch coordinates correct
 *  - lets the user twist the map with two fingers (touch)
 *    or Alt/Option-drag / Ctrl-wheel (desktop) with stable deadband
 *  - shows a bottom-left compass with a vertical lock dock underneath:
 *      * slide compass down over the lock -> disables screen turning
 *      * slide back up towards initial position, or tap -> re-enables screen turning
 *      * tap when unlocked -> resets orientation to true north
 */
(function (L) {
    'use strict';
    if (!L || !L.Map) return;

    var DEG = Math.PI / 180;
    var RAD = 180 / Math.PI;
    var SNAP = 3.0; // Snap to north when within 3 degrees
    var TOUCH_ROTATE_THRESHOLD = 9.0; // Intentional twist threshold in degrees
    var MIN_TOUCH_DISTANCE = 35; // Minimum pixel distance between fingers for angular stability
    var STORAGE_LOCK_KEY = 'detectlab_rotation_locked';

    function wrapDeg(deg) {
        deg = deg % 360;
        if (deg > 180) deg -= 360;
        if (deg <= -180) deg += 360;
        return deg;
    }

    function rotatePoint(point, deg, origin) {
        if (!deg) return point.clone ? point.clone() : L.point(point);
        var rad = deg * DEG;
        var cos = Math.cos(rad);
        var sin = Math.sin(rad);
        var x = point.x - origin.x;
        var y = point.y - origin.y;
        return L.point(x * cos - y * sin + origin.x, x * sin + y * cos + origin.y);
    }

    function angleBetween(a, b) {
        return Math.atan2(b.y - a.y, b.x - a.x) * RAD;
    }

    function getClientY(e) {
        if (e.clientY !== undefined) return e.clientY;
        if (e.touches && e.touches.length > 0) return e.touches[0].clientY;
        if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientY;
        return 0;
    }

    var origSetPosition = L.DomUtil.setPosition;
    var origGetBounds = L.Map.prototype.getBounds;
    var origContainerToLayer = L.Map.prototype.containerPointToLayerPoint;
    var origLayerToContainer = L.Map.prototype.layerPointToContainerPoint;
    var origGetTiledPixelBounds = L.GridLayer && L.GridLayer.prototype._getTiledPixelBounds;

    L.DomUtil.setPosition = function (el, point) {
        origSetPosition.call(this, el, point);
        if (el && el._dlRotateMap) el._dlRotateMap._applyRotateTransform();
    };

    L.Map.mergeOptions({
        rotate: false,
        touchRotate: true,
        keyRotate: true,
        rotateLocked: false,
        bearing: 0
    });

    L.Map.include({
        getBearing: function () {
            return this._bearing || 0;
        },

        isRotateLocked: function () {
            return !!this._rotateLocked;
        },

        setRotateLocked: function (locked, options) {
            locked = !!locked;
            if (this._rotateLocked === locked) return this;
            this._rotateLocked = locked;
            try {
                localStorage.setItem(STORAGE_LOCK_KEY, locked ? 'true' : 'false');
            } catch (err) {}
            if (this._container) {
                this._container.classList.toggle('is-rotation-locked', locked);
            }
            if (this.compassControl && (!options || !options.fromCompass)) {
                this.compassControl.setLocked(locked, { fromMap: true });
            }
            this.fire('rotatelockchange', { locked: locked });
            return this;
        },

        setBearing: function (deg, options) {
            if (!this._rotate) return this;
            options = options || {};
            if (this._rotateLocked && !options.force && !options.noLockCheck) {
                return this;
            }
            var next = wrapDeg(deg);
            if (Math.abs(next) < SNAP) next = 0;
            if (next === this._bearing) {
                this._applyRotateTransform();
                this.fire('rotate', { bearing: next });
                return this;
            }
            this._bearing = next;
            this._applyRotateTransform();
            if (this._container) {
                this._container.classList.toggle('is-map-rotated', next !== 0);
            }
            this.fire('rotate', { bearing: next });
            if (!options.noMove) {
                this.fire('move');
            }
            return this;
        },

        resetBearing: function () {
            if (!this._rotate || !this._bearing) return this;
            var map = this;
            var from = this._bearing;
            if (Math.abs(from) < 1) return this.setBearing(0, { force: true });
            var start = null;
            var duration = 280;
            function step(ts) {
                if (start === null) start = ts;
                var t = Math.min(1, (ts - start) / duration);
                var eased = 1 - Math.pow(1 - t, 3);
                map.setBearing(from * (1 - eased), { noMove: t < 1, force: true });
                if (t < 1) L.Util.requestAnimFrame(step);
                else map.fire('moveend');
            }
            L.Util.requestAnimFrame(step);
            return this;
        },

        _pivot: function () {
            return this.getSize()._divideBy(2);
        },

        _applyRotateTransform: function () {
            var pane = this._mapPane;
            if (!pane) return;
            var pos = L.DomUtil.getPosition(pane) || L.point(0, 0);
            var bearing = this._bearing || 0;
            var pivot = this._pivot();
            pane.style.transformOrigin = (pivot.x - pos.x) + 'px ' + (pivot.y - pos.y) + 'px';
            if (!bearing) {
                pane.style[L.DomUtil.TRANSFORM] = L.Browser.any3d
                    ? 'translate3d(' + pos.x + 'px,' + pos.y + 'px,0)'
                    : 'translate(' + pos.x + 'px,' + pos.y + 'px)';
                return;
            }
            pane.style[L.DomUtil.TRANSFORM] =
                'translate3d(' + pos.x + 'px,' + pos.y + 'px,0) rotate(' + bearing + 'deg)';
        },

        containerPointToLayerPoint: function (point) {
            if (!this._rotate || !this._bearing) {
                return origContainerToLayer.call(this, point);
            }
            var unrotated = rotatePoint(L.point(point), -this._bearing, this._pivot());
            return unrotated.subtract(this._getMapPanePos());
        },

        layerPointToContainerPoint: function (point) {
            if (!this._rotate || !this._bearing) {
                return origLayerToContainer.call(this, point);
            }
            return rotatePoint(L.point(point).add(this._getMapPanePos()), this._bearing, this._pivot());
        },

        getBounds: function () {
            if (!this._rotate || !this._bearing) {
                return origGetBounds.call(this);
            }
            var size = this.getSize();
            return L.latLngBounds([
                this.containerPointToLatLng([0, 0]),
                this.containerPointToLatLng([size.x, 0]),
                this.containerPointToLatLng([size.x, size.y]),
                this.containerPointToLatLng([0, size.y])
            ]);
        }
    });

    if (origGetTiledPixelBounds) {
        L.GridLayer.include({
            _getTiledPixelBounds: function (center) {
                var bounds = origGetTiledPixelBounds.call(this, center);
                var map = this._map;
                if (!map || !map._rotate || !map._bearing) return bounds;
                var rad = Math.abs(map._bearing) * DEG;
                var size = map.getSize();
                var extraX = (size.x * Math.abs(Math.cos(rad)) + size.y * Math.abs(Math.sin(rad)) - size.x) / 2;
                var extraY = (size.x * Math.abs(Math.sin(rad)) + size.y * Math.abs(Math.cos(rad)) - size.y) / 2;
                var pad = L.point(Math.ceil(Math.max(0, extraX)), Math.ceil(Math.max(0, extraY)));
                return new L.Bounds(bounds.min.subtract(pad), bounds.max.add(pad));
            }
        });
    }

    // Two-finger twist with intentional threshold and distance guard.
    // Pinch-zoom stays with Leaflet's own TouchZoom.
    L.Map.TouchRotate = L.Handler.extend({
        addHooks: function () {
            L.DomEvent.on(this._map._container, 'touchstart', this._onStart, this);
            // iOS Safari exposes a dedicated rotation delta on gesture events.
            this._onGestureStart = this._onGestureStart.bind(this);
            this._onGestureChange = this._onGestureChange.bind(this);
            this._onGestureEnd = this._onGestureEnd.bind(this);
            this._map._container.addEventListener('gesturestart', this._onGestureStart, { passive: false });
            this._map._container.addEventListener('gesturechange', this._onGestureChange, { passive: false });
            this._map._container.addEventListener('gestureend', this._onGestureEnd, { passive: false });
        },
        removeHooks: function () {
            L.DomEvent.off(this._map._container, 'touchstart', this._onStart, this);
            this._map._container.removeEventListener('gesturestart', this._onGestureStart);
            this._map._container.removeEventListener('gesturechange', this._onGestureChange);
            this._map._container.removeEventListener('gestureend', this._onGestureEnd);
            L.DomEvent.off(document, 'touchmove', this._onMove, this);
            L.DomEvent.off(document, 'touchend touchcancel', this._onEnd, this);
        },
        _onGestureStart: function (e) {
            if (!this._map._rotate || this._map.isRotateLocked()) return;
            this._usingGesture = true;
            this._gestureBearing = this._map.getBearing();
            this._gestureMoved = false;
            e.preventDefault();
        },
        _onGestureChange: function (e) {
            if (!this._map._rotate || this._map.isRotateLocked() || typeof e.rotation !== 'number') return;
            var rot = e.rotation;
            if (!this._gestureMoved) {
                if (Math.abs(rot) < TOUCH_ROTATE_THRESHOLD) return;
                this._gestureMoved = true;
            }
            // Smoothly subtract deadband so rotation begins gently without sudden jumps
            var smoothRot = rot > 0 ? (rot - TOUCH_ROTATE_THRESHOLD) : (rot + TOUCH_ROTATE_THRESHOLD);
            this._map.setBearing(this._gestureBearing + smoothRot, { noMove: true });
            e.preventDefault();
        },
        _onGestureEnd: function () {
            if (this._gestureMoved) this._map.fire('moveend');
            this._gestureMoved = false;
            this._usingGesture = false;
        },
        _onStart: function (e) {
            if (this._usingGesture) return;
            if (!e.touches || e.touches.length !== 2 || !this._map._rotate || this._map.isRotateLocked()) return;
            var a = this._map.mouseEventToContainerPoint(e.touches[0]);
            var b = this._map.mouseEventToContainerPoint(e.touches[1]);
            if (a.distanceTo(b) < MIN_TOUCH_DISTANCE) return;
            this._startAngle = angleBetween(a, b);
            this._startBearing = this._map.getBearing();
            this._moved = false;
            L.DomEvent.on(document, 'touchmove', this._onMove, this);
            L.DomEvent.on(document, 'touchend touchcancel', this._onEnd, this);
        },
        _onMove: function (e) {
            if (this._usingGesture) return;
            if (!e.touches || e.touches.length !== 2 || this._map.isRotateLocked()) return;
            var a = this._map.mouseEventToContainerPoint(e.touches[0]);
            var b = this._map.mouseEventToContainerPoint(e.touches[1]);
            if (a.distanceTo(b) < MIN_TOUCH_DISTANCE) return;
            var angle = angleBetween(a, b);
            var delta = wrapDeg(angle - this._startAngle);
            if (!this._moved) {
                if (Math.abs(delta) < TOUCH_ROTATE_THRESHOLD) return;
                this._moved = true;
            }
            // Smoothly subtract deadband so rotation starts smoothly
            var smoothDelta = delta > 0 ? (delta - TOUCH_ROTATE_THRESHOLD) : (delta + TOUCH_ROTATE_THRESHOLD);
            this._map.setBearing(this._startBearing + smoothDelta, { noMove: true });
            L.DomEvent.preventDefault(e);
        },
        _onEnd: function () {
            L.DomEvent.off(document, 'touchmove', this._onMove, this);
            L.DomEvent.off(document, 'touchend touchcancel', this._onEnd, this);
            if (this._moved) this._map.fire('moveend');
            this._moved = false;
        }
    });

    // Desktop: Alt/Option-drag rotates; Ctrl/Cmd + wheel nudges the bearing.
    L.Map.KeyRotate = L.Handler.extend({
        addHooks: function () {
            this._onDown = this._onDown.bind(this);
            this._onWheel = this._onWheel.bind(this);
            this._map._container.addEventListener('mousedown', this._onDown, true);
            this._map._container.addEventListener('wheel', this._onWheel, { capture: true, passive: false });
        },
        removeHooks: function () {
            this._map._container.removeEventListener('mousedown', this._onDown, true);
            this._map._container.removeEventListener('wheel', this._onWheel, true);
            L.DomEvent.off(document, 'mousemove', this._onMove, this);
            L.DomEvent.off(document, 'mouseup', this._onUp, this);
        },
        _isRotateMod: function (e) {
            return !!(e.altKey && e.button === 0);
        },
        _onDown: function (e) {
            if (!this._map._rotate || this._map.isRotateLocked() || !this._isRotateMod(e)) return;
            this._startX = e.clientX;
            this._startBearing = this._map.getBearing();
            this._moved = false;
            this._dragWasEnabled = this._map.dragging && this._map.dragging.enabled();
            if (this._dragWasEnabled) this._map.dragging.disable();
            L.DomUtil.disableTextSelection();
            L.DomEvent.on(document, 'mousemove', this._onMove, this);
            L.DomEvent.on(document, 'mouseup', this._onUp, this);
            L.DomEvent.preventDefault(e);
            L.DomEvent.stopPropagation(e);
        },
        _onMove: function (e) {
            if (this._map.isRotateLocked()) return;
            var rawDelta = (e.clientX - this._startX) * 0.35;
            if (!this._moved) {
                if (Math.abs(rawDelta) < 2.5) return;
                this._moved = true;
            }
            var delta = rawDelta > 0 ? (rawDelta - 2.5) : (rawDelta + 2.5);
            this._map.setBearing(this._startBearing + delta, { noMove: true });
            L.DomEvent.preventDefault(e);
        },
        _onUp: function () {
            L.DomUtil.enableTextSelection();
            L.DomEvent.off(document, 'mousemove', this._onMove, this);
            L.DomEvent.off(document, 'mouseup', this._onUp, this);
            if (this._dragWasEnabled && this._map.dragging) this._map.dragging.enable();
            this._dragWasEnabled = false;
            if (this._moved) this._map.fire('moveend');
            this._moved = false;
        },
        _onWheel: function (e) {
            if (!this._map._rotate || this._map.isRotateLocked() || !(e.altKey || (e.ctrlKey && e.shiftKey))) return;
            var delta = e.deltaY || e.wheelDelta || 0;
            this._map.setBearing(this._map.getBearing() + (delta > 0 ? 5 : -5));
            e.preventDefault();
            e.stopPropagation();
        }
    });

    var SLIDE_MAX = 44; // Vertical travel in pixels

    L.Control.Compass = L.Control.extend({
        options: {
            position: 'bottomleft'
        },
        onAdd: function (map) {
            var self = this;
            this._map = map;
            this._slideMax = SLIDE_MAX;
            this._isLocked = map.isRotateLocked ? map.isRotateLocked() : false;
            this._currentY = this._isLocked ? this._slideMax : 0;

            var wrap = this._container = L.DomUtil.create('div', 'leaflet-control detectlab-compass');
            var track = this._track = L.DomUtil.create('div', 'detectlab-compass-track', wrap);
            
            var dock = this._dock = L.DomUtil.create('div', 'detectlab-compass-lock-dock', track);
            dock.setAttribute('role', 'button');
            dock.setAttribute('aria-label', 'Toggle rotation lock');
            dock.innerHTML =
                '<div class="dl-compass-lock-icons" aria-hidden="true">' +
                    '<svg class="dl-lock-icon-unlocked" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                        '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>' +
                        '<path d="M7 11V7a5 5 0 0 1 9.9-1"/>' +
                    '</svg>' +
                    '<svg class="dl-lock-icon-locked" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                        '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>' +
                        '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
                    '</svg>' +
                '</div>' +
                '<span class="dl-lock-dock-label">LOCK</span>';

            var guide = L.DomUtil.create('div', 'detectlab-compass-guide', track);
            guide.innerHTML = '<span class="dl-guide-arrow" aria-hidden="true">▾</span>';

            var btn = this._btn = L.DomUtil.create('button', 'detectlab-compass-btn', track);
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Compass and rotation lock');
            btn.innerHTML =
                '<span class="detectlab-compass-rose" aria-hidden="true">' +
                    '<svg viewBox="0 0 48 48">' +
                        '<circle class="dl-compass-ring" cx="24" cy="24" r="21.5"/>' +
                        '<circle class="dl-compass-hub" cx="24" cy="24" r="3"/>' +
                        '<path class="dl-compass-needle-n" d="M24 7 L28.2 24 L24 21.4 L19.8 24 Z"/>' +
                        '<path class="dl-compass-needle-s" d="M24 41 L28.2 24 L24 26.6 L19.8 24 Z"/>' +
                        '<text class="dl-compass-n" x="24" y="16" text-anchor="middle">N</text>' +
                    '</svg>' +
                '</span>' +
                '<span class="dl-compass-mini-lock" aria-hidden="true">' +
                    '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">' +
                        '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>' +
                    '</svg>' +
                '</span>';
            this._rose = btn.querySelector('.detectlab-compass-rose');

            L.DomEvent.disableClickPropagation(wrap);
            L.DomEvent.disableScrollPropagation(wrap);

            // Bind drag & tap handlers
            this._onDragStart = this._onDragStart.bind(this);
            this._onDragMove = this._onDragMove.bind(this);
            this._onDragEnd = this._onDragEnd.bind(this);

            if (window.PointerEvent) {
                btn.addEventListener('pointerdown', this._onDragStart);
            } else {
                btn.addEventListener('touchstart', this._onDragStart, { passive: false });
                btn.addEventListener('mousedown', this._onDragStart);
            }

            dock.addEventListener('click', function (e) {
                L.DomEvent.stop(e);
                self.setLocked(!self._isLocked);
            });

            this._onRotate = L.bind(this._update, this);
            this._onLockChange = L.bind(this._updateLock, this);
            map.on('rotate', this._onRotate);
            map.on('rotatelockchange', this._onLockChange);

            this.setLocked(this._isLocked, { fromMap: true });
            this._update();
            return wrap;
        },
        onRemove: function (map) {
            map.off('rotate', this._onRotate);
            map.off('rotatelockchange', this._onLockChange);
            if (window.PointerEvent) {
                if (this._btn) this._btn.removeEventListener('pointerdown', this._onDragStart);
            } else {
                if (this._btn) {
                    this._btn.removeEventListener('touchstart', this._onDragStart);
                    this._btn.removeEventListener('mousedown', this._onDragStart);
                }
            }
        },
        _onDragStart: function (e) {
            if (e.button !== undefined && e.button !== 0) return;
            this._isDragging = true;
            this._dragMoved = false;
            this._startY = getClientY(e);
            this._dragStartTime = Date.now();
            this._startPosY = this._isLocked ? this._slideMax : 0;
            this._track.classList.add('is-dragging');

            if (e.target && e.target.setPointerCapture && e.pointerId !== undefined) {
                try {
                    e.target.setPointerCapture(e.pointerId);
                    this._pointerId = e.pointerId;
                } catch (err) {}
            }

            if (window.PointerEvent) {
                window.addEventListener('pointermove', this._onDragMove, { passive: false });
                window.addEventListener('pointerup', this._onDragEnd);
                window.addEventListener('pointercancel', this._onDragEnd);
            } else {
                window.addEventListener('touchmove', this._onDragMove, { passive: false });
                window.addEventListener('touchend', this._onDragEnd);
                window.addEventListener('touchcancel', this._onDragEnd);
                window.addEventListener('mousemove', this._onDragMove);
                window.addEventListener('mouseup', this._onDragEnd);
            }
            L.DomEvent.stop(e);
        },
        _onDragMove: function (e) {
            if (!this._isDragging) return;
            var currentY = getClientY(e);
            var deltaY = currentY - this._startY;
            if (Math.abs(deltaY) > 4) {
                this._dragMoved = true;
            }
            var nextY = Math.max(0, Math.min(this._slideMax, this._startPosY + deltaY));
            this._currentY = nextY;
            this._btn.style.transform = 'translateY(' + nextY + 'px)';
            L.DomEvent.preventDefault(e);
            L.DomEvent.stopPropagation(e);
        },
        _onDragEnd: function (e) {
            if (!this._isDragging) return;
            this._isDragging = false;
            this._track.classList.remove('is-dragging');

            if (window.PointerEvent) {
                window.removeEventListener('pointermove', this._onDragMove);
                window.removeEventListener('pointerup', this._onDragEnd);
                window.removeEventListener('pointercancel', this._onDragEnd);
            } else {
                window.removeEventListener('touchmove', this._onDragMove);
                window.removeEventListener('touchend', this._onDragEnd);
                window.removeEventListener('touchcancel', this._onDragEnd);
                window.removeEventListener('mousemove', this._onDragMove);
                window.removeEventListener('mouseup', this._onDragEnd);
            }

            if (this._pointerId !== undefined && this._btn && this._btn.releasePointerCapture) {
                try {
                    this._btn.releasePointerCapture(this._pointerId);
                } catch (err) {}
                this._pointerId = undefined;
            }

            var endY = getClientY(e);
            var totalDist = Math.abs(endY - this._startY);
            var duration = Date.now() - this._dragStartTime;

            // If tap (minimal movement, short duration)
            if (!this._dragMoved || (totalDist < 6 && duration < 300)) {
                if (this._isLocked) {
                    // Tapped while locked -> Unlock!
                    this.setLocked(false);
                } else {
                    // Tapped while unlocked -> Reset north!
                    if (this._map) this._map.resetBearing();
                }
                L.DomEvent.stop(e);
                return;
            }

            // Dragged -> Snap to position based on release point
            var threshold = this._slideMax * 0.45;
            if (this._startPosY === 0) {
                // Dragged down from top position:
                if (this._currentY >= threshold) {
                    this.setLocked(true);
                } else {
                    this.setLocked(false);
                }
            } else {
                // Dragged up from bottom position:
                if (this._currentY <= (this._slideMax * 0.55)) {
                    this.setLocked(false);
                } else {
                    this.setLocked(true);
                }
            }
            L.DomEvent.stop(e);
        },
        setLocked: function (locked, options) {
            locked = !!locked;
            this._isLocked = locked;
            this._currentY = locked ? this._slideMax : 0;
            if (this._btn) {
                this._btn.style.transform = 'translateY(' + this._currentY + 'px)';
                this._btn.classList.toggle('is-locked', locked);
                if (locked) {
                    this._btn.setAttribute('aria-label', 'Screen rotation locked. Tap or slide up to unlock.');
                    this._btn.title = 'Rotirea ecranului este blocată / Screen rotation locked. Atinge sau glisează în sus pentru a debloca / Tap or slide up to unlock.';
                } else {
                    this._btn.setAttribute('aria-label', 'Screen rotation unlocked. Slide down to lock. Tap to reset north.');
                    this._btn.title = 'Glisează în jos pentru a bloca rotirea / Slide down to lock rotation. Apasă pentru a reseta nordul / Tap to reset north.';
                }
            }
            if (this._track) {
                this._track.classList.toggle('is-locked', locked);
            }
            if (this._map && (!options || !options.fromMap)) {
                this._map.setRotateLocked(locked, { fromCompass: true });
            }
            this._update();
        },
        _updateLock: function (e) {
            if (e && e.locked !== undefined && e.locked !== this._isLocked) {
                this.setLocked(e.locked, { fromMap: true });
            }
        },
        _update: function () {
            var bearing = this._map ? this._map.getBearing() : 0;
            if (this._rose) {
                this._rose.style.transform = 'rotate(' + (-bearing) + 'deg)';
            }
            if (this._btn) {
                this._btn.classList.toggle('is-rotated', Math.abs(bearing) >= SNAP);
            }
        }
    });

    L.control.compass = function (options) {
        return new L.Control.Compass(options);
    };

    L.Map.addInitHook(function () {
        if (!this.options.rotate) return;
        this._rotate = true;
        this._bearing = wrapDeg(this.options.bearing || 0);

        var initialLocked = false;
        try {
            initialLocked = localStorage.getItem(STORAGE_LOCK_KEY) === 'true';
        } catch (e) {}
        this._rotateLocked = !!(this.options.rotateLocked || initialLocked);

        if (this._mapPane) this._mapPane._dlRotateMap = this;

        this.addHandler('touchRotate', L.Map.TouchRotate);
        this.addHandler('keyRotate', L.Map.KeyRotate);

        this.whenReady(function () {
            if (!this.compassControl) {
                this.compassControl = L.control.compass({ position: 'bottomleft' });
                this.compassControl.addTo(this);
            }
            if (this._rotateLocked) {
                this.compassControl.setLocked(true, { fromMap: true });
                if (this._container) this._container.classList.add('is-rotation-locked');
            }
            this._applyRotateTransform();
            if (this._bearing) this.fire('rotate', { bearing: this._bearing });
        });

        this.on('move zoom viewreset resize', this._applyRotateTransform, this);

        // Compensate one-finger drag so the map follows the finger while rotated.
        var map = this;
        var origEnable = this.dragging && this.dragging.enable;
        if (origEnable) {
            this.whenReady(function () {
                var draggable = map.dragging && map.dragging._draggable;
                if (!draggable || draggable._dlRotatePatched) return;
                draggable._dlRotatePatched = true;
                var protoMove = draggable._onMove;
                draggable._onMove = function (t) {
                    if (!map._bearing) return protoMove.call(this, t);
                    var ev = t.touches && t.touches.length === 1 ? t.touches[0] : t;
                    var cur = new L.Point(ev.clientX, ev.clientY);
                    var delta = cur._subtract(this._startPoint);
                    if (!delta.x && !delta.y) return;
                    if (Math.abs(delta.x) + Math.abs(delta.y) < this.options.clickTolerance) return;
                    var parent = this._parentScale || { x: 1, y: 1 };
                    delta.x /= parent.x;
                    delta.y /= parent.y;
                    delta = rotatePoint(delta, -map._bearing, L.point(0, 0));
                    L.DomEvent.preventDefault(t);
                    if (!this._moved) {
                        this.fire('dragstart');
                        this._moved = true;
                        L.DomUtil.addClass(document.body, 'leaflet-dragging');
                        this._lastTarget = t.target || t.srcElement;
                        L.DomUtil.addClass(this._lastTarget, 'leaflet-drag-target');
                    }
                    this._newPos = this._startPos.add(delta);
                    this._moving = true;
                    this._lastEvent = t;
                    this._updatePosition();
                };
            });
        }
    });
})(window.L);
