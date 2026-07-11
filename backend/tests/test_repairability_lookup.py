"""Tests for the GTIN → repairability lookup (Phase 1 of consumer scan mode).

Runs standalone (``python backend/tests/test_repairability_lookup.py``) or under
pytest — no extra dependencies required. Exercises the parser against the sample
fixture so it's testable without the full data.gouv.fr CSV.
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR / "data"))

import repairability_lookup as rl  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "repairability_sample.csv"


def _index():
    return rl.build_index([FIXTURE])


def test_verified_lookup_and_normalisation():
    """note_ir 9/10 → 90/100, banded Excellent, tagged verified."""
    idx = _index()
    r = rl.lookup_by_gtin("3701234567890", index=idx)
    assert r is not None
    assert r.score_0_100 == 90
    assert r.band == "Excellent"
    assert r.source == "verified_fr_index"
    assert r.raw_note_ir == 9.0
    assert r.brand == "Fairphone"
    assert r.category == "Smartphone"


def test_duplicate_gtin_keeps_higher_score():
    """The same barcode is re-listed at 7/10; the better published score wins."""
    r = rl.lookup_by_gtin("3701234567890", index=_index())
    assert r.score_0_100 == 90  # not 70 from the relisting row


def test_french_decimal_comma_and_band():
    """'2,5' parses to 2.5 → 25/100 → Poor."""
    r = rl.lookup_by_gtin("0012345678905", index=_index())
    assert r is not None
    assert r.score_0_100 == 25
    assert r.band == "Poor"


def test_durability_index_fallback():
    """Row with no note_ir falls back to note_id (7/10 → 70 → Good)."""
    r = rl.lookup_by_gtin("4006381333931", index=_index())
    assert r is not None
    assert r.score_0_100 == 70
    assert r.band == "Good"


def test_non_gtin_rows_excluded():
    """A row keyed by an internal model ref, not a barcode, is never indexed."""
    idx = _index()
    assert all(res.product_name != "Prototype Blender" for res in idx.values())
    assert rl.lookup_by_gtin("MDL-99823", index=idx) is None


def test_gtin_normalisation_is_forgiving():
    """Spaces / dashes / leading-zero quirks still resolve to the same product."""
    idx = _index()
    assert rl.lookup_by_gtin(" 3701234567890 ", index=idx) is not None
    assert rl.lookup_by_gtin("370-123-4567890", index=idx) is not None
    assert rl.normalize_gtin("0012345678905") == "0012345678905"  # leading zero kept


def test_criteria_breakdown_normalised_to_100():
    """Sub-criteria are surfaced 0–100 under readable labels."""
    r = rl.lookup_by_gtin("3701234567890", index=_index())
    assert r.criteria_breakdown["Documentation"] == 90
    assert r.criteria_breakdown["Disassembly & access"] == 50
    assert set(r.criteria_breakdown) <= set(rl.CRITERIA_COLUMNS.values())


def test_unknown_gtin_returns_none():
    assert rl.lookup_by_gtin("9999999999999", index=_index()) is None


def test_better_alternative_same_category_higher_score():
    """BudgetPhone (25) → Fairphone 5 (90), both Smartphone, is suggested."""
    idx = _index()
    budget = rl.lookup_by_gtin("0012345678905", index=idx)
    alt = rl.better_alternative(budget, index=idx)
    assert alt is not None
    assert alt.gtin == "3701234567890"
    assert alt.score_0_100 == 90


def test_better_alternative_none_when_already_best():
    """The top-scoring product in its category has no better alternative."""
    idx = _index()
    fairphone = rl.lookup_by_gtin("3701234567890", index=idx)
    assert rl.better_alternative(fairphone, index=idx) is None


def test_band_boundaries():
    assert rl.band_for(0) == "Bad"
    assert rl.band_for(24) == "Bad"
    assert rl.band_for(25) == "Poor"
    assert rl.band_for(49) == "Poor"
    assert rl.band_for(50) == "Good"
    assert rl.band_for(74) == "Good"
    assert rl.band_for(75) == "Excellent"
    assert rl.band_for(100) == "Excellent"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL  {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
