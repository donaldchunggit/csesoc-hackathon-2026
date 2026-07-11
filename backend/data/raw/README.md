# `backend/data/raw/` — French repairability/durability index CSVs

Drop the consolidated `data.gouv.fr` **indice de réparabilité / indice de
durabilité** CSV(s) here. Every `*.csv` in this folder is loaded and indexed by
`repairability_lookup.py` on first use.

The parser keeps only rows whose identifier is a barcode
(`referentiel_id_modele == 'GTIN_EAN'`).

## Expected columns

The column names the parser expects live in `COLS` / `CRITERIA_COLUMNS` at the
top of `../repairability_lookup.py`. They currently follow this schema (also used
by the test fixture in `../../tests/fixtures/`):

| Column | Meaning |
|---|---|
| `referentiel_id_modele` | identifier type — `GTIN_EAN` for barcode-keyed rows |
| `id_modele` | the actual GTIN/EAN barcode value |
| `nom_modele` | product/model name |
| `marque` | brand / manufacturer |
| `categorie_produit` | product category |
| `note_ir` | repairability index, 0–10 |
| `note_id` | durability index, 0–10 (newer categories; optional fallback) |
| `note_c1_documentation` | criterion: documentation (0–10) |
| `note_c2_demontabilite` | criterion: disassembly & access (0–10) |
| `note_c3_disponibilite_pieces` | criterion: spare-parts availability (0–10) |
| `note_c4_prix_pieces` | criterion: spare-parts price (0–10) |
| `note_c5_critere_specifique` | criterion: category-specific (0–10) |

If the official headers differ, reconcile **only** the constants at the top of
`repairability_lookup.py` — no other code should need to change.

> Files here are data, not source — keep them out of version control if large.
