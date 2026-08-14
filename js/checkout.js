/* ═══════════════════════════════════════════════════════════════════════
   DetectLab Premium — checkout page logic (REAL payments via Stripe)
   ───────────────────────────────────────────────────────────────────────
   · order summary (€5 for one month — one-time payment, no auto-renewal)
   · "Pay" → POST /api/payments/checkout (backend) → redirect to Stripe's
     hosted Checkout page in `payment` mode (cards + Apple Pay + Google
     Pay are handled by Stripe — this page never touches card data)
   · return flow (?payment=success / cancelled / portal)
   · activation is confirmed server-side by the Stripe webhook; the page
     polls the user's profile until the webhook lands.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    var PLAN_PRICE_EUR = 5;
    var API_BASE = (typeof window.DETECTLAB_API_BASE !== 'undefined' && window.DETECTLAB_API_BASE) ||
        'https://detectlab-backend-production.up.railway.app/api';
    var POLL_ATTEMPTS = 20;       // 20 × 1.5s ≈ 30s (webhooks land in ~2-5s)
    var POLL_INTERVAL_MS = 1500;

    function t(key) {
        var lang = (typeof currentLang !== 'undefined') ? currentLang : 'ro';
        var T = (typeof translations !== 'undefined' && translations[lang]) ? translations[lang] : {};
        return T[key] !== undefined ? T[key] : key;
    }

    function $(id) { return document.getElementById(id); }

    function show(id) { var el = $(id); if (el) el.style.display = ''; }
    function hide(id) { var el = $(id); if (el) el.style.display = 'none'; }

    function currentUser() {
        return (typeof window._authUser === 'function') ? window._authUser() : null;
    }

    function getParam(name) {
        try { return new URLSearchParams(window.location.search).get(name); }
        catch (e) { return null; }
    }

    /* ── Views ───────────────────────────────────────────────────── */

    // Every view helper hides all the other cards, so adding a card means
    // adding it to this list once.
    var ALL_CARDS = [
        'coLoginCard', 'coCheckoutCard', 'coRedirectCard', 'coProcessingCard',
        'coPendingCard', 'coAlreadyCard', 'coSuccessCard', 'coPromoSuccessCard'
    ];

    function showOnly(id) {
        ALL_CARDS.forEach(function (cardId) {
            if (cardId !== id) hide(cardId);
        });
        show(id);
    }

    function showLoginRequired() {
        showOnly('coLoginCard');
    }

    function showCheckout() {
        showOnly('coCheckoutCard');
    }

    function showRedirecting() {
        showOnly('coRedirectCard');
    }

    function showProcessing() {
        showOnly('coProcessingCard');
    }

    function showPending() {
        showOnly('coPendingCard');
    }

    function showAlready(expiresAt) {
        showOnly('coAlreadyCard');
        var d = $('coAlreadyDate');
        if (d) d.textContent = formatDate(expiresAt || currentExpiry());
        applyManageVisibility();
    }

    function showSuccess(expiresAt) {
        showOnly('coSuccessCard');
        var d = $('coSuccessDate');
        if (d) d.textContent = formatDate(expiresAt);
        applyManageVisibility();
    }

    // Free trial / promo unlocked — deliberately a separate card from the
    // paid success one: no receipt, no "you were charged" wording.
    function showPromoSuccess(expiresAt) {
        showOnly('coPromoSuccessCard');
        var d = $('coPromoSuccessDate');
        if (d) d.textContent = formatDate(expiresAt);
    }

    function currentExpiry() {
        var u = currentUser();
        return (u && u.premiumExpiresAt) ? new Date(u.premiumExpiresAt) : null;
    }

    // "Manage subscription" only makes sense for LEGACY recurring
    // subscribers — a one-time purchase has no renewal to cancel.
    function isLegacySubscriber() {
        if (typeof window._dlIsLegacySubscriber === 'function') {
            return !!window._dlIsLegacySubscriber(currentUser());
        }
        var u = currentUser();
        return !!(u && u.stripeSubscriptionId && u.stripeSubscriptionStatus !== 'one_time_paid');
    }

    function applyManageVisibility() {
        var legacy = isLegacySubscriber();
        ['coManageBtn', 'coSuccessManageBtn'].forEach(function (id) {
            var el = $(id);
            if (el) el.style.display = legacy ? '' : 'none';
        });
    }

    function formatDate(d) {
        if (!d) return '—';
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        return dd + '.' + mm + '.' + d.getFullYear();
    }

    function setError(msg) {
        var el = $('coError');
        if (el) { el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none'; }
    }

    function setInfo(msg) {
        var el = $('coInfo');
        if (el) { el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none'; }
    }

    function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    /* ── Auth token ──────────────────────────────────────────────── */

    async function getAccessToken() {
        if (typeof window._dlAccessToken === 'function') return window._dlAccessToken();
        if (window.supabaseClient && window.supabaseClient.auth && window.supabaseClient.auth.getSession) {
            var r = await window.supabaseClient.auth.getSession();
            var session = r && r.data && r.data.session;
            return session ? session.access_token : null;
        }
        return null;
    }

    /* ── Start payment ───────────────────────────────────────────── */

    async function payNow() {
        setError(''); setInfo('');

        var user = currentUser();
        if (!user) {
            if (typeof window.openAuth === 'function') window.openAuth('login');
            return;
        }

        var token = await getAccessToken();
        if (!token) {
            setError(t('co_login_needed') || 'Please log in first.');
            return;
        }

        var btn = $('coPayBtn');
        var label = $('coPayLabel');
        var originalLabel = label.textContent;
        btn.disabled = true;
        label.textContent = t('co_redirecting') || 'Taking you to Stripe…';

        try {
            var res = await fetch(API_BASE + '/payments/checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                }
            });
            var data = await res.json().catch(function () { return {}; });

            if (res.status === 409 && data.error === 'already_premium') {
                showAlready(data.premium_expires_at ? new Date(data.premium_expires_at) : null);
                return;
            }
            if (!res.ok) {
                throw new Error(data.message || ('HTTP ' + res.status));
            }
            if (!data.url) throw new Error('No checkout URL returned');

            showRedirecting();
            window._dlRedirect(data.url);
        } catch (err) {
            console.error('[Checkout] payNow:', err);
            setError(t('co_not_configured') || 'Payments are not configured yet. Please try again later.');
            showCheckout();
        } finally {
            btn.disabled = false;
            label.textContent = originalLabel;
        }
    }

    /* ── Promo code ──────────────────────────────────────────────────
       Redeeming a valid code unlocks Premium with no payment. All the
       rules live in the backend (POST /api/promo/redeem); the shared
       client wrapper is window.redeemPromoCode() in js/subscriptions.js,
       which also refreshes the profile afterwards.
       ─────────────────────────────────────────────────────────────── */

    function setPromoMessage(okText, errText) {
        var okEl = $('coPromoOk');
        var errEl = $('coPromoErr');
        if (okEl) {
            okEl.textContent = okText || '';
            okEl.style.display = okText ? 'block' : 'none';
        }
        if (errEl) {
            errEl.textContent = errText || '';
            errEl.style.display = errText ? 'block' : 'none';
        }
    }

    function normalizePromoCode(value) {
        if (typeof window._dlNormalizePromoCode === 'function') {
            return window._dlNormalizePromoCode(value);
        }
        return String(value == null ? '' : value)
            .trim().toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9_-]/g, '').slice(0, 64);
    }

    // Set while a redemption is in flight: window.redeemPromoCode() fires
    // `detectlab:authchange` as soon as Premium is granted, and the
    // listener below would otherwise flash the "already Premium" card
    // before we get to show the promo success one.
    var promoInFlight = false;

    async function redeemPromo() {
        var input = $('coPromoInput');
        var btn = $('coPromoBtn');
        if (!input) return;

        var code = normalizePromoCode(input.value);
        input.value = code;

        if (!code) {
            setPromoMessage('', t('promo_err_invalid'));
            input.focus();
            return;
        }
        if (typeof window.redeemPromoCode !== 'function') {
            setPromoMessage('', t('promo_err_generic'));
            return;
        }

        setPromoMessage('', '');
        setError(''); setInfo('');
        if (btn) btn.disabled = true;
        input.disabled = true;
        promoInFlight = true;

        var result;
        try {
            result = await window.redeemPromoCode(code);
        } finally {
            promoInFlight = false;
            if (btn) btn.disabled = false;
            input.disabled = false;
        }

        if (!result.ok) {
            // The user is already Premium (e.g. bought a month in another
            // tab) → send them to the card that explains that state.
            if (result.error === 'already_premium') {
                showAlready(currentExpiry());
                return;
            }
            setPromoMessage('', result.message);
            input.focus();
            input.select();
            return;
        }

        showPromoSuccess(result.expiresAt || currentExpiry());
    }

    function initPromo() {
        var toggle = $('coPromoToggle');
        var form = $('coPromoForm');
        var btn = $('coPromoBtn');
        var input = $('coPromoInput');

        if (toggle && form) {
            toggle.addEventListener('click', function () {
                form.style.display = '';
                toggle.style.display = 'none';
                toggle.setAttribute('aria-expanded', 'true');
                if (input) input.focus();
            });
        }
        if (btn) btn.addEventListener('click', redeemPromo);
        if (input) {
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    redeemPromo();
                }
            });
            input.addEventListener('input', function () {
                var pos = input.selectionStart;
                var next = normalizePromoCode(input.value);
                if (next !== input.value) {
                    input.value = next;
                    try { input.setSelectionRange(pos, pos); } catch (e) {}
                }
            });
        }

        // Deep link: checkout.html?promo=TRIAL24 pre-fills and opens the
        // form (handy for campaign links in emails / social posts).
        var fromUrl = normalizePromoCode(getParam('promo') || getParam('code'));
        if (fromUrl && input && toggle && form) {
            input.value = fromUrl;
            form.style.display = '';
            toggle.style.display = 'none';
            toggle.setAttribute('aria-expanded', 'true');
        }
    }

    /* ── Billing portal (manage / cancel / renew) ────────────────── */

    async function openPortal() {
        setError(''); setInfo('');
        var token = await getAccessToken();
        if (!token) {
            setError(t('co_login_needed') || 'Please log in first.');
            return;
        }
        try {
            var res = await fetch(API_BASE + '/payments/portal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
            });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok || !data.url) throw new Error(data.message || ('HTTP ' + res.status));
            window._dlRedirect(data.url);
        } catch (err) {
            console.error('[Checkout] openPortal:', err);
            setError(t('co_not_configured') || 'Payments are not configured yet. Please try again later.');
        }
    }

    /* ── Return flow (after Stripe redirects back) ───────────────── */

    async function waitForActivation() {
        var user = currentUser();
        if (!user) return false;

        for (var i = 0; i < POLL_ATTEMPTS; i++) {
            // Refresh the in-memory user from the profiles table — the
            // Stripe webhook writes it server-side.
            if (typeof window.loadUserPremiumProfile === 'function') {
                await window.loadUserPremiumProfile(user.id);
            }
            var u = currentUser();
            if (u && u.plan === 'premium' && u.premiumExpiresAt &&
                new Date(u.premiumExpiresAt).getTime() > Date.now()) {
                showSuccess(new Date(u.premiumExpiresAt));
                return true;
            }
            await delay(POLL_INTERVAL_MS);
        }
        return false;
    }

    async function handleReturn() {
        var payment = getParam('payment');

        if (payment === 'cancelled') {
            showCheckout();
            setInfo(t('co_cancelled') || 'Payment cancelled — you were not charged.');
            return;
        }

        if (payment === 'portal') {
            showCheckout();
            setInfo(t('co_portal_return') || 'Subscription settings updated.');
            return;
        }

        if (payment === 'success') {
            showProcessing();
            var activated = await waitForActivation();
            if (!activated) showPending();
        }
    }

    /* ── Init ────────────────────────────────────────────────────── */

    function init() {
        var payBtn = $('coPayBtn');
        if (payBtn) payBtn.addEventListener('click', payNow);

        initPromo();

        var checkAgain = $('coCheckAgainBtn');
        if (checkAgain) {
            checkAgain.addEventListener('click', async function () {
                showProcessing();
                var activated = await waitForActivation();
                if (!activated) showPending();
            });
        }

        [['coManageBtn'], ['coSuccessManageBtn']].forEach(function (ids) {
            var el = $(ids[0]);
            if (el) el.addEventListener('click', openPortal);
        });
        applyManageVisibility();

        // Language: swap [data-key] nodes to the active language.
        try {
            var lang = localStorage.getItem('detectlab_lang') ||
                ((typeof currentLang !== 'undefined') ? currentLang : 'ro');
            var T = (typeof translations !== 'undefined' && translations[lang]) ? translations[lang] : {};
            document.querySelectorAll('.t[data-key]').forEach(function (el) {
                var key = el.getAttribute('data-key');
                if (T[key] !== undefined) el.innerHTML = T[key];
            });
        } catch (e) {}

        // Wait for the auth system (auth.js on this page).
        var ready = (typeof window._authReadyPromise !== 'undefined') ? window._authReadyPromise : Promise.resolve();
        // An account whose Premium has NOT expired yet cannot buy another
        // month — decided purely on premium_expires_at (the backend enforces
        // the same rule and answers 409 already_premium). js/subscriptions.js
        // loads the profile from Supabase asynchronously, so re-check
        // whenever the user object changes.
        function hasUnexpiredPremium() {
            var exp = currentExpiry();
            return !!(exp && exp.getTime() > Date.now());
        }

        window.addEventListener('detectlab:authchange', function () {
            if (promoInFlight) return; // redeemPromo() decides the next view
            var card = $('coCheckoutCard');
            var onCheckoutCard = card && card.style.display !== 'none';
            if (onCheckoutCard && hasUnexpiredPremium()) showAlready(currentExpiry());
        });

        ready.then(function () {
            var user = currentUser();
            if (!user) {
                showLoginRequired();
                return;
            }
            if (getParam('payment')) {
                handleReturn();
                return;
            }
            if (hasUnexpiredPremium()) {
                showAlready(currentExpiry());
                return;
            }
            showCheckout();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
