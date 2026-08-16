import crypto from 'node:crypto';
// Import the library entry directly: pdf-parse's package root executes its
// bundled demo when loaded from some ESM runtimes.
import pdf from 'pdf-parse/lib/pdf-parse.js';

const ORIGIN = 'https://biblioteca-digitala.ro';
const USER_AGENT = 'DetectLab-Archaeological-Evidence-Engine/1.0 (+https://detectlab.ro)';
const MAX_PDF_BYTES = 35 * 1024 * 1024;
const MIN_REQUEST_INTERVAL_MS = Number(process.env.BIBLIOTECA_REQUEST_INTERVAL_MS || 1200);
let nextRequestAt = 0;
let requestChain = Promise.resolve();

// One process-wide request lane. This deliberately trades throughput for
// politeness; national ingestion runs progressively and is resumable.
async function waitForSourceSlot() {
  const turn = requestChain.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  });
  requestChain = turn.catch(() => {});
  await turn;
}

function decodeHtml(value = '') {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ș: 'ș', ţ: 'ţ' };
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Zșţ]+);/g, (all, n) => named[n] ?? all);
}

function text(value = '') {
  return decodeHtml(String(value).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function absolute(href = '') {
  try {
    const url = new URL(decodeHtml(href), ORIGIN);
    return url.hostname === 'biblioteca-digitala.ro' || url.hostname.endsWith('.biblioteca-digitala.ro') ? url.href : null;
  } catch { return null; }
}

async function sourceFetch(url, { timeoutMs = 20000, maxBytes = 4 * 1024 * 1024 } = {}) {
  const safe = absolute(url);
  if (!safe) throw new Error('Blocked non-biblioteca-digitala.ro URL');
  await waitForSourceSlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(safe, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5' },
      redirect: 'follow', signal: controller.signal,
    });
    if (!absolute(response.url)) throw new Error('Blocked redirect outside biblioteca-digitala.ro');
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxBytes) throw new Error('Source document exceeds the safe download limit');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('Source document exceeds the safe download limit');
    return { buffer, contentType: response.headers.get('content-type') || '', url: response.url };
  } finally { clearTimeout(timer); }
}

export async function searchCatalog(aliases, limit = 12) {
  const found = new Map();
  for (const alias of aliases.slice(0, 6)) {
    const { buffer } = await sourceFetch(`${ORIGIN}/?cuvinte=${encodeURIComponent(alias)}`);
    const html = buffer.toString('utf8');
    const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const match = row.match(/href=["']([^"']*\?articol=(\d+)-[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!match) continue;
      const url = absolute(match[1]);
      if (!url || found.has(match[2])) continue;
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => text(m[1]));
      const year = cells.find((v) => /^(18|19|20)\d{2}$/.test(v)) || null;
      const pages = cells.find((v) => /^\d+\s*[-–]\s*\d+$/.test(v)) || null;
      found.set(match[2], { documentId: match[2], title: text(match[3]), url, year: year ? Number(year) : null, pages, matchedAlias: alias });
      if (found.size >= limit) return [...found.values()];
    }
  }
  return [...found.values()];
}

function field(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<strong>\\s*${escaped}\\s*:?\\s*<\\/strong>([\\s\\S]*?)(?=<\\/li>)`, 'i'));
  return match ? text(match[1]) : null;
}

function linksAfter(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<strong>\\s*${escaped}\\s*:?\\s*<\\/strong>([\\s\\S]*?)(?=<\\/li>)`, 'i'));
  return match ? [...match[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => text(m[1])).filter(Boolean) : [];
}

export async function getArticle(candidate) {
  const { buffer } = await sourceFetch(candidate.url);
  const html = buffer.toString('utf8');
  const heading = html.match(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/i);
  const download = [...html.matchAll(/href=["']([^"']+)["'][^>]*>(?:\s*<[^>]+>)*\s*Descarc[ăa]/gi)][0];
  const descriptorsBlock = html.match(/<strong>\s*Descriptori\s*:?\s*<\/strong>([\s\S]*?)(?=<\/li>)/i);
  const descriptors = descriptorsBlock ? [...descriptorsBlock[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => text(m[1])) : [];
  const pagination = field(html, 'Paginaţia') || field(html, 'Paginația') || candidate.pages;
  const yearRaw = field(html, 'Anul publicaţiei') || field(html, 'Anul publicației');
  return {
    ...candidate,
    title: heading ? text(heading[1]) : candidate.title,
    authors: linksAfter(html, 'Realizatori'),
    year: Number((yearRaw || '').match(/\b(18|19|20)\d{2}\b/)?.[0]) || candidate.year,
    publication: field(html, 'Vezi publicația'),
    volume: field(html, 'Referinţă bibliografică pentru nr. revistă'),
    publisher: field(html, 'Editura'), publicationLocation: field(html, 'Loc publicare'),
    language: field(html, 'Limba de redactare'), section: field(html, 'Secţiunea'),
    pagination, abstract: field(html, 'Subiect'), descriptors,
    pdfUrl: download ? absolute(download[1]) : null,
    extractionStatus: download ? 'PENDING' : 'METADATA_ONLY',
  };
}

export async function extractPdfPages(pdfUrl, pagination = null) {
  if (!pdfUrl) return { pages: [], status: 'NO_PDF' };
  const { buffer } = await sourceFetch(pdfUrl, { timeoutMs: 45000, maxBytes: MAX_PDF_BYTES });
  const pages = [];
  const range = String(pagination || '').match(/(\d+)\s*[-–]\s*(\d+)/);
  await pdf(buffer, {
    max: 180,
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      const pageText = content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
      const pdfPage = pages.length + 1;
      const expectedPrinted = range ? Number(range[1]) + pdfPage - 1 : null;
      // A printed page is accepted only when its expected label is visible near
      // a page boundary. We never silently assume PDF page == printed page.
      const boundary = `${pageText.slice(0, 180)} ${pageText.slice(-180)}`;
      const printedPage = expectedPrinted && new RegExp(`(?:^|\\D)${expectedPrinted}(?:\\D|$)`).test(boundary) ? String(expectedPrinted) : null;
      pages.push({ pdfPage, printedPage, text: pageText, textChecksum: crypto.createHash('sha256').update(pageText).digest('hex'), characterCount: pageText.length, ocr: false });
      return pageText;
    },
  });
  const chars = pages.reduce((n, page) => n + page.text.length, 0);
  return { pages, status: chars < Math.max(100, pages.length * 25) ? 'OCR_REQUIRED' : 'PDF_TEXT' };
}

export const bibliotecaDigitalaOrigin = ORIGIN;
