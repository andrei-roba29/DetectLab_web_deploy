import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  databaseUrl: required('DATABASE_URL'),
  pgSsl: process.env.PGSSL === 'true',

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  arcgis: {
    baseUrl: required('ARCGIS_BASE_URL'),
    pageSize: Number(process.env.ARCGIS_PAGE_SIZE || 1000),
    concurrency: Number(process.env.ARCGIS_CONCURRENCY || 5),
    requestTimeoutMs: Number(process.env.ARCGIS_REQUEST_TIMEOUT_MS || 15000),
    maxRetries: Number(process.env.ARCGIS_MAX_RETRIES || 3),
  },

  sync: {
    minSuccessRatio: Number(process.env.SYNC_MIN_SUCCESS_RATIO || 0.98),
    cron: process.env.SYNC_CRON || '0 0 * * *',
    onBoot: process.env.SYNC_ON_BOOT === 'true',
  },

  // ── Supabase (auth verification for the payments API) ────────────────
  // Not required at boot: the payments endpoints return 503 until set.
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',

  // Protects national-ingestion and review administration endpoints.
  ingestionAdminKey: process.env.INGESTION_ADMIN_KEY || '',
  evidenceWorkerEnabled: process.env.EVIDENCE_WORKER_ENABLED === 'true',
  // Wall-clock budget for the live crawl a user search triggers. The source is
  // politely throttled through one request lane, so an unbounded run can
  // outlast the platform's HTTP timeout and the browser's own abort: the
  // engine stops at the deadline and answers with everything it managed to
  // read, flagged as `truncated` (and re-researched on a later search).
  evidenceResearchBudgetMs: Number(process.env.EVIDENCE_RESEARCH_BUDGET_MS || 45000),
  // Echo the underlying error message in failed evidence responses (useful on
  // staging; leave unset in production).
  exposeErrorDetails: process.env.EVIDENCE_DEBUG === 'true',

  // ── Stripe (real payments) ────────────────────────────────────────────
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    // One-time €5 price (Premium for one calendar month, no renewal).
    // This is what new checkouts use.
    oneTimePriceId: process.env.STRIPE_ONE_TIME_PRICE_ID || '',
    // Legacy recurring price — kept only so existing subscribers keep
    // working and as a fallback when the one-time price is not set yet.
    priceId: process.env.STRIPE_PRICE_ID || '',
    // Base URL used for success/cancel redirects; falls back to the
    // request's Origin header (handy for local testing).
    siteUrl: process.env.STRIPE_SITE_URL || '',
  },
};
