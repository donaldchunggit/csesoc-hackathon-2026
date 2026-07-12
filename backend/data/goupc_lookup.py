"""GTIN -> general-retail product identity via Go-UPC.

A second general-retail fallback alongside ``barcode_lookup`` (UPCitemdb): when
Open Food Facts has no food match AND UPCitemdb misses (or is rate-limited),
Go-UPC gives another shot at a real name/brand/category for non-food barcodes
(household goods, electronics, cosmetics...).

Like UPCitemdb this is IDENTITY ONLY (name, brand, category, image) — no
environmental or repairability grade — so when identity comes from here the scan
pipeline falls back to the clearly-labelled AI carbon estimate.

Auth: Go-UPC requires an API key on every request (``Authorization: Bearer
<key>``); there is no keyless tier. So this module is DORMANT unless ``GOUPC_KEY``
is set — with no key it returns None immediately and never touches the network,
keeping the keyless demo path unchanged. Best-effort otherwise: any failure
(offline, unauthorised, not found, malformed) returns None and the caller
degrades gracefully.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

_BASE_URL = "https://go-upc.com/api/v1/code"
_TIMEOUT_S = 6
_UA = "ecocompass-scan/1.0 (hackathon project)"


def normalize_gtin(raw: str) -> str:
    return "".join(ch for ch in (raw or "") if ch.isdigit())


def _http_get_json(url: str, headers: dict):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:  # noqa: S310 — fixed https host
        return json.loads(resp.read().decode("utf-8", "replace"))


def _default_fetch(gtin: str):
    """Query Go-UPC with the Bearer key from ``GOUPC_KEY``.

    Raises KeyError-free: the caller only reaches here when a key is present."""
    key = os.environ["GOUPC_KEY"]
    headers = {
        "User-Agent": _UA,
        "Accept": "application/json",
        "Authorization": f"Bearer {key}",
    }
    return _http_get_json(f"{_BASE_URL}/{urllib.parse.quote(gtin)}", headers)


def _specific_category(product: dict):
    """Prefer the single ``category`` string; else the deepest ``categoryPath``
    segment. Go-UPC uses Google Shopping taxonomy (broad -> specific)."""
    cat = (product.get("category") or "").strip()
    if cat:
        return cat
    path = product.get("categoryPath")
    if isinstance(path, list):
        segs = [str(p).strip() for p in path if str(p).strip()]
        if segs:
            return segs[-1]
    return None


_CACHE: dict[str, dict | None] = {}


def lookup_by_gtin(gtin: str, *, fetch=None):
    """General-retail product identity for a barcode via Go-UPC, or None.

    Returns ``{gtin, product_name, brand, category, image_url, source}``. Returns
    None immediately when no ``GOUPC_KEY`` is configured (unless ``fetch`` is
    injected, as tests do). ``fetch`` is injectable for tests and is given the
    normalised gtin."""
    gtin = normalize_gtin(gtin)
    if not gtin:
        return None
    # Dormant without a key — never hit the network on the keyless demo path.
    if fetch is None and not os.environ.get("GOUPC_KEY"):
        return None
    if gtin in _CACHE:
        return _CACHE[gtin]

    result = None
    try:
        data = (fetch or _default_fetch)(gtin)
    except Exception:  # noqa: BLE001 — offline / unauthorised / malformed -> treat as a miss
        data = None

    product = (data or {}).get("product") if isinstance(data, dict) else None
    if isinstance(product, dict):
        name = (product.get("name") or "").strip() or None
        if name:
            image = product.get("imageUrl")
            result = {
                "gtin": gtin,
                "product_name": name,
                "brand": (product.get("brand") or "").strip() or None,
                "category": _specific_category(product),
                "image_url": (image.strip() if isinstance(image, str) and image.strip() else None),
                "source": "go_upc",
            }

    _CACHE[gtin] = result
    return result
