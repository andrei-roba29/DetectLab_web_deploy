import https from 'node:https';
import { env } from '../../config/env.js';
import { logger } from '../../logger.js';

// Node's built-in fetch() has a known crash bug (an internal assertion
// failure) when talking to servers that close connections in unusual
// ways — which this old government server does regularly. Rather than
// fight that, we use the older, extremely stable `https` module
// directly, with keep-alive fully disabled (a fresh connection per
// request avoids the specific race condition entirely).
const agent = new https.Agent({ keepAlive: false });

function requestOnce(urlString, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlString);

    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method,
        headers: { ...headers, Connection: 'close' },
        agent,
        timeout: env.arcgis.requestTimeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            bodyText: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      }
    );

    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}

/**
 * Fetch a URL with a timeout, retrying on failure with exponential backoff.
 * This is the one place all network flakiness against the government
 * server gets absorbed, so callers don't need to think about it.
 */
export async function fetchWithRetry(url, { retries = env.arcgis.maxRetries, ...fetchOptions } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await requestOnce(url, fetchOptions);

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(
          `HTTP ${res.statusCode} ${res.statusMessage} — body: ${res.bodyText.slice(0, 500)}`
        );
      }

      let data;
      try {
        data = JSON.parse(res.bodyText);
      } catch {
        throw new Error(`Response was not valid JSON: ${res.bodyText.slice(0, 200)}`);
      }

      // ArcGIS returns HTTP 200 even for its own internal errors, so we
      // have to check the body shape too.
      if (data.error) {
        throw new Error(`ArcGIS error: ${JSON.stringify(data.error)}`);
      }

      return data;
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === retries + 1;

      logger.warn(
        { attempt, retries, url, err: err.message },
        isLastAttempt ? 'Request failed, no retries left' : 'Request failed, retrying'
      );

      if (!isLastAttempt) {
        const backoffMs = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s, ...
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError;
}
