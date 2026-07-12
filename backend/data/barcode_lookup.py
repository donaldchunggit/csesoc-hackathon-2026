"""GTIN -> general-retail product identity via UPCitemdb.

Open Food Facts (see ``openfacts_lookup``) covers food/grocery brilliantly but
returns nothing for electronics, household goods, cosmetics, etc. — so those
scans come back as "Unknown product". UPCitemdb is a general-retail barcode
database that fills that gap (it knows phones, appliances, tools, homeware...).

This gives IDENTITY ONLY (name, brand, category, image) — no environmental or
repairability grade — so when identity comes from here the scan pipeline falls
back to the clearly-labelled AI carbon estimate.

Auth: the ``trial`` endpoint needs no key but is rate-limited (~100 lookups/day
per IP) — fine for a demo. Set ``UPCITEMDB_KEY`` to use an authenticated key with
higher limits. Best-effort: any failure (offline, rate-limited, not found)
returns None and the caller degrades gracefully.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

_TRIAL_URL = "https://api.upcitemdb.com/prod/trial/lookup"
_KEYED_URL = "https://api.upcitemdb.com/prod/v1/lookup"
_TIMEOUT_S = 6
_UA = "ecocompass-scan/1.0 (hackathon project)"


def normalize_gtin(raw: str) -> str:
    return "".join(ch for ch in (raw or "") if ch.isdigit())


def _http_get_json(url: str, headers: dict):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:  # noqa: S310 — fixed https host
        return json.loads(resp.read().decode("utf-8", "replace"))


def _default_fetch(gtin: str):
    """Query UPCitemdb (keyed endpoint if UPCITEMDB_KEY is set, else the trial)."""
    key = os.environ.get("UPCITEMDB_KEY")
    headers = {"User-Agent": _UA, "Accept": "application/json"}
    if key:
        headers.update({"user_key": key, "key_type": "3scale"})
        base = _KEYED_URL
    else:
        base = _TRIAL_URL
    return _http_get_json(f"{base}?upc={urllib.parse.quote(gtin)}", headers)


def _specific_category(raw: str):
    """UPCitemdb categories look like 'Electronics > ... > Mobile Phones'.
    Keep the most-specific (last) segment for display + AI hint."""
    parts = [p.strip() for p in (raw or "").split(">") if p.strip()]
    return parts[-1] if parts else None


_CACHE: dict[str, dict | None] = {}


def lookup_by_gtin(gtin: str, *, fetch=None):
    """General-retail product identity for a barcode, or None.

    Returns ``{gtin, product_name, brand, category, image_url, source}``.
    ``fetch`` is injectable for tests; it defaults to the real HTTP call and is
    given the normalised gtin."""
    gtin = normalize_gtin(gtin)
    if not gtin:
        return None
    if gtin in _CACHE:
        return _CACHE[gtin]

    result = None
    try:
        data = (fetch or _default_fetch)(gtin)
    except Exception:  # noqa: BLE001 — offline / rate-limited / malformed -> treat as a miss
        data = None

    items = (data or {}).get("items") if isinstance(data, dict) else None
    if isinstance(data, dict) and data.get("code") == "OK" and items:
        item = items[0] or {}
        name = (item.get("title") or "").strip() or None
        if name:
            images = item.get("images") if isinstance(item.get("images"), list) else []
            result = {
                "gtin": gtin,
                "product_name": name,
                "brand": (item.get("brand") or "").strip() or None,
                "category": _specific_category(item.get("category")),
                "image_url": (images[0].strip() if images and isinstance(images[0], str) else None),
                "source": "upcitemdb",
            }

    _CACHE[gtin] = result
    return result
