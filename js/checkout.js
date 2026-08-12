/* ═══════════════════════════════════════════════════════════════════════
   DetectLab Premium — checkout page logic
   ───────────────────────────────────────────────────────────────────────
   · order summary (€5 / month)
   · Apple Pay / Google Pay buttons via the Payment Request API
     (shown only when the browser supports them)
   · conventional card form
   · DEMO MODE: the payment is simulated (no real charge). To go live,
     replace processPayment() with a real provider (Stripe Payment
     Element supports card + Apple Pay + Google Pay out of the box) and
     have its webhook / edge function write the `profiles` row.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    var PLAN_PRICE_EUR = 5;

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

    /* ── Views ───────────────────────────────────────────────────── */

    function showLoginRequired() {
        hide('coCheckoutCard'); hide('coProcessingCard'); hide('coSuccessCard');
        show('coLoginCard');
    }

    function showCheckout() {
        hide('coLoginCard'); hide('coProcessingCard'); hide('coSuccessCard');
        show('coCheckoutCard');
        var user = currentUser();
        var nameEl = $('coCardName');
        if (nameEl && user && user.name && !nameEl.value) nameEl.value = user.name.toUpperCase();
    }

    function showProcessing() {
        hide('coLoginCard'); hide('coCheckoutCard'); hide('coSuccessCard');
        show('coProcessingCard');
    }

    function showSuccess(expiresAt) {
        hide('coLoginCard'); hide('coCheckoutCard'); hide('coProcessingCard');
        show('coSuccessCard');
        var d = $('coSuccessDate');
        if (d) d.textContent = formatDate(expiresAt);
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

    /* ── Card input formatting + validation ──────────────────────── */

    function formatCardNumber(v) {
        return v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
    }

    function formatExpiry(v) {
        var digits = v.replace(/\D/g, '').slice(0, 4);
        if (digits.length <= 2) return digits;
        return digits.slice(0, 2) + '/' + digits.slice(2);
    }

    function luhnOk(num) {
        var digits = num.replace(/\D/g, '');
        if (digits.length < 13) return false;
        var sum = 0, alt = false;
        for (var i = digits.length - 1; i >= 0; i--) {
            var d = parseInt(digits.charAt(i), 10);
            if (alt) { d *= 2; if (d > 9) d -= 9; }
            sum += d;
            alt = !alt;
        }
        return sum % 10 === 0;
    }

    function expiryOk(v) {
        var m = /^(\d{2})\/(\d{2})$/.exec(v.replace(/\s/g, ''));
        if (!m) return false;
        var mm = parseInt(m[1], 10), yy = parseInt(m[2], 10);
        if (mm < 1 || mm > 12) return false;
        var now = new Date();
        var exp = new Date(2000 + yy, mm, 1); // first day of the month after expiry
        return exp > now;
    }

    function validateCardForm() {
        var name = $('coCardName').value.trim();
        var num = $('coCardNumber').value.trim();
        var exp = $('coCardExp').value.trim();
        var cvc = $('coCardCvc').value.trim();

        if (name.length < 3) return 'Please enter the name on the card.';
        if (!luhnOk(num)) return 'Please enter a valid card number.';
        if (!expiryOk(exp)) return 'Please enter a valid expiry date (MM/YY).';
        if (!/^\d{3,4}$/.test(cvc)) return 'Please enter a valid CVC.';
        return null;
    }

    function cardBrand(num) {
        var n = num.replace(/\D/g, '');
        if (/^4/.test(n)) return '💳 Visa';
        if (/^(5[1-5]|2[2-7])/.test(n)) return '💳 Mastercard';
        if (/^3[47]/.test(n)) return '💳 Amex';
        if (/^6(011|5)/.test(n)) return '💳 Discover';
        return '💳';
    }

    /* ── Payment Request API (Apple Pay / Google Pay) ────────────── */

    var pr = null;
    var prSupported = false;

    function buildPaymentRequest() {
        if (!window.PaymentRequest) return null;
        try {
            return new PaymentRequest(
                [
                    { supportedMethods: 'https://google.com/pay', data: { environment: 'TEST', apiVersion: 2, apiVersionMinor: 0, allowedPaymentMethods: [{ type: 'CARD', parameters: { allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'], allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX'] }, tokenizationSpecification: { type: 'PAYMENT_GATEWAY', parameters: { gateway: 'example', gatewayMerchantId: 'example' } } }] } },
                    { supportedMethods: 'https://apple.com/apple-pay', data: { version: 3, merchantIdentifier: 'merchant.detectlab.demo', merchantCapabilities: ['supports3DS'], supportedNetworks: ['visa', 'mastercard', 'amex'], countryCode: 'RO', currencyCode: 'EUR' } }
                ],
                {
                    total: { label: 'DetectLab Premium — Monthly', amount: { currency: 'EUR', value: PLAN_PRICE_EUR.toFixed(2) } },
                    displayItems: [{ label: 'DetectLab Premium — Monthly', amount: { currency: 'EUR', value: PLAN_PRICE_EUR.toFixed(2) } }]
                },
                { requestPayerName: true, requestPayerEmail: true }
            );
        } catch (e) {
            console.warn('[Checkout] PaymentRequest build failed:', e);
            return null;
        }
    }

    async function initWallets() {
        pr = buildPaymentRequest();
        if (!pr) return;

        var methods = [];
        try {
            // canMakePayment() tells us which wallets the browser supports.
            var resp = await pr.canMakePayment();
            if (resp) {
                // Probe each method separately.
                var g = await probeMethod('https://google.com/pay');
                var a = await probeMethod('https://apple.com/apple-pay');
                if (g) methods.push('google');
                if (a) methods.push('apple');
            }
        } catch (e) {
            console.warn('[Checkout] canMakePayment failed:', e);
        }

        if (methods.length === 0) return;

        prSupported = true;
        show('coWallets');
        if (methods.indexOf('apple') !== -1) show('coApplePayBtn');
        if (methods.indexOf('google') !== -1) show('coGooglePayBtn');
        if (methods.indexOf('google') !== -1 && methods.indexOf('apple') !== -1) show('coWalletOr');
        else $('coWalletOr').style.display = 'none';
    }

    async function probeMethod(method) {
        try {
            var p = new PaymentRequest([{ supportedMethods: method }], {
                total: { label: 'Test', amount: { currency: 'EUR', value: '0.01' } }
            });
            var r = await p.canMakePayment();
            return !!r;
        } catch (e) { return false; }
    }

    async function payWithWallet() {
        if (!pr) return;
        setError('');
        try {
            showProcessing();
            var result = await pr.show();

            // DEMO MODE — simulate the provider confirming the payment.
            await delay(1200);
            await pr.complete('success');

            await finishPurchase('wallet');
        } catch (err) {
            console.warn('[Checkout] Wallet payment aborted:', err);
            hide('coProcessingCard');
            if (err && err.name === 'AbortError') {
                showCheckout(); // user dismissed the sheet
            } else {
                setError('Payment failed. Please try again.');
                showCheckout();
            }
        }
    }

    /* ── DEMO payment simulation ─────────────────────────────────── */
    // Replace this function with a real provider call in production.
    function processPayment(method) {
        return new Promise(function (resolve, reject) {
            setTimeout(function () {
                // Simulated provider: always succeeds in demo mode.
                resolve({ id: 'demo_' + Date.now(), method: method });
            }, 1800);
        });
    }

    function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    async function finishPurchase(method) {
        try {
            var user = currentUser();
            if (!user) throw new Error('No user');

            var res = await window.completePremiumPurchase({ from: user });
            showSuccess(res.expiresAt);
        } catch (err) {
            console.error('[Checkout] finishPurchase:', err);
            setError('Could not activate Premium. Please try again.');
            hide('coProcessingCard');
            showCheckout();
        }
    }

    /* ── Card submit ─────────────────────────────────────────────── */

    async function onCardSubmit(e) {
        e.preventDefault();
        setError('');

        var err = validateCardForm();
        if (err) { setError(err); return; }

        var btn = $('coPayBtn');
        var label = $('coPayLabel');
        var originalLabel = label.textContent;
        btn.disabled = true;
        label.textContent = t('co_processing_short') || 'Processing…';
        showProcessing();

        try {
            await processPayment('card');
            await finishPurchase('card');
        } finally {
            btn.disabled = false;
            label.textContent = originalLabel;
        }
    }

    /* ── Init ────────────────────────────────────────────────────── */

    function init() {
        // Input formatting
        $('coCardNumber').addEventListener('input', function () {
            var el = this;
            el.value = formatCardNumber(el.value);
            var brand = $('coCardBrand');
            if (brand) brand.textContent = cardBrand(el.value);
        });
        $('coCardExp').addEventListener('input', function () {
            this.value = formatExpiry(this.value);
        });
        $('coCardCvc').addEventListener('input', function () {
            this.value = this.value.replace(/\D/g, '').slice(0, 4);
        });

        $('coCardForm').addEventListener('submit', onCardSubmit);
        $('coApplePayBtn').addEventListener('click', payWithWallet);
        $('coGooglePayBtn').addEventListener('click', payWithWallet);

        // Language: swap [data-key] nodes to the active language.
        // (We don't call translations.setLang() here because it also
        // drives the landing-page billing display, which doesn't exist
        // on this page.)
        try {
            var lang = localStorage.getItem('detectlab_lang') ||
                ((typeof currentLang !== 'undefined') ? currentLang : 'ro');
            var T = (typeof translations !== 'undefined' && translations[lang]) ? translations[lang] : {};
            document.querySelectorAll('.t[data-key]').forEach(function (el) {
                var key = el.getAttribute('data-key');
                if (T[key] !== undefined) el.innerHTML = T[key];
            });
        } catch (e) {}

        initWallets();

        // Wait for the auth system (auth.js on this page).
        var ready = (typeof window._authReadyPromise !== 'undefined') ? window._authReadyPromise : Promise.resolve();
        ready.then(function () {
            var user = currentUser();
            if (user) {
                showCheckout();
                // Already premium? Let them renew from the account page —
                // still allow purchase, it extends the subscription.
            } else {
                showLoginRequired();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
