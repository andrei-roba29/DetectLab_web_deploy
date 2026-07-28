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
};
