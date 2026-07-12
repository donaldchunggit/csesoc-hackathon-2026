"""Offline tests for the UPCitemdb general-retail barcode lookup (injected fetch)."""

import sys
from pathlib import Path

import pytest

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
if str(DATA_DIR) not in sys.path:
    sys.path.insert(0, str(DATA_DIR))

import barcode_lookup as bl  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_cache():
    bl._CACHE.clear()
    yield
    bl._CACHE.clear()


def _ok(item):
    return lambda gtin: {"code": "OK", "total": 1, "items": [item]}


def test_general_retail_item_parsed():
    r = bl.lookup_by_gtin("0885909950805", fetch=_ok({
        "title": "Apple iPhone 6, Space Gray, 64 GB", "brand": "Apple",
        "category": "Electronics > Telephony > Mobile Phones > Unlocked Mobile Phones",
        "images": ["https://img/iphone.jpg"],
    }))
    assert r["product_name"].startswith("Apple iPhone 6")
    assert r["brand"] == "Apple"
    assert r["category"] == "Unlocked Mobile Phones"   # most-specific segment
    assert r["image_url"] == "https://img/iphone.jpg"
    assert r["source"] == "upcitemdb"


def test_no_items_returns_none():
    assert bl.lookup_by_gtin("111", fetch=lambda g: {"code": "OK", "total": 0, "items": []}) is None


def test_item_without_title_is_a_miss():
    assert bl.lookup_by_gtin("112", fetch=_ok({"title": "", "brand": "X"})) is None


def test_network_error_never_raises():
    def boom(gtin):
        raise RuntimeError("rate limited")
    assert bl.lookup_by_gtin("113", fetch=boom) is None


def test_blank_gtin_returns_none():
    assert bl.lookup_by_gtin("", fetch=_ok({"title": "Z"})) is None


def test_missing_images_key_is_tolerated():
    r = bl.lookup_by_gtin("114", fetch=_ok({"title": "Kettle", "brand": "Brand"}))
    assert r["image_url"] is None
    assert r["category"] is None
