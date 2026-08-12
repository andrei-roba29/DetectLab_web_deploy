/* ═══════════════════════════════════════════════════════════════════════
   DetectLab Premium — subscriptions, gating, membership popup, checkout
   ───────────────────────────────────────────────────────────────────────
   Single source of truth for the paid membership:
     · one plan:  Monthly — €5 / month
     · weekly & yearly are marked as NOT AVAILABLE in the pricing UI
     · premium layers are gated: any attempt to enable a premium layer
       (or open the Premium tab) opens the membership popup
     · popup "Buy / Cumpără" -> checkout.html
     · after payment the user's profile gets plan='premium' +
       premium_expires_at (Supabase `profiles` table, with a localStorage
       fallback so the demo works even before the migration is applied)
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    /* ── Plan config ─────────────────────────────────────────────── */
    var PLAN = {
        id: 'monthly',
        nameKey: 'plan_monthly',
        price: 5,
        currency: 'EUR',
        period: 'month',
        days: 30        // demo expiry: +30 days
    };

    var LS_PREFIX = 'dl_premium_';   // localStorage key prefix (per user id)

    /* ── i18n helper (mirrors translations.js) ───────────────────── */
    function t(key) {
        var lang = (typeof currentLang !== 'undefined') ? currentLang : 'ro';
        var T = (typeof translations !== 'undefined' && translations[lang]) ? translations[lang] : {};
        return T[key] !== undefined ? T[key] : key;
    }

    function currentUser() {
        return (typeof window._authUser === 'function') ? window._authUser() : null;
    }

    function localStorageRecord(userId) {
        if (!userId) return null;
        try {
            var raw = localStorage.getItem(LS_PREFIX + userId);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function localStorageWrite(userId, rec) {
        try {
            if (rec) localStorage.setItem(LS_PREFIX + userId, JSON.stringify(rec));
            else localStorage.removeItem(LS_PREFIX + userId);
        } catch (e) {}
    }

    /* ── Premium status ──────────────────────────────────────────── */

    // True when the current user has an active (non-expired) subscription.
    function isPremium() {
        var u = currentUser();
        if (!u) return false;
        if (u.plan === 'premium' && u.premiumExpiresAt) {
            return new Date(u.premiumExpiresAt).getTime() > Date.now();
        }
        var rec = localStorageRecord(u.id);
        return !!(rec && rec.plan === 'premium' && rec.premiumExpiresAt &&
            new Date(rec.premiumExpiresAt).getTime() > Date.now());
    }

    // Expiration Date (or null for free users).
    function getExpiryDate() {
        var u = currentUser();
        if (u && u.plan === 'premium' && u.premiumExpiresAt) {
            return new Date(u.premiumExpiresAt);
        }
        if (u) {
            var rec = localStorageRecord(u.id);
            if (rec && rec.plan === 'premium' && rec.premiumExpiresAt) {
                return new Date(rec.premiumExpiresAt);
            }
        }
        return null;
    }

    /* ── Persistence ─────────────────────────────────────────────── */

    // Writes the premium status into the Supabase `profiles` table
    // (migration: supabase/migrations/20260812010000_...) and into the
    // localStorage fallback. Never throws.
    async function persistPremium(userId, expiresAt) {
        var results = { supabase: false, local: true };
        try {
            localStorageWrite(userId, { plan: 'premium', premiumExpiresAt: expiresAt.toISOString() });
        } catch (e) {}

        try {
            if (window.supabaseClient && window.supabaseClient.from) {
                var res = await window.supabaseClient
                    .from('profiles')
                    .upsert({
                        id: userId,
                        plan: 'premium',
                        premium_expires_at: expiresAt.toISOString(),
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'id' });
                if (!res.error) results.supabase = true;
                else console.warn('[Premium] profiles upsert failed (is the migration applied?):', res.error.message);
            }
        } catch (e) {
            console.warn('[Premium] profiles upsert threw:', e && e.message);
        }
        return results;
    }

    // Refreshes plan / premiumExpiresAt on the in-memory user from
    // Supabase (source of truth) then localStorage (demo fallback).
    window.loadUserPremiumProfile = async function (userId) {
        try {
            var fromDb = null;
            if (window.supabaseClient && window.supabaseClient.from) {
                var res = await window.supabaseClient
                    .from('profiles')
                    .select('plan, premium_expires_at')
                    .eq('id', userId)
                    .maybeSingle();
                if (!res.error && res.data) fromDb = res.data;
            }
            var u = currentUser();
            if (!u || u.id !== userId) return;

            var rec = fromDb ||
                localStorageRecord(userId) ||
                { plan: 'free', premiumExpiresAt: null };

            u.plan = (rec.plan === 'premium' && rec.premium_expires_at) ? 'premium' : 'free';
            u.premiumExpiresAt = rec.premium_expires_at || null;

            // Sync local cache to whatever the DB said (so the demo
            // fallback never outlives a real profile row).
            if (fromDb) {
                localStorageWrite(userId, u.plan === 'premium'
                    ? { plan: u.plan, premiumExpiresAt: u.premiumExpiresAt }
                    : null);
            }

            if (typeof window._save === 'function') window._save(u);
            window.dispatchEvent(new CustomEvent('detectlab:authchange', { detail: { user: u } }));
            applyPremiumUI();
        } catch (e) {
            console.warn('[Premium] loadUserPremiumProfile:', e && e.message);
        }
    };

    /* ── Membership popup ────────────────────────────────────────── */

    function openPremiumModal() {
        var modal = document.getElementById('premiumModal');
        if (!modal) return;
        modal.classList.add('show');
        refreshPremiumModal();
        if (typeof closeAuth === 'function') closeAuth();
    }

    window.openPremiumModal = openPremiumModal;

    function closePremiumModal() {
        var modal = document.getElementById('premiumModal');
        if (modal) modal.classList.remove('show');
    }

    window.closePremiumModal = closePremiumModal;

    function refreshPremiumModal() {
        var modal = document.getElementById('premiumModal');
        if (!modal) return;
        var user = currentUser();
        var prem = isPremium();

        var titleEl = document.getElementById('premTitle');
        var bodyEl = document.getElementById('premBody');
        if (!bodyEl) return;

        var buyWrap = document.getElementById('premBuyWrap');
        var laterBtn = document.getElementById('premLaterBtn');
        if (buyWrap) buyWrap.style.display = user ? '' : 'none';
        if (laterBtn) laterBtn.style.display = user ? '' : 'none';

        if (titleEl) titleEl.textContent = t('prem_modal_title');

        if (!user) {
            bodyEl.innerHTML =
                '<div class="prem-ico">🔒</div>' +
                '<p class="prem-sub">' + esc(t('prem_modal_sub')) + '</p>' +
                '<div class="prem-login-box">' +
                '  <p>' + esc(t('prem_login_needed')) + '</p>' +
                '  <button type="button" class="prem-btn prem-btn-primary" onclick="window.openAuth && openAuth(\'login\')">' +
                '    ' + esc(t('prem_login_btn')) +
                '  </button>' +
                '</div>';
            return;
        }

        if (prem) {
            var exp = getExpiryDate();
            bodyEl.innerHTML =
                '<div class="prem-ico">✅</div>' +
                '<p class="prem-sub">' + esc(t('prem_already')) + '</p>' +
                (exp ? '<p class="prem-expiry">' + esc(t('acct_premium_until').replace('{date}', formatDate(exp))) + '</p>' : '') +
                '<div class="prem-login-box">' +
                '  <button type="button" class="prem-btn prem-btn-primary" onclick="goToCheckout()">' +
                '    ' + esc(t('prem_manage')) +
                '  </button>' +
                '</div>';
            return;
        }

        bodyEl.innerHTML =
            '<div class="prem-ico">👑</div>' +
            '<p class="prem-sub">' + esc(t('prem_modal_sub')) + '</p>' +
            '<div class="prem-features">' +
            '  <div class="prem-feature">🛰️ <span>' + esc(t('prem_feat_apm20')) + '</span></div>' +
            '  <div class="prem-feature">🗺️ <span>' + esc(t('prem_feat_hist')) + '</span></div>' +
            '  <div class="prem-feature">📡 <span>' + esc(t('prem_feat_lidar')) + '</span></div>' +
            '  <div class="prem-feature">🏛️ <span>' + esc(t('prem_feat_archeo')) + '</span></div>' +
            '  <div class="prem-feature">⚔️ <span>' + esc(t('prem_feat_roman')) + '</span></div>' +
            '</div>' +
            '<div class="prem-price-line">' + esc(t('prem_price_line')) + '</div>';
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function formatDate(d) {
        if (!d) return '';
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var yyyy = d.getFullYear();
        return dd + '.' + mm + '.' + yyyy;
    }

    window._dlFormatDate = formatDate;

    /* ── Checkout navigation ─────────────────────────────────────── */

    window.goToCheckout = function () {
        var user = currentUser();
        if (!user) {
            // Ask for a free account first, then bounce back to checkout.
            sessionStorage.setItem('dl_redirect_after_login', 'checkout.html');
            if (typeof window.openAuth === 'function') window.openAuth('login');
            return;
        }
        window.location.href = 'checkout.html';
    };

    // Called by checkout.html after a successful (demo) payment.
    window.completePremiumPurchase = async function (opts) {
        opts = opts || {};
        var user = currentUser();
        if (!user) throw new Error('No user');

        var from = opts.from || null;
        var base = from && from.premiumExpiresAt ? new Date(from.premiumExpiresAt) : new Date();
        if (from && from.premiumExpiresAt && new Date(from.premiumExpiresAt) > base) base = new Date(from.premiumExpiresAt);
        var expiresAt = new Date(base.getTime() + (PLAN.days * 24 * 60 * 60 * 1000));

        // In-memory user + local cache (works even if the migration is
        // not applied yet).
        user.plan = 'premium';
        user.premiumExpiresAt = expiresAt.toISOString();
        if (typeof window._save === 'function') window._save(user);
        localStorageWrite(user.id, { plan: 'premium', premiumExpiresAt: expiresAt.toISOString() });
        window.dispatchEvent(new CustomEvent('detectlab:authchange', { detail: { user: user } }));

        await persistPremium(user.id, expiresAt);

        return { expiresAt: expiresAt };
    };

    /* ── Gating: premium layers & the Premium tab ────────────────── */

    // Anything interactive inside a [data-category="premium"] row is
    // blocked for free users (capture phase → runs before the layer
    // toggle handlers).
    function onDocClickCapture(e) {
        if (isPremium()) return;
        var target = e.target;
        if (!target || !target.closest) return;

        // Gate the Premium tab inside the layers panel.
        if (target.closest && target.closest('[data-tab="premium"]')) {
            e.preventDefault();
            e.stopPropagation();
            rememberPendingToggle(target);
            openPremiumModal();
            return;
        }

        var row = target.closest('[data-category="premium"]');
        if (!row) return;

        // Allow pure text selection / scrolling; block every interactive
        // control (toggle switches, buttons, sliders) inside premium rows.
        if (target.closest('input, button, label, a, .transp-slider, select, textarea')) {
            e.preventDefault();
            e.stopPropagation();
            rememberPendingToggle(target);
            openPremiumModal();
        }
    }

    // Remembers which premium toggle the user tried to flip, so that it can
    // be switched on automatically after a successful purchase.
    function rememberPendingToggle(target) {
        try {
            var cb = target && target.closest ? target.closest('input[type="checkbox"]') : null;
            if (cb && cb.id) sessionStorage.setItem('dl_pending_premium_toggle', cb.id);
            else {
                var row = target && target.closest ? target.closest('[data-category="premium"]') : null;
                var cb2 = row && row.querySelector ? row.querySelector('input[type="checkbox"]') : null;
                if (cb2 && cb2.id) sessionStorage.setItem('dl_pending_premium_toggle', cb2.id);
            }
        } catch (e) {}
    }

    // Wraps the programmatic layer toggles so premium layers can never be
    // switched ON by a free user (map clicks on coverage rectangles, JS
    // calls, etc.). Turning a layer OFF is always allowed.
    var PREMIUM_TOGGLE_FNS = [
        'toggleApm20Layer',
        'toggleHistPremiumLayer',
        'toggleJosephineLayer',
        'toggleRomanLayer',
        'toggleArcheoPotentialLayer',
        'toggleLidarScannerLayer',
        'setLidarActive',
        'toggleHistPremiumMap'      // safe no-op if absent
    ];

    function wrapPremiumToggles() {
        PREMIUM_TOGGLE_FNS.forEach(function (fnName) {
            var fn = window[fnName];
            if (typeof fn !== 'function') return;
            window[fnName] = function (on) {
                // Turning a layer ON is premium-only; turning OFF is free.
                var wantOn = (on === true || on === undefined);
                if (wantOn && !isPremium()) {
                    // Some callers flip their checkbox before invoking the
                    // toggle — revert any premium checkbox to off, then
                    // show the membership popup.
                    applyPremiumUI();
                    openPremiumModal();
                    return;
                }
                return fn.apply(this, arguments);
            };
        });
    }

    // Keeps premium checkboxes in sync with the actual subscription.
    function applyPremiumUI() {
        var prem = isPremium();
        document.querySelectorAll('[data-category="premium"] input[type="checkbox"]').forEach(function (cb) {
            if (!prem) cb.checked = false;
        });
        // Reflect premium state in the nav pill / user menu if present.
        var navBadge = document.getElementById('navPremiumBadge');
        if (navBadge) navBadge.style.display = prem ? '' : 'none';
    }

    window.applyPremiumUI = applyPremiumUI;

    // If a purchase happened and the user picked a premium layer before
    // paying, re-apply that toggle now that they're back on the map.
    function applyPendingPremiumAction() {
        try {
            var pending = sessionStorage.getItem('dl_pending_premium_toggle');
            if (!pending || !isPremium()) return;
            sessionStorage.removeItem('dl_pending_premium_toggle');
            var el = document.getElementById(pending);
            if (el && el.type === 'checkbox') {
                el.checked = true;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (el && el.click) {
                el.click();
            }
        } catch (e) {}
    }

    /* ── URL helpers (index.html side) ───────────────────────────── */

    function handleUrlParams() {
        var params = new URLSearchParams(window.location.search || '');

        // ?goto=checkout — came from the checkout "log in" button.
        if (params.get('goto') === 'checkout') {
            var user = currentUser();
            if (!user) {
                sessionStorage.setItem('dl_redirect_after_login', 'checkout.html');
                if (typeof window.openAuth === 'function') window.openAuth('login');
            } else {
                window.location.href = 'checkout.html';
            }
        }

        // ?open=account — after checkout success ("Go to my account").
        if (params.get('open') === 'account') {
            if (currentUser() && typeof window.openAccount === 'function') {
                setTimeout(function () { window.openAccount(); }, 300);
            }
        }
    }

    function handlePostLoginRedirect() {
        try {
            var dest = sessionStorage.getItem('dl_redirect_after_login');
            if (dest && currentUser()) {
                sessionStorage.removeItem('dl_redirect_after_login');
                window.location.href = dest;
            }
        } catch (e) {}
    }

    /* ── Init ────────────────────────────────────────────────────── */

    function init() {
        document.addEventListener('click', onDocClickCapture, true);

        window.addEventListener('detectlab:authchange', function () {
            refreshPremiumModal();
            applyPremiumUI();
            handlePostLoginRedirect();
            // NOTE: the profile itself is (re)loaded by auth.js's
            // _syncFromSession() on every session change — we must NOT
            // re-fetch it here, because loadUserPremiumProfile() fires
            // this same event when it finishes (would loop forever).
        });

        // Wrap toggles once everything is loaded (map-app.js, lidar,
        // archeo-potential all run before this script).
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { wrapPremiumToggles(); });
        } else {
            wrapPremiumToggles();
        }

        // Initial state.
        if (window._authReadyPromise) {
            window._authReadyPromise.then(function () {
                var u = currentUser();
                if (u && window.loadUserPremiumProfile) window.loadUserPremiumProfile(u.id);
                applyPremiumUI();
                applyPendingPremiumAction();
                handleUrlParams();
            });
        } else {
            setTimeout(function () {
                applyPremiumUI();
                handleUrlParams();
            }, 0);
        }

        // Escape closes the membership popup.
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closePremiumModal();
        });

        // Clicking the backdrop closes the popup.
        var modal = document.getElementById('premiumModal');
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closePremiumModal();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
