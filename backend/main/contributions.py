"""Append-only store for community product contributions (consumer scan mode).

When a scanned product has no verified data, users can submit a photo + details
so we can score it later. There is no database in this project yet, so we capture
submissions as JSONL (plus any photos on disk) — this collects the data the growth
wedge needs without standing up a migration.

Proposed `contributions` table for when this graduates to a real DB (deferred —
ask before migrating):

    id                  TEXT PRIMARY KEY      -- uuid4 hex
    created_at          TIMESTAMP             -- UTC ISO-8601
    gtin                TEXT                  -- normalised barcode, may be ''
    product_name        TEXT
    submitted_materials TEXT
    notes               TEXT
    photo_paths         TEXT[]                -- relative paths under contributions/uploads/
    status              TEXT DEFAULT 'pending' -- pending|approved|rejected (no moderation UI yet)
"""

import base64
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

CONTRIB_DIR = Path(__file__).resolve().parent.parent / "data" / "contributions"
UPLOAD_DIR = CONTRIB_DIR / "uploads"
LOG_PATH = CONTRIB_DIR / "contributions.jsonl"

_DATA_URL = re.compile(r"^data:(?P<mime>[\w/+.-]+);base64,(?P<b64>.+)$", re.DOTALL)
_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
_MAX_PHOTO_BYTES = 8 * 1024 * 1024  # 8 MB per photo


def _save_photo(cid: str, i: int, data_url: str) -> str | None:
    """Persist one base64 data-URL photo; return its relative path, or None if
    it isn't a decodable image within the size cap."""
    m = _DATA_URL.match(str(data_url or "").strip())
    if not m:
        return None
    try:
        raw = base64.b64decode(m.group("b64"), validate=False)
    except Exception:  # noqa: BLE001
        return None
    if not raw or len(raw) > _MAX_PHOTO_BYTES:
        return None
    ext = _EXT.get(m.group("mime"), "bin")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{cid}_{i}.{ext}"
    (UPLOAD_DIR / name).write_bytes(raw)
    return f"uploads/{name}"


def save_contribution(record: dict, photos=None) -> str:
    """Persist one contribution (+ optional base64 data-URL photos) and return its id."""
    CONTRIB_DIR.mkdir(parents=True, exist_ok=True)
    cid = uuid.uuid4().hex
    paths = []
    for i, p in enumerate(photos or []):
        saved = _save_photo(cid, i, p)
        if saved:
            paths.append(saved)
    entry = {
        "id": cid,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "pending",
        "photo_paths": paths,
        **record,
    }
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return cid
