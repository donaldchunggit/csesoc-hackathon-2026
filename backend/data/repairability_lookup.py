"""GTIN → repairability lookup over the French durability/repairability index.

Consumer "scan a product" mode (the free Yuka-style wedge) needs a VERIFIED
repairability score keyed by barcode. France publishes the *indice de
réparabilité* (and its successor, the *indice de durabilité*) as consolidated
CSVs on data.gouv.fr, scored 0–10 per product model. This module:

  1. loads those CSV(s) from backend/data/raw/,
  2. keeps only rows whose identifier is a barcode
     (``referentiel_id_modele == 'GTIN_EAN'``),
  3. indexes them by normalised GTIN,
  4. normalises the 0–10 ``note_ir`` to a 0–100 score with a 4-band verdict, and
  5. exposes ``lookup_by_gtin(gtin) -> RepairabilityResult | None``.

Provenance matters: every score this module returns is tagged
``source="verified_fr_index"`` so the UI can badge it "Verified" — never mixed
up with an AI estimate.

NOTE ON THE SCHEMA: the column names below (``COLS`` / ``CRITERIA_COLUMNS``) are a
faithful stand-in for the real data.gouv.fr headers so the parser, fixture and
tests are all self-consistent today. When the official CSVs are dropped into
backend/data/raw/, reconcile ONLY these constants with the real header row — no
other code should need to change.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

RAW_DIR = Path(__file__).resolve().parent / "raw"

# The identifier-type discriminator and the value that means "this row is keyed
# by a barcode" (vs a manufacturer's internal model ref).
ID_TYPE_COL = "referentiel_id_modele"
ID_TYPE_GTIN = "GTIN_EAN"

# Column names in the consolidated CSV (see SCHEMA note above).
COLS = {
    "gtin": "id_modele",            # the actual barcode value
    "product_name": "nom_modele",
    "brand": "marque",
    "category": "categorie_produit",
    "note_ir": "note_ir",           # repairability index, 0–10
    "note_id": "note_id",           # durability index, 0–10 (newer categories); optional
}

# Per-criterion sub-scores (each 0–10) → the human label surfaced in the UI.
CRITERIA_COLUMNS = {
    "note_c1_documentation": "Documentation",
    "note_c2_demontabilite": "Disassembly & access",
    "note_c3_disponibilite_pieces": "Spare-parts availability",
    "note_c4_prix_pieces": "Spare-parts price",
    "note_c5_critere_specifique": "Category-specific",
}

# 4-band verdict over the 0–100 scale. Shared with the carbon side so a "Good"
# means the same thing on both grades.
BANDS = (
    (75, "Excellent"),
    (50, "Good"),
    (25, "Poor"),
    (0, "Bad"),
)


def band_for(score_0_100: float) -> str:
    """Map a 0–100 score to Bad / Poor / Good / Excellent."""
    for floor, label in BANDS:
        if score_0_100 >= floor:
            return label
    return "Bad"


@dataclass
class RepairabilityResult:
    """A verified repairability score for one product, keyed by barcode.

    ``brand`` and ``category`` are beyond the shape in the spec but come free from
    the same row — the call-out-brand feature (Phase 6) needs the brand and the
    carbon estimator (Phase 3) uses the category, so we carry them here rather
    than re-derive them downstream.
    """

    gtin: str
    product_name: str
    score_0_100: int
    band: str
    source: str = "verified_fr_index"
    criteria_breakdown: dict = field(default_factory=dict)
    raw_note_ir: float = 0.0
    brand: str | None = None
    category: str | None = None


def normalize_gtin(raw: str) -> str:
    """Reduce a barcode to comparable digits (drop spaces, dashes, decimals).

    Spreadsheet exports love to render an EAN as ``3.760…E+12`` or
    ``'0012345678905`` — we keep only digits so lookups are robust. Leading zeros
    are preserved because we never int-cast."""
    return "".join(ch for ch in (raw or "") if ch.isdigit())


def _num(raw: str) -> float | None:
    """Parse a French-or-English decimal (``'7,5'`` or ``'7.5'``) to float, or None."""
    if raw is None:
        return None
    s = raw.strip().replace(",", ".")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _score_from_row(row: dict) -> tuple[float, float] | None:
    """(raw_0_10, score_0_100) from a row, preferring the repairability index and
    falling back to the durability index. None if neither is present/parseable."""
    raw = _num(row.get(COLS["note_ir"]))
    if raw is None:
        raw = _num(row.get(COLS["note_id"]))
    if raw is None:
        return None
    raw = max(0.0, min(10.0, raw))
    return raw, round(raw * 10)


def _result_from_row(row: dict) -> RepairabilityResult | None:
    """Build a RepairabilityResult from one GTIN-keyed CSV row, or None if the
    row has no usable barcode / score."""
    gtin = normalize_gtin(row.get(COLS["gtin"], ""))
    scored = _score_from_row(row)
    if not gtin or scored is None:
        return None
    raw_note, score_0_100 = scored

    breakdown = {}
    for col, label in CRITERIA_COLUMNS.items():
        v = _num(row.get(col))
        if v is not None:
            breakdown[label] = round(max(0.0, min(10.0, v)) * 10)

    return RepairabilityResult(
        gtin=gtin,
        product_name=(row.get(COLS["product_name"]) or "").strip() or "Unknown product",
        score_0_100=int(score_0_100),
        band=band_for(score_0_100),
        criteria_breakdown=breakdown,
        raw_note_ir=raw_note,
        brand=(row.get(COLS["brand"]) or "").strip() or None,
        category=(row.get(COLS["category"]) or "").strip() or None,
    )


def build_index(paths: Iterable[Path]) -> dict[str, RepairabilityResult]:
    """Index GTIN → result across the given consolidated CSV files.

    Only rows whose ``referentiel_id_modele`` is ``GTIN_EAN`` are kept. When the
    same barcode appears more than once, the higher score wins (models get
    re-scored; we surface the best published figure)."""
    index: dict[str, RepairabilityResult] = {}
    for path in paths:
        with Path(path).open(newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if (row.get(ID_TYPE_COL) or "").strip() != ID_TYPE_GTIN:
                    continue
                res = _result_from_row(row)
                if res is None:
                    continue
                prior = index.get(res.gtin)
                if prior is None or res.score_0_100 > prior.score_0_100:
                    index[res.gtin] = res
    return index


_INDEX: dict[str, RepairabilityResult] | None = None


def get_index(force_reload: bool = False) -> dict[str, RepairabilityResult]:
    """Lazily build (and cache) the index from every CSV in backend/data/raw/.

    Returns an empty index if the folder is missing or has no CSVs yet — the scan
    endpoint treats "no match" as needs-contribution, so this never has to crash
    just because the raw data hasn't been dropped in."""
    global _INDEX
    if _INDEX is not None and not force_reload:
        return _INDEX
    paths = sorted(RAW_DIR.glob("*.csv")) if RAW_DIR.is_dir() else []
    _INDEX = build_index(paths)
    return _INDEX


def lookup_by_gtin(gtin: str, index: dict[str, RepairabilityResult] | None = None) -> RepairabilityResult | None:
    """Look up a verified repairability result by barcode, or None if unknown.

    Pass ``index`` to query an explicit index (tests use this); otherwise the
    cached raw/ index is used."""
    idx = index if index is not None else get_index()
    return idx.get(normalize_gtin(gtin))


def better_alternative(
    result: RepairabilityResult | None,
    index: dict[str, RepairabilityResult] | None = None,
) -> RepairabilityResult | None:
    """The best *different* product in the same category that beats ``result``.

    Powers the "here's a more repairable option" suggestion after a scan. Returns
    None when we have no category to compare within or nothing scores higher."""
    if result is None or not result.category:
        return None
    idx = index if index is not None else get_index()
    want = result.category.lower()
    best = None
    for r in idx.values():
        if r.gtin == result.gtin or (r.category or "").lower() != want:
            continue
        if r.score_0_100 <= result.score_0_100:
            continue
        if best is None or r.score_0_100 > best.score_0_100:
            best = r
    return best
