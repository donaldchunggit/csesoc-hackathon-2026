import sys
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Load backend/.env (your ANTHROPIC_API_KEY lives there) before anything reads
# the environment. An already-set env var wins over the file.
load_dotenv(BACKEND_DIR / ".env")

# backend/main holds the CSV/processing pipeline (parse.py, score.py, ...);
# it isn't a package, so add it to the path to import from it.
sys.path.append(str(BACKEND_DIR / "main"))
from parse import parse_csv  # noqa: E402
from score import analyze_bom  # noqa: E402
from ai import ai_configured, extract_bom, generate_narrative  # noqa: E402
from main import library_summary, match_library  # noqa: E402  (data/reference-library pipeline)


def _attach_library(result, bom):
    """Enrich a swap analysis with reference-library recognition (backend/data).

    Adds a per-line `library` block (known flags + matched reference detail) and a
    `library` roll-up on the summary. Best-effort: any failure leaves the analysis
    untouched so the reference library can never break scoring."""
    try:
        matched = match_library(
            [{"component": b.get("component", ""), "material": b.get("from", "")} for b in bom]
        )
        for line, m in zip(result.get("lines", []), matched):
            line["library"] = {
                "componentKnown": m["component_known"],
                "componentRef": m["component_ref"],
                "materialKnown": m["material_known"],
                "materialRef": m["material_ref"],
            }
        result.setdefault("summary", {})["library"] = library_summary(matched)
    except Exception:  # noqa: BLE001 — reference library is additive, never fatal
        pass
    return result


def _ai_unavailable(exc):
    """Map an SDK/runtime failure to a clean 503 so AI outages never 500 the app."""
    msg = str(exc).lower()
    if isinstance(exc, anthropic.AuthenticationError) or "authentication" in msg or "api_key" in msg:
        return HTTPException(status_code=503, detail="AI features need ANTHROPIC_API_KEY set on the backend.")
    return HTTPException(status_code=503, detail=f"AI unavailable: {exc}")

app = FastAPI(title="ecocompass API")

# The frontend reaches us through Vite's /api proxy (same-origin in dev), but
# allow direct localhost calls too so the app works without the proxy.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    """Health check + endpoint index."""
    return {
        "service": "ecocompass",
        "status": "ok",
        "ai": ai_configured(),
        "endpoints": ["/upload-csv", "/analyze-bom", "/library-compare", "/narrative", "/extract-bom"],
    }


@app.post("/narrative")
def narrative_endpoint(payload: dict = Body(...)):
    """Generate a grounded, human-readable summary of a swap analysis (Claude).

    Body: { "bom": [...], "weights": {...}, "productName"? }
    Returns { "narrative": string }.
    """
    bom = payload.get("bom")
    if not isinstance(bom, list) or not bom:
        raise HTTPException(status_code=400, detail="Request must include a non-empty 'bom' array.")
    weights = payload.get("weights") or {"carbon": 0.6}
    product = payload.get("productName") or "This build"
    try:
        return {"narrative": generate_narrative(bom, weights, product)}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — never 500; surface as a 503 the UI can show
        raise _ai_unavailable(exc)


@app.post("/extract-bom")
async def extract_bom_endpoint(file: UploadFile):
    """Read a bill of materials from a photo / PDF / Excel / CSV using Claude.

    Returns { "rows": [{component, from, kg}], "warnings": [...], "meta": {...} } —
    ready to feed straight into /analyze-bom.
    """
    data = await file.read()
    try:
        return extract_bom(data, file.filename or "upload")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise _ai_unavailable(exc)


@app.post("/analyze-bom")
def analyze_bom_endpoint(payload: dict = Body(...)):
    """Run the swap analysis for a bill of materials.

    Body: { "bom": [{ "component", "from", "kg", "req"? }, ...],
            "weights": { "carbon": 0..1 } }
    Returns { "weights", "lines", "summary" } — the shape the frontend renders.
    """
    bom = payload.get("bom")
    if not isinstance(bom, list) or not bom:
        raise HTTPException(status_code=400, detail="Request must include a non-empty 'bom' array.")
    weights = payload.get("weights") or {"carbon": 0.6}
    try:
        return _attach_library(analyze_bom(bom, weights), bom)
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Unknown material in BOM: {e}")


@app.post("/library-compare")
def library_compare_endpoint(payload: dict = Body(...)):
    """Match a bill of materials against the backend/data reference library.

    Body: { "bom": [{ "component", "from"|"material" }, ...] }
    Returns { "rows": [...matched entries...], "summary": {...} } — each row flags
    whether the component/material is a known reference entry and, if so, the
    reference detail (repairability, failure risk, service life, recycling ...).
    """
    bom = payload.get("bom")
    if not isinstance(bom, list) or not bom:
        raise HTTPException(status_code=400, detail="Request must include a non-empty 'bom' array.")
    rows = [
        {"component": b.get("component", ""), "material": b.get("material", b.get("from", ""))}
        for b in bom
    ]
    matched = match_library(rows)
    return {"rows": matched, "summary": library_summary(matched)}


@app.post("/upload-csv")
async def upload_csv(file: UploadFile):
    """Accept an uploaded CSV file and convert it into rows for backend processing."""
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported.")

    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Could not decode file as UTF-8.")

    rows = parse_csv(text)
    return {"filename": file.filename, "row_count": len(rows), "rows": rows}