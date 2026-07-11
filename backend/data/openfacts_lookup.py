"""GTIN -> verified product identity + environmental grade via Open Facts.

Open Food Facts / Open Products Facts (openfoodfacts.org) is a free, open,
crowd-sourced product database keyed by barcode, with no API key. For consumer
scan mode it gives us two VERIFIED things the AI cannot:

  * real product identity (name, brand, category, image) for millions of
    barcodes, and
  * a verified environmental grade (the Eco-Score / Green-Score, 0-100 + A-E)
    for products that carry one.

Provenance matters: anything this module returns is real third-party data tagged
``source="open_food_facts"`` so the UI can badge it "Verified" — never mixed up
with the AI carbon estimate.

Network policy: best-effort with a short timeout. ANY failure (offline, timeout,
not found, malformed JSON) returns ``None``; the scan endpoint then degrades to
the AI estimate and never crashes.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request

# Open Facts flavours, most-likely-to-hold-the-product first. Food has by far the
# best coverage; products/beauty catch non-food barcodes.
_HOSTS = (
    "https://world.openfoodfacts.org",
    "https://world.openproductsfacts.org",
    "https://world.openbeautyfacts.org",
)

# Only pull the handful of fields we use — keeps the response small and fast.
_FIELDS = ",".join((
    "product_name",
    "brands",
    "categories",
    "ecoscore_grade",
    "ecoscore_score",
    "environmental_score_grade",  # newer "Green-Score" key; fallback
    "environmental_score_score",
    "image_front_url",
))

_TIMEOUT_S = 5
_UA = "ecocompass-scan/1.0 (hackathon project)"

# Eco-Score letter -> representative 0-100 when the numeric score is absent.
_GRADE_SCORE = {"a-plus": 96, "a": 90, "b": 72, "c": 55, "d": 38, "e": 18}

# Non-scores that Open Facts uses when a product has no environmental grade.
_NO_GRADE = {"", "unknown", "not-applicable", "not-computed", "none"}


def normalize_gtin(raw: str) -> str:
    """Reduce a barcode to comparable digits (drop spaces, dashes, decimals)."""
    return "".join(ch for ch in (raw or "") if ch.isdigit())


def _band_for(score: float) -> str:
    """Map a 0-100 score to Bad / Poor / Good / Excellent (shared thresholds)."""
    if score >= 75:
        return "Excellent"
    if score >= 50:
        return "Good"
    if score >= 25:
        return "Poor"
    return "Bad"


def _http_get_json(url: str):
    """Fetch and parse JSON from a URL. Raises on any network/parse error."""
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:  # noqa: S310 — fixed https hosts
        return json.loads(resp.read().decode("utf-8", "replace"))


def _fetch_product(gtin: str, fetch):
    """Return (host, product_dict) for the first Open Facts flavour that has the
    barcode, or None. A "product not found" reply is a fast 200, so trying each
    flavour is cheap; the timeout only bites when a host is unreachable."""
    for host in _HOSTS:
        url = f"{host}/api/v2/product/{urllib.parse.quote(gtin)}.json?fields={_FIELDS}"
        try:
            data = fetch(url)
        except Exception:  # noqa: BLE001 — unreachable/timeout/malformed: try the next flavour
            continue
        if isinstance(data, dict) and data.get("status") == 1 and isinstance(data.get("product"), dict):
            return host, data["product"]
    return None


def _eco_from_product(host: str, gtin: str, p: dict):
    """Build the VERIFIED environmental grade block, or None if the product has no
    Eco-Score / Green-Score published."""
    grade = str(p.get("ecoscore_grade") or p.get("environmental_score_grade") or "").strip().lower()
    raw_score = p.get("ecoscore_score")
    if raw_score is None:
        raw_score = p.get("environmental_score_score")

    score = None
    try:
        if raw_score is not None:
            score = int(round(float(raw_score)))
    except (TypeError, ValueError):
        score = None
    if score is None and grade not in _NO_GRADE:
        score = _GRADE_SCORE.get(grade)
    if score is None:
        return None

    score = max(0, min(100, score))
    return {
        "score": score,
        "band": _band_for(score),
        "grade": grade if grade not in _NO_GRADE else None,
        "source": "open_food_facts",
        "sourceUrl": f"{host}/product/{gtin}",
    }


def _category_of(p: dict):
    """Most-specific human category. Open Facts lists categories broad->specific."""
    cats = [c.strip() for c in (p.get("categories") or "").split(",") if c.strip()]
    return cats[-1] if cats else None


def _first_brand(p: dict):
    brands = [b.strip() for b in (p.get("brands") or "").split(",") if b.strip()]
    return brands[0] if brands else None


# Small process-lifetime cache so repeated scans of the same barcode (and repeat
# misses) don't re-hit the network. Cleared only on restart.
_CACHE: dict[str, dict | None] = {}


def lookup_by_gtin(gtin: str, *, fetch=None):
    """Verified product identity + environmental grade for a barcode, or None.

    Returns a dict::

        {gtin, product_name, brand, category, image_url,
         eco: {score, band, grade, source, sourceUrl} | None,
         source: "open_food_facts", source_url}

    ``fetch`` is injectable (tests pass a fake) — it defaults to the real HTTP
    getter. A hit with neither a name nor an eco grade is treated as a miss."""
    gtin = normalize_gtin(gtin)
    if not gtin:
        return None
    if gtin in _CACHE:
        return _CACHE[gtin]

    got = _fetch_product(gtin, fetch or _http_get_json)
    result = None
    if got is not None:
        host, p = got
        name = (p.get("product_name") or "").strip() or None
        eco = _eco_from_product(host, gtin, p)
        if name or eco:  # a bare, empty record is not worth returning
            result = {
                "gtin": gtin,
                "product_name": name,
                "brand": _first_brand(p),
                "category": _category_of(p),
                "image_url": (p.get("image_front_url") or "").strip() or None,
                "eco": eco,
                "source": "open_food_facts",
                "source_url": f"{host}/product/{gtin}",
            }

    _CACHE[gtin] = result
    return result
