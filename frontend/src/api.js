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
