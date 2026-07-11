// Thin client for the FastAPI backend. Requests go through Vite's /api proxy
// (see vite.config.js) to http://localhost:8000.

export async function uploadCsv(file) {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch('/api/upload-csv', { method: 'POST', body: formData })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Upload failed (${res.status})`)
  }
  return res.json()
}

// AI BOM extraction — send a photo / PDF / Excel / CSV and get back structured
// rows { component, from, kg } ready for /analyze-bom. Requires the backend
// (with ANTHROPIC_API_KEY) to be running.
export async function extractBom(file) {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch('/api/extract-bom', { method: 'POST', body: formData })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Extraction failed (${res.status})`)
  }
  return res.json() // { rows, warnings, meta }
}

// AI narrative — a grounded, plain-language summary of a computed analysis.
export async function fetchNarrative(bom, weights, productName) {
  const res = await fetch('/api/narrative', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bom, weights, productName }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Narrative failed (${res.status})`)
  }
  return res.json() // { narrative }
}

// Government-incentive finder — Claude searches the live web for real grants /
// rebates / tax credits in the chosen region, each with a source URL. Slower
// (it hits the web), so the UI triggers it on demand.
export async function fetchIncentives({ productName, materials, region }) {
  const res = await fetch('/api/incentives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productName, materials, region }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Incentives lookup failed (${res.status})`)
  }
  return res.json() // { region, incentives: [...] }
}
