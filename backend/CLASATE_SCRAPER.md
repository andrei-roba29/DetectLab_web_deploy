# CIMEC Clasate Artifacts — Scraping & Database Pipeline

## Overview

This pipeline scrapes all **~21,761 classified archaeological artifacts** from the
Romanian National Heritage registry at [clasate.cimec.ro](https://clasate.cimec.ro/Lista.asp?dom=2-Arheologie),
geocodes their finding places to approximate coordinates, stores everything in
Supabase (PostGIS), and serves the data as GeoJSON for the DetectLab map.

## Architecture

```
┌─────────────────────────┐     ┌──────────────┐     ┌───────────────────┐
│  clasate.cimec.ro       │────▶│  Puppeteer   │────▶│  JSON file        │
│  (21,761 artifacts)     │     │  Scraper     │     │  (data/*.json)    │
└─────────────────────────┘     └──────────────┘     └────────┬──────────┘
                                                               │
                          ┌────────────────┐                   ▼
                          │  Nominatim     │◀──── geocoding ──┘
                          │  (coordinates) │
                          └────────────────┘
                                    │
                                    ▼
┌─────────────────────────┐     ┌──────────────┐     ┌───────────────────┐
│  DetectLab Map          │◀────│  Express API │◀────│  Supabase         │
│  (Leaflet layer)        │     │  /api/clasate│     │  (PostGIS table)  │
└─────────────────────────┘     └──────────────┘     └───────────────────┘
```

## Quick Start

### 1. Install dependencies

```bash
cd backend
npm install puppeteer   # adds Chromium (~170MB, one-time)
```

### 2. Run the scraper

```bash
# Full scrape (all 21,761 items — takes ~6-12 hours)
node scripts/scrapeClasate.mjs

# Or with environment variables for control:
SCRAPE_DELAY=2000 node scripts/scrapeClasate.mjs           # slower, safer
SCRAPE_START=1 SCRAPE_END=500 node scripts/scrapeClasate.mjs  # first 500 only
SCRAPE_NO_GEOCODE=true node scripts/scrapeClasate.mjs      # skip geocoding
PUPPETEER_HEADLESS=false node scripts/scrapeClasate.mjs    # see the browser
SCRAPE_RESUME=true node scripts/scrapeClasate.mjs          # resume from last checkpoint
```

The scraper:
1. Opens a headless Chromium browser
2. Navigates through 436 listing pages (50 items each)
3. Collects all detail page URLs
4. Visits each detail page to extract:
   - **Name** (Tip)
   - **Description** (Descriere)
   - **Dating** (Datare)
   - **Period** (Epoca/Perioada)
   - **Culture** (Etnia/Cultura)
   - **Finding place** (Loc de descoperire)
   - **Holder** (Deținător)
   - **Material** (Material/Tehnică)
   - **Classification** (Fond/Tezaur)
   - **Inventory number** (Nr. inventar)
   - **Image URL**
5. Geocodes finding places → approximate coordinates
6. Saves checkpoints every 100 items

### 3. Import into Supabase

```bash
node scripts/importClasateToSupabase.mjs
```

This reads `data/clasate_artifacts.json` and upserts all rows into the
`clasate_artifacts` PostGIS table.

### 4. API endpoints

Once imported, the Express backend serves:

| Endpoint | Description |
|---|---|
| `GET /api/clasate/geojson` | All artifacts as GeoJSON FeatureCollection |
| `GET /api/clasate/geojson?period=Eneolitic` | Filter by period |
| `GET /api/clasate/geojson?culture=Cucuteni` | Filter by culture |
| `GET /api/clasate/geojson?county=CLUJ` | Filter by county |
| `GET /api/clasate/geojson?classification=Tezaur` | Filter by classification |
| `GET /api/clasate/geojson?search=vas` | Full-text search |
| `GET /api/clasate/stats` | Aggregate statistics |
| `GET /api/clasate/:id` | Single artifact details |
| `GET /api/clasate/periods/list` | All period values |
| `GET /api/clasate/cultures/list` | All culture values |
| `GET /api/clasate/counties/list` | All county values |

### 5. Map integration

The frontend automatically shows a **"Clasate Artifacts (INP)"** layer toggle
in the layer panel. When enabled:

- Fetches GeoJSON from the backend API
- Renders ~21k points as canvas circle markers
- Color-coded: 🟡 Gold = Tezaur, 🔵 Blue = Fond, ⚫ Gray = Unknown
- Click any marker for a popup with full artifact details
- Filter by period and culture via dropdown selectors
- Opacity slider for visual adjustment

## Geocoding Strategy

Finding places follow Romanian administrative format:
```
jud. HARGHITA, com. Păuleni-Ciuc, Șoimeni, Dâmbul Cetății
```

The geocoder resolves these in priority order:
1. **Village (sat)**: Most specific — tries `Șoimeni, Păuleni-Ciuc, Harghita, Romania`
2. **Commune (comună)**: Falls back to `Păuleni-Ciuc, Harghita, Romania`
3. **County centroid**: Uses pre-built lookup table of 42 Romanian county centroids

Confidence levels:
- `locality` — Village-level match (±1km)
- `commune` — Commune-level match (±5km)
- `county` — County centroid fallback (±30km)

## Database Schema

```sql
clasate_artifacts (
  id              TEXT PRIMARY KEY,    -- MD5 key from cimec.ro
  name            TEXT,                -- Artifact type
  description     TEXT,                -- Full description
  dating          TEXT,                -- "Mil. V a. Chr."
  period          TEXT,                -- "Eneolitic"
  culture         TEXT,                -- "Cucuteni"
  finding_place   TEXT,                -- Raw finding place text
  classification  TEXT,                -- "Fond" / "Tezaur"
  holder          TEXT,                -- Museum
  geom            GEOMETRY(Point,4326),-- Approximate coordinates
  geocode_confidence TEXT,             -- 'locality'|'commune'|'county'
  ...
)
```

## Files

| Path | Purpose |
|---|---|
| `supabase/migrations/20260804000000_create_clasate_artifacts.sql` | DB schema |
| `backend/scripts/scrapeClasate.mjs` | Puppeteer scraper |
| `backend/scripts/importClasateToSupabase.mjs` | Supabase import |
| `backend/src/services/geocoding/romaniaGeocoder.js` | Geocoding engine |
| `backend/src/routes/clasate.js` | API endpoints |
| `backend/data/clasate_artifacts.json` | Scraped data (output) |

## Rate Limiting

The scraper uses a configurable delay (default 1.5s) between requests to
be respectful to the cimec.ro server. The Nominatim geocoder respects
OSM's 1 req/s policy.

## Resuming After Interruption

The scraper saves checkpoints to `data/.clasate_checkpoint.json`. If
interrupted, run with `SCRAPE_RESUME=true` to continue from where it left off.
