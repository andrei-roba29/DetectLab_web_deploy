#!/usr/bin/env python3
"""
process_archaeological_corpus.py

Pipeline:
  JSONL (extracted/*)  →  locality matching  →  candidate mentions  →  locality_mentions.jsonl + Supabase

Usage:
  python process_archaeological_corpus.py --input D:\\Babel\\extracted --output locality_mentions.jsonl
  python process_archaeological_corpus.py --input ./extracted --output ./locality_mentions.jsonl --dictionary ./dictionary.json
  python process_archaeological_corpus.py --input ./extracted --output ./locality_mentions.jsonl --dry-run   # no DB insert

Dictionary source resolution (first that succeeds):
  1. --dictionary JSON file  (array of {locality_id, siruta_code, name, normalized_name, county, county_code, aliases: [...]})
  2. DATABASE_URL (PostgreSQL) → knowledge.localities + knowledge.locality_aliases
  3. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (REST)
  4. Fallback: empty -> warning

Matching:
  - Uses knowledge.localities.name / normalized_name + locality_aliases
  - Normalization: NFD strip diacritics, lower, ș/ț handling, hyphen/dash/underscore → space, punctuation → space, collapse whitespace
  - Keeps original matched_text, stores normalized_match
  - Aho-Corasick trie for O(n) per page, word-boundary aware, longest-match wins per position
  - Context: ~700 chars before/after, extended to sentence boundaries, total 500-1500 chars

No AI calls.
No RAN duplication.
No automatic alias creation.
"""
import argparse
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import List, Dict, Tuple, Optional

# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def normalize_str(s: str) -> str:
    """Normalize for dictionary building: same as matching normalization but without position map."""
    if not s:
        return ""
    s = str(s).lower()
    # NFD strip
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("ș", "s").replace("ş", "s").replace("ț", "t").replace("ţ", "t")
    # Dashes / underscores / dots inside names → space
    s = re.sub(r"[\-\u2013\u2014\u2015_·\.]+", " ", s)
    # Punctuation → space, keep only alphanumerics + space
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def normalize_with_map(text: str):
    """
    Normalize text char-by-char and build mapping from normalized index → original index.
    Returns (normalized_text, orig_indices)
    where orig_indices[i] = original string index that produced normalized char i
    """
    norm_chars = []
    orig_indices = []  # parallel to norm_chars
    # We build a raw normalized stream then collapse spaces in a second pass
    # Keep per-char mapping for the raw stage
    for idx, ch in enumerate(text):
        lower = ch.lower()
        # NFD strip: may produce multiple chars
        decomposed = unicodedata.normalize("NFD", lower)
        stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
        # handle ș/ț leftover variants
        stripped = stripped.replace("ș", "s").replace("ş", "s").replace("ț", "t").replace("ţ", "t")
        for c in stripped:
            if c in "-\u2013\u2014\u2015_·.":  # dash-like → space
                norm_chars.append(" ")
                orig_indices.append(idx)
            elif c.isalnum() or c == " ":
                # keep alnum and space, other punctuation → space
                norm_chars.append(c)
                orig_indices.append(idx)
            elif c in " \t\n\r":
                norm_chars.append(" ")
                orig_indices.append(idx)
            else:
                # punctuation → space (single)
                norm_chars.append(" ")
                orig_indices.append(idx)
    raw = "".join(norm_chars)
    # Collapse whitespace to single space, trimming, while preserving mapping approx.
    # We need to produce final norm + map to original start index of each kept char.
    collapsed = []
    collapsed_map = []
    prev_space = True  # to trim leading
    for c, oi in zip(raw, orig_indices):
        if c == " ":
            if prev_space:
                continue
            collapsed.append(" ")
            collapsed_map.append(oi)
            prev_space = True
        else:
            collapsed.append(c)
            collapsed_map.append(oi)
            prev_space = False
    # Trim trailing space
    if collapsed and collapsed[-1] == " ":
        collapsed.pop()
        collapsed_map.pop()
    return "".join(collapsed), collapsed_map


# ---------------------------------------------------------------------------
# Source type inference
# ---------------------------------------------------------------------------

def infer_source_type(document_name: str) -> str:
    n = document_name.lower()
    if "cca" in n or "cronica" in n:
        return "CCA"
    if "repert" in n:
        return "REPERTORY"
    return "OTHER_ARCHAEOLOGICAL_SOURCE"

# ---------------------------------------------------------------------------
# Aho-Corasick
# ---------------------------------------------------------------------------

class ACNode:
    __slots__ = ("children", "fail", "outputs")
    def __init__(self):
        self.children: Dict[str, "ACNode"] = {}
        self.fail: Optional["ACNode"] = None
        self.outputs: List[Tuple[str, List[Dict]]] = []  # (pattern, entries)

class AhoCorasick:
    def __init__(self):
        self.root = ACNode()
        self.built = False

    def add(self, pattern: str, entries: List[Dict]):
        node = self.root
        for ch in pattern:
            if ch not in node.children:
                node.children[ch] = ACNode()
            node = node.children[ch]
        node.outputs.append((pattern, entries))

    def build(self):
        q = deque()
        for child in self.root.children.values():
            child.fail = self.root
            q.append(child)
        while q:
            cur = q.popleft()
            for ch, nxt in cur.children.items():
                q.append(nxt)
                f = cur.fail
                while f and ch not in f.children:
                    f = f.fail
                nxt.fail = f.children[ch] if f and ch in f.children else self.root
                nxt.outputs.extend(nxt.fail.outputs)
        self.built = True

    def search(self, text: str):
        """Yield (end_index, pattern, entries)"""
        node = self.root
        for i, ch in enumerate(text):
            while node is not self.root and ch not in node.children:
                node = node.fail
            if ch in node.children:
                node = node.children[ch]
            else:
                node = self.root
            for pattern, entries in node.outputs:
                yield (i, pattern, entries)

# ---------------------------------------------------------------------------
# Dictionary loading
# ---------------------------------------------------------------------------

def load_dictionary_from_db(database_url: str):
    """Try psycopg2, else pg8000, else warn."""
    try:
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(database_url)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id, siruta_code, name, normalized_name, county, county_code FROM knowledge.localities")
        localities = cur.fetchall()
        cur.execute("SELECT locality_id, alias, normalized_alias, alias_type, language FROM knowledge.locality_aliases")
        aliases = cur.fetchall()
        cur.close()
        conn.close()
        return localities, aliases
    except Exception as e:
        print(f"[warn] psycopg2 load failed: {e}", file=sys.stderr)
    # try pg8000 or async?
    return None

def load_dictionary_from_supabase_rest(supabase_url: str, service_key: str):
    try:
        import urllib.request
        import urllib.parse
        headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
        def fetch(table, select="*"):
            url = f"{supabase_url.rstrip('/')}/rest/v1/{table}?select={urllib.parse.quote(select)}"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
                return data
        localities = fetch("localities", "id,siruta_code,name,normalized_name,county,county_code")
        # aliases table might be locality_aliases
        aliases = fetch("locality_aliases", "locality_id,alias,normalized_alias,alias_type,language")
        return localities, aliases
    except Exception as e:
        print(f"[warn] Supabase REST load failed: {e}", file=sys.stderr)
        return None

def build_match_entries(localities, aliases):
    """
    Returns dict normalized_form -> list of {locality_id, siruta_code, locality_name, county, match_type, alias, normalized}
    """
    mp: Dict[str, List[Dict]] = defaultdict(list)
    locality_by_id = {}
    for loc in localities:
        lid = loc["id"]
        locality_by_id[lid] = loc
        for field, mtype in [("name", "CURRENT"), ("normalized_name", "CURRENT")]:
            val = loc.get(field)
            if not val:
                continue
            norm = normalize_str(val)
            if not norm or len(norm) < 2:
                continue
            # avoid duplicate entry for same lid+norm
            entry = {
                "locality_id": lid,
                "siruta_code": loc.get("siruta_code"),
                "locality_name": loc.get("name"),
                "county": loc.get("county"),
                "county_code": loc.get("county_code"),
                "matched_alias": val,
                "normalized": norm,
                "match_type": mtype,
            }
            # dedup
            if not any(e["locality_id"] == lid and e["match_type"] == mtype for e in mp[norm]):
                mp[norm].append(entry)
    for a in aliases:
        lid = a.get("locality_id")
        loc = locality_by_id.get(lid, {})
        alias = a.get("alias") or a.get("normalized_alias")
        norm = a.get("normalized_alias") or normalize_str(alias)
        norm = normalize_str(norm)
        if not norm or len(norm) < 2:
            continue
        mtype = (a.get("alias_type") or "VARIANT").upper()
        entry = {
            "locality_id": lid,
            "siruta_code": loc.get("siruta_code"),
            "locality_name": loc.get("name"),
            "county": loc.get("county"),
            "county_code": loc.get("county_code"),
            "matched_alias": alias,
            "normalized": norm,
            "match_type": mtype,
        }
        if not any(e["locality_id"] == lid and e["normalized"] == norm for e in mp[norm]):
            mp[norm].append(entry)
    return mp

def load_dictionary(args):
    # 1) explicit file
    if args.dictionary:
        p = Path(args.dictionary)
        if p.exists():
            data = json.loads(p.read_text(encoding="utf-8"))
            # allow two shapes: {"localities": [...], "aliases": [...]} or flat list
            if isinstance(data, dict) and "localities" in data:
                return build_match_entries(data["localities"], data.get("aliases", []))
            elif isinstance(data, list):
                # list of localities with aliases embedded
                localities = data
                aliases = []
                for loc in localities:
                    for al in loc.get("aliases", []):
                        aliases.append({"locality_id": loc["id"], "alias": al.get("alias"), "normalized_alias": al.get("normalized_alias"), "alias_type": al.get("alias_type")})
                return build_match_entries(localities, aliases)
            else:
                # assume already map
                return data
    # 2) DATABASE_URL
    db_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
    if db_url:
        res = load_dictionary_from_db(db_url)
        if res:
            locs, als = res
            print(f"[info] Loaded {len(locs)} localities, {len(als)} aliases from DATABASE_URL")
            return build_match_entries(locs, als)
    # 3) SUPABASE_URL + key
    supa_url = os.getenv("SUPABASE_URL")
    supa_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if supa_url and supa_key:
        res = load_dictionary_from_supabase_rest(supa_url, supa_key)
        if res:
            locs, als = res
            print(f"[info] Loaded {len(locs)} localities, {len(als)} aliases from Supabase REST")
            return build_match_entries(locs, als)
    # 4) Try to load from backend test fixture / embedded sample
    print("[warn] No dictionary source found. Use --dictionary or set DATABASE_URL / SUPABASE_URL.", file=sys.stderr)
    print("[warn] Proceeding with empty dictionary – output will be empty.", file=sys.stderr)
    return {}

# ---------------------------------------------------------------------------
# Context extraction
# ---------------------------------------------------------------------------

def extract_context(original_text: str, orig_start: int, orig_end: int, window=700):
    """Extract sentence-aware context. orig_start/end are indices in original_text."""
    # Expand window
    before_start = max(0, orig_start - window)
    after_end = min(len(original_text), orig_end + window)
    snippet = original_text[before_start:after_end]

    # Try to extend to sentence boundaries within expanded window
    # Find nearest sentence break before and after
    # Sentence delimiters: . ! ? \n
    left = snippet
    right = snippet

    # For context_before / context / context_after split
    # context is the sentence containing the match (or ~200 chars around)
    # Find sentence start: last occurrence of .!? + space or newline before match offset in snippet
    match_offset_in_snippet = orig_start - before_start
    match_end_in_snippet = orig_end - before_start

    # Sentence start
    delimiters = re.compile(r"[.!?\n]+")
    # Search backwards for delimiter
    pre = snippet[:match_offset_in_snippet]
    # find last delimiter
    last_delims = list(delimiters.finditer(pre))
    if last_delims:
        sent_start_idx = last_delims[-1].end()
        # skip leading spaces
        while sent_start_idx < len(snippet) and snippet[sent_start_idx] == " ":
            sent_start_idx += 1
    else:
        sent_start_idx = 0

    post = snippet[match_end_in_snippet:]
    m = delimiters.search(post)
    if m:
        sent_end_idx = match_end_in_snippet + m.end()
    else:
        sent_end_idx = len(snippet)

    sentence = snippet[sent_start_idx:sent_end_idx].strip()
    # If sentence is too short (<80) expand to window
    if len(sentence) < 80:
        sentence = snippet.strip()

    # Clamp to 500-1500 total
    if len(sentence) > 1500:
        # center around match
        # take 1500 window centered
        center = (match_offset_in_snippet + match_end_in_snippet)//2
        half = 750
        s = max(0, center - half)
        e = min(len(snippet), center + half)
        sentence = snippet[s:e].strip()

    # Also produce before/after
    context_before = snippet[max(0, sent_start_idx - 300):sent_start_idx].strip()[-500:]
    context_after = snippet[sent_end_idx:sent_end_idx+300].strip()[:500]

    # The main context field: sentence (or expanded snippet) – this is what AI will use
    # Ensure not exceeding 2000 for DB column but spec says 500-1500
    context = sentence[:2000]

    return context, context_before[:1000], context_after[:1000]

# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def create_automaton(match_map: Dict[str, List[Dict]]) -> AhoCorasick:
    ac = AhoCorasick()
    # Sort patterns by length descending for longest-first insertion not needed but helps debugging
    for norm, entries in sorted(match_map.items(), key=lambda x: -len(x[0])):
        # Skip very short patterns (<3) that cause noise, except allow but with boundary check
        if len(norm) < 3:
            continue
        # Skip patterns that are common romanian words? We keep all locality names even if short.
        ac.add(norm, entries)
    ac.build()
    return ac

def process_page(doc_name: str, page: int, text: str, ac: AhoCorasick):
    if not text or not ac:
        return []
    norm_text, norm_map = normalize_with_map(text)
    if not norm_text:
        return []
    results = []
    # Collect raw matches from AC, with boundary check
    # We want longest match at each position – filter overlapping
    raw_matches = []
    for end_idx, pattern, entries in ac.search(norm_text):
        start_idx = end_idx - len(pattern) + 1
        # Boundary check: char before/after must be space or start/end
        before_ok = start_idx == 0 or norm_text[start_idx - 1] == " "
        after_ok = end_idx == len(norm_text) - 1 or norm_text[end_idx + 1] == " "
        if not (before_ok and after_ok):
            continue
        raw_matches.append((start_idx, end_idx, pattern, entries))

    if not raw_matches:
        return []

    # Resolve overlapping: prefer longest pattern; sort by start then -length
    raw_matches.sort(key=lambda x: (x[0], -(x[1]-x[0])))
    filtered = []
    last_end = -2
    for s, e, pat, entries in raw_matches:
        if s <= last_end:
            # overlap with previous kept (which is longer due to sort) – skip
            continue
        filtered.append((s, e, pat, entries))
        last_end = e

    for s, e, pat, entries in filtered:
        # Map back to original text indices
        # norm_map[s] is orig index of first char, norm_map[e] is orig index of last char
        # Need to find original substring precisely: orig_start = norm_map[s]
        # orig_end: find extent of last normalized char in original (could be 1 char) +1
        orig_start = norm_map[s]
        orig_end_char_idx = norm_map[e]
        # Extend orig_end to include full original token: find next space/punct boundary in original?
        # We take original slice from orig_start to orig_start+len that covers pattern,
        # but better to search original text for the matched alias approx.
        # Simplest: slice original_text[orig_start:orig_end_char_idx+1] may be truncated if pattern has spaces
        # Instead, we can estimate: find original substring by searching around orig_start with regex
        # For now, derive orig_end by scanning forward until we have consumed pattern tokens
        # Heuristic: take a window of len(pattern)+10 and find best alignment
        # Approach: expand orig_end to cover the whole words that mapped to the normalized span
        # We walk forward in original text until we have covered e-s+1 normalized chars? We already have mapping, so orig_end = orig_end_char_idx+1 is inclusive end
        # But if normalized collapsed spaces, the mapping of spaces is approximate.
        # We'll expand orig_end to include trailing alnum chars of the last word
        orig_end = orig_end_char_idx + 1
        # Extend to word boundary in original (include trailing letters of last word if truncated)
        while orig_end < len(text) and text[orig_end].isalnum():
            # Actually this would extend too far; only if norm_map didn't account for extra diacritic chars
            # Safer: keep as is, but expand to include full word at boundaries
            break
        # Extract matched_text from original: take text[orig_start:orig_end] then normalize compare
        # To get accurate original casing/diacritics, we take a slightly larger window and search
        # Find word boundaries in original around orig_start/orig_end
        # Expand to include full words that correspond to pattern word count
        pattern_word_count = pat.count(" ") + 1
        # Expand orig_start left to start of word
        while orig_start > 0 and text[orig_start - 1].isalnum():
            orig_start -= 1
        # Expand orig_end right to end of word
        while orig_end < len(text) and text[orig_end].isalnum():
            orig_end += 1
        # If pattern has multiple words, we need to include spaces/hyphens between
        # Walk and count words roughly – extend until we have pattern_word_count words
        # Count words in current slice
        slice_candidate = text[orig_start:orig_end]
        # If not enough words (due to hyphen), expand further
        words_in_slice = len(re.findall(r"\w+", slice_candidate))
        expand_end = orig_end
        while words_in_slice < pattern_word_count and expand_end < len(text):
            # include next word (skip non-alnum)
            while expand_end < len(text) and not text[expand_end].isalnum():
                expand_end += 1
            start_w = expand_end
            while expand_end < len(text) and text[expand_end].isalnum():
                expand_end += 1
            if start_w < expand_end:
                words_in_slice += 1
                orig_end = expand_end
            else:
                break
        matched_text = text[orig_start:orig_end].strip(" \t\n\r.,;:\"'()[]")
        # Fallback if matched_text normalized != pat, try to refine by searching normalized slice
        if normalize_str(matched_text) != pat:
            # try to adjust: search for pattern words in slice
            # keep as is but log; still emit
            pass
        # Dedup identical matched_text per page/pattern? we keep one per (locality_id) so expand later
        context, ctx_before, ctx_after = extract_context(text, orig_start, orig_end)
        for entry in entries:
            results.append({
                "document": doc_name,
                "document_name": doc_name,
                "page": page,
                "locality_id": entry["locality_id"],
                "siruta_code": entry["siruta_code"],
                "locality": entry["locality_name"],
                "locality_name": entry["locality_name"],
                "county": entry["county"],
                "county_code": entry["county_code"],
                "matched_text": matched_text,
                "normalized_match": pat,
                "match_type": entry["match_type"],
                "source_type": infer_source_type(doc_name),
                "context": context,
                "context_before": ctx_before,
                "context_after": ctx_after,
                "match_confidence": 1.0,
            })
    # Deduplicate identical (document, page, locality_id, matched_text) – keep first
    seen = set()
    deduped = []
    for r in results:
        key = (r["document_name"], r["page"], r["locality_id"], r["matched_text"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    return deduped

def iter_jsonl_files(input_dir: Path):
    for p in sorted(input_dir.rglob("*.jsonl")):
        yield p
    for p in sorted(input_dir.rglob("*.json")):  # also allow .json with jsonl inside
        if p.suffix == ".jsonl":
            continue
        yield p

def process_corpus(input_dir: Path, output_path: Path, match_map: Dict, ac: AhoCorasick, args):
    stats = Counter()
    stats["documents"] = 0
    seen_docs = set()
    total_mentions = 0
    per_locality = Counter()
    per_match_type = Counter()

    # For DB insert batching
    batch = []
    batch_size = 1000

    # DB connection if needed
    db_conn = None
    if not args.dry_run and not args.no_db:
        db_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
        if db_url:
            try:
                import psycopg2
                import psycopg2.extras
                db_conn = psycopg2.connect(db_url)
                db_conn.autocommit = False
            except Exception as e:
                print(f"[warn] DB connect failed, running in dry-run mode: {e}", file=sys.stderr)
                db_conn = None

    def flush_batch():
        nonlocal batch
        if not batch or not db_conn:
            return
        try:
            cur = db_conn.cursor()
            # Use INSERT ... ON CONFLICT DO NOTHING
            from psycopg2.extras import execute_values
            execute_values(cur, """
                INSERT INTO knowledge.archaeological_locality_mentions
                (document_name, page, locality_id, siruta_code, locality_name, county, matched_text, normalized_match, match_type, source_type, context, context_before, context_after, match_confidence)
                VALUES %s
                ON CONFLICT (document_name, page, locality_id, matched_text) DO NOTHING
            """, [
                (r["document_name"], r["page"], r["locality_id"], r["siruta_code"], r["locality_name"], r["county"], r["matched_text"], r["normalized_match"], r["match_type"], r["source_type"], r["context"], r["context_before"], r["context_after"], r["match_confidence"])
                for r in batch
            ])
            db_conn.commit()
            print(f"[info] Flushed {len(batch)} mentions to DB")
        except Exception as e:
            print(f"[error] DB flush failed: {e}", file=sys.stderr)
            try:
                db_conn.rollback()
            except: pass
        batch = []

    out_f = open(output_path, "w", encoding="utf-8")

    files = list(iter_jsonl_files(input_dir))
    if not files:
        print(f"[warn] No .jsonl files found in {input_dir}", file=sys.stderr)
    for fp in files:
        try:
            with open(fp, "r", encoding="utf-8") as f:
                for line_no, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except:
                        stats["errors"] += 1
                        continue
                    doc = obj.get("document") or obj.get("document_name") or fp.name
                    page = obj.get("page")
                    text = obj.get("text") or obj.get("content") or ""
                    if page is None:
                        page = 0
                    try:
                        page = int(page)
                    except:
                        page = 0
                    if not text:
                        continue
                    stats["pages_processed"] += 1
                    seen_docs.add(doc)
                    mentions = process_page(doc, page, text, ac)
                    if mentions:
                        stats["pages_with_matches"] += 1
                    else:
                        stats["unmatched_pages"] += 1
                    for m in mentions:
                        out_f.write(json.dumps(m, ensure_ascii=False) + "\n")
                        total_mentions += 1
                        per_locality[(m["locality"], m["county"])] += 1
                        per_match_type[m["match_type"]] += 1
                        if db_conn:
                            batch.append(m)
                            if len(batch) >= batch_size:
                                flush_batch()
                    if stats["pages_processed"] % 500 == 0:
                        print(f"[progress] pages={stats['pages_processed']} mentions={total_mentions} docs={len(seen_docs)}")
        except Exception as e:
            print(f"[error] file {fp}: {e}", file=sys.stderr)
            stats["errors"] += 1

    if db_conn and batch:
        flush_batch()
    out_f.close()
    if db_conn:
        try: db_conn.close()
        except: pass

    stats["documents_processed"] = len(seen_docs)
    stats["locality_mentions"] = total_mentions
    stats["unique_localities_matched"] = len(per_locality)
    for k, v in per_match_type.items():
        stats[f"match_type_{k}"] = v

    print("\n" + "="*60)
    print("STATISTICI FINALE")
    print("="*60)
    print(f"Documents processed:       {stats['documents_processed']}")
    print(f"Pages processed:           {stats['pages_processed']}")
    print(f"Pages with matches:        {stats['pages_with_matches']}")
    print(f"Unmatched pages:           {stats['unmatched_pages']}")
    print(f"Locality mentions:         {stats['locality_mentions']}")
    print(f"Unique localities matched: {stats['unique_localities_matched']}")
    for k, v in sorted(per_match_type.items()):
        print(f"  match_type {k}: {v}")
    print(f"Errors:                    {stats['errors']}")
    print("\nTop localities by mentions:")
    for (loc, county), cnt in per_locality.most_common(20):
        print(f"  {loc} ({county}): {cnt}")
    print("="*60)
    print(f"Output: {output_path}")
    return stats


def main():
    ap = argparse.ArgumentParser(description="DetectLab archaeological corpus locality matcher")
    ap.add_argument("--input", required=True, help="Director cu .jsonl extrase (D:\\Babel\\extracted)")
    ap.add_argument("--output", default="locality_mentions.jsonl", help="Fisier output JSONL")
    ap.add_argument("--dictionary", default=None, help="JSON cu localities+aliases (optional)")
    ap.add_argument("--dry-run", action="store_true", help="Nu scrie in Supabase, doar JSONL local")
    ap.add_argument("--no-db", action="store_true", help="Alias pentru dry-run")
    ap.add_argument("--min-length", type=int, default=3, help="Lungime minima pattern")
    args = ap.parse_args()

    input_dir = Path(args.input)
    if not input_dir.exists():
        print(f"[error] Input dir not found: {input_dir}", file=sys.stderr)
        sys.exit(1)
    output_path = Path(args.output)

    print(f"[info] Loading dictionary...")
    match_map = load_dictionary(args)
    if not match_map:
        print("[error] Dictionary empty – cannot match. Provide --dictionary or DATABASE_URL.", file=sys.stderr)
        # Still allow to run to produce empty output for testing?
    print(f"[info] Dictionary patterns: {len(match_map)} (distinct normalized forms)")
    total_entries = sum(len(v) for v in match_map.values())
    print(f"[info] Total locality entries: {total_entries}")

    # Quick sanity check on requested localities
    checks = ["Cluj-Napoca", "Apahida", "Dej", "Sibiu", "Alba Iulia", "Botosani"]
    for ch in checks:
        n = normalize_str(ch)
        if n in match_map:
            print(f"[check] {ch} -> '{n}' : FOUND ({len(match_map[n])} loc(s))")
        else:
            print(f"[check] {ch} -> '{n}' : NOT FOUND")

    print("[info] Building Aho-Corasick automaton...")
    ac = create_automaton(match_map)
    print("[info] Automaton built.")

    print(f"[info] Processing corpus: {input_dir} -> {output_path}")
    process_corpus(input_dir, output_path, match_map, ac, args)

if __name__ == "__main__":
    main()
