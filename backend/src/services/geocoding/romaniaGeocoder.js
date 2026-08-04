/**
 * Romanian Geocoding Engine for CIMEC Clasate artifacts
 *
 * Converts finding-place strings like:
 *   "jud. HARGHITA, com. Păuleni-Ciuc, Șoimeni, Dâmbul Cetății"
 * into approximate [lat, lng] coordinates.
 *
 * Strategy (in priority order):
 *   1. Local lookup table of Romanian counties/communes/villages
 *   2. Nominatim (OpenStreetMap) API with Romanian locale
 *   3. County centroid fallback
 */

import { logger } from '../../logger.js';

// ── Romanian county centroids (WGS84) ──────────────────────────────
// Source: INSSE / Wikipedia centroid data
const COUNTY_CENTROIDS = {
  'ALBA':          { lat: 46.1500, lng: 23.5667 },
  'ARAD':          { lat: 46.5000, lng: 21.7500 },
  'ARGEŞ':         { lat: 44.8500, lng: 24.8667 },
  'ARGES':         { lat: 44.8500, lng: 24.8667 },
  'BACĂU':         { lat: 46.4333, lng: 26.8833 },
  'BACAU':         { lat: 46.4333, lng: 26.8833 },
  'BIHOR':         { lat: 46.9667, lng: 22.0000 },
  'BIŞIŢA':       { lat: 47.1000, lng: 22.4000 },
  'BISTRIŢA-NĂSĂUD': { lat: 47.1333, lng: 24.5000 },
  'BISTRITA-NASAUD': { lat: 47.1333, lng: 24.5000 },
  'BOTOŞANI':      { lat: 47.8500, lng: 26.6667 },
  'BOTOSANI':      { lat: 47.8500, lng: 26.6667 },
  'BRAŞOV':        { lat: 45.7500, lng: 25.3333 },
  'BRASOV':        { lat: 45.7500, lng: 25.3333 },
  'BRĂILA':       { lat: 45.1500, lng: 27.6333 },
  'BRAILA':       { lat: 45.1500, lng: 27.6333 },
  'BUZĂU':        { lat: 45.1500, lng: 26.8167 },
  'BUZAU':        { lat: 45.1500, lng: 26.8167 },
  'CĂLĂRAŞI':    { lat: 44.3333, lng: 27.3333 },
  'CALARASI':     { lat: 44.3333, lng: 27.3333 },
  'CARAŞ-SEVERIN': { lat: 45.0833, lng: 22.0667 },
  'CARAS-SEVERIN': { lat: 45.0833, lng: 22.0667 },
  'CLUJ':          { lat: 46.7667, lng: 23.5833 },
  'CONSTANŢA':    { lat: 44.2500, lng: 28.5000 },
  'CONSTANTA':    { lat: 44.2500, lng: 28.5000 },
  'COVASNA':       { lat: 45.8667, lng: 26.0333 },
  'DÂMBOVIŢA':   { lat: 44.7667, lng: 25.4167 },
  'DAMBOVITA':    { lat: 44.7667, lng: 25.4167 },
  'DOLJ':          { lat: 44.1667, lng: 23.6333 },
  'GALAŢI':       { lat: 45.6333, lng: 27.8333 },
  'GALATI':       { lat: 45.6333, lng: 27.8333 },
  'GIURGIU':       { lat: 43.9000, lng: 25.9667 },
  'GORJ':          { lat: 45.0333, lng: 23.2833 },
  'HARGHITA':      { lat: 46.5000, lng: 25.5000 },
  'HUNEDOARA':     { lat: 45.7500, lng: 22.8833 },
  'IALOMIŢA':     { lat: 44.5833, lng: 27.3167 },
  'IALOMITA':     { lat: 44.5833, lng: 27.3167 },
  'IAŞI':         { lat: 47.1667, lng: 27.0000 },
  'IASI':         { lat: 47.1667, lng: 27.0000 },
  'ILFOV':         { lat: 44.4333, lng: 26.1000 },
  'MARAMUREŞ':    { lat: 47.6667, lng: 24.0000 },
  'MARAMURES':    { lat: 47.6667, lng: 24.0000 },
  'MEHEDINŢI':   { lat: 44.6333, lng: 22.8833 },
  'MEHEDINTI':    { lat: 44.6333, lng: 22.8833 },
  'MUREŞ':        { lat: 46.5500, lng: 24.5500 },
  'MURES':        { lat: 46.5500, lng: 24.5500 },
  'NEAMŢ':       { lat: 46.9667, lng: 26.5000 },
  'NEAMT':        { lat: 46.9667, lng: 26.5000 },
  'OLT':           { lat: 44.3333, lng: 24.3667 },
  'PRAHOVA':       { lat: 45.0667, lng: 26.0167 },
  'SĂLAJ':       { lat: 47.2000, lng: 23.1667 },
  'SALAJ':        { lat: 47.2000, lng: 23.1667 },
  'SATU MARE':     { lat: 47.7500, lng: 22.8333 },
  'SATU-MARE':     { lat: 47.7500, lng: 22.8333 },
  'SIBIU':         { lat: 45.9167, lng: 24.0000 },
  'SUCEAVA':       { lat: 47.5833, lng: 26.0000 },
  'TELEORMAN':     { lat: 44.0833, lng: 25.1333 },
  'TIMIŞ':        { lat: 45.7500, lng: 21.3333 },
  'TIMIS':         { lat: 45.7500, lng: 21.3333 },
  'TULCEA':        { lat: 45.0833, lng: 28.8667 },
  'VÂLCEA':      { lat: 45.1000, lng: 24.3667 },
  'VALCEA':       { lat: 45.1000, lng: 24.3667 },
  'VASLUI':        { lat: 46.6333, lng: 27.7333 },
  'VRANCEA':       { lat: 45.7000, lng: 27.0667 },
  'BUCUREŞTI':    { lat: 44.4333, lng: 26.1000 },
  'BUCURESTI':     { lat: 44.4333, lng: 26.1000 },
  'BUCUREŞTI SECTORUL 1': { lat: 44.4396, lng: 26.0822 },
  'BUCUREŞTI SECTORUL 2': { lat: 44.4524, lng: 26.1315 },
  'BUCUREŞTI SECTORUL 3': { lat: 44.4294, lng: 26.1536 },
  'BUCUREŞTI SECTORUL 4': { lat: 44.3960, lng: 26.1230 },
  'BUCUREŞTI SECTORUL 5': { lat: 44.3868, lng: 26.0610 },
  'BUCUREŞTI SECTORUL 6': { lat: 44.4350, lng: 26.0150 },
  // Moldova (Republic of) sometimes appears
  'MOLDOVA':       { lat: 47.2000, lng: 28.8000 },
  'CHIŞINĂU':     { lat: 47.0056, lng: 28.8575 },
};

// ── Nominatim geocoding (OpenStreetMap) ─────────────────────────────
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_DELAY_MS = 1100; // Respecting OSM's 1 req/s policy

let _lastNominatimCall = 0;

async function nominatimGeocode(query) {
  // Rate limit
  const elapsed = Date.now() - _lastNominatimCall;
  if (elapsed < NOMINATIM_DELAY_MS) {
    await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS - elapsed));
  }
  _lastNominatimCall = Date.now();

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '1',
    countrycodes: 'ro,md',
    'accept-language': 'ro',
  });

  try {
    const resp = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: { 'User-Agent': 'DetectLab/1.0 (archaeological database; contact@detectlab.ro)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return null;

    const results = await resp.json();
    if (results.length > 0) {
      return {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon),
        method: 'nominatim',
        confidence: results[0].type === 'house' ? 'exact'
          : results[0].type === 'village' ? 'locality'
          : results[0].type === 'administrative' ? 'commune'
          : 'approximate',
        display_name: results[0].display_name,
      };
    }
  } catch (err) {
    logger.warn({ err: err.message, query }, 'Nominatim geocode failed');
  }
  return null;
}

// ── Romanian text normalization ─────────────────────────────────────
function normalizeRo(text) {
  return (text || '')
    .replace(/[ăâ]/g, 'a')
    .replace(/[șş]/g, 's')
    .replace(/[țţ]/g, 't')
    .replace(/î/g, 'i')
    .toUpperCase()
    .trim();
}

// ── Parse finding place string ──────────────────────────────────────
// Typical format: "jud. HARGHITA, com. Păuleni-Ciuc, Șoimeni, Dâmbul Cetății"
// Also handles: "mun. București, sector 3" or just "jud. CLUJ"
function parseFindingPlace(text) {
  if (!text) return null;

  const result = {
    county: null,
    commune: null,
    locality: null,
    site: null,
    raw: text,
  };

  // Extract county
  const countyMatch = text.match(/jud\.?\s*([^,]+)/i);
  if (countyMatch) {
    result.county = countyMatch[1].trim().toUpperCase();
  }

  // Extract commune (com.)
  const communeMatch = text.match(/com\.?\s*([^,]+)/i);
  if (communeMatch) {
    result.commune = communeMatch[1].trim();
  }

  // Extract municipality (mun.)
  const munMatch = text.match(/mun\.?\s*([^,]+)/i);
  if (munMatch) {
    result.commune = munMatch[1].trim(); // Municipality acts like a commune
  }

  // Extract city (or./oraș)
  const cityMatch = text.match(/(?:or\.|oras\.?)\s*([^,]+)/i);
  if (cityMatch) {
    result.commune = cityMatch[1].trim();
  }

  // Extract sector (for Bucharest)
  const sectorMatch = text.match(/sector\s*(\d)/i);
  if (sectorMatch) {
    result.county = `BUCUREŞTI SECTORUL ${sectorMatch[1]}`;
  }

  // Extract locality (sat) - comes after commune
  if (result.commune) {
    const afterComune = text.split(result.commune)[1];
    if (afterComune) {
      const parts = afterComune.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length > 0) result.locality = parts[0];
      if (parts.length > 1) result.site = parts.slice(1).join(', ');
    }
  }

  return result;
}

// ── Main geocoding function ─────────────────────────────────────────
/**
 * Geocode a Romanian finding-place string to [lat, lng].
 *
 * @param {string} findingPlace - e.g. "jud. HARGHITA, com. Păuleni-Ciuc, Șoimeni"
 * @returns {Promise<{lat: number, lng: number, method: string, confidence: string}>}
 */
export async function geocodeFindingPlace(findingPlace) {
  if (!findingPlace || findingPlace.trim() === '') {
    return null;
  }

  const parsed = parseFindingPlace(findingPlace);
  if (!parsed || !parsed.county) {
    // Can't even extract a county — try Nominatim with full string
    return await nominatimGeocode(findingPlace);
  }

  const countyKey = normalizeRo(parsed.county);
  const countyCoords = COUNTY_CENTROIDS[countyKey] || COUNTY_CENTROIDS[parsed.county.toUpperCase()];

  // Strategy 1: Try Nominatim with the most specific location
  if (parsed.locality && parsed.commune) {
    const query = `${parsed.locality}, ${parsed.commune}, ${parsed.county}, Romania`;
    const result = await nominatimGeocode(query);
    if (result) return result;
  }

  if (parsed.commune) {
    const query = `${parsed.commune}, ${parsed.county}, Romania`;
    const result = await nominatimGeocode(query);
    if (result) return result;
  }

  // Strategy 2: Try Nominatim with county name
  const countyQuery = `${parsed.county}, Romania`;
  const countyResult = await nominatimGeocode(countyQuery);
  if (countyResult) return countyResult;

  // Strategy 3: Use our local county centroid as absolute fallback
  if (countyCoords) {
    return {
      lat: countyCoords.lat,
      lng: countyCoords.lng,
      method: 'county_centroid',
      confidence: 'county',
    };
  }

  return null;
}

/**
 * Geocode with caching support (returns cached result if available).
 */
const _geocodeCache = new Map();

export async function geocodeWithCache(findingPlace) {
  if (!findingPlace) return null;

  const key = findingPlace.trim().toLowerCase();
  if (_geocodeCache.has(key)) {
    return _geocodeCache.get(key);
  }

  const result = await geocodeFindingPlace(findingPlace);
  _geocodeCache.set(key, result);
  return result;
}

export { parseFindingPlace, COUNTY_CENTROIDS, normalizeRo };
