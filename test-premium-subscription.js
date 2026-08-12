/* Smoke test for the DetectLab Premium subscription flow.
   Runs the real js/subscriptions.js, js/translations.js, js/account-legacy.js
   and js/checkout.js against a jsdom DOM that mirrors the relevant parts of
   index.html / checkout.html.

   Run:  node test-premium-subscription.js   (from repo root)
*/
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(cond, name) {
    if (cond) { passed++; console.log('  ✓ ' + name); }
    else { failed++; console.log('  ✗ FAIL: ' + name); }
}

function read(file) { return fs.readFileSync(path.join(__dirname, file), 'utf8'); }

// jsdom lacks a few browser APIs the app scripts touch at load time.
function patchWindow(w) {
    w.IntersectionObserver = class {
        constructor(cb) { this.cb = cb; }
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    w.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    w.matchMedia = w.matchMedia || function () {
        return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
    };
    w.scrollTo = w.scrollTo || function () {};
    w.requestAnimationFrame = w.requestAnimationFrame || function (cb) { return setTimeout(cb, 0); };
}

/* ────────────────────────────────────────────────────────────────────
   Test 1: translations.js pricing (monthly-only, €5, "Not available")
   ──────────────────────────────────────────────────────────────────── */
async function testPricing() {
    console.log('\n[1] Pricing — translations.js');
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div class="t" data-key="pricing_title" id="pricing_title"></div>
        <div class="pricing-toggle" id="billingToggle"></div>
        <span id="lbl_weekly"></span><span id="lbl_monthly"></span>
        <span id="bronzePrice"></span><span id="bronzePeriod"></span><p id="bronzeNote"></p>
        <span id="silverPrice"></span><span id="silverPeriod"></span><p id="silverNote"></p>
        <span id="goldPrice"></span><span id="goldPeriod"></span><p id="goldNote"></p>
        <div id="langDropdown"></div>
    </body></html>`, { runScripts: 'outside-only', url: 'http://localhost/' });

    const w = dom.window;
    patchWindow(w);
    w.localStorage.setItem('detectlab_lang', 'ro');
    w.eval(read('js/translations.js'));

    ok(w.document.getElementById('silverPrice').textContent === '5', 'silver (monthly) price = 5');
    ok(w.document.getElementById('silverPeriod').textContent === '/lună', 'silver period = /lună (ro)');
    ok(w.document.getElementById('bronzePrice').textContent === '—', 'bronze (weekly) price = —');
    ok(w.document.getElementById('goldPrice').textContent === '—', 'gold (yearly) price = —');
    ok(w.document.getElementById('bronzeNote').textContent === 'Indisponibil', 'bronze note = Indisponibil');
    ok(w.document.getElementById('goldNote').textContent === 'Indisponibil', 'gold note = Indisponibil');
    ok(w.document.getElementById('silverNote').textContent === 'Facturat lunar', 'silver note = Facturat lunar');
    ok(w.document.getElementById('pricing_title').innerHTML.includes('Planul'), 'ro pricing title applied');
}

/* ────────────────────────────────────────────────────────────────────
   Test 2: subscriptions.js — gating, modal, purchase
   ──────────────────────────────────────────────────────────────────── */
async function testSubscriptions() {
    console.log('\n[2] Subscriptions — js/subscriptions.js');
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="premiumModal" style="display:none"><div class="premium-box">
            <h2 id="premTitle"></h2>
            <div id="premBody"></div>
            <div id="premBuyWrap"><button id="premBuyLabel"></button></div>
            <button id="premLaterBtn"></button>
        </div></div>
        <button class="tab-btn" data-tab="premium" onclick="switchLayerTab('premium')">Premium</button>
        <div class="premium-panel-upsell" id="premiumPanelUpsell" data-category="premium">
            <button type="button" id="premiumPanelCta" data-premium-checkout>Become a premium member</button>
        </div>
        <div class="transp-layer-row" data-category="premium">
            <label class="apm-toggle-switch"><input type="checkbox" id="apm20Toggle"></label>
            <button id="lidarScannerRun">Scan</button>
        </div>
        <div class="transp-layer-row" data-category="premium" id="secondPremiumRow">
            <label><input type="checkbox" id="secondPremiumToggle"></label>
        </div>
        <div class="transp-layer-row" data-category="free">
            <label><input type="checkbox" id="apmToggle"></label>
        </div>
        <div id="authModal"></div>
    </body></html>`, { runScripts: 'outside-only', url: 'http://localhost/index.html' });

    const w = dom.window;
    patchWindow(w);
    w.translations = { en: {}, ro: { prem_modal_title: 'DetectLab Premium', prem_login_needed: 'x', prem_login_btn: 'Log in', prem_modal_sub: 's', prem_already: 'a', prem_manage: 'm', prem_buy_btn: 'b', prem_later: 'n', prem_layer_locked_label: 'Strat premium blocat', acct_premium_until: 'Premium until {date}' } };
    w.currentLang = 'ro';
    let authUser = null;
    let authModalOpened = false;
    w._authUser = () => authUser;
    w._save = (u) => { authUser = u; };
    w._authReadyPromise = Promise.resolve(null);
    w.openAuth = () => { authModalOpened = true; };
    w.switchLayerTab = (tab) => {
        w.document.querySelectorAll('[data-category]').forEach((el) => {
            el.classList.toggle('active', el.dataset.category === tab);
        });
    };

    // Supabase stub
    let db = {};
    w.supabaseClient = {
        from: (tbl) => ({
            select: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: db[tbl] ? db[tbl][authUser.id] : null, error: null }) })
            }),
            upsert: async (row) => { (db[tbl] = db[tbl] || {})[row.id] = row; return { error: null }; }
        })
    };

    w.eval(read('js/subscriptions.js'));
    // Let the module init (DOMContentLoaded / microtasks) settle.
    await new Promise(r => setTimeout(r, 60));

    const modal = w.document.getElementById('premiumModal');
    const apm20 = w.document.getElementById('apm20Toggle');

    // — logged-out user clicking a premium toggle → modal opens (login state), checkbox stays off
    apm20.click();
    ok(modal.classList.contains('show'), 'logged-out user: clicking premium toggle opens the modal');
    ok(apm20.checked === false, 'logged-out user: premium checkbox stays unchecked');
    modal.classList.remove('show');

    // — goToCheckout while logged out → auth modal + redirect flag
    w.goToCheckout();
    ok(authModalOpened, 'goToCheckout (logged out) opens the auth modal');
    ok(w.sessionStorage.getItem('dl_redirect_after_login') === 'checkout.html', 'redirect after login flag set');
    // Clear the pending redirect so the later purchase in this test doesn't
    // attempt a (jsdom-unsupported) navigation to checkout.html.
    w.sessionStorage.removeItem('dl_redirect_after_login');

    // — free (logged-in) user
    authUser = { id: 'u1', name: 'Test', email: 't@t.ro' };
    apm20.click();
    ok(modal.classList.contains('show'), 'free user: clicking premium toggle opens the modal');
    ok(apm20.checked === false, 'free user: premium checkbox stays unchecked');
    ok(w.sessionStorage.getItem('dl_pending_premium_toggle') === 'apm20Toggle', 'pending premium toggle remembered');

    // — free user clicking the premium tab → full locked catalogue (not a blocking modal)
    modal.classList.remove('show');
    w.document.querySelector('[data-tab="premium"]').click();
    // jsdom's outside-only mode does not execute inline onclick attributes;
    // invoke the real tab-switch equivalent after proving the gate allowed it.
    w.switchLayerTab('premium');
    ok(!modal.classList.contains('show'), 'free user: Premium tab remains browseable');
    ok(w.document.querySelectorAll('.transp-layer-row[data-category="premium"].active').length === 2, 'free user: all Premium rows are shown');
    ok(w.document.querySelectorAll('.transp-layer-row.is-premium-locked .premium-layer-lock-badge').length === 2, 'free user: every Premium row has a visible lock badge');
    ok(!w.document.getElementById('premiumPanelUpsell').classList.contains('premium-member'), 'free user: membership CTA is shown');

    let panelCheckoutStarted = false;
    const realGoToCheckout = w.goToCheckout;
    w.goToCheckout = () => { panelCheckoutStarted = true; };
    w.document.getElementById('premiumPanelCta').click();
    ok(panelCheckoutStarted, 'Become a premium member CTA starts checkout');
    ok(!modal.classList.contains('show'), 'catalogue CTA goes to checkout without opening the layer popup');
    w.goToCheckout = realGoToCheckout;

    // — free user clicking a free row toggle → no modal
    w.document.getElementById('apmToggle').click();
    ok(!modal.classList.contains('show'), 'free user: free toggle is not blocked');

    // — purchase
    authModalOpened = false;
    const res = await w.completePremiumPurchase({ from: authUser });
    ok(authUser.plan === 'premium' && !!authUser.premiumExpiresAt, 'purchase sets plan + expiry on user');
    ok(w.localStorage.getItem('dl_premium_u1') && JSON.parse(w.localStorage.getItem('dl_premium_u1')).plan === 'premium', 'purchase persisted to localStorage');
    const days = Math.round((new Date(authUser.premiumExpiresAt) - Date.now()) / 86400000);
    ok(days >= 29 && days <= 31, 'expiry ≈ 30 days out (got ' + days + ')');
    ok(db.profiles && db.profiles.u1 && db.profiles.u1.plan === 'premium', 'purchase upserted into Supabase profiles');
    ok(!!res.expiresAt, 'purchase returns the expiry date');
    ok(w.document.querySelectorAll('.transp-layer-row.is-premium-locked').length === 0, 'active Premium membership removes every layer lock');
    ok(w.document.getElementById('premiumPanelUpsell').classList.contains('premium-member'), 'active Premium membership hides the checkout CTA');

    // — premium user clicking a premium toggle → no modal, checkbox toggles
    modal.classList.remove('show');
    apm20.click();
    ok(!modal.classList.contains('show'), 'premium user: toggle not blocked');
    ok(apm20.checked === true, 'premium user: checkbox can be checked');

    // — premium user clicking the Premium tab → no modal
    w.document.querySelector('[data-tab="premium"]').click();
    ok(!modal.classList.contains('show'), 'premium user: Premium tab not blocked');
}

/* ────────────────────────────────────────────────────────────────────
   Test 3: checkout.js — Stripe redirect flow
   ──────────────────────────────────────────────────────────────────── */
const CHECKOUT_DOM = `<!DOCTYPE html><html><body>
    <main class="co-main">
    <section id="coLoginCard" style="display:none"></section>
    <section id="coCheckoutCard" style="display:none">
        <button type="button" id="coPayBtn"><span id="coPayLabel">Pay €5.00</span></button>
        <div id="coInfo" style="display:none"></div>
        <div id="coError"></div>
    </section>
    <section id="coRedirectCard" style="display:none"></section>
    <section id="coProcessingCard" style="display:none"></section>
    <section id="coPendingCard" style="display:none"><button id="coCheckAgainBtn"></button></section>
    <section id="coAlreadyCard" style="display:none"><button id="coManageBtn"></button></section>
    <section id="coSuccessCard" style="display:none">
        <strong id="coSuccessDate"></strong><button id="coSuccessManageBtn"></button>
    </section>
    </main>
</body></html>`;

async function buildCheckoutPage(url, { fetchImpl, onPremiumLoad } = {}) {
    const dom = new JSDOM(CHECKOUT_DOM, { runScripts: 'outside-only', url: url || 'http://localhost/checkout.html' });
    const w = dom.window;
    patchWindow(w);
    w.translations = { en: {}, ro: {
        co_login_title: 'x', co_login_desc: 'x', co_login_btn: 'x', co_order_title: 'x', co_plan_name: 'x',
        co_all_layers: 'x', co_total: 'x', co_renews: 'x', co_pay_title: 'x',
        co_pay_btn: 'Plătește 5,00 €', co_processing: 'x', co_processing_desc: 'x',
        co_redirecting: 'x', co_cancelled: 'x', co_already_title: 'x', co_already_desc: 'x',
        co_manage_billing: 'x', co_pending_title: 'x', co_pending_desc: 'x', co_check_again: 'x',
        co_not_configured: 'x', co_login_needed: 'x', co_secure: 'x', co_success_title: 'x',
        co_success_desc: 'x', co_success_expiry: 'x', co_go_account: 'x', co_back_map: 'x',
        co_footer: 'x', co_login_btn2: 'x', co_portal_return: 'x'
    } };
    w.currentLang = 'ro';
    const user = { id: 'u1', name: 'Ion', email: 'i@t.ro', plan: 'free' };
    w._authUser = () => user;
    w._authReadyPromise = Promise.resolve(null);
    w._save = () => {};
    w.supabaseClient = {
        auth: { getSession: async () => ({ data: { session: { access_token: 'tok_123' } } }) },
        from: () => ({})
    };
    w.fetch = fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) }));

    w.eval(read('js/subscriptions.js'));
    // Override AFTER subscriptions.js: controllable profile loader + redirect capture.
    let loadCount = 0;
    w.loadUserPremiumProfile = onPremiumLoad || (async () => {
        loadCount++;
        if (loadCount >= 2) {
            user.plan = 'premium';
            user.premiumExpiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
        }
    });
    let redirectedTo = null;
    w._dlRedirect = (u) => { redirectedTo = u; };
    w.eval(read('js/checkout.js'));

    const $ = (id) => w.document.getElementById(id);
    await new Promise(r => setTimeout(r, 30));
    return { w, $, user, getRedirected: () => redirectedTo };
}

async function testCheckout() {
    console.log('\n[3] Checkout — js/checkout.js (Stripe redirect)');

    // — logged-in user sees the checkout card
    {
        const { w, $ } = await buildCheckoutPage('http://localhost/checkout.html');
        ok($('coCheckoutCard').style.display !== 'none', 'logged-in user sees the checkout');
        ok($('coLoginCard').style.display === 'none', 'login-required hidden for logged-in user');
        w.close();
    }

    // — clicking Pay calls the backend and redirects to Stripe
    {
        let fetchCalled = null;
        const { w, $, getRedirected } = await buildCheckoutPage('http://localhost/checkout.html', {
            fetchImpl: async (url, options) => {
                fetchCalled = { url, options };
                return { ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) };
            }
        });
        $('coPayBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
        await new Promise(r => setTimeout(r, 50));

        ok(!!fetchCalled, 'Pay click → fetch called');
        ok(fetchCalled && fetchCalled.url.indexOf('/api/payments/checkout') !== -1, 'fetch hits /api/payments/checkout');
        ok(fetchCalled && fetchCalled.options.method === 'POST', 'fetch uses POST');
        ok(fetchCalled && fetchCalled.options.headers.Authorization === 'Bearer tok_123', 'Authorization: Bearer <supabase token>');
        ok(getRedirected() === 'https://checkout.stripe.com/c/pay/cs_test_1', 'redirects to the Stripe Checkout URL');
        ok($('coRedirectCard').style.display !== 'none', 'redirect card shown while navigating');
        w.close();
    }

    // — backend rejects (not configured / 500) → error, stay on checkout
    {
        const { w, $ } = await buildCheckoutPage('http://localhost/checkout.html', {
            fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: 'payments_not_configured' }) })
        });
        $('coPayBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
        await new Promise(r => setTimeout(r, 50));
        ok($('coError').textContent.length > 0, 'backend failure shows an error');
        ok($('coCheckoutCard').style.display !== 'none', 'stays on the checkout card');
        w.close();
    }

    // — already premium (409) → "already premium" card
    {
        const { w, $ } = await buildCheckoutPage('http://localhost/checkout.html', {
            fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ error: 'already_premium' }) })
        });
        $('coPayBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
        await new Promise(r => setTimeout(r, 50));
        ok($('coAlreadyCard').style.display !== 'none', '409 already_premium → already-premium card');
        w.close();
    }

    // — return flow: ?payment=success → polls profile → success card with expiry
    {
        const { w, $ } = await buildCheckoutPage('http://localhost/checkout.html?payment=success&session_id=cs_test_1');
        await new Promise(r => setTimeout(r, 3800)); // ~2 polls × 1.5s
        ok($('coSuccessCard').style.display !== 'none', 'success card shown after webhook activates Premium');
        ok(/^\d{2}\.\d{2}\.\d{4}$/.test($('coSuccessDate').textContent), 'expiry date shown on success card');
        w.close();
    }

    // — return flow: ?payment=cancelled → back to checkout with info
    {
        const { w, $ } = await buildCheckoutPage('http://localhost/checkout.html?payment=cancelled');
        ok($('coCheckoutCard').style.display !== 'none', 'cancelled → checkout card shown again');
        ok($('coInfo').style.display === 'block' && $('coInfo').textContent.length > 0, 'cancelled → info message shown');
        w.close();
    }
}

(async () => {
    await testPricing();
    await testSubscriptions();
    await testCheckout();
    console.log('\n────────────────────────────────────────');
    console.log(`passed: ${passed}   failed: ${failed}`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(2); });
