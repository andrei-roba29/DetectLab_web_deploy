# Corpus Locality Matching — pipeline fără AI

Pipeline local, determinist, pentru mențiuni candidate din corpusul istoric
`D:\Babel` (repertorii + Cronica Cercetărilor Arheologice).

```
JSONL (extracted/*.jsonl)  →  dicționar SIRUTA local  →  Aho-Corasick  →  locality_mentions.jsonl  →  knowledge.archaeological_locality_mentions (Supabase)
```

Nu folosește OpenAI/LLM. Nu modifică RAN. Nu creează aliasuri automat.

## Tabele existente (nu duplicate)

- `knowledge.localities` — nomenclatura SIRUTA (S1 2025), deja în Supabase
- `knowledge.locality_aliases` — aliasuri istorice/maghiare/germane/latine, deja în Supabase
- `knowledge.locality_mentions` — mențiuni legate de `knowledge.documents` (biblioteca-digitala.ro) — **rămâne neschimbat**

## Tabel nou (doar dacă nu există)

`knowledge.archaeological_locality_mentions` — mențiuni candidate din `D:\Babel`:

```sql
-- backend/migrations/008_archaeological_locality_mentions.sql
-- supabase/migrations/20260816000000_archaeological_locality_mentions.sql
CREATE TABLE knowledge.archaeological_locality_mentions (
    document_name TEXT NOT NULL,
    page INTEGER NOT NULL,
    locality_id BIGINT REFERENCES knowledge.localities(id),
    siruta_code TEXT,
    locality_name TEXT,
    county TEXT,
    matched_text TEXT NOT NULL,
    normalized_match TEXT,
    match_type TEXT,             -- CURRENT | HISTORICAL | HUNGARIAN | GERMAN | LATIN | ...
    source_type TEXT,            -- REPERTORY | CCA | OTHER_ARCHAEOLOGICAL_SOURCE
    context TEXT,                -- 500-1500 chars, sentence-aware
    context_before TEXT,
    context_after TEXT,
    match_confidence NUMERIC,    -- 1.0 pentru match normalizat exact
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_name, page, locality_id, matched_text)
);
```

Aplică migrația:

```bash
cd backend
npm run migrate   # aplică 008_archaeological_locality_mentions.sql pe DATABASE_URL
```

## Instalare

Scriptul Python folosește doar stdlib. Pentru inserarea în Supabase are nevoie de `psycopg2`:

```bash
pip install psycopg2-binary
```

## Export dicționar (opțional, pentru rulare offline)

Dacă rulezi pe PC fără acces direct la DB, exportă dicționarul o dată:

```bash
# pe server / oriunde ai DATABASE_URL
cd backend
DATABASE_URL=... npm run export:siruta-dict -- ../siruta_dictionary.json
# sau
DATABASE_URL=... node scripts/exportSirutaDictionary.js ../siruta_dictionary.json
```

Apoi pe `D:\Babel`:

```bash
python process_archaeological_corpus.py --input D:\Babel\extracted --dictionary siruta_dictionary.json --dry-run
```

## Utilizare principală

### 1. Procesare locală (Windows, corpusul tău)

```bash
# a) Cu DATABASE_URL setat (scrie și în Supabase + JSONL)
set DATABASE_URL=postgresql://...
python process_archaeological_corpus.py --input D:\Babel\extracted --output D:\Babel\locality_mentions.jsonl

# b) Cu dicționar exportat (fără DB, doar JSONL)
python process_archaeological_corpus.py --input D:\Babel\extracted --output D:\Babel\locality_mentions.jsonl --dictionary siruta_dictionary.json --dry-run

# c) Doar JSONL, fără DB (verificare rapidă)
python process_archaeological_corpus.py --input D:\Babel\extracted --output locality_mentions.jsonl --dry-run
```

### 2. Opțiuni

```
--input DIR         director cu *.jsonl (fiecare linie: {document, page, text})
--output FILE       fișier JSONL de ieșire (default locality_mentions.jsonl)
--dictionary FILE   JSON {localities:[], aliases:[]} (dacă nu ai DATABASE_URL)
--dry-run / --no-db nu scrie în Supabase
```

## Normalizare

Funcție comună pentru dicționar și text:

- lower + NFD strip diacritice
- ș/ş → s, ț/ţ → t
- cratime/dash-uri (– — - _) și puncte → spațiu
- punctuație → spațiu, spații multiple → un spațiu
- păstrează `matched_text` original, în `normalized_match` varianta normalizată

Exemple tratate identic: `Cășeiu` / `Caseiu` / `CĂȘEIU`, `Cluj-Napoca` / `Cluj–Napoca` / `CLUJ NAPOCA` / `Cluj Napoca`.

## Matching

- Dicționarul (localități + aliasuri) este preîncărcat în memorie.
- Automat Aho-Corasick (O(n) per pagină), streaming, fără `query per cuvânt`.
- Word-boundary aware (spațiu/start/end).
- Overlap: cel mai lung match câștigă la aceeași poziție.
- Pentru aliasuri ambigue (același `normalized_alias` → mai multe localități) se emite câte un rând per `locality_id`.

## Context

Pentru fiecare match:

- `context` — propoziția/paragraful care conține mențiunea, ~700 chars înainte/după, extins la granițe de propoziție (`.!?` / newline), clamp 500-1500 chars.
- `context_before` / `context_after` — vecinătate suplimentară (max 500 chars).
- `document_name` + `page` sunt păstrate obligatoriu.

## Source type

Din numele fișierului:

- conține `cca` / `cronica` → `CCA`
- conține `repert` → `REPERTORY`
- altfel → `OTHER_ARCHAEOLOGICAL_SOURCE`

## Verificare manuală (localități cerute)

După rulare, verifică:

```bash
python -c "import json; rows=[json.loads(l) for l in open('locality_mentions.jsonl', encoding='utf-8')]; print([r for r in rows if r['locality'] in ['Cluj-Napoca','Apahida','Dej','Sibiu','Alba Iulia','Botoșani']][:5])"
```

Sau filtrează în Supabase:

```sql
SELECT document_name, page, locality_name, county, matched_text, match_type, left(context,120)
FROM knowledge.archaeological_locality_mentions
WHERE locality_name IN ('Cluj-Napoca','Apahida','Dej','Sibiu','Alba Iulia')
ORDER BY document_name, page LIMIT 20;
```

## Statistici finale

Scriptul tipărește:

```
Documents processed: 49
Pages processed: XXXXX
Pages with matches: XXXXX
Locality mentions: XXXXX
Unique localities matched: XXXXX
  match_type CURRENT: ...
  match_type HISTORICAL: ...
  match_type HUNGARIAN: ...
  match_type GERMAN: ...
Errors: ...
Top localities by mentions:
  ...
```

## Performance

- Dicționar 13k + aliasuri construit o singură dată.
- Procesare streaming, scris incremental (nu încarcă tot corpusul în RAM).
- Batch insert 1000 rânduri, `ON CONFLICT DO NOTHING`.

## Etape următoare (nu în acest task)

- Clasificare AI: localitate → sit/punct → epocă → tip descoperire.
- Legare mențiuni → RAN (`archaeological_sites` deja sincronizat zilnic).
- Legare imagini/figuri/planuri (`knowledge.figures` există deja).

## Nu face în această etapă

- Nu trimite pagini la LLM.
- Nu modifica `knowledge.locality_aliases` automat.
- Nu duplica RAN.
