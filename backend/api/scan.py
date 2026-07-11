"""Consumer "scan a product" endpoints — the free, Yuka-style growth wedge.

A thin layer that COMBINES two things and never touches the paid B2B flow:
  * a VERIFIED repairability score (French index, keyed by barcode), and
  * an ESTIMATED carbon grade (Claude infers the category; the number is looked up).

It does not import or modify analysis.js / score.py or the /analyze-bom,
/extract-bom, /narrative endpoints. Every score it returns carries a visible
``provenance`` label so "Verified" and "Estimated" can never be confused — the
core trust requirement of this feature.

Routes (mounted under the app in api/main.py):
  POST /scan-barcode      { gtin }                    -> ScanResult
  POST /scan-photo        (multipart image upload)    -> ScanResult
  POST /contribute-product{ gtin?, product_name?, ... } -> { ok, id }
"""

import sys
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, UploadFile

BACKEND_DIR = Path(__file__).resolve().parent.parent
for _p in (BACKEND_DIR / "data", BACKEND_DIR / "main"):
    if str(_p) not in sys.path:
        sys.path.append(str(_p))

import repairability_lookup as repair_lookup  # noqa: E402
from ai import (  # noqa: E402
    _content_block,
    estimate_carbon_from_category,
    extract_product_from_image,
    generate_scan_narrative,
)
from contributions import save_contribution  # noqa: E402

router = APIRouter(tags=["scan"])

# Human-readable provenance labels — the trust/legal requirement. "Verified" and
# "Estimated" must be textually and visually distinct wherever a score is shown.
PROV_VERIFIED = "Verified — French repairability index"
PROV_ESTIMATED = "Estimated — AI analysis"


def _repair_payload(res):
    """Serialise a RepairabilityResult to the wire shape, or a not_found stub."""
    if res is None:
        return {
            "score": None, "band": None, "source": "not_found",
            "provenance": None, "criteria": {}, "rawNoteIr": None,
        }
    return {
        "score": res.score_0_100,
        "band": res.band,
        "source": res.source,            # "verified_fr_index"
        "provenance": PROV_VERIFIED,
        "criteria": res.criteria_breakdown,
        "rawNoteIr": res.raw_note_ir,
    }


def _carbon_payload(est):
    """Attach the provenance label to a carbon estimate dict (or pass through None)."""
    if not est:
        return None
    return {**est, "provenance": PROV_ESTIMATED}


def _build_scan(*, gtin, repair_res, product_name, brand, category, image_block=None):
    """Assemble the combined ScanResult. Never raises for a missing score — an
    absent repairability match becomes needs_contribution, and a failed carbon
    estimate becomes a null carbon block."""
    name = product_name or (repair_res.product_name if repair_res else None) or "Unknown product"
    brand = brand or (repair_res.brand if repair_res else None)
    category = category or (repair_res.category if repair_res else None)

    # Only estimate carbon when there's something to describe (a name or a photo).
    carbon = None
    if name != "Unknown product" or image_block is not None:
        carbon = estimate_carbon_from_category(name, category, image_block=image_block)

    alt = repair_lookup.better_alternative(repair_res) if repair_res else None
    alternative = None
    if alt is not None:
        alternative = {
            "gtin": alt.gtin, "productName": alt.product_name,
            "score": alt.score_0_100, "band": alt.band, "brand": alt.brand,
        }

    scan = {
        "gtin": gtin,
        "productName": name,
        "brand": brand,
        "category": category,
        "repairability": _repair_payload(repair_res),
        "carbon": _carbon_payload(carbon),
        "alternative": alternative,
        "needs_contribution": repair_res is None,
    }
    scan["narrative"] = generate_scan_narrative(scan)
    return scan


@router.post("/scan-barcode")
def scan_barcode(payload: dict = Body(...)):
    """Scan a product by barcode.

    Body: { "gtin": str }. Returns a ScanResult: verified repairability (or a
    not_found stub with needs_contribution=true), an estimated carbon grade, a
    grounded narrative, and one better-scoring alternative if available.
    """
    gtin = repair_lookup.normalize_gtin(str(payload.get("gtin") or ""))
    if not gtin:
        raise HTTPException(status_code=400, detail="Provide a numeric 'gtin' (barcode).")
    res = repair_lookup.lookup_by_gtin(gtin)
    return _build_scan(gtin=gtin, repair_res=res, product_name=None, brand=None, category=None)


@router.post("/scan-photo")
async def scan_photo(file: UploadFile):
    """Scan a product from a photo (no barcode required).

    Reads the product identity via Claude vision (reusing the shared content-block
    helper), then runs the same combined scoring as /scan-barcode. If a barcode is
    legible in the photo we look it up for a verified repairability score.
    """
    data = await file.read()
    try:
        ident = extract_product_from_image(data, file.filename or "photo.jpg")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 — vision/API failure -> clean 503
        raise HTTPException(status_code=503, detail=f"AI unavailable: {exc}")

    gtin = repair_lookup.normalize_gtin(ident.get("gtin") or "")
    res = repair_lookup.lookup_by_gtin(gtin) if gtin else None
    try:
        image_block = _content_block(data, file.filename or "photo.jpg")
    except ValueError:
        image_block = None
    return _build_scan(
        gtin=gtin or None,
        repair_res=res,
        product_name=ident.get("product_name") or None,
        brand=ident.get("brand") or None,
        category=ident.get("category") or None,
        image_block=image_block,
    )


@router.post("/contribute-product")
def contribute_product(payload: dict = Body(...)):
    """Capture a community submission for a not-yet-scored product.

    Body: { "gtin"?, "product_name"?, "photos"? (base64 data URLs),
            "submitted_materials"?, "notes"? }. Stored append-only, no moderation
    yet. Returns { "ok": true, "id": ... }.
    """
    record = {
        "gtin": repair_lookup.normalize_gtin(str(payload.get("gtin") or "")),
        "product_name": str(payload.get("product_name") or "").strip(),
        "submitted_materials": str(payload.get("submitted_materials") or "").strip(),
        "notes": str(payload.get("notes") or "").strip(),
    }
    photos = payload.get("photos")
    photos = photos if isinstance(photos, list) else ([] if photos is None else [photos])
    try:
        cid = save_contribution(record, photos)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not save contribution: {exc}")
    return {"ok": True, "id": cid}
