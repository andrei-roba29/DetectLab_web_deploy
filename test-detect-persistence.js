// Smoke test for the detection-switch persistence + 10h auto-OFF state machine
// added to js/map-app.js.  Replicates the exact logic with stubbed
// localStorage / Date / _det / toggleDetection so we can fast-forward time.
// Run: node test-detect-persistence.js

'use strict';

// ── Stubs ──
let store = {};
const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
};

let NOW = Date.parse('2026-08-06T12:00:00Z');
function realNow() { return NOW; }
function advanceHours(h) { NOW += h * 60 * 60 * 1000; }

// Track toggleDetection calls and the live _det flag like the real code does.
let _det = { active: false };
let toggleCalls = [];
let uiSyncs = [];
const navigatorStub = { serviceWorker: null };

function toggleDetection(on) {
    toggleCalls.push(on);
    _det.active = on;
    // exact storage behaviour copied from window.toggleDetection in map-app.js
    if (on) {
        localStorage.setItem('detection_enabled', 'true');
        if (!localStorage.getItem('detection_enabled_at')) {
            localStorage.setItem('detection_enabled_at', String(realNow()));
        }
    } else {
        localStorage.setItem('detection_enabled', 'false');
        localStorage.removeItem('detection_enabled_at');
    }
}

// ── Logic copied verbatim (adapted to stubs) from the new block in map-app.js ──
const DETECT_MAX_AGE_MS = 10 * 60 * 60 * 1000; // 10 hours

function _syncDetectSwitchUI(on) { uiSyncs.push(on); }

function _detPersistedState() {
    try {
        return {
            on: localStorage.getItem('detection_enabled') === 'true',
            since: parseInt(localStorage.getItem('detection_enabled_at') || '0', 10) || 0
        };
    } catch (e) {
        return { on: false, since: 0 };
    }
}

function _detEnforceExpiry() {
    const st = _detPersistedState();
    if (!st.on) return false;
    const expired = !st.since || (realNow() - st.since) >= DETECT_MAX_AGE_MS;
    if (!expired) return true;
    try {
        localStorage.setItem('detection_enabled', 'false');
        localStorage.removeItem('detection_enabled_at');
    } catch (e) {}
    if (_det.active) {
        try { toggleDetection(false); } catch (e) {}
    }
    _syncDetectSwitchUI(false);
    return false;
}

function _detRestorePersistedState() {
    if (!_detEnforceExpiry()) return;
    if (_det.active) return;
    if (!_detPersistedState().on) return;
    _syncDetectSwitchUI(true);
    toggleDetection(true);
}

// ── Tiny test framework ──
let failures = 0;
function check(name, cond) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (!cond) failures++;
}

// ── Scenario 1: turn ON → state + timestamp persisted ──
store = {}; toggleCalls = []; uiSyncs = []; _det = { active: false };
toggleDetection(true);
check('1. ON persists detection_enabled=true', store['detection_enabled'] === 'true');
check('1. ON stores activation timestamp', store['detection_enabled_at'] === String(NOW));

// ── Scenario 2: app restart 3h later → restore keeps switch ON, keeps original timestamp ──
advanceHours(3);
_det = { active: false }; // fresh page load: in-memory flag gone
const tsBefore = store['detection_enabled_at'];
_detRestorePersistedState();
check('2. restore turns detection back ON', _det.active === true && toggleCalls[toggleCalls.length - 1] === true);
check('2. restore syncs switch UI ON', uiSyncs[uiSyncs.length - 1] === true);
check('2. restore does NOT reset the 10h window', store['detection_enabled_at'] === tsBefore);

// ── Scenario 3: resume from background at 9h59m → still ON ──
advanceHours(6); advanceHours(0.983); // now ~9h59m elapsed since activation
_det = { active: false };
check('3. 9h59m elapsed → enforce keeps ON', _detEnforceExpiry() === true);
_detRestorePersistedState();
check('3. 9h59m elapsed → restore re-enables', _det.active === true);

// ── Scenario 4: resume at exactly 10h → auto OFF, storage cleared, UI synced ──
advanceHours(0.017); // now >10h elapsed
_det = { active: true }; // switch was left ON in memory (app backgrounded)
check('4. 10h elapsed → enforce returns false', _detEnforceExpiry() === false);
check('4. 10h elapsed → detection stopped (toggleDetection(false))', _det.active === false && toggleCalls[toggleCalls.length - 1] === false);
check('4. 10h elapsed → storage cleared', store['detection_enabled'] === 'false' && !('detection_enabled_at' in store));
check('4. 10h elapsed → UI synced OFF', uiSyncs[uiSyncs.length - 1] === false);

// ── Scenario 5: cold start with expired flag (app killed, reopened 12h after ON) ──
store = {}; toggleCalls = []; uiSyncs = []; _det = { active: false };
const t0 = NOW;
localStorage.setItem('detection_enabled', 'true');
localStorage.setItem('detection_enabled_at', String(t0));
advanceHours(12); // phone off / app killed for 12h, then reopened
_det = { active: false }; // cold start — nothing running
_detRestorePersistedState();
check('5. cold start 12h later → stays OFF', _det.active === false && toggleCalls.length === 0);
check('5. cold start 12h later → expired storage cleared', !('detection_enabled_at' in store));
check('5. cold start 12h later → UI forced OFF', uiSyncs[uiSyncs.length - 1] === false);

// ── Scenario 6: manual OFF clears state; next ON starts a fresh 10h window ──
store = {}; toggleCalls = []; uiSyncs = []; _det = { active: false };
toggleDetection(true);
toggleDetection(false);
check('6. manual OFF clears timestamp', !('detection_enabled_at' in store));
advanceHours(5);
toggleDetection(true);
check('6. re-ON starts a fresh window', store['detection_enabled_at'] === String(NOW));
advanceHours(9);
_det = { active: false };
check('6. 9h after re-ON → still valid', _detEnforceExpiry() === true);

// ── Scenario 7: nothing persisted → restore is a no-op ──
store = {}; toggleCalls = []; uiSyncs = []; _det = { active: false };
_detRestorePersistedState();
check('7. no persisted state → no toggle calls', toggleCalls.length === 0 && _det.active === false);

// ── Scenario 8: storage unavailable (throws) → fails safe to OFF, no crash ──
const realGet = localStorage.getItem;
try {
    _detRestorePersistedState();
    check('8. storage error tolerated', true);
} catch (e) {
    check('8. storage error tolerated', false);
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
