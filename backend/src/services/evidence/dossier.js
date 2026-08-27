// DetectLab Historical Dossier Builder — “Dosarul arheologic” layer.
//
// Implements the canonical specification stored in the repository:
//   RO: data/dossier-spec/FISA_ISTORICA_PROMPT_RO.md
//   EN: data/dossier-spec/HISTORICAL_RECORD_PROMPT_EN.md
//
// The builder is fully deterministic (no LLM). Every populated field is either
// (a) official SIRUTA identity data imported from INS (level-1 source), or
// (b) a stored archaeological claim backed by an exact excerpt + source URL
//     from biblioteca-digitala.ro (level-2 source).
// Anything that cannot be populated from those verified inputs stays empty and
// is explicitly flagged `noVerifiedSource: true` — per specification §20
// (“Nu inventa…” / “Never invent…”), fields are left empty rather than
// estimated. RAN/LMI codes and site coordinates are never fabricated: the RAN
// integration is declared as pending until the official repertory is imported.

export const DOSSIER_SCHEMA_VERSION = '1.0.0';
export const DOSSIER_SPEC = {
  ro: 'data/dossier-spec/FISA_ISTORICA_PROMPT_RO.md',
  en: 'data/dossier-spec/HISTORICAL_RECORD_PROMPT_EN.md',
};

// Official level-1 source recorded by the SIRUTA importer (see
// backend/scripts/importSiruta.js — OFFICIAL_SOURCE_URL). Kept here as a
// documented fallback so the dossier always cites the canonical provenance.
const SIRUTA_OFFICIAL_URL = 'https://data.gov.ro/dataset/fcba1a54-cffd-422c-b3ac-920f63564085/resource/0ab29d86-302c-4cfa-b9b9-fd5c7ff90710/download/siruta_s1_2025.csv';
const RAN_PORTAL_URL = 'http://ran.cimec.ro/';
const INP_PORTAL_URL = 'https://patrimoniu.ro/';

// Certainty vocabulary — specification §19 (🟢🟡🟠🔴 + explicit no-data state).
export const CERTAINTY_LEVELS = ['CERT', 'PROBABLE', 'CONTESTED', 'HYPOTHESIS', 'NO_DATA'];

// Ordered history buckets (specification §5). `sourcePeriods` maps the labels
// produced by the deterministic evidence engine (knowledge.periods.label_ro);
// buckets without a detectable label remain honestly empty.
export const HISTORY_BUCKETS = [
  { key: 'preistorie', label: { ro: 'Preistorie', en: 'Prehistory' }, sourcePeriods: ['Preistorie', 'Paleolitic', 'Mezolitic', 'Neolitic', 'Eneolitic', 'Epoca bronzului', 'Hallstatt'] },
  { key: 'antichitate', label: { ro: 'Antichitate', en: 'Antiquity' }, sourcePeriods: ['La Tène', 'Epoca fierului', 'Dacic / getic', 'Roman', 'Antichitate'] },
  { key: 'ev-mediu-timpuriu', label: { ro: 'Evul Mediu timpuriu', en: 'Early Middle Ages' }, sourcePeriods: ['Epoca migrațiilor'] },
  { key: 'ev-mediu', label: { ro: 'Evul Mediu', en: 'Middle Ages' }, sourcePeriods: ['Medieval'] },
  { key: 'moderna-timpurie', label: { ro: 'Perioada modernă timpurie', en: 'Early modern period' }, sourcePeriods: ['Modern'] },
  { key: 'sec-xviii-xix', label: { ro: 'Secolele XVIII–XIX', en: '18th–19th centuries' }, sourcePeriods: [] },
  { key: 'austro-ungara', label: { ro: 'Perioada austro-ungară', en: 'Austro-Hungarian period' }, sourcePeriods: [] },
  { key: 'primul-razboi-mondial', label: { ro: 'Primul Război Mondial', en: 'World War I' }, sourcePeriods: [] },
  { key: 'interbelic', label: { ro: 'Perioada interbelică', en: 'Interwar period' }, sourcePeriods: [] },
  { key: 'al-doilea-razboi-mondial', label: { ro: 'Al Doilea Război Mondial', en: 'World War II' }, sourcePeriods: [] },
  { key: 'comunista', label: { ro: 'Perioada comunistă', en: 'Communist period' }, sourcePeriods: [] },
  { key: 'post-1989', label: { ro: 'Perioada post-1989', en: 'Post-1989 period' }, sourcePeriods: [] },
  { key: 'nespecificat', label: { ro: 'Perioadă nespecificată', en: 'Unspecified period' }, sourcePeriods: null }, // claims without a detected period
];

// Deterministic thematic classifiers (specification §§6–9, 14–16). A claim
// enters a section only when its own text (claim + verified excerpt + context)
// matches; sections with no match are returned with noVerifiedSource=true.
// Character classes are diacritic-aware (\w does not match ă/â/î/ș/ț).
const THEMATIC_SECTIONS = [
  { key: 'administrativeEvolution', pattern: /\bplas[ăa]\b|\braion(?:ul|ele)?\b|comitat(?:ul|ele)?|district(?:ul|ele)?|apar[țt]inu[șst]?\s+(?:de\s+|la\s+)?(?:jude[țt]ul|comitatul|regiunea|districtul|plasaua)|s-a\s+aflat\s+[îi]n\s+componen[țt]a|[îi]n\s+cadrul\s+(?:jude[țt]ului|raionului|regiunii|comitatului)|re[șs]edin[țt]a\s+(?:de\s+)?plas|jude[țt]ul\s+istoric|regiunea\s+(?:Autonom[ăa]\s+)?[A-ZĂÂÎȘȚ]/i },
  { key: 'population', pattern: /recens[ăa]m|locuitori|popula[țt]i(?:a|ei|ale)?\s|structur[ăa]\s+etnic|confesional|biserica\s+greco-catolic|ortodoc[șs]i|catolici\s|evrei\s|sa[șs]i\s|maghiari\s|romi\s/i },
  { key: 'familiesAndEstates', pattern: /mo[șs]i(?:a|e|ile|iile)?\b|domeniu(?:l|ile)?\b|boier(?:i|ul|imea)?\b|nobil(?:i|ul|imea)?\b|proprietar(?:ii|ul|i)?\b|familia\s+(?:nobil[ăa]|boiereasc[ăa]|regal[ăa])|familii\s+(?:nobile|boiere[șs]ti)|st[ăa]p[âa]ni(?:a|itorul)?\s+(?:mo[șs]ia|domeniul)/i },
  { key: 'historicBuildings', pattern: /biseric|[ăa]m[ăa]n[ăa]stire|cetate|cet[ăa][țt]ui|fortifica[țt]|castr|conac|castel|castelul|hanul|\bmoar|mor[ăa]rit|podul|cimitir|crucea|monument(?:ul|e\s+comemorative)?|capel/i },
  { key: 'vanishedLocalities', pattern: /disp[ăa]r[țt]|vetr[ăa]\s+(?:veche|str[ăa]veche)|p[ăa]r[ăa]sit|abandonat|depopulat|localitate\s+absorbit|sate\s+medievale\s+disp[ăa]rute/i },
  { key: 'toponymy', pattern: /toponim|numele\s+(?:localit[ăa][țt]ii|satului)|denumirea\s+(?:localit[ăa][țt]ii|satului|provine)|provine\s+din|vine\s+de\s+la\s+numele|dealul\s+[a-zăâîșț]|valea\s+[a-zăâîșț]|p[ăa]durea\s+[a-zăâîșț]/i },
  { key: 'historicalMaps', pattern: /harta|h[ăa]r[țt]i(?:le|\s+militare)?\b|plan[șs]a|plan[șs]ele|plan\s+cadastral|schimbul\s+topografic|habsburgic|austro-ungar\s+(?:harta|planul)/i },
];

// Claim categories that describe a distinct site/findspot context rather than
// a loose artefact note — used for the archaeological-sites section (§10).
const SITE_CATEGORIES = new Set(['ARCHAEOLOGICAL_SITE', 'SETTLEMENT', 'NECROPOLIS', 'FORTIFICATION', 'HOARD', 'BURIAL', 'EXCAVATION', 'SURVEY']);

const CATEGORY_LABELS = {
  NECROPOLIS: { ro: 'necropolă', en: 'necropolis' },
  BURIAL: { ro: 'context funerar', en: 'burial context' },
  SETTLEMENT: { ro: 'așezare', en: 'settlement' },
  FORTIFICATION: { ro: 'fortificație', en: 'fortification' },
  HOARD: { ro: 'tezaur', en: 'hoard' },
  COIN_FIND: { ro: 'descoperire monetară', en: 'coin find' },
  ARTEFACT: { ro: 'artefact', en: 'artefact' },
  SURVEY: { ro: 'cercetare de suprafață', en: 'field survey' },
  EXCAVATION: { ro: 'săpătură arheologică', en: 'excavation' },
  ARCHAEOLOGICAL_SITE: { ro: 'sit arheologic', en: 'archaeological site' },
  OTHER_ARCHAEOLOGICAL_EVIDENCE: { ro: 'altă evidență arheologică', en: 'other archaeological evidence' },
};

const ATTESTATION_PATTERN = /prima\s+(?:men[țt]iune|atestare|pomenire|consemnare)|atestat[a-zăâîșț]*\s+documentar|men[țt]iun[a-zăâîșț]*\s+documentar|pomenit[a-zăâîșț]*\s+(?:[îi]n|la)\b|consemnat[a-zăâîșț]*\s+documentar|document\s+de\s+at(?:estare|ribuire)|prima\s+p[ăa]r/i;
const YEAR_PATTERN = /\b(1[0-9]{3}|20[0-4][0-9])\b/g;
// SIRUTA codes are numeric and appear in the official CSV with 5 or 6 digits.
const SIRUTA_PATTERN = /^\d{5,6}$/;

const clampExcerpt = (value, max = 600) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

export function certaintyFromClaim(claim) {
  if (!claim) return 'NO_DATA';
  const score = Number(claim.confidence || 0);
  if (claim.fullyVerified && score >= 0.8) return 'CERT';
  if (score >= 0.2) return 'PROBABLE';
  return 'HYPOTHESIS';
}

function claimRef(claim) {
  return {
    claimId: claim.id ?? null,
    claim: claim.claim,
    category: claim.category,
    categoryLabel: CATEGORY_LABELS[claim.category] || null,
    periods: claim.periods || [],
    certainty: certaintyFromClaim(claim),
    confidence: Number(claim.confidence || 0),
    evidence: (claim.evidence || []).slice(0, 3),
    source: claim.source || null,
  };
}

function claimText(claim) {
  const first = claim.evidence?.[0] || {};
  return `${claim.claim || ''} ${first.excerpt || ''} ${first.contextWindow || ''}`;
}

export function bucketForPeriods(periods) {
  const list = Array.isArray(periods) ? periods : [];
  if (!list.length) return 'nespecificat';
  for (const bucket of HISTORY_BUCKETS) {
    if (bucket.sourcePeriods && list.some((label) => bucket.sourcePeriods.includes(label))) return bucket.key;
  }
  return 'nespecificat';
}

// First documentary attestation (specification §4). Deterministic: an entry is
// produced ONLY when a stored excerpt itself contains attestation wording plus
// a year. The result is always PROBABLE — the original document must be
// verified before being treated as certain (§4, §18).
export function extractFirstAttestation(claims) {
  const candidates = [];
  for (const claim of claims || []) {
    for (const item of claim.evidence || []) {
      const text = `${item.excerpt || ''} ${item.contextWindow || ''}`.replace(/\s+/g, ' ').trim();
      if (!text || !ATTESTATION_PATTERN.test(text)) continue;
      const years = [...text.matchAll(YEAR_PATTERN)].map((m) => Number(m[1])).filter((y) => y >= 1000 && y <= 2049);
      if (!years.length) continue;
      const year = Math.min(...years);
      const quoted = text.match(/["„«]([^"”»]{2,60})["”»]/);
      candidates.push({
        year, claimId: claim.id ?? null, text, historicalForm: quoted ? quoted[1] : null,
        source: claim.source || null,
      });
    }
  }
  if (!candidates.length) {
    return {
      status: 'NO_VERIFIED_SOURCE',
      year: null, historicalForm: null, documentType: null, documentLanguage: null,
      excerpt: null, source: null, certainty: 'NO_DATA', conflicts: [],
      note: {
        ro: 'Nu a fost identificată o sursă verificabilă pentru prima atestare documentară în sursele integrate (Biblioteca Digitală / ProEuropeana).',
        en: 'No verifiable source for the first documentary attestation was identified in the integrated sources (Digital Library / ProEuropeana).',
      },
    };
  }
  candidates.sort((a, b) => a.year - b.year);
  const primary = candidates[0];
  const conflicts = candidates
    .filter((c) => c.year !== primary.year)
    .slice(0, 4)
    .map((c) => ({ year: c.year, excerpt: clampExcerpt(c.text), source: c.source }));
  return {
    status: 'DOCUMENTED',
    year: primary.year,
    historicalForm: primary.historicalForm,
    documentType: null, // the exact document type requires the original act — never guessed (§20)
    documentLanguage: null,
    excerpt: clampExcerpt(primary.text),
    source: primary.source,
    certainty: 'PROBABLE',
    conflicts,
    note: {
      ro: 'Data provine dintr-o publicație din Biblioteca Digitală, nu din documentul original. Conform specificației, documentul original trebuie verificat înainte de a considera atestarea certă.',
      en: 'The date comes from a Digital Library publication, not from the original document. Per the specification, the original document must be verified before the attestation is treated as certain.',
    },
  };
}

export function buildHistory(claims) {
  const buckets = HISTORY_BUCKETS.map((bucket) => ({ key: bucket.key, label: bucket.label, entries: [] }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const claim of claims || []) byKey.get(bucketForPeriods(claim.periods))?.entries.push(claimRef(claim));
  return {
    buckets,
    note: {
      ro: 'Sinteza cronologică este populată exclusiv cu afirmații extrase verificabil din publicațiile integrate. Perioadele fără dovezi rămân explicit nemarcate — nu se estimează (§20).',
      en: 'The chronological synthesis is populated exclusively with verifiably extracted statements from the integrated publications. Periods without evidence remain explicitly unmarked — nothing is estimated (§20).',
    },
  };
}

export function classifyThematic(claims) {
  const output = {};
  for (const section of THEMATIC_SECTIONS) output[section.key] = [];
  for (const claim of claims || []) {
    const text = claimText(claim);
    for (const section of THEMATIC_SECTIONS) {
      if (section.pattern.test(text)) output[section.key].push(claimRef(claim));
    }
  }
  return output;
}

// Archaeological sites section (specification §§10–12). Site entries are
// documented contexts from verified claims. RAN/LMI codes, culture and site
// coordinates are never invented: they stay null until the official RAN/CIMEC
// repertory is integrated, and each entry says so explicitly.
export function buildRanSites(claims, storedSites, localityName) {
  const entries = (claims || [])
    .filter((claim) => SITE_CATEGORIES.has(claim.category))
    .map((claim) => {
      const bucket = HISTORY_BUCKETS.find((b) => b.key === bucketForPeriods(claim.periods));
      const label = CATEGORY_LABELS[claim.category] || { ro: claim.category, en: claim.category };
      const first = claim.evidence?.[0] || {};
      return {
        name: { ro: `${label.ro.charAt(0).toUpperCase() + label.ro.slice(1)} — ${localityName}`, en: `${label.en.charAt(0).toUpperCase() + label.en.slice(1)} — ${localityName}` },
        ranCode: null,
        lmiCode: null,
        category: claim.category,
        categoryLabel: label,
        type: label,
        components: null,
        epoch: bucket ? bucket.label : null,
        periods: claim.periods || [],
        culture: null, // never deduced from the period (§11)
        chronology: (claim.periods || []).join(' · ') || null,
        description: clampExcerpt(first.excerpt || claim.claim),
        locality: localityName,
        coordinates: null, // locality coordinates are never reused for a site (§10)
        latitude: null,
        longitude: null,
        links: { ran: null, lmi: null, other: first.sourceUrl || null },
        evidence: (claim.evidence || []).slice(0, 3),
        source: claim.source || null,
        certainty: certaintyFromClaim(claim),
        pendingIntegration: {
          ro: 'Codul RAN, codul LMI, cultura arheologică și coordonatele sitului nu au fost identificate în sursele integrate; integrarea Repertoriului Arheologic Național (RAN/CIMEC) este în curs. Nu se inventează identificatori (§13, §20).',
          en: 'The RAN code, LMI code, archaeological culture and site coordinates were not identified in the integrated sources; National Archaeological Repertory (RAN/CIMEC) integration is in progress. No identifiers are invented (§13, §20).',
        },
      };
    });
  const stored = (storedSites || []).map((site) => ({
    name: { ro: site.name || localityName, en: site.name || localityName },
    ranCode: null, lmiCode: null,
    category: 'ARCHAEOLOGICAL_SITE',
    categoryLabel: CATEGORY_LABELS.ARCHAEOLOGICAL_SITE,
    type: { ro: site.site_type || 'nespecificat', en: site.site_type || 'unspecified' },
    components: null, epoch: null, periods: [], culture: null, chronology: null,
    description: null,
    locality: localityName,
    coordinates: site.latitude != null && site.longitude != null ? { lat: site.latitude, lng: site.longitude } : null,
    latitude: site.latitude ?? null, longitude: site.longitude ?? null,
    locationPrecision: site.location_precision || null,
    links: { ran: null, lmi: null, other: null },
    evidence: [], source: null, certainty: 'PROBABLE',
    pendingIntegration: {
      ro: 'Sit înregistrat în baza locală (knowledge.archaeological_sites), fără cod RAN atribuit momentan.',
      en: 'Site recorded in the local database (knowledge.archaeological_sites), currently without an assigned RAN code.',
    },
  }));
  return {
    entries: [...stored, ...entries],
    officialPortals: [
      { name: 'RAN / CIMEC', url: RAN_PORTAL_URL },
      { name: 'Institutul Național al Patrimoniului', url: INP_PORTAL_URL },
    ],
    note: {
      ro: 'Siturile listate mai jos sunt contextele atribuite explicit acestei localități în sursele integrate. Siturile apropiate, dar atribuite altor localități, NU sunt incluse (§12).',
      en: 'The sites listed below are the contexts explicitly attributed to this locality in the integrated sources. Nearby sites attributed to other localities are NOT included (§12).',
    },
  };
}

// Final homonym verification — specification §21 (CHECK 1…7).
export function identityChecks(locality, claims, storedSites) {
  const checks = [];
  const push = (key, label, ok, pending, passDetail, pendingDetail) => checks.push({
    id: `CHECK_${checks.length + 1}`, key, status: ok ? 'PASS' : pending ? 'PENDING' : 'FAIL',
    label, detail: ok ? passDetail : pendingDetail,
  });
  push('name', { ro: 'Numele localității corespunde?', en: 'Does the locality name match?' },
    Boolean(locality?.name), false,
    { ro: `Denumire SIRUTA: ${locality?.name}.`, en: `SIRUTA name: ${locality?.name}.` },
    { ro: 'Nume lipsă din registrul SIRUTA.', en: 'Name missing from the SIRUTA register.' });
  push('county', { ro: 'Județul corespunde?', en: 'Does the county match?' },
    Boolean(locality?.county), false,
    { ro: `Județ: ${locality?.county}.`, en: `County: ${locality?.county}.` },
    { ro: 'Județ lipsă.', en: 'County missing.' });
  push('uat', { ro: 'UAT-ul corespunde?', en: 'Does the UAT match?' },
    Boolean(locality?.uat_name), Boolean(locality && !locality.uat_name),
    { ro: `UAT: ${locality?.uat_name}.`, en: `UAT: ${locality?.uat_name}.` },
    { ro: 'UAT indisponibil în registrul importat; verificarea rămâne în așteptare.', en: 'UAT unavailable in the imported register; the check remains pending.' });
  push('siruta', { ro: 'Codul SIRUTA corespunde?', en: 'Does the SIRUTA code match?' },
    SIRUTA_PATTERN.test(String(locality?.siruta_code || '')), false,
    { ro: `Cod SIRUTA: ${locality?.siruta_code}.`, en: `SIRUTA code: ${locality?.siruta_code}.` },
    { ro: 'Cod SIRUTA lipsă sau invalid.', en: 'SIRUTA code missing or invalid.' });
  const hasCoords = locality?.latitude != null && locality?.longitude != null;
  push('coordinates', { ro: 'Coordonatele corespund?', en: 'Do the coordinates match?' },
    hasCoords, Boolean(locality && !hasCoords),
    { ro: `Latitudine ${locality?.latitude}, longitudine ${locality?.longitude} (SIRUTA).`, en: `Latitude ${locality?.latitude}, longitude ${locality?.longitude} (SIRUTA).` },
    { ro: 'Coordonatele nu sunt disponibile în registrul SIRUTA importat; câmpul rămâne necompletat (§20).', en: 'Coordinates are unavailable in the imported SIRUTA register; the field stays empty (§20).' });
  const ranIntegrated = Boolean(storedSites?.some((s) => s.ran_code));
  push('ran-attribution', { ro: 'Siturile RAN sunt atribuite exact acestei localități?', en: 'Are the RAN sites assigned to exactly this locality?' },
    ranIntegrated, !ranIntegrated,
    { ro: 'Situri RAN înregistrate pentru această localitate.', en: 'RAN sites recorded for this locality.' },
    { ro: 'Repertoriul RAN/CIMEC nu este încă integrat; atribuirea siturilor RAN rămâne în așteptare. Siturile listate provin exclusiv din sursele integrate.', en: 'The RAN/CIMEC repertory is not yet integrated; RAN site attribution remains pending. Listed sites come exclusively from the integrated sources.' });
  const hasClaims = Boolean(claims?.length);
  push('source-attribution', { ro: 'Informațiile istorice provin din surse care se referă exact la această localitate?', en: 'Does the historical information come from sources referring exactly to this locality?' },
    hasClaims, !hasClaims,
    { ro: `${claims?.length || 0} afirmații cu extrase și sursă, atribuite prin potrivire pe aliasuri controlate.`, en: `${claims?.length || 0} statements with excerpts and source, attributed through controlled-alias matching.` },
    { ro: 'Nu există afirmații stocate pentru această localitate; nu se importă informații de la localități omonime (§1).', en: 'No stored statements for this locality; no information is imported from homonymous localities (§1).' });
  return checks;
}

function buildSources(locality, documents) {
  const sources = [{
    level: 1,
    name: { ro: 'INS — Nomenclatorul SIRUTA (unități administrativ-teritoriale)', en: 'INS — SIRUTA nomenclature (administrative-territorial units)' },
    url: locality?.source_url || SIRUTA_OFFICIAL_URL,
    role: { ro: 'identificarea exactă a localității (nume, județ, UAT, SIRUTA)', en: 'exact locality identification (name, county, UAT, SIRUTA)' },
  }, {
    level: 1,
    name: { ro: 'Biblioteca Digitală a Publicațiilor Culturale / ProEuropeana', en: 'Digital Library of Cultural Publications / ProEuropeana' },
    url: 'https://biblioteca-digitala.ro/',
    role: { ro: 'sursa exclusivă de publicații pentru dovezi istorice și arheologice', en: 'exclusive publication source for historical and archaeological evidence' },
  }, {
    level: 1,
    name: { ro: 'RAN / CIMEC — Repertoriul Arheologic Național', en: 'RAN / CIMEC — National Archaeological Repertory' },
    url: RAN_PORTAL_URL,
    status: 'NOT_INTEGRATED',
    role: { ro: 'în curs de integrare — coduri RAN și fișe de sit', en: 'integration in progress — RAN codes and site record pages' },
  }, {
    level: 1,
    name: { ro: 'Institutul Național al Patrimoniului (INP)', en: 'National Heritage Institute (INP)' },
    url: INP_PORTAL_URL,
    status: 'NOT_INTEGRATED',
    role: { ro: 'în curs de integrare — LMI și patrimoniu', en: 'integration in progress — LMI and heritage' },
  }];
  for (const document of documents || []) {
    sources.push({
      level: 2,
      name: { ro: document.title || 'Publicație', en: document.title || 'Publication' },
      detail: { authors: document.authors || [], year: document.publication_year ?? null, publication: document.publication || null },
      url: document.catalog_url || document.document_url || null,
      role: { ro: 'publicație sursă pentru dovezi', en: 'source publication for evidence' },
    });
  }
  return sources;
}

function overallCertainty(locality, attestation, thematic, siteCount) {
  const claims = locality;
  void claims;
  return {
    identification: 'CERT', // official SIRUTA register (level 1)
    historicalNames: null, // filled by the caller (depends on aliases)
    firstAttestation: attestation.status === 'DOCUMENTED' ? 'PROBABLE' : 'NO_DATA',
    history: null, // filled by the caller
    archaeologicalSites: siteCount ? 'PROBABLE' : 'NO_DATA',
    toponymy: (thematic.toponymy || []).length ? 'PROBABLE' : 'NO_DATA',
    otherInfo: Object.values(thematic).some((list) => list.length) ? 'PROBABLE' : 'NO_DATA',
  };
}

export function buildDossier(locality, bundle, { sites: storedSites = [] } = {}) {
  const claims = bundle?.archaeologicalInformation || [];
  const documents = bundle?.documents || [];
  const attestation = extractFirstAttestation(claims);
  const thematic = classifyThematic(claims);
  const ranSites = buildRanSites(claims, storedSites, locality?.name || bundle?.locality?.currentName || '');
  const aliases = locality?.aliases || [];

  const emptySection = (note) => ({ entries: [], noVerifiedSource: true, note });
  const NO_SOURCE_NOTE = {
    ro: 'Nu a fost identificată o sursă verificabilă.',
    en: 'No verifiable source was identified.',
  };

  const history = buildHistory(claims);
  const certainty = overallCertainty(locality, attestation, thematic, ranSites.entries.length);
  certainty.historicalNames = aliases.length ? (aliases.some((a) => a.verified) ? 'CERT' : 'PROBABLE') : 'NO_DATA';
  certainty.history = claims.length
    ? (claims.some((c) => c.fullyVerified && Number(c.confidence || 0) >= 0.8) ? 'CERT' : 'PROBABLE')
    : 'NO_DATA';

  return {
    schemaVersion: DOSSIER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    spec: DOSSIER_SPEC,
    sectionOrder: [
      'identity', 'historicalNames', 'firstAttestation', 'history', 'administrativeEvolution',
      'population', 'familiesAndEstates', 'historicBuildings', 'ranSites', 'nearbySites',
      'vanishedLocalities', 'toponymy', 'historicalMaps', 'identityChecks', 'sources', 'certainty',
    ],
    identity: {
      name: locality?.name ?? null,
      county: locality?.county ?? null,
      countyCode: locality?.county_code ?? null,
      uat: locality?.uat_name ?? null,
      type: locality?.locality_type ?? null, // official SIRUTA category (ro label; UI translates common values)
      siruta: locality?.siruta_code ?? null,
      parentSiruta: locality?.parent_siruta_code ?? null,
      level: locality?.level ?? null,
      coordinates: locality?.latitude != null && locality?.longitude != null ? { lat: locality.latitude, lng: locality.longitude } : null,
      latitude: locality?.latitude ?? null,
      longitude: locality?.longitude ?? null,
      coordinatesNote: locality?.latitude != null
        ? { ro: 'Coordonatele provin din registrul SIRUTA importat și reprezintă localitatea, nu un sit arheologic (§2).', en: 'The coordinates come from the imported SIRUTA register and represent the locality, not an archaeological site (§2).' }
        : NO_SOURCE_NOTE,
      source: { name: locality?.source_name || 'INS SIRUTA', version: locality?.source_version ?? null, url: locality?.source_url || SIRUTA_OFFICIAL_URL },
    },
    historicalNames: aliases.length
      ? {
          entries: aliases.map((a) => ({ form: a.alias, aliasType: a.type || 'VARIANT', language: a.language || null, source: 'dicționar curat de aliasuri istorice', verified: Boolean(a.verified) })),
          noVerifiedSource: false,
          note: {
            ro: 'Variantele provin din dicționarul curat de aliasuri; cele neverificate sunt marcate. Nu se presupune că două nume asemănătoare desemnează aceeași localitate (§3).',
            en: 'The variants come from the curated alias dictionary; unverified ones are flagged. Two similar names are never assumed to designate the same locality (§3).',
          },
        }
      : emptySection(NO_SOURCE_NOTE),
    firstAttestation: attestation,
    history,
    administrativeEvolution: thematic.administrativeEvolution.length ? { entries: thematic.administrativeEvolution, noVerifiedSource: false } : emptySection(NO_SOURCE_NOTE),
    population: thematic.population.length ? { entries: thematic.population, noVerifiedSource: false } : emptySection(NO_SOURCE_NOTE),
    familiesAndEstates: thematic.familiesAndEstates.length ? { entries: thematic.familiesAndEstates, noVerifiedSource: false } : emptySection(NO_SOURCE_NOTE),
    historicBuildings: thematic.historicBuildings.length ? { entries: thematic.historicBuildings, noVerifiedSource: false } : emptySection(NO_SOURCE_NOTE),
    vanishedLocalities: thematic.vanishedLocalities.length ? { entries: thematic.vanishedLocalities, noVerifiedSource: false } : emptySection(NO_SOURCE_NOTE),
    toponymy: thematic.toponymy.length ? { entries: thematic.toponymy, noVerifiedSource: false } : emptySection(NO_SOURCE_NOTE),
    historicalMaps: thematic.historicalMaps.length ? { entries: thematic.historicalMaps, noVerifiedSource: false } : emptySection(NO_SOURCE_NOTE),
    ranSites,
    nearbySites: {
      entries: [],
      note: {
        ro: 'Secțiune rezervată siturilor atribuite explicit altor localități din vecinătate. Nu se mută situri între localități pe baza proximității geografice (§12).',
        en: 'Section reserved for sites explicitly attributed to other nearby localities. Sites are never moved between localities based on geographic proximity (§12).',
      },
    },
    identityChecks: identityChecks(locality, claims, storedSites),
    sources: buildSources(locality, documents),
    certainty,
  };
}
