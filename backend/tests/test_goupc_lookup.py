"""Offline tests for the Go-UPC general-retail barcode lookup (injected fetch)."""

import sys
from pathlib import Path

import pytest

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
if str(DATA_DIR) not in sys.path:
    sys.path.insert(0, str(DATA_DIR))

import goupc_lookup as gl  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_cache():
    gl._CACHE.clear()
    yield
    gl._CACHE.clear()


def _ok(product):
    return lambda gtin: {"code": gtin, "codeType": "UPC", "product": product}


def test_general_retail_item_parsed():
    r = gl.lookup_by_gtin("0829576019311", fetch=_ok({
        "name": "Dr. Bronner's Pure-Castile Liquid Soap", "brand": "Dr. Bronner's",
        "category": "Bath & Body > Bar Soap",
        "imageUrl": "https://img/soap.jpg",
    }))
    assert r["product_name"].startswith("Dr. Bronner's")
    assert r["brand"] == "Dr. Bronner's"
    assert r["category"] == "Bath & Body > Bar Soap"
    assert r["image_url"] == "https://img/soap.jpg"
    assert r["source"] == "go_upc"


def test_category_falls_back_to_deepest_path_segment():
    r = gl.lookup_by_gtin("111", fetch=_ok({
        "name": "Kettle", "categoryPath": ["Home", "Kitchen", "Kettles"],
    }))
    assert r["category"] == "Kettles"


def test_no_product_returns_none():
    assert gl.lookup_by_gtin("112", fetch=lambda g: {"code": "112"}) is None


def test_product_without_name_is_a_miss():
    assert gl.lookup_by_gtin("113", fetch=_ok({"name": "", "brand": "X"})) is None


def test_network_error_never_raises():
    def boom(gtin):
        raise RuntimeError("unauthorised")
    assert gl.lookup_by_gtin("114", fetch=boom) is None


def test_blank_gtin_returns_none():
    assert gl.lookup_by_gtin("", fetch=_ok({"name": "Z"})) is None


def test_dormant_without_key(monkeypatch):
    """With no GOUPC_KEY and no injected fetch, it must not touch the network."""
    monkeypatch.delenv("GOUPC_KEY", raising=False)
    assert gl.lookup_by_gtin("829576019311") is None


def test_missing_image_is_tolerated():
    r = gl.lookup_by_gtin("115", fetch=_ok({"name": "Broom", "brand": "Brand"}))
    assert r["image_url"] is None
    assert r["category"] is None
