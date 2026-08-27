// DetectLab epoch classification.
//
// Uses the SAME canonical taxonomy and detection rules as the Archaeological
// Report (js/archeo-report.js — PERIOD_RULES and periodKey()):
//   Paleolitic, Mezolitic, Eneolitic, Neolitic, Epoca bronzului, Hallstatt,
//   Epoca fierului (incl. La Tène / celtic), Dacic / getic, Roman,
//   Epoca migrațiilor, Medieval, Modern, Preistorie (generic),
//   Antichitate (generic).
//
// Order is priority — the FIRST matching rule wins (like the report's single
// `periodKey`), so a claim never shows contradictory epochs. When no rule
// matches, a century/millennium expression ("sec. II-III p.Chr.",
// "mileniul I î.Chr.") is mapped onto the same scale.
//
// NB: "Eneolitic" contains "neolitic", so Eneolitic MUST be tested first.

export const PERIOD_LABELS = [
  'Paleolitic', 'Mezolitic', 'Eneolitic', 'Neolitic', 'Epoca bronzului',
  'Hallstatt', 'Epoca fierului', 'Dacic / getic', 'Roman',
  'Epoca migrațiilor', 'Medieval', 'Modern', 'Preistorie', 'Antichitate',
];

const periodPatterns = [
  ['Paleolitic', /paleolitic|palaeolitic|paleolithic/i],
  ['Mezolitic', /mezolitic|mesolitic/i],
  ['Eneolitic', /eneolitic|eneolithic|eneo|cucuteni|cotofeni|petre[sș]ti|gumelni[tț]a|hamangia|vin[cč]a|decea|boian/i],
  ['Neolitic', /neolitic|neolithic|star[cč]evo|\bcri[sș]\b/i],
  ['Epoca bronzului', /bronz|bronze/i],
  ['Hallstatt', /hallstatt/i],
  ['Epoca fierului', /fierului|fier\b|iron age|la\s*t[eè]ne|lat[eè]ne|latene|celtic/i],
  ['Dacic / getic', /dacic|geto[- ]?dac|getic|geto/i],
  ['Roman', /roman|romano|romano-bizantin|castru|castrul|vicus/i],
  ['Epoca migrațiilor', /migrat|migration|popoarelor/i],
  ['Medieval', /mediev|mediaev|feudal|evul mediu/i],
  ['Modern', /modern|contemporan/i],
  ['Preistorie', /preistor/i],
  ['Antichitate', /antic|antichit/i],
];

// Century / millennium notation fallback — identical to the report's
// centuryPeriod()/periodKeyFromCenturies()/periodKeyFromMillennium().
const ROMAN_DIGIT_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100 };
function romanToInt(s) {
  let total = 0, prev = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const v = ROMAN_DIGIT_VALUES[s.charAt(i).toUpperCase()];
    if (v === undefined) return NaN;
    total += (v < prev) ? -v : v;
    prev = v;
  }
  return total;
}
const CENTURY_NUM = '([IVXLCDM]+|\\d{1,2})';
const CENTURY_RANGE_RE = new RegExp('^\\s*(?:al\\s+)?' + CENTURY_NUM + '(?:\\s*-lea|-le)?(?:\\s*(?:[-–—,]|până\\s+la|și|si)\\s*(?:al\\s+)?' + CENTURY_NUM + '(?:\\s*-lea|-le)?)?', 'i');
// NB: no \b around the Romanian era markers — ă/â/î/ș/ț are not JS word chars.
const CENTURY_BC_RE = /(?:^|[\s(])(?:î|i|a)\.?\s*Chr|(?:^|\s)BC(?![A-Za-z])|(?:^|[\s(])(?:î|i)\.?\s*Hr|(?:^|[\s(])(?:î|i)\.?\s*e\.?\s*n\./i;
const CENTURY_AD_RE = /(?:^|[\s(])(?:p|d)\.?\s*Chr|(?:^|\s)AD(?![A-Za-z])|(?:^|[\s(])(?:p|d)\.?\s*Hr|(?:^|[\s(])e\.?\s*n\./i;
const CENTURY_KEYWORD_RE = /\b(sec\.?|secole?(?:ul|ele|ului)?|mileniu(?:l|le)?)(?![A-Za-z0-9\u0103\u0102\u00E2\u00C2\u00EE\u00CE\u0219\u0218\u021B\u021A])/i;

function parseCenturyRange(text) {
  const s = String(text || '');
  const m = CENTURY_KEYWORD_RE.exec(s);
  if (!m) return null;
  const isMillennium = /milen/i.test(m[0]);
  const tail = s.slice(m.index + m[0].length);
  const rm = CENTURY_RANGE_RE.exec(tail);
  if (!rm) return null;
  const v1 = /^\d+$/.test(rm[1]) ? parseInt(rm[1], 10) : romanToInt(rm[1]);
  if (!isFinite(v1) || v1 < 1 || v1 > 40) return null;
  let v2 = v1;
  if (rm[2]) {
    const raw2 = /^\d+$/.test(rm[2]) ? parseInt(rm[2], 10) : romanToInt(rm[2]);
    if (!isFinite(raw2) || raw2 < 1 || raw2 > 40) return null;
    v2 = raw2;
  }
  const bcIdx = tail.search(CENTURY_BC_RE);
  const adIdx = tail.search(CENTURY_AD_RE);
  const bc = bcIdx !== -1 && (adIdx === -1 || bcIdx < adIdx);
  return { from: v1, to: v2, bc, millennium: isMillennium };
}

// One century (BC = negative) mapped onto the epoch scale, mirroring the
// conventions used in Romanian archaeology for Transylvania (report §9).
function centuryPeriod(c) {
  if (c < 0) {
    if (c >= -1) return 'Dacic / getic';
    if (c >= -5) return 'Epoca fierului';
    if (c >= -12) return 'Hallstatt';
    if (c >= -30) return 'Epoca bronzului';
    return 'Preistorie';
  }
  if (c <= 3) return 'Roman';
  if (c <= 7) return 'Epoca migrațiilor';
  if (c <= 18) return 'Medieval';
  return 'Modern';
}

function periodKeyFromCenturies(from, to, bc) {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  if (!isFinite(lo) || !isFinite(hi) || hi - lo > 30) return null;
  const votes = {};
  for (let c = lo; c <= hi; c++) {
    const k = centuryPeriod(bc ? -c : c);
    if (!votes[k]) votes[k] = { n: 0, minAbs: Infinity };
    votes[k].n++;
    if (c < votes[k].minAbs) votes[k].minAbs = c;
  }
  let best = null, bestN = 0, bestAbs = Infinity;
  Object.keys(votes).forEach((k) => {
    const v = votes[k];
    if (v.n > bestN || (v.n === bestN && v.minAbs < bestAbs)) { best = k; bestN = v.n; bestAbs = v.minAbs; }
  });
  return best;
}

function periodKeyFromMillennium(n, bc) {
  if (bc) {
    if (n <= 1) return 'Epoca fierului';
    if (n === 2) return 'Epoca bronzului';
    return 'Preistorie';
  }
  if (n <= 1) return 'Antichitate';
  return 'Modern';
}

function centuryPeriodLabel(text) {
  const c = parseCenturyRange(text);
  if (!c) return null;
  return c.millennium ? periodKeyFromMillennium(c.from, c.bc) : periodKeyFromCenturies(c.from, c.to, c.bc);
}

/**
 * Classify a snippet into a single epoch.
 * Mirrors the Archaeological Report's periodKey(): the first matching epoch
 * rule wins; otherwise a century/millennium expression is mapped onto the
 * scale. Returns an array (single label) for API compatibility, or [].
 */
export function periods(value, descriptors = []) {
  const all = `${value} ${descriptors.join(' ')}`;
  for (const [name, rx] of periodPatterns) if (rx.test(all)) return [name];
  const fromCentury = centuryPeriodLabel(all);
  return fromCentury ? [fromCentury] : [];
}
