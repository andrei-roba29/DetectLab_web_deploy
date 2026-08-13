/* ═══════════════════════════════════════════════════════════════════════
   Stripe setup helper — creates the DetectLab Premium product + the
   ONE-TIME €5 price (Premium for one calendar month, no automatic
   renewal) and prints the env values you need.

   Usage (from backend/):
     STRIPE_SECRET_KEY=sk_test_... node scripts/setupStripe.js

   · With a sk_test key it creates TEST product/price (safe to play with).
   · With a sk_live key it creates LIVE product/price (real money).
   · Idempotent: re-running reuses the existing product/price via the
     `detectlab_product` metadata tag, so you never end up with duplicates.
   ═══════════════════════════════════════════════════════════════════════ */

import 'dotenv/config';

const API = 'https://api.stripe.com/v1';

function authHeader() {
  return 'Basic ' + Buffer.from(process.env.STRIPE_SECRET_KEY + ':').toString('base64');
}

async function stripeRequest(path, opts = {}) {
  const method = opts.method || 'GET';
  const params = opts.params || {};
  const url = new URL(API + path);
  const headers = { Authorization: authHeader(), Accept: 'application/json' };
  let body;
  if (method === 'GET') {
    if (Object.keys(params).length) url.search = new URLSearchParams(params).toString();
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(params).toString();
  }
  const res = await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data.error && data.error.message) || `Stripe API error ${res.status}`);
  }
  return data;
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('Missing STRIPE_SECRET_KEY (sk_test_... or sk_live_...).');
    console.error('  Example: STRIPE_SECRET_KEY=sk_test_xxx node scripts/setupStripe.js');
    process.exit(1);
  }

  const mode = process.env.STRIPE_SECRET_KEY.startsWith('sk_test') ? 'TEST' : 'LIVE';
  console.log(`\nStripe mode: ${mode}\n`);

  // ── Product ─────────────────────────────────────────────────────────
  let productId = null;
  const products = await stripeRequest('/products', { params: { limit: '100', active: 'true' } });
  for (const p of products.data || []) {
    if (p.metadata && p.metadata.detectlab_product === '1') { productId = p.id; break; }
  }
  if (!productId) {
    const product = await stripeRequest('/products', {
      method: 'POST',
      params: {
        name: 'DetectLab Premium',
        description: 'One month of access to all premium map layers (one-time payment)',
        'metadata[detectlab_product]': '1',
      },
    });
    productId = product.id;
    console.log(`Created product: ${product.name} (${productId})`);
  } else {
    console.log(`Reusing product ${productId}`);
  }

  // ── One-time €5 price (no recurring interval) ──────────────────────
  let priceId = null;
  const prices = await stripeRequest('/prices', { params: { product: productId, limit: '100' } });
  for (const p of prices.data || []) {
    if (p.currency === 'eur' && p.unit_amount === 500 && !p.recurring && p.active !== false) {
      priceId = p.id;
      break;
    }
  }
  if (!priceId) {
    const price = await stripeRequest('/prices', {
      method: 'POST',
      params: {
        product: productId,
        currency: 'eur',
        unit_amount: '500', // €5.00, charged once
      },
    });
    priceId = price.id;
    console.log(`Created price: €5.00 one-time (${priceId})`);
  } else {
    console.log(`Reusing one-time price ${priceId}`);
  }

  console.log('\n──────────────────────────────────────────────');
  console.log('Add these to your backend environment (Railway / .env):');
  console.log(`  STRIPE_ONE_TIME_PRICE_ID=${priceId}`);
  console.log(`  STRIPE_SITE_URL=https://<your-frontend-host>`);
  console.log('');
  console.log('Then configure the webhook:');
  console.log('  Local dev:   stripe listen --forward-to localhost:3001/api/payments/webhook');
  console.log('               → copy the printed whsec_... into STRIPE_WEBHOOK_SECRET');
  console.log('  Production:  Stripe Dashboard → Developers → Webhooks → Add endpoint');
  console.log('               URL: https://<your-backend-host>/api/payments/webhook');
  console.log('               Events: checkout.session.completed,');
  console.log('                       checkout.session.async_payment_succeeded');
  console.log('                       (legacy subscribers also need: invoice.paid,');
  console.log('                        invoice.payment_failed,');
  console.log('                        customer.subscription.updated,');
  console.log('                        customer.subscription.deleted)');
  console.log('               → reveal the signing secret (whsec_...) and set it as');
  console.log('                 STRIPE_WEBHOOK_SECRET');
  console.log('──────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
