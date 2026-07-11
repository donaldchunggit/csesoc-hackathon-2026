// Client for the consumer "scan a product" endpoints (the free wedge). Separate
// from api.js so the consumer layer stays clearly decoupled from the B2B flow.
// All requests go through Vite's /api proxy → FastAPI (see vite.config.js).

// Scan by barcode number. Returns a ScanResult:
//   { gtin, productName, brand, category,
//     repairability: { score, band, source, provenance, criteria, rawNoteIr } | not_found stub,
//     carbon: { score, band, source:'ai_estimated', confidence, provenance, ... } | null,
//     alternative: { productName, gtin, score, band } | null,
//     narrative, needs_contribution }
export async function scanBarcode(gtin) {
  const res = await fetch('/api/scan-barcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gtin }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Scan failed (${res.status})`)
  }
  return res.json()
}

// Scan from a product photo (packaging/label/item). Same ScanResult shape.
export async function scanPhoto(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/scan-photo', { method: 'POST', body: formData })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Photo scan failed (${res.status})`)
  }
  return res.json()
}

// Community contribution for a not-yet-scored product. `photos` is an array of
// base64 data URLs (optional). Returns { ok, id }.
export async function contributeProduct({ gtin, productName, photos, submittedMaterials, notes }) {
  const res = await fetch('/api/contribute-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gtin,
      product_name: productName,
      photos,
      submitted_materials: submittedMaterials,
      notes,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Contribution failed (${res.status})`)
  }
  return res.json()
}
