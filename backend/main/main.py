"""Compares parsed BOM rows (from parse.parse_csv) against the reference CSVs
in backend/data (component_library.csv, material_library.csv), reporting whether
each component/material is a known entry and, when it is, the reference detail
(repairability, failure risk, service life, recycling potential, ...)."""

import csv
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def list_data_csvs() -> list[str]:
    """List CSV filenames available in the backend/data reference folder."""
    return sorted(p.name for p in DATA_DIR.glob("*.csv"))


def load_data_csv(filename: str) -> list[dict]:
    """Load a reference CSV from backend/data by filename."""
    with (DATA_DIR / filename).open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def _words(text: str) -> set[str]:
    """Lowercased whole-word token set, e.g. 'Plastic (ABS)' -> {'plastic', 'abs'}."""
    return {w for w in re.split(r"[^a-z0-9]+", (text or "").lower()) if w}


def _keys_for(entry: dict, name_field: str) -> list[str]:
    """The canonical name plus any '; '-separated aliases for a reference entry."""
    keys = [entry.get(name_field, "")]
    keys += entry.get("aliases", "").split(";")
    return [k.strip() for k in keys if k.strip()]


def _find_match(name: str, entries: list[dict], name_field: str) -> dict | None:
    """Best reference entry for a free-text BOM name. Matches on exact name/alias
    or whole-word containment either direction ('Rear casing' -> 'casing',
    'Lithium-ion' -> 'lithium-ion battery'), so messy real BOM labels still land."""
    want = _words(name)
    if not want:
        return None
    for entry in entries:
        for key in _keys_for(entry, name_field):
            kw = _words(key)
            if kw and (kw <= want or want <= kw):
                return entry
    return None


def match_library(parsed_rows: list[dict]) -> list[dict]:
    """For each BOM row, attach the matched component/material reference entry
    (or None) alongside known/unknown flags. Rows are expected to carry
    'component' and 'material' keys (see parse.parse_csv / the analyzer's lines)."""
    components = load_data_csv("component_library.csv")
    materials = load_data_csv("material_library.csv")

    results = []
    for row in parsed_rows:
        component_ref = _find_match(row.get("component", ""), components, "component_type")
        material_ref = _find_match(row.get("material", ""), materials, "material_name")
        results.append({
            **row,
            "component_known": component_ref is not None,
            "component_ref": component_ref,
            "material_known": material_ref is not None,
            "material_ref": material_ref,
        })
    return results


def compare_with_library(parsed_rows: list[dict]) -> list[dict]:
    """Match each parsed BOM row's component/material against the reference CSVs,
    flagging whether each is a known entry (bool-only view of match_library)."""
    return [
        {**{k: v for k, v in r.items() if k not in ("component_ref", "material_ref")}}
        for r in match_library(parsed_rows)
    ]


def library_summary(matched: list[dict]) -> dict:
    """Roll-up of how much of a BOM the reference library recognises."""
    total = len(matched)
    return {
        "total": total,
        "componentsKnown": sum(1 for m in matched if m["component_known"]),
        "materialsKnown": sum(1 for m in matched if m["material_known"]),
    }
