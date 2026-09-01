# -*- coding: utf-8 -*-
"""
build_battles_db.py — reproducibil
===================================
Construiește baza de date bilingvă (RO + EN) pentru stratul premium
"Bătălii / Battles" din DetectLab.

Intrări:
  • data/conflicte_militare/conflicte_militare_romania.json  (baza RO, 166 evenimente)
  • scripts_conflicts/conflicts_en_part1.py … conflicts_en_part7.py
    (module cu traduceri în engleză pentru câmpurile descriptive)

Ieșire:
  • data/conflicte_militare/conflicte_militare_romania.bilingual.json
    — listă de evenimente cu câmpuri comune (id, an_start, an_end, secol_n,
      lat, lng, zona_aprox, teritoriu) și blocuri `ro` / `en` cu câmpurile
      textuale (titlu, tip, locatie, regiune, participanti, descriere, rezultat).

Folosire:
  python3 scripts_conflicts/build_battles_db.py

Validare: scriptul verifică că fiecare eveniment RO are traducere EN completă
și inversează; dacă lipsește ceva, iese cu eroare și cod ≠ 0.
"""

import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RO_JSON = os.path.join(REPO_ROOT, "data", "conflicte_militare", "conflicte_militare_romania.json")
OUT_JSON = os.path.join(REPO_ROOT, "data", "conflicte_militare", "conflicte_militare_romania.bilingual.json")
SCRIPTS_DIR = os.path.join(REPO_ROOT, "scripts_conflicts")

TEXT_FIELDS = ["titlu", "tip", "locatie", "regiune", "participanti", "descriere", "rezultat"]
COMMON_FIELDS = ["id", "data_start", "data_end", "an_start", "an_end", "secol_n", "lat", "lng", "zona_aprox", "teritoriu"]


def load_en_modules():
    """Importă toate modulele conflicts_en_partN.py din scripts_conflicts."""
    sys.path.insert(0, SCRIPTS_DIR)
    en = {}
    for fname in sorted(os.listdir(SCRIPTS_DIR)):
        if not fname.startswith("conflicts_en_part") or not fname.endswith(".py"):
            continue
        mod_name = fname[:-3]
        mod = __import__(mod_name)
        attr = "CONFLICTS_EN_" + mod_name.split("_en_part")[1]
        data = getattr(mod, attr)
        en.update(data)
    return en


def main():
    with open(RO_JSON, encoding="utf-8") as f:
        ro_db = json.load(f)

    ro_events = ro_db["conflicte"]
    en_map = load_en_modules()

    # ── Validare completă (în ambele direcții) ──
    ro_ids = {c["id"] for c in ro_events}
    en_ids = set(en_map.keys())
    missing_en = sorted(ro_ids - en_ids)
    extra_en = sorted(en_ids - ro_ids)
    problems = []
    if missing_en:
        problems.append("Lipsesc traduceri EN pentru: " + ", ".join(missing_en))
    if extra_en:
        problems.append("Traduceri EN fără corespondent RO: " + ", ".join(extra_en))

    for c in ro_events:
        en = en_map.get(c["id"])
        if en is None:
            continue
        for field in TEXT_FIELDS:
            if not en.get(field):
                problems.append("%s: câmp EN lipsă '%s'" % (c["id"], field))

    if problems:
        print("EROARE la validarea bazei bilingve:")
        for p in problems:
            print("  •", p)
        sys.exit(1)

    # ── Construcție fișier bilingv ──
    out_conflicts = []
    for c in ro_events:
        en = en_map[c["id"]]
        out_conflicts.append({
            **{k: c[k] for k in COMMON_FIELDS},
            "ro": {k: c[k] for k in TEXT_FIELDS},
            "en": {k: en[k] for k in TEXT_FIELDS},
        })

    out_db = {
        "meta": {
            "titlu": "Baza de date bilingvă a conflictelor militare de pe teritoriul României",
            "descriere": "Conflicte militare de pe teritoriul actual al României, sec. VIII î.Hr. – 1944 (RO + EN)",
            "sursa_principala": "batalii.csv + completări din istoriografia consacrată",
            "generat": "2026-09-01",
            "numar_inregistrari": len(out_conflicts),
            "structura": "câmpuri comune + blocuri `ro` și `en` cu câmpurile textuale",
        },
        "conflicte": out_conflicts,
    }

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out_db, f, ensure_ascii=False, indent=1)

    print("OK — %d evenimente bilingve scrise în %s" % (len(out_conflicts), os.path.relpath(OUT_JSON, REPO_ROOT)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
