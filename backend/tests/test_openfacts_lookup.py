"""Offline tests for the Open Food Facts verified-data lookup.

No network: every test injects a fake ``fetch`` so the parsing/normalisation is
exercised deterministically. The cache is cleared per test.
"""

import sys
from pathlib import Path

import pytest

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
if str(DATA_DIR) not in sys.path:
    sys.path.insert(0, str(DATA_DIR))

import openfacts_lookup as off  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_cache():
    off._CACHE.clear()
    yield
    off._CACHE.clear()


def _fetch(product):
    return lambda url: {"status": 1, "product": product}


def test_numeric_score_wins_and_bands():
    r = off.lookup_by_gtin("3229820782560", fetch=_fetch({
        "product_name": "Muesli", "brands": "Bjorg, Distributor",
        "categories": "Breakfasts, Cereals, Mueslis", "ecoscore_grade": "a",
        "ecoscore_score": 82, "image_front_url": "https://img/x.jpg",
    }))
    assert r["product_name"] == "Muesli"
    assert r["brand"] == "Bjorg"                 # first brand only
    assert r["category"] == "Mueslis"            # most-specific (last) category
    assert r["image_url"] == "https://img/x.jpg"
    assert r["eco"]["score"] == 82
    assert r["eco"]["band"] == "Excellent"
    assert r["eco"]["source"] == "open_food_facts"


def test_grade_only_falls_back_to_representative_score():
    r = off.lookup_by_gtin("111", fetch=_fetch({"product_name": "X", "ecoscore_grade": "c"}))
    assert r["eco"]["score"] == 55
    assert r["eco"]["band"] == "Good"


def test_newer_environmental_score_key_is_read():
    r = off.lookup_by_gtin("112", fetch=_fetch({
        "product_name": "Y", "environmental_score_grade": "b", "environmental_score_score": 70,
    }))
    assert r["eco"]["score"] == 70
    assert r["eco"]["grade"] == "b"


def test_unknown_grade_gives_identity_but_no_eco():
    r = off.lookup_by_gtin("222", fetch=_fetch({"product_name": "Y", "ecoscore_grade": "unknown"}))
    assert r["product_name"] == "Y"
    assert r["eco"] is None


def test_empty_record_is_treated_as_miss():
    r = off.lookup_by_gtin("223", fetch=_fetch({"product_name": "", "ecoscore_grade": "not-applicable"}))
    assert r is None


def test_not_found_returns_none():
    assert off.lookup_by_gtin("333", fetch=lambda url: {"status": 0}) is None


def test_network_error_never_raises():
    def boom(url):
        raise RuntimeError("offline")
    assert off.lookup_by_gtin("444", fetch=boom) is None


def test_blank_gtin_returns_none():
    assert off.lookup_by_gtin("", fetch=_fetch({"product_name": "Z"})) is None


def test_score_is_clamped_0_100():
    r = off.lookup_by_gtin("555", fetch=_fetch({"product_name": "Z", "ecoscore_score": 140}))
    assert r["eco"]["score"] == 100
