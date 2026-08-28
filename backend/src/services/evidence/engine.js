import crypto from 'node:crypto';
import { extractPdfPages, getArticle, searchCatalog } from './bibliotecaDigitala.js';
import { createDeadline } from './deadline.js';
import { periods } from './periods.js';

export const LOCATION_ROLES = ['ARCHAEOLOGICAL_TARGET','FINDSPOT','EXCAVATION_LOCATION','SURVEY_LOCATION','HISTORICAL_LOCATION','ARCHAEOLOGICAL_CONTEXT','INSTITUTION','MUSEUM_LOCATION','COLLECTION_LOCATION','EXHIBITION_LOCATION','AUTHOR_AFFILIATION','PUBLICATION_LOCATION','BIBLIOGRAPHIC_REFERENCE','INCIDENTAL_MENTION','UNKNOWN'];

const arch = /arheolog|săpătur|sapatur|descoper|sit(?:ul)?|necropol|așez|asez|fortifica|castr|castel|cetat|mormânt|mormant|tezaur|moned|fibul|ceramic|tumul|sanctuar|villa rustica|atelier|perieghez|prospecți|prospecti|diagnostic|stratigraf|inventar funerar/i;
const categoryPatterns = [
  ['NECROPOLIS', /necropol|cimitir/], ['BURIAL', /mormânt|mormant|funerar/], ['SETTLEMENT', /așezar|asezar/],
  ['FORTIFICATION', /fortifica|cetat|castr|castellum|burgus/], ['HOARD', /tezaur/], ['COIN_FIND', /moned/],
  ['ARTEFACT', /fibul|ceramic|armă|arma|podoab|artefact|obiect/], ['SURVEY', /perieghez|prospecți|prospecti|suprafață|suprafata/],
  ['EXCAVATION', /săpătur|sapatur|excav|dezvel/], ['ARCHAEOLOGICAL_SITE', /sit arheologic|situl/],
];

function normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[șş]/gi, 's').replace(/[țţ]/gi, 't').toLocaleLowerCase('ro').trim(); }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function confidenceLabel(score) { return score >= .8 ? 'HIGH' : score >= .5 ? 'MEDIUM' : score >= .2 ? 'LOW' : 'IRRELEVANT'; }
function claimId(locality, evidence) { return crypto.createHash('sha256').update(`${normalize(locality)}|${normalize(evidence)}`).digest('hex').slice(0, 20); }

export function buildAliases(locality, supplied = []) {
  const values = [locality, ...supplied].map((x) => String(x || '').trim()).filter((x) => x.length >= 2);
  if (locality) values.push(normalize(locality));
  const unique = new Map();
  values.forEach((value) => { if (!unique.has(normalize(value))) unique.set(normalize(value), value); });
  return [...unique.values()].slice(0, 12);
}

function hasAlias(value, aliases) { const n = normalize(value); return aliases.some((a) => n.includes(normalize(a))); }
function sentenceWindows(pageText, aliases) {
  const sentences = pageText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const out = [];
  sentences.forEach((sentence, i) => {
    if (!hasAlias(sentence, aliases)) return;
    out.push({ sentence: sentence.trim(), context: sentences.slice(Math.max(0, i - 1), i + 2).join(' ').replace(/\s+/g, ' ').trim() });
  });
  return out;
}

function classifyMention(context, title, descriptors, aliases) {
  const normalizedContext = normalize(context);
  const aliasPattern = aliases.map((alias) => escapeRegex(normalize(alias))).filter(Boolean).join('|');
  const near = (before, after = '') => new RegExp(`(?:${before})[^.!?]{0,100}(?:${aliasPattern})(?:${after})`, 'i').test(normalizedContext);
  const afterAlias = (pattern) => new RegExp(`(?:${aliasPattern})[^.!?]{0,100}(?:${pattern})`, 'i').test(normalizedContext);
  let positive = null;
  const directFindspot = new RegExp(`descoper(?:it|ita|ite|ire)[^.!?]{0,35}(?:la|in|din)\\s+[^,.!?]{0,18}(?:${aliasPattern})`, 'i').test(normalizedContext);
  if (directFindspot || afterAlias('(?:au fost|a fost|s-au)\\s+descoper')) positive = ['FINDSPOT', null, .35];
  else if (near('sapatur|excav|dezvel') || afterAlias('sapatur|excav|dezvel')) positive = ['EXCAVATION_LOCATION', null, .30];
  else if (near('perieghez|cercetari de suprafata|prospecti|diagnostic') || afterAlias('perieghez|prospecti|diagnostic')) positive = ['SURVEY_LOCATION', null, .25];
  else if (near('(?:situl|necropol|asezar|fortifica|castr|mormant|tezaur)[^.!?]{0,35}(?:de la|din|la)\\s+') || afterAlias('(?:este|a existat|se afla)[^.!?]{0,30}(?:sit|necropol|asezar|fortifica|castr|mormant|tezaur)')) positive = ['ARCHAEOLOGICAL_TARGET', null, .40];
  else if (near('(?:zona|teritoriul)[^.!?]{0,30}') && arch.test(context)) positive = ['ARCHAEOLOGICAL_CONTEXT', null, .05];

  let negative = null;
  const tiedNegatives = [
    ['COLLECTION_LOCATION', '(?:colecti|pastrat|depozit)', -.30],
    ['AUTHOR_AFFILIATION', '(?:universitat|afiliere|autor|profesor|doctorand)', -.30],
    ['MUSEUM_LOCATION', '(?:muzeul|museum)', -.50], ['INSTITUTION', '(?:institutul|institut|academia)', -.50],
    ['PUBLICATION_LOCATION', '(?:editura|publicat la|loc publicare)', -.50],
  ];
  for (const item of tiedNegatives) { if (near(item[1])) { negative = item; break; } }
  if (!negative && /bibliografi|op\.\s*cit|idem|ibidem/i.test(context)) negative = ['BIBLIOGRAPHIC_REFERENCE', '', -.20];
  const role = positive?.[0] || negative?.[0] || (arch.test(context) ? 'ARCHAEOLOGICAL_CONTEXT' : 'INCIDENTAL_MENTION');
  let score = positive?.[2] || 0;
  if (arch.test(context)) score += .05;
  if (hasAlias(title, aliases)) score += .20;
  if (descriptors.some((d) => hasAlias(d, aliases) && /loc geografic|jude/i.test(d))) score += .15;
  if (!positive && negative) score += negative[2];
  if (!positive && !negative && !arch.test(context)) score -= .20;
  score = Math.max(0, Math.min(1, score));
  return { role, score, confidence: confidenceLabel(score) };
}

export function classifyLocationMention(context, locality, { title = '', descriptors = [], aliases = [] } = {}) {
  return classifyMention(context, title, descriptors, buildAliases(locality, aliases));
}

function category(value) { return categoryPatterns.find(([, rx]) => rx.test(value))?.[0] || 'OTHER_ARCHAEOLOGICAL_EVIDENCE'; }
function makeClaim(locality, categoryName, evidence) {
  const labels = { NECROPOLIS: 'o necropolă', BURIAL: 'un context funerar', SETTLEMENT: 'o așezare', FORTIFICATION: 'o fortificație', HOARD: 'un tezaur', COIN_FIND: 'o descoperire monetară', ARTEFACT: 'artefacte', SURVEY: 'cercetări de suprafață', EXCAVATION: 'săpături arheologice', ARCHAEOLOGICAL_SITE: 'un sit arheologic', OTHER_ARCHAEOLOGICAL_EVIDENCE: 'informații arheologice' };
  const action = /descoper/i.test(evidence) ? 'este documentată descoperirea de' : 'sunt documentate';
  return `La ${locality} ${action} ${labels[categoryName]}.`;
}

function captionCandidates(pages, locality, claimIdValue) {
  const rx = /(?:fig(?:ura|\.)?|pl(?:anșa|ansa|\.)?|harta)\s*\d+[a-z]?\s*[.):-]?\s*[^.]{3,240}/gi;
  const images = [];
  pages.forEach((page) => {
    for (const match of page.text.matchAll(rx)) {
      if (!hasAlias(match[0], [locality]) && !arch.test(match[0])) continue;
      const caption = match[0].trim();
      const imageType = /hart/i.test(caption) ? 'MAP' : /plan/i.test(caption) ? 'SITE_PLAN' : /secți|secti|profil|stratigraf/i.test(caption) ? 'STRATIGRAPHIC_SECTION' : /fotogr|vedere/i.test(caption) ? 'ARCHAEOLOGICAL_PHOTO' : /fibul|moned|vas|ceramic|pies/i.test(caption) ? 'ARTEFACT_PHOTO' : 'OTHER';
      images.push({ figureNumber: caption.match(/(?:fig(?:ura|\.)?|pl(?:anșa|ansa|\.)?|harta)\s*\d+[a-z]?/i)?.[0] || null, caption, pdfPage: page.pdfPage, printedPage: null, type: imageType, associatedLocality: locality, associatedClaim: claimIdValue, confidence: hasAlias(caption, [locality]) ? .9 : .55, imageAvailable: true, imageUrl: null, imageRepublicationAllowed: false, copyrightLicense: null });
    }
  });
  return images.slice(0, 6);
}

export function extractClaims(document, pages, locality, aliases, extractionStatus) {
  const claims = [];
  const candidates = [];
  pages.forEach((page) => sentenceWindows(page.text, aliases).forEach((window) => candidates.push({ ...window, pdfPage: page.pdfPage, printedPage: page.printedPage, pageTextChecksum: page.textChecksum, pageCharacterCount: page.characterCount, ocr: page.ocr })));
  if (!candidates.length && document.abstract && hasAlias(document.abstract, aliases)) candidates.push({ sentence: document.abstract, context: document.abstract, pdfPage: null, ocr: false, abstract: true });
  for (const item of candidates) {
    const mention = classifyMention(item.context, document.title, document.descriptors, aliases);
    const evidentiaryRoles = new Set(['ARCHAEOLOGICAL_TARGET','FINDSPOT','EXCAVATION_LOCATION','SURVEY_LOCATION','HISTORICAL_LOCATION','ARCHAEOLOGICAL_CONTEXT']);
    // Negative/contextual-only roles must never become archaeological claims
    // for that locality; they can be retained separately by a discovery pass.
    if (!evidentiaryRoles.has(mention.role) || mention.score < .2 || !arch.test(item.context)) continue;
    const evidence = item.sentence.slice(0, 900).trim();
    const cat = category(item.context);
    const id = claimId(locality, evidence);
    claims.push({
      id, claim: makeClaim(locality, cat, evidence), category: cat, periods: periods(item.context, document.descriptors),
      locations: [{ name: locality, originalName: aliases.find((a) => hasAlias(evidence, [a])) || locality, role: mention.role, confidence: mention.score, attributionReason: `Localitatea apare într-un context clasificat ${mention.role}; semnalele din titlu, descriptori și fragment au produs scorul ${mention.score.toFixed(2)}.` }],
      evidence: [{ excerpt: evidence, contextWindow: item.context.slice(0, 1400), printedPage: item.printedPage || null, pdfPage: item.pdfPage, pageTextChecksum: item.pageTextChecksum || null, pageCharacterCount: item.pageCharacterCount || null, documentUrl: document.url, pageUrl: null, sourceUrl: document.pdfUrl || document.url, extractionMethod: item.abstract ? 'ABSTRACT' : item.ocr ? 'OCR' : 'PDF_TEXT', confidence: mention.score }],
      source: { sourceId: document.documentId, title: document.title, authors: document.authors, year: document.year, publication: document.publication, volume: document.volume, url: document.url, pdfUrl: document.pdfUrl, provider: 'Biblioteca Digitală a Publicațiilor Culturale / ProEuropeana', providerOrigin: 'https://biblioteca-digitala.ro' },
      images: captionCandidates(pages.filter((p) => p.pdfPage === item.pdfPage), locality, id), confidence: mention.score, confidenceLevel: mention.confidence,
      fullyVerified: Boolean(evidence && (item.pdfPage || item.abstract) && document.url), conflictingSources: false,
      extractionStatus,
    });
  }
  return claims.sort((a, b) => b.confidence - a.confidence).slice(0, 30);
}

async function mapLimited(items, limit, fn) {
  const output = new Array(items.length); let cursor = 0;
  async function worker() { while (cursor < items.length) { const index = cursor++; try { output[index] = await fn(items[index], index); } catch (error) { output[index] = { error: error.message, candidate: items[index] }; } } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)); return output;
}

/**
 * Minimum milliseconds a document still needs to be worth starting: fetching a
 * monograph PDF and parsing up to 180 pages is the expensive part of a search,
 * so a run that is about to hit its budget must not begin it.
 */
const MIN_FULL_TEXT_MS = 12000;

export async function researchLocality({ locality, county = null, aliases: suppliedAliases = [], limit = 10, includeFullText = true, budgetMs = 0 }) {
  const deadline = createDeadline(budgetMs);
  const aliases = buildAliases(locality, suppliedAliases);
  const candidates = await searchCatalog(aliases, Math.max(1, Math.min(Number(limit) || 10, 20)), { deadline });
  const documents = await mapLimited(candidates, 3, async (candidate, index) => {
    // The shared budget is checked per document: an exhausted run finishes the
    // work already paid for and reports the rest as a failure (which keeps the
    // locality `PARTIAL`, so a later search resumes the research).
    if (deadline.exceeded()) throw new Error('research_budget_exhausted');
    const article = await getArticle(candidate, { deadline });
    let extracted = { pages: [], status: article.extractionStatus };
    const metadataRelevant = hasAlias(article.title, aliases) || article.descriptors.some((d) => hasAlias(d, aliases)) || hasAlias(article.abstract, aliases);
    // Analyse only the strongest first candidates synchronously; all metadata
    // remains in the response and can be queued by a future background worker.
    const canExtractFullText = includeFullText && index < 6 && metadataRelevant && article.pdfUrl && (!deadline.bounded || deadline.remaining() > MIN_FULL_TEXT_MS);
    if (canExtractFullText) {
      try { extracted = await extractPdfPages(article.pdfUrl, article.pagination, { deadline }); } catch (error) { extracted = { pages: [], status: 'PDF_EXTRACTION_FAILED', error: error.message }; }
    }
    const claims = extractClaims(article, extracted.pages, locality, aliases, extracted.status);
    return { ...article, extractionStatus: extracted.status, extractionError: extracted.error || null, claims };
  });
  const validDocuments = documents.filter((d) => !d.error);
  const claims = validDocuments.flatMap((d) => d.claims);
  // `truncated` = this answer is deliberately incomplete (time budget or a
  // source refusal that was survivable), never a claim of exhaustiveness.
  const truncated = Boolean(candidates.truncated) || deadline.exceeded() || documents.some((d) => d.error && /budget/.test(String(d.error)));
  return {
    schemaVersion: '1.0', locality: { currentName: locality, county, aliases, coordinates: null, siruta: null },
    sourcePolicy: { exclusiveProvider: 'https://biblioteca-digitala.ro/', externalArchaeologicalSourcesAllowed: false },
    searchedAt: new Date().toISOString(), candidateCount: candidates.length, documentCount: validDocuments.length,
    truncated, budgetMs: deadline.bounded ? Number(budgetMs) : null,
    archaeologicalInformation: claims, documents: validDocuments.map(({ claims: _, ...document }) => document),
    failures: documents.filter((d) => d.error),
    audit: { verifiedClaims: claims.filter((c) => c.fullyVerified).length, highConfidence: claims.filter((c) => c.confidenceLevel === 'HIGH').length, ocrRequiredDocuments: validDocuments.filter((d) => d.extractionStatus === 'OCR_REQUIRED').length, truncated },
  };
}
