function normalizeOrigin(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

function isLocalDevelopmentOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/**
 * Select a safe frontend origin for Stripe success/cancel/portal links.
 *
 * A trusted request origin wins over the legacy single-site fallback. This
 * lets detectlab.ro and detectlab.eu share one backend without sending a user
 * back to the other market after payment. Unrecognised Origin headers never
 * become redirect targets.
 */
export function resolveSiteOrigin({
  requestOrigin,
  allowedOrigins = [],
  configuredSiteUrl = '',
  fallbackOrigin = '',
  allowLocalhost = false,
} = {}) {
  const requested = normalizeOrigin(requestOrigin);
  const allowed = new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean));

  if (requested && (allowed.has(requested) || (allowLocalhost && isLocalDevelopmentOrigin(requested)))) {
    return requested;
  }

  return normalizeOrigin(configuredSiteUrl)
    || normalizeOrigin(fallbackOrigin)
    || [...allowed][0]
    || '';
}

export { normalizeOrigin };
