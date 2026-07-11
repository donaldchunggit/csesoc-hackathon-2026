"""Reference-library pipeline for a bill of materials.

Two jobs, both grounded in backend/data:
  1. match_library() — resolve each BOM row's component/material to a reference
     entry (repairability, failure risk, service life, recycling potential, ...).
  2. score_repairability() — turn those matches plus the BOM's own fastening /
     sourcing choices into a 0-100 longevity score, a grade, and *actionable*
     design fixes, using the deltas in scoring_rules.json.
"""

import csv
import json
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


# --- repairability / longevity scoring -------------------------------------
# The design-longevity engine. Unlike the material-swap engine (which optimises
# embodied carbon), this scores how *repairable and long-lived* a build is, using
# the transparent point deltas in backend/data/scoring_rules.json.

def load_scoring_rules() -> dict:
    """Load the heuristic scoring rules (backend/data/scoring_rules.json)."""
    with (DATA_DIR / "scoring_rules.json").open(encoding="utf-8-sig") as f:
        return json.load(f)


RULES = load_scoring_rules()


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _band_delta(value, bands: dict):
    """Look a numeric value up in a band map whose keys are 'lo-hi' / 'N+' ranges."""
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    for key, delta in bands.items():
        if key.endswith("+"):
            if v >= float(key[:-1]):
                return delta
        elif "-" in key:
            lo, hi = key.split("-")
            if float(lo) <= v <= float(hi):
                return delta
    return None


def _avg_life(component_ref, material_ref):
    """Average expected service life (yrs) — prefer the component, else material."""
    for ref, lo, hi in (
        (component_ref, "expected_service_life_years_min", "expected_service_life_years_max"),
        (material_ref, "estimated_life_years_min", "estimated_life_years_max"),
    ):
        if ref and ref.get(lo) and ref.get(hi):
            try:
                return (float(ref[lo]) + float(ref[hi])) / 2
            except (TypeError, ValueError):
                continue
    return None


def _best_option(rule_map: dict):
    """The highest-scoring choice in a scoring_rules map (e.g. best fastening)."""
    ranked = sorted(rule_map.items(), key=lambda kv: kv[1], reverse=True)
    return ranked[0]  # (name, delta)


def _factor(label, kind, delta, detail=""):
    return {"label": label, "kind": kind, "delta": delta, "detail": detail}


def _score_row(row: dict) -> dict:
    """Longevity score for one matched BOM row (base + transparent deltas)."""
    c = row.get("component_ref")
    m = row.get("material_ref")
    score = RULES["base_score"]
    factors, fixes = [], []

    def apply(label, kind, delta, detail=""):
        nonlocal score
        if delta is None:
            return
        score += delta
        factors.append(_factor(label, kind, delta, detail))

    # Material circularity & durability (from material_library).
    recycling = _norm(m.get("recycling_potential")) if m else "unknown"
    apply(f"{recycling or 'unknown'} recycling potential", "material",
          RULES["material_recycling_potential"].get(recycling, RULES["material_recycling_potential"]["unknown"]),
          m.get("material_name", "") if m else "")
    apply("material durability", "material",
          _band_delta(m.get("durability_score") if m else None, RULES["material_durability_score_to_delta"]),
          f"durability {m.get('durability_score')}/10" if m else "")

    # Component repair profile (from component_library).
    if c:
        apply(f"{_norm(c.get('typical_failure_risk'))} failure risk", "component",
              RULES["component_failure_risk"].get(_norm(c.get("typical_failure_risk"))),
              c.get("repairability_notes", ""))
        apply(f"{_norm(c.get('repair_importance'))} repair importance", "component",
              RULES["component_repair_importance"].get(_norm(c.get("repair_importance"))))

    # How the part is attached — the biggest repairability lever.
    fastening = _norm(row.get("fastening")) or "unknown"
    f_delta = RULES["fastening_type"].get(fastening, RULES["fastening_type"]["unknown"])
    apply(f"{fastening} fastening", "fastening", f_delta)
    best_fname, best_fdelta = _best_option(RULES["fastening_type"])
    if f_delta < best_fdelta - 1:
        pref = _norm(c.get("preferred_fastening")) if c else ""
        target = pref if pref and RULES["fastening_type"].get(pref, -99) >= best_fdelta - 3 else best_fname
        gain = RULES["fastening_type"].get(target, best_fdelta) - f_delta
        fixes.append({
            "component": row.get("component", ""),
            "action": f"Attach with {target} instead of {fastening}",
            "gain": round(gain),
            "kind": "fastening",
        })

    # Sourcing — proprietary / single-source parts are replacement traps.
    sourcing = _norm(row.get("sourcing")) or "unknown"
    s_delta = RULES["sourcing_type"].get(sourcing, RULES["sourcing_type"]["unknown"])
    apply(f"{sourcing} sourcing", "sourcing", s_delta)
    best_sname, best_sdelta = _best_option(RULES["sourcing_type"])
    if s_delta < best_sdelta - 1:
        fixes.append({
            "component": row.get("component", ""),
            "action": f"Source as {best_sname} rather than {sourcing}",
            "gain": round(best_sdelta - s_delta),
            "kind": "sourcing",
        })

    # Expected service life.
    apply("expected service life", "lifespan",
          _band_delta(_avg_life(c, m), RULES["lifespan_years_average_to_delta"]))

    # A recognised part with a specific design recommendation of its own.
    if c and c.get("suggested_alternative"):
        fixes.append({
            "component": row.get("component", ""),
            "action": c["suggested_alternative"],
            "gain": None,
            "kind": "design",
        })

    return {
        "component": row.get("component", ""),
        "score": max(0, min(100, round(score))),
        "factors": factors,
        "fixes": fixes,
    }


def _grade_for(score: float) -> dict:
    for band in RULES["grade_bands"]:
        if score >= band["min"]:
            return {"grade": band["grade"], "label": band["label"]}
    return {"grade": "F", "label": "High replacement risk"}


def score_repairability(rows: list[dict]) -> dict:
    """Score a BOM's design longevity/repairability from scoring_rules.json.

    `rows` should carry component/material plus optional 'fastening'/'sourcing'.
    Returns an overall 0-100 score + grade, per-line detail, and the top
    point-ranked design fixes across the whole BOM."""
    matched = match_library(rows)
    for r, src in zip(matched, rows):  # carry fastening/sourcing onto matched rows
        r["fastening"] = src.get("fastening", "")
        r["sourcing"] = src.get("sourcing", "")

    lines = [_score_row(r) for r in matched]
    overall = round(sum(l["score"] for l in lines) / len(lines)) if lines else RULES["base_score"]

    recs = [f for l in lines for f in l["fixes"] if f.get("gain")]
    recs.sort(key=lambda f: f["gain"], reverse=True)
    seen, top = set(), []
    for f in recs:
        key = (f["component"], f["kind"])
        if key in seen:
            continue
        seen.add(key)
        top.append(f)

    return {
        "score": overall,
        **_grade_for(overall),
        "lines": lines,
        "recommendations": top[:6],
    }
