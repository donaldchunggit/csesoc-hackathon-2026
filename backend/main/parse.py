"""CSV parsing utilities for the backend processing pipeline."""

import csv
import io


def parse_csv(content: str) -> list[dict]:
    """Parse CSV text (header row + data rows) into a list of row dicts."""
    reader = csv.DictReader(io.StringIO(content))
    return [dict(row) for row in reader]
