#!/usr/bin/env node
/**
 * CIMEC Clasate Archaeological Artifacts Scraper
 * ================================================
 *
 * Scrapes all ~21,761 artifacts from the Arheologie domain of
 * clasate.cimec.ro, extracts detail page data, geocodes finding
 * places, and outputs a complete JSON database.
 *
 * USAGE:
 *   # Install Puppeteer first (one-time):
 *   cd tools/scrape-clasate && npm install puppeteer
 *
 *   # Run the full scraper (takes ~6-12 hours for all 21,761 items):
 *   node scripts/scrapeClasate.mjs
 *
 *   # Or with options:
 *   SCRAPE_START=1000 SCRAPE_END=2000 node scripts/scrapeClasate.mjs
 *   SCRAPE_DELAY=2000 node scripts/scrapeClasate.mjs  # slower, safer
 *   SCRAPE_NO_GEOCODE=true node scripts/scrapeClasate.mjs  # skip geocoding
 *
 * ENVIRONMENT VARIABLES:
 *   SCRAPE_START       - Start at listing ordinal N (default: 1)
 *   SCRAPE_END         - Stop at listing ordinal N (default: all)
 *   SCRAPE_DELAY       - Delay between requests in ms (default: 1500)
 *   SCRAPE_NO_GEOCODE  - Set 'true' to skip geocoding phase
 *   SCRAPE_OUTPUT      - Output file path (default: data/clasate_artifacts.json)
 *   SCRAPE_BATCH_SIZE  - How many items to save between checkpoints (default: 100)
 *   SCRAPE_RESUME      - Set 'true' to resume from last checkpoint
 *   PUPPETEER_HEADLESS - Set 'false' to see the browser (for debugging)
 *
 * OUTPUT:
 *   A JSON array of artifact objects, each with:
 *     - id, name, description, dating, period, culture, finding_place
 *     - holder, county_holder, classification, material, inventory_nr
 *     - detail_url, image_url
 *     - lat, lng (geocoded), geocode_method, geocode_confidence
 *
 * The output can then be imported into Supabase using:
 *   node scripts/importClasateToSupabase.mjs
 */

import puppeteer from 'puppeteer';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geocodeFindingPlace } from '../geocoding/romaniaGeocoder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ───────────────────────────────────────────────────
const CONFIG = {
  baseUrl: 'https://clasate.cimec.ro',
  listPath: '/Lista.asp?dom=2-Arheologie',
  pageSize: 50,
  totalItems: 21761,
  startOrdinal: Number(process.env.SCRAPE_START) || 1,
  endOrdinal: Number(process.env.SCRAPE_END) || 21761,
  requestDelay: Number(process.env.SCRAPE_DELAY) || 1500,
  skipGeocode: process.env.SCRAPE_NO_GEOCODE === 'true',
  outputPath: resolve(__dirname, '..', process.env.SCRAPE_OUTPUT || 'data/clasate_artifacts.json'),
  checkpointPath: resolve(__dirname, '..', 'data/.clasate_checkpoint.json'),
  batchSize: Number(process.env.SCRAPE_BATCH_SIZE) || 100,
  resume: process.env.SCRAPE_RESUME === 'true',
  headless: process.env.PUPPETEER_HEADLESS !== 'false',
};

// ── Helpers ─────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function loadCheckpoint() {
  if (existsSync(CONFIG.checkpointPath)) {
    try {
      return JSON.parse(readFileSync(CONFIG.checkpointPath, 'utf8'));
    } catch { return null; }
  }
  return null;
}

function saveCheckpoint(artifacts, lastOrdinal) {
  mkdirSync(dirname(CONFIG.checkpointPath), { recursive: true });
  writeFileSync(CONFIG.checkpointPath, JSON.stringify({
    lastOrdinal,
    count: artifacts.length,
    timestamp: new Date().toISOString(),
  }));
}

function saveResults(artifacts) {
  mkdirSync(dirname(CONFIG.outputPath), { recursive: true });
  writeFileSync(CONFIG.outputPath, JSON.stringify(artifacts, null, 2));
  console.log(`💾 Saved ${artifacts.length} artifacts to ${CONFIG.outputPath}`);
}

// ── Phase 1: Collect all detail page URLs from listing ──────────────
async function collectDetailUrls(page) {
  console.log('📋 Phase 1: Collecting artifact detail URLs from listing pages...');

  const allLinks = [];
  const totalPages = Math.ceil(CONFIG.totalItems / CONFIG.pageSize);

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const offset = (pageNum - 1) * CONFIG.pageSize;
    if (offset >= CONFIG.endOrdinal) break;
    if (offset + CONFIG.pageSize < CONFIG.startOrdinal) continue;

    const url = `${CONFIG.baseUrl}${CONFIG.listPath}`;
    console.log(`  Page ${pageNum}/${totalPages} (items ${offset + 1}-${offset + CONFIG.pageSize})`);

    try {
      // Navigate to listing page
      if (pageNum === 1) {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      }

      // Wait for the table to be visible
      await page.waitForSelector('table', { timeout: 15000 });

      // If not page 1, click the page button
      if (pageNum > 1) {
        // Find and click the page number button in the pagination
        const clicked = await page.evaluate((targetPage) => {
          const links = document.querySelectorAll('a[href="#"]');
          for (const link of links) {
            const text = link.textContent.trim();
            if (text === `page ${targetPage}` || text === String(targetPage)) {
              link.click();
              return true;
            }
          }
          // Try the "next" button approach
          const nextBtn = document.querySelector('.pager a.next, a[title="next"]');
          if (nextBtn) { nextBtn.click(); return true; }
          return false;
        }, pageNum);

        if (!clicked) {
          console.warn(`  ⚠️ Could not find page ${pageNum} button, trying JS navigation...`);
          // Alternative: evaluate the pagination JS directly
          await page.evaluate((p) => {
            if (typeof goToPage === 'function') goToPage(p);
            if (typeof paginate === 'function') paginate(p);
            if (typeof schimbaPagina === 'function') schimbaPagina(p);
          }, pageNum);
        }

        await sleep(CONFIG.requestDelay);
        await page.waitForSelector('table', { timeout: 15000 });
      }

      // Extract all detail page links from the current page view
      const links = await page.evaluate(() => {
        const results = [];
        const rows = document.querySelectorAll('table tr');
        rows.forEach(row => {
          const anchor = row.querySelector('a[href*="Detaliu.asp"]');
          if (anchor) {
            const href = anchor.getAttribute('href');
            const fullUrl = href.startsWith('http') ? href : `https://clasate.cimec.ro${href}`;
            const keyMatch = href.match(/k=([a-f0-9]+)/i);
            results.push({
              url: fullUrl,
              key: keyMatch ? keyMatch[1] : null,
            });
          }
        });
        return results;
      });

      allLinks.push(...links);
      console.log(`  ✓ Found ${links.length} items (total: ${allLinks.length})`);

    } catch (err) {
      console.error(`  ✗ Error on page ${pageNum}:`, err.message);
    }
  }

  return allLinks;
}

// ── Phase 2: Scrape each detail page ────────────────────────────────
async function scrapeDetailPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const data = await page.evaluate(() => {
      const getText = (label) => {
        // Look for bold text matching label, then get the next text node/sibling
        const bolds = document.querySelectorAll('b, strong');
        for (const b of bolds) {
          if (b.textContent.trim().startsWith(label)) {
            // The value is typically in the next sibling or parent's next sibling
            let node = b.nextSibling;
            if (node && node.textContent.trim()) return node.textContent.trim();
            // Try parent's next sibling
            const parent = b.parentElement;
            if (parent) {
              node = parent.nextSibling;
              if (node) {
                const text = node.textContent.trim();
                if (text) return text;
              }
            }
            // Try the text content after the bold in the same line
            const line = b.parentElement ? b.parentElement.textContent : '';
            const parts = line.split(label);
            if (parts.length > 1) return parts[1].trim();
          }
        }
        return null;
      };

      // Extract all field values
      const result = {
        name: getText('Tip:') || getText('Tip specific:') || document.title.split(' - ')[0],
        description: getText('Descriere:') || null,
        holder: null,
        domain: getText('Domeniu:') || 'Arheologie',
        dating: getText('Datare:') || null,
        period: getText('Epoca/Perioada:') || getText('Epoca:') || null,
        culture: getText('Etnia/Cultura:') || getText('Cultura:') || null,
        finding_place: getText('Loc de descoperire:') || null,
        material: getText('Material/Tehnică') || getText('Material:') || null,
        inventory_nr: getText('Nr. inventar:') || null,
        classification: null,
        image_url: null,
      };

      // Holder: often a link
      const holderLink = document.querySelector('a[href*="ghidulmuzeelor"]');
      if (holderLink) {
        result.holder = holderLink.textContent.trim();
      } else {
        result.holder = getText('Deţinător:') || getText('Detinator:') || getText('Deținător:');
      }

      // Classification from the "Ordin de clasare" field
      const ordText = getText('Ordin de clasare:') || '';
      if (ordText.includes('Fond')) result.classification = 'Fond';
      else if (ordText.includes('Tezaur')) result.classification = 'Tezaur';

      // First image
      const imgs = document.querySelectorAll('img[src*="medium/imagini"]');
      if (imgs.length > 0) {
        result.image_url = imgs[0].src.split('?')[0]; // Remove cache-busting param
      }

      return result;
    });

    return data;
  } catch (err) {
    console.error(`  ✗ Failed to scrape ${url}:`, err.message);
    return null;
  }
}

// ── Phase 3: Geocode all artifacts ──────────────────────────────────
async function geocodeArtifacts(artifacts) {
  if (CONFIG.skipGeocode) {
    console.log('⏭️  Skipping geocoding (SCRAPE_NO_GEOCODE=true)');
    return artifacts;
  }

  console.log(`🌍 Phase 3: Geocoding ${artifacts.length} finding places...`);
  let geocoded = 0;
  let failed = 0;

  for (let i = 0; i < artifacts.length; i++) {
    const art = artifacts[i];
    if (art.lat && art.lng) continue; // Already geocoded (resume)

    if (!art.finding_place) {
      failed++;
      continue;
    }

    try {
      const coords = await geocodeFindingPlace(art.finding_place);
      if (coords) {
        art.lat = coords.lat;
        art.lng = coords.lng;
        art.geocode_method = coords.method;
        art.geocode_confidence = coords.confidence;
        geocoded++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  📍 ${geocoded} geocoded, ${failed} failed, ${i + 1}/${artifacts.length} processed`);
    }
  }

  console.log(`✅ Geocoding complete: ${geocoded} success, ${failed} failed`);
  return artifacts;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  CIMEC Clasate Archaeological Artifacts Scraper');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Range: items ${CONFIG.startOrdinal}–${CONFIG.endOrdinal}`);
  console.log(`  Output: ${CONFIG.outputPath}`);
  console.log(`  Geocoding: ${CONFIG.skipGeocode ? 'disabled' : 'enabled'}`);
  console.log('');

  // Load existing data if resuming
  let artifacts = [];
  let startFrom = CONFIG.startOrdinal;

  if (CONFIG.resume && existsSync(CONFIG.outputPath)) {
    try {
      artifacts = JSON.parse(readFileSync(CONFIG.outputPath, 'utf8'));
      const checkpoint = loadCheckpoint();
      if (checkpoint) {
        startFrom = checkpoint.lastOrdinal + 1;
      }
      console.log(`📂 Resuming: ${artifacts.length} artifacts loaded, starting from ordinal ${startFrom}`);
    } catch (err) {
      console.warn('⚠️ Could not load checkpoint, starting fresh');
    }
  }

  // Launch browser
  console.log('🚀 Launching browser...');
  const browser = await puppeteer.launch({
    headless: CONFIG.headless ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Set a realistic user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  try {
    // Phase 1: Collect all detail page URLs
    const allLinks = await collectDetailUrls(page);
    console.log(`\n📋 Total unique URLs collected: ${allLinks.length}\n`);

    // Phase 2: Scrape each detail page
    console.log('📝 Phase 2: Scraping individual artifact pages...');
    let scraped = 0;
    let errors = 0;

    for (let i = 0; i < allLinks.length; i++) {
      const link = allLinks[i];
      if (!link.key) continue;

      // Check if already scraped (resume mode)
      if (artifacts.find(a => a.id === link.key)) {
        continue;
      }

      const data = await scrapeDetailPage(page, link.url);
      if (data) {
        artifacts.push({
          id: link.key,
          ...data,
          detail_url: link.url,
          ordinal: startFrom + i,
          scraped_at: new Date().toISOString(),
        });
        scraped++;
      } else {
        errors++;
      }

      // Periodic checkpoint
      if (scraped > 0 && scraped % CONFIG.batchSize === 0) {
        saveResults(artifacts);
        saveCheckpoint(artifacts, startFrom + i);
        console.log(`  💾 Checkpoint: ${artifacts.length} total, ${scraped} new this run`);
      }

      // Rate limiting
      await sleep(CONFIG.requestDelay);

      if ((scraped + errors) % 20 === 0) {
        console.log(`  Progress: ${scraped} scraped, ${errors} errors, ${i + 1}/${allLinks.length} URLs`);
      }
    }

    console.log(`\n✅ Phase 2 complete: ${scraped} new artifacts scraped, ${errors} errors`);

  } catch (err) {
    console.error('💥 Fatal error:', err);
  } finally {
    await browser.close();
  }

  // Phase 3: Geocode
  await geocodeArtifacts(artifacts);

  // Final save
  saveResults(artifacts);
  saveCheckpoint(artifacts, CONFIG.endOrdinal);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  ✅ DONE! ${artifacts.length} artifacts saved to ${CONFIG.outputPath}`);
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('💥 Unhandled error:', err);
  process.exit(1);
});
