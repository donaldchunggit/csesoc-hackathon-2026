"""AI features powered by Claude (Anthropic Python SDK).

Two capabilities, both grounded so the model never fabricates the numbers that
make ecocompass credible:

  * generate_narrative() — turns the deterministic swap analysis into a short,
    human-readable briefing. The engine computes every figure; Claude only
    explains what's already there.
  * extract_bom() — reads a messy bill of materials (phone photo, PDF, Excel,
    CSV) and returns structured rows, mapping each material to the library.

The API key is read from ANTHROPIC_API_KEY by the default client. If it's unset,
the SDK raises on the first request; the API layer turns that into a clean 503
so the rest of the app keeps working.
"""

import base64
import io
import json
import os
import re
from pathlib import Path

import anthropic

from materials import DATA
from score import analyze_bom
from main import score_repairability  # design-longevity engine (backend/data)

# Opus 4.8 for both by default: strong at grounded writing and vision/PDF
# extraction. Override with ANTHROPIC_MODEL in backend/.env — e.g.
# ANTHROPIC_MODEL=claude-haiku-4-5 for cheaper/faster at some quality cost.
MODEL = os.environ.get("ANTHROPIC_MODEL") or "claude-opus-4-8"

_client = None


def client():
    """Lazily construct the SDK client so the server starts without a key."""
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def ai_configured():
    """Best-effort signal for the health endpoint (an ambient CLI profile also works)."""
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


# ---------------------------------------------------------------------------
# 1) Swap narrative
# ---------------------------------------------------------------------------
_NARRATIVE_SYSTEM = """You are a materials-sustainability analyst. You are given a JSON object with the
results of a bill-of-materials analysis that has ALREADY been computed by two
deterministic engines: a CARBON engine (lower-embodied-carbon material swaps) and
a DESIGN-LONGEVITY engine (how repairable and long-lived the build is). Write a
concise briefing (4-6 sentences, plain prose — no markdown, no headings, no bullet
points) for an engineer or procurement reviewer.

Rules:
- Use ONLY the numbers and facts in the JSON. Never invent, round differently, or
  estimate any figure.
- Lead with the blended OVERALL score/grade, then give its two halves: the carbon
  result (co2e saved, cost impact, and the "carbon score") and the repairability
  result (the "repairability score" and grade). The carbon score is NOT the
  overall score — do not conflate them. Write score names as natural prose
  ("carbon score", "repairability score"), never the raw JSON key spellings.
- Name one or two of the strongest carbon swaps by component name.
- Name the single highest-impact design fix from top_design_fixes (its component
  and action) as the clearest way to raise the repairability score.
- If any component has status "red" it was flagged and kept as-is — say so and
  give the rejection reason. This honesty is the whole point; do not gloss over it.
- Neutral, factual tone. No emoji, no salesy language."""


def _overall(eco, repair):
    return round(0.5 * eco + 0.5 * repair)


def _grade(score):
    return "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 45 else "F"


def _narrative_facts(bom, weights, product_name):
    res = analyze_bom(bom, weights)
    s = res["summary"]
    components = []
    for l in res["lines"]:
        rej = l["rejected"][0] if (l["status"] == "red" and l["rejected"]) else None
        components.append({
            "component": l["component"],
            "from": l["from"],
            "to": l["to"],
            "status": l["status"],
            "swapped": l["swapped"],
            "carbon_saved_kg": round(l["co2eFrom"] - l["co2eTo"], 2),
            "cost_delta_usd": round(l["costTo"] - l["costFrom"], 2),
            "note": l["statusReason"],
            "top_rejection": (f"{rej['material']}: {rej['reasons'][0]}" if rej else None),
        })

    # Design-longevity engine (backend/data) — best-effort so the narrative still
    # works if the reference libraries are missing.
    repair = None
    try:
        repair = score_repairability([
            {"component": b.get("component", ""), "material": b.get("from", ""),
             "fastening": b.get("fastening", ""), "sourcing": b.get("sourcing", "")}
            for b in bom
        ])
    except Exception:  # noqa: BLE001
        repair = None

    carbon = res["weights"]["carbon"]
    facts = {
        "product": product_name,
        "priority": f"{round(carbon * 100)}% carbon / {round((1 - carbon) * 100)}% cost",
        "summary": {
            "co2e_saved_kg_per_unit": round(s["co2eSaved"], 1),
            "co2e_reduction_pct": s["co2ePct"],
            "cost_delta_usd_per_unit": round(s["costDelta"], 2),
            "cost_increased": s["costUp"],
            "recommended_swaps": s["viableCount"],
            "flagged_components": s["flaggedCount"],
            "carbon_eco_score": s["ecoScore"],
            "carbon_eco_grade": s["ecoGrade"],
        },
        "components": components,
    }
    if repair:
        overall = _overall(s["ecoScore"], repair["score"])
        facts["summary"].update({
            "repairability_score": repair["score"],
            "repairability_grade": repair["grade"],
            "repairability_label": repair["label"],
            "overall_score": overall,
            "overall_grade": _grade(overall),
        })
        facts["top_design_fixes"] = [
            {"component": f["component"], "action": f["action"], "gain_points": f.get("gain")}
            for f in repair["recommendations"][:3]
        ]
    return facts


def generate_narrative(bom, weights=None, product_name="This build"):
    facts = _narrative_facts(bom, weights or {"carbon": 0.6}, product_name)
    msg = client().messages.create(
        model=MODEL,
        max_tokens=1024,
        system=_NARRATIVE_SYSTEM,
        messages=[{"role": "user", "content": json.dumps(facts, ensure_ascii=False)}],
    )
    return "".join(b.text for b in msg.content if b.type == "text").strip()


# ---------------------------------------------------------------------------
# 3) Government-incentive finder (grounded web search)
# ---------------------------------------------------------------------------
# Uses Claude's server-side web_search tool so every program is a REAL result
# with a source URL the user can verify — no fabricated grants. Same "the model
# only reports what it found" discipline as the rest of the app.
_INCENTIVES_SYSTEM = """You are a sustainability-incentives researcher for a hardware manufacturer.
Use web search to find CURRENT, REAL government incentives — grants, rebates, tax credits,
low-interest loans, or R&D programs — that could help a company manufacture the described product
more sustainably (lower-carbon or recycled materials, local sourcing, repairable/circular design).
Search official government and agency sources for the specified region.

Rules:
- Only include programs you actually found via web search, each with a real source URL. NEVER
  invent a program, an amount, or a link. If you find nothing credible, return an empty list.
- Prefer official government / agency pages over blogs or aggregators.
- Keep each summary to one or two plain sentences: what it offers and who qualifies.
- Order by relevance to sustainable manufacturing and materials.

Respond with ONLY a JSON object of this exact shape and nothing else:
{"incentives": [{"name": string, "provider": string, "level": string, "summary": string, "url": string, "relevance": string}]}
where "level" is one of "federal", "state", "local", or "other"."""

# web_search_20260209 (dynamic filtering) requires Opus 4.8/4.7/4.6 or Sonnet 5/4.6 — the default
# MODEL (claude-opus-4-8) qualifies. It's a server-side tool: results come back as content blocks.
_WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 5}


def generate_incentives(product_name="this product", materials="", region="Australia"):
    user = (
        f"Region: {region}\n"
        f"Product: {product_name}\n"
        f"Key materials / sustainability context: "
        f"{materials or 'lower-carbon and recycled material swaps, repairable design'}\n\n"
        "Find government incentives in this region that could support making this product more "
        "sustainably. Return the specified JSON."
    )
    messages = [{"role": "user", "content": user}]
    msg = None
    # The server-side search loop can stop with pause_turn; resume until it finishes.
    for _ in range(4):
        msg = client().messages.create(
            model=MODEL,
            max_tokens=2048,
            system=_INCENTIVES_SYSTEM,
            tools=[_WEB_SEARCH_TOOL],
            messages=messages,
        )
        if msg.stop_reason != "pause_turn":
            break
        messages.append({"role": "assistant", "content": msg.content})

    text = "".join(b.text for b in (msg.content if msg else []) if b.type == "text")
    try:
        parsed = _extract_json(text)
    except (ValueError, json.JSONDecodeError):
        parsed = {}

    rows = []
    for it in (parsed.get("incentives") if isinstance(parsed, dict) else None) or []:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").strip()
        if not name:
            continue
        rows.append({
            "name": name,
            "provider": str(it.get("provider") or "").strip(),
            "level": (str(it.get("level") or "other").strip().lower() or "other"),
            "summary": str(it.get("summary") or "").strip(),
            "url": str(it.get("url") or "").strip(),
            "relevance": str(it.get("relevance") or "").strip(),
        })
    return {"region": region, "incentives": rows}


# ---------------------------------------------------------------------------
# 2) BOM extraction from arbitrary files
# ---------------------------------------------------------------------------
_KNOWN = [d["name"] for d in DATA]
_NORM = {re.sub(r"[^a-z0-9]", "", n.lower()): n for n in _KNOWN}

_IMAGE_TYPES = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "gif": "image/gif", "webp": "image/webp",
}


def _match_material(raw):
    """Resolve a model-supplied material name to a canonical library entry, or None."""
    if not raw:
        return None
    return _NORM.get(re.sub(r"[^a-z0-9]", "", str(raw).lower()))


# Common free-text names people write for each library material (mirrors the
# frontend's MAT_SYNONYMS). Lets "aluminium", "oak wood", "ABS plastic", "rPET"
# etc. resolve to a real entry instead of falling through to a category proxy.
_SYNONYMS = {name: syns for name, syns in {
    "aluminum_6061": ["aluminum", "aluminium", "al", "6061", "aluminumalloy", "aluminiumalloy"],
    "steel": ["steel", "mildsteel", "carbonsteel", "structuralsteel", "a36"],
    "recycled_steel": ["recycledsteel", "eafsteel", "scrapsteel", "secondarysteel"],
    "recycled_aluminum": ["recycledaluminum", "recycledaluminium", "secondaryaluminum", "secondaryaluminium"],
    "ABS": ["abs", "absplastic"],
    "polypropylene": ["polypropylene", "pp"],
    "PET": ["pet", "pete", "polyester"],
    "recycled_PET": ["recycledpet", "rpet"],
    "bamboo_composite": ["bamboo", "bamboocomposite"],
    "FSC_plywood": ["plywood", "fscplywood", "ply"],
    "oak": ["oak", "oakwood", "hardwood"],
    "cork": ["cork"],
    "hemp_composite": ["hemp", "hempcomposite"],
    "PLA": ["pla"],
    "glass_fiber_composite": ["glassfiber", "glassfibre", "gfrp", "fiberglass", "fibreglass", "glassfibercomposite"],
    "flax_fiber_composite": ["flax", "flaxfiber", "flaxfibre", "flaxcomposite"],
    "mycelium_foam": ["mycelium", "myceliumfoam"],
    "wool_felt": ["wool", "woolfelt", "felt"],
}.items() if _NORM.get(re.sub(r"[^a-z0-9]", "", name.lower()))}


def _smart_match(raw):
    """Exact, then synonym, then loose-substring match to a library entry, or None."""
    n = re.sub(r"[^a-z0-9]", "", str(raw or "").lower())
    if not n:
        return None
    if n in _NORM:
        return _NORM[n]
    for name, syns in _SYNONYMS.items():
        if n in syns:
            return name
    # Loose substring, but only for tokens long enough to be unambiguous.
    if len(n) >= 4:
        for name, syns in _SYNONYMS.items():
            if any(len(s) >= 4 and (s in n or n in s) for s in syns):
                return name
    return None


# When a material isn't in the swap library, we don't drop the component — we
# stand in the closest representative material of its category so the analysis
# still runs and its mass still counts, then flag it for the user to confirm.
_CATEGORY_PROXY = {c: n for c, n in {
    "metal": "steel", "plastic": "ABS", "bioplastic": "PLA", "wood": "FSC_plywood",
    "natural": "cork", "biocomposite": "bamboo_composite", "composite": "glass_fiber_composite",
}.items() if _NORM.get(re.sub(r"[^a-z0-9]", "", n.lower()))}

# Keyword → category, checked in order (bioplastic before plastic so "biopolymer"
# doesn't get swallowed by the "plastic" substring, etc.).
_CATEGORY_KEYWORDS = [
    ("metal", ["metal", "alloy", "steel", "iron", "alumin", "zinc", "brass", "copper", "bronze", "titanium", "magnesium", "chrome", "nickel", "tin"]),
    ("wood", ["wood", "timber", "plywood", "oak", "bamboo", "mdf", "birch", "pine", "walnut", "maple"]),
    ("bioplastic", ["bioplastic", "biopolymer", "starch", "alginate", "chitosan", "gelatin", "agar"]),
    ("biocomposite", ["composite", "fiber", "fibre", "hemp", "flax", "cellulose", "coir", "jute"]),
    ("natural", ["cork", "wool", "felt", "leather", "cotton", "mycelium", "paper", "cardboard", "rubber", "silicone", "latex"]),
    ("plastic", ["plastic", "polymer", "resin", "nylon", "polyamide", "polycarbonate", "pvc", "acrylic", "pmma", "abs", "hdpe", "ldpe", "polyethylene", "polypropylene", "pet", "tpu", "tpe", "foam", "polyurethane", "styrene"]),
]


def _infer_category(raw):
    n = str(raw or "").lower()
    for cat, kws in _CATEGORY_KEYWORDS:
        if any(k in n for k in kws):
            return cat
    return None


def _resolve_material(raw, category_hint=None):
    """Best-effort resolve a material to a library entry.

    Returns (canonical_name, confidence, reason) where confidence is 'high' (a
    real library match) or 'proxy' (a stand-in for the user to confirm).
    """
    canon = _smart_match(raw)
    if canon:
        return canon, "high", ""

    clean = str(raw or "").strip() or "this material"
    cat = str(category_hint or "").strip().lower()
    if cat not in _CATEGORY_PROXY:
        cat = _infer_category(clean)
    if cat in _CATEGORY_PROXY:
        proxy = _CATEGORY_PROXY[cat]
        return proxy, "proxy", (
            f'"{clean}" isn\'t in the swap library — using {proxy.replace("_", " ")} '
            f'as the closest {cat} stand-in. Confirm or pick a better fit.'
        )
    proxy = _CATEGORY_PROXY.get("plastic") or _KNOWN[0]
    return proxy, "proxy", (
        f'Couldn\'t place "{clean}" in the swap library — using {proxy.replace("_", " ")} '
        f'as a placeholder. Confirm or pick a better fit.'
    )


def _pretty_product(filename):
    stem = re.sub(r"\.[^.]+$", "", filename or "Uploaded BOM")
    stem = re.sub(r"[_\-]+", " ", stem).strip()
    return (stem.title() or "Uploaded BOM")


def _xlsx_to_text(data):
    import openpyxl  # imported lazily so a missing dep only affects .xlsx uploads
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    lines = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            lines.append(",".join("" if c is None else str(c) for c in row))
    return "\n".join(lines)


def _content_block(data, filename):
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext in _IMAGE_TYPES:
        return {"type": "image", "source": {"type": "base64", "media_type": _IMAGE_TYPES[ext],
                                            "data": base64.standard_b64encode(data).decode()}}
    if ext == "pdf":
        return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                               "data": base64.standard_b64encode(data).decode()}}
    if ext == "xlsx":
        return {"type": "text", "text": _xlsx_to_text(data)}
    if ext == "xls":
        raise ValueError("Legacy .xls isn't supported — export as .xlsx or CSV.")
    try:
        return {"type": "text", "text": data.decode("utf-8-sig")}
    except UnicodeDecodeError:
        raise ValueError("Unsupported or unreadable file type. Use CSV, Excel, PDF, or an image.")


def _extract_json(text):
    """Parse the model's JSON reply, tolerating stray prose or code fences."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        raise


def extract_bom(data, filename):
    block = _content_block(data, filename)
    system = (
        "You extract a bill of materials from the provided file, which may be a photo, "
        "a scanned PDF, a spreadsheet dump, or CSV text. For every line item, capture the "
        "component name, its material, its material category, and the mass in kilograms.\n\n"
        "Map each material to the SINGLE closest name from this library, copying the name "
        "EXACTLY (including underscores/casing):\n" + ", ".join(_KNOWN) + "\n\n"
        "If a line's material genuinely matches none of these, DO NOT write \"unknown\" — "
        "instead put the material's real name as written on the file in \"material\", and set "
        "\"material_category\" to one of: metal, plastic, bioplastic, wood, natural, "
        "biocomposite, composite (or \"electronics\"/\"other\" if none fit). When the material "
        "does map to the library, still set \"material_category\" to its best-fit category.\n\n"
        "Convert masses to kilograms (e.g. 500 g -> 0.5, 2 lb -> 0.91). Set \"kg\" to the mass "
        "stated on the file, or 0 if none is given. ALWAYS set \"est_kg\" to your best estimate "
        "of a typical mass in kilograms for that component (a positive number) — it is used only "
        "when \"kg\" is 0. Ignore header rows, subtotals, totals, and any non-material lines.\n\n"
        "Respond with ONLY a JSON object of this exact shape and nothing else:\n"
        "{\"product_name\": string, \"lines\": [{\"component\": string, \"material\": string, "
        "\"material_category\": string, \"kg\": number, \"est_kg\": number}]}"
    )
    msg = client().messages.create(
        model=MODEL,
        max_tokens=4096,
        # The system prompt (instructions + material library) is identical on every
        # upload, so mark it cacheable. Prompt caching only actually kicks in once
        # the prefix exceeds the model's minimum cacheable size, but it's free to
        # request and pays off if the library/prompt grows.
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": [
            block,
            {"type": "text", "text": "Extract the bill of materials now as the specified JSON."},
        ]}],
    )
    text = next((b.text for b in msg.content if b.type == "text"), "{}")
    parsed = _extract_json(text)

    rows, warnings = [], []
    proxy_count, est_count = 0, 0
    for item in parsed.get("lines", []):
        component = (str(item.get("component") or "").strip() or f"Component {len(rows) + 1}")
        raw_mat = item.get("material")
        # Never drop a component: an unmatched material is stood in with the closest
        # library material (flagged 'proxy' for the user to confirm) rather than skipped.
        canon, confidence, reason = _resolve_material(raw_mat, item.get("material_category"))

        try:
            kg = float(item.get("kg") or 0)
        except (TypeError, ValueError):
            kg = 0
        # Missing/invalid mass: flag the row so the UI can ask the user to confirm it,
        # but pre-fill Claude's typical-mass estimate (or a 1 kg fallback) so the
        # analysis still runs with a sensible number meanwhile.
        kg_missing = kg <= 0
        kg_estimated = False
        if kg_missing:
            try:
                est = float(item.get("est_kg") or 0)
            except (TypeError, ValueError):
                est = 0
            if est > 0:
                kg, kg_estimated = est, True
                est_count += 1
            else:
                kg = 1

        row = {
            "component": component,
            "from": canon,
            "kg": round(kg, 3),
            "kgMissing": kg_missing,
            "kgEstimated": kg_estimated,
        }
        if confidence != "high":
            row["materialConfidence"] = "proxy"
            row["materialRaw"] = str(raw_mat).strip() if raw_mat else ""
            row["materialReason"] = reason
            proxy_count += 1
        rows.append(row)

    if not rows:
        warnings.append("No bill-of-materials rows could be read from this file.")
    else:
        if proxy_count:
            warnings.append(
                f"{proxy_count} material{'s' if proxy_count > 1 else ''} weren't in the swap "
                "library — we filled in the closest match for you to confirm below."
            )
        if est_count:
            warnings.append(
                f"{est_count} component{'s' if est_count > 1 else ''} had no mass — we estimated "
                "one for you to confirm below."
            )

    product = (str(parsed.get("product_name") or "").strip() or _pretty_product(filename))
    return {
        "rows": rows,
        "warnings": warnings,
        "meta": {
            "productName": product,
            "componentCount": len(rows),
            "totalKg": round(sum(r["kg"] for r in rows), 3),
            "note": f"extracted from {filename} with AI",
        },
    }


# ---------------------------------------------------------------------------
# 4) Consumer scan mode — carbon estimate, product-from-photo, scan narrative
# ---------------------------------------------------------------------------
# These power the free "scan a product" wedge. They are deliberately thin and
# self-contained: they reuse the vision/JSON helpers above but never touch the
# B2B swap engine. Every carbon number is looked up from a static table — the AI
# only picks the category — so an estimate is clearly labelled and never invented.
_CARBON_BANDS_PATH = Path(__file__).resolve().parent.parent / "data" / "category_carbon_bands.json"
_CARBON_BANDS = None


def _carbon_bands():
    """Lazily load and cache the category → carbon-band table."""
    global _CARBON_BANDS
    if _CARBON_BANDS is None:
        with _CARBON_BANDS_PATH.open(encoding="utf-8") as f:
            _CARBON_BANDS = json.load(f).get("categories", {})
    return _CARBON_BANDS


_CARBON_SYSTEM = """You are a product carbon analyst for a consumer sustainability scanner.
Given a product name (and maybe a photo and a category hint), infer the most likely product
category and its main materials, then pick the SINGLE closest category key from the provided list.

Rules:
- Choose exactly one category key from the list. If nothing fits, choose "other".
- This is a rough estimate from the product's identity alone — you do NOT have measured data.
  Never claim certainty. Set "confidence" to "low" normally, or "medium" ONLY when the product
  name clearly and unambiguously names a category on the list.
- "materials" is your best guess at the 2-4 dominant materials, lowercase.
- "rationale" is ONE short plain sentence a shopper can read.

Respond with ONLY this JSON and nothing else:
{"category": string, "materials": [string], "confidence": "low"|"medium", "rationale": string}"""


def estimate_carbon_from_category(product_name="this product", category=None, image_block=None):
    """Rough, clearly-labelled carbon grade for a scanned product.

    Claude infers the category/materials; the 0-100 score itself comes from the
    static category_carbon_bands.json table, so we never fabricate the number.
    Returns a dict tagged source='ai_estimated' with a low/medium confidence, or
    None if the AI call fails — the caller shows the scores it has and never crashes.
    """
    table = _carbon_bands()
    keys = [k for k in table if k != "other"]
    hint = f"\nCategory hint (may be wrong): {category}" if category else ""
    user_text = (
        f"Product: {product_name}{hint}\n\n"
        f"Category keys to choose from: {', '.join(keys)}, other\n\n"
        "Infer the category and materials, then return the specified JSON."
    )
    content = []
    if image_block is not None:
        content.append(image_block)
    content.append({"type": "text", "text": user_text})
    try:
        msg = client().messages.create(
            model=MODEL,
            max_tokens=400,
            system=[{"type": "text", "text": _CARBON_SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": content}],
        )
        text = next((b.text for b in msg.content if b.type == "text"), "{}")
        parsed = _extract_json(text)
    except Exception:  # noqa: BLE001 — carbon estimate is best-effort; degrade to None
        return None

    key = str(parsed.get("category") or "other").strip().lower()
    entry = table.get(key) or table.get("other")
    if not entry:
        return None
    confidence = parsed.get("confidence")
    if confidence not in ("low", "medium"):
        confidence = "low"
    materials = [str(m).strip() for m in (parsed.get("materials") or []) if str(m).strip()][:4]
    return {
        "score": int(entry["score_0_100"]),
        "band": entry["band"],
        "co2ePerKg": entry["co2e_per_kg"],
        "category": key,
        "materials": materials,
        "confidence": confidence,
        "rationale": str(parsed.get("rationale") or "").strip(),
        "source": "ai_estimated",
    }


_PRODUCT_VISION_SYSTEM = """You identify a single consumer product from a photo (its packaging, label, or the item itself).
Extract only what you can actually see; do not invent details.

Respond with ONLY this JSON and nothing else:
{"product_name": string, "brand": string, "category": string, "materials": [string], "gtin": string}
- "gtin" is the barcode digits if a barcode / EAN / UPC number is clearly legible, else "".
- "category" in plain words (e.g. "smartphone", "washing machine"); "" if unsure.
- Leave any field you cannot determine as "" (or [] for materials)."""


def extract_product_from_image(data, filename):
    """Best-guess product identity from an uploaded photo.

    Reuses the vision content-block helper shared with extract_bom() rather than
    duplicating it. Returns product_name / brand / category / materials / gtin,
    with empty strings for anything not legible in the image.
    """
    block = _content_block(data, filename)  # raises ValueError on unreadable types
    msg = client().messages.create(
        model=MODEL,
        max_tokens=500,
        system=[{"type": "text", "text": _PRODUCT_VISION_SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": [
            block,
            {"type": "text", "text": "Identify the product as the specified JSON."},
        ]}],
    )
    text = next((b.text for b in msg.content if b.type == "text"), "{}")
    parsed = _extract_json(text)
    return {
        "product_name": str(parsed.get("product_name") or "").strip(),
        "brand": str(parsed.get("brand") or "").strip(),
        "category": str(parsed.get("category") or "").strip(),
        "materials": [str(m).strip() for m in (parsed.get("materials") or []) if str(m).strip()][:6],
        "gtin": "".join(ch for ch in str(parsed.get("gtin") or "") if ch.isdigit()),
    }


_SCAN_NARRATIVE_SYSTEM = """You write a 2-3 sentence plain-language verdict for a consumer product scanner.
You are given a JSON object with scores that have ALREADY been computed. Use ONLY those figures — never
invent a number, a material, or a claim not present in the JSON.

Rules:
- Mention the repairability grade and the carbon grade in plain words. If a score is null, say we don't
  have that data yet — do not guess one.
- Repairability is "verified" (an official durability/repairability index); carbon is "estimated" (an AI
  guess from the product category, not measured). Make that difference clear and never blur the two.
- If an alternative is provided, mention it by name as a better-scoring option.
- Warm, direct, shopper-friendly. No markdown, no emoji, no headings."""


def generate_scan_narrative(scan):
    """Grounded plain-language explanation of a scan result.

    Best-effort: falls back to a deterministic template if the AI call fails, so
    the result card always has copy (and the template, too, only states figures
    already present in `scan`)."""
    try:
        msg = client().messages.create(
            model=MODEL,
            max_tokens=400,
            system=[{"type": "text", "text": _SCAN_NARRATIVE_SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": json.dumps(scan, ensure_ascii=False)}],
        )
        out = "".join(b.text for b in msg.content if b.type == "text").strip()
        if out:
            return out
    except Exception:  # noqa: BLE001 — narrative is a nicety; fall back to a template
        pass
    return _scan_narrative_fallback(scan)


def _scan_narrative_fallback(scan):
    """Deterministic narrative from the computed figures only (no fabrication)."""
    name = scan.get("productName") or "This product"
    parts = []
    r = scan.get("repairability") or {}
    if r.get("score") is not None:
        parts.append(
            f"{name} scores {r['score']}/100 for repairability "
            f"({str(r.get('band') or '').lower()}) — a verified figure from the French index."
        )
    else:
        parts.append(f"We don't yet have verified repairability data for {name}.")
    c = scan.get("carbon") or {}
    if c.get("score") is not None:
        parts.append(
            f"Its estimated carbon grade is {str(c.get('band') or '').lower()} ({c['score']}/100), "
            "an AI estimate from the product category rather than a measured figure."
        )
    alt = scan.get("alternative")
    if alt:
        parts.append(f"A better-scoring option is {alt['productName']} ({alt['score']}/100).")
    return " ".join(parts)
