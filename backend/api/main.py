import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile

# backend/main holds the CSV/processing pipeline (parse.py, score.py, ...);
# it isn't a package, so add it to the path to import from it.
sys.path.append(str(Path(__file__).resolve().parent.parent / "main"))
from parse import parse_csv  # noqa: E402

app = FastAPI()


@app.get("/")
def read_root():
    return {"Hello": "Wo"}


@app.get("/items/{item_id}")
def read_item(item_id: int, q: str | None = None):
    return {"item_id": item_id, "q": q}


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