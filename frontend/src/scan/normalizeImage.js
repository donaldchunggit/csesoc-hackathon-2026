// Normalise a picked/captured photo before uploading it to the vision API.
//
// Two real-world phone problems this solves:
//   * iPhone photos are HEIC, which the vision API cannot read. Drawing the
//     image to a canvas and re-encoding produces a JPEG it can read. (On iOS
//     Safari the <img> fallback decodes HEIC; on Android photos are already
//     JPEG.)
//   * Phone cameras shoot 12MP, multi-megabyte images that can exceed the API's
//     size limits and are slow to upload. We downscale to a sane long edge.
//
// It also fixes EXIF rotation so a sideways phone photo isn't analysed sideways.
// Best-effort: if the browser can't decode the file (e.g. HEIC on desktop
// Chrome), we hand back the original and let the backend report a clear error.

const MAX_EDGE = 1600      // longest side, px — comfortably within API limits
const JPEG_QUALITY = 0.85

export async function normalizeImage(file) {
  if (!file) return file
  try {
    const source = await loadDecodable(file)
    const srcW = source.width || source.naturalWidth
    const srcH = source.height || source.naturalHeight
    if (!srcW || !srcH) return file

    const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH))
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(source, 0, 0, w, h)
    if (source.close) source.close() // release ImageBitmap

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) return file
    return new File([blob], 'scan.jpg', { type: 'image/jpeg' })
  } catch {
    return file // couldn't decode — upload as-is; backend gives a clear message
  }
}

// Decode to something canvas can draw: prefer createImageBitmap (respects EXIF
// orientation, decodes off the main thread), fall back to an <img> element.
async function loadDecodable(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch { /* HEIC/unsupported here — try the <img> path */ }
  }
  return await loadViaImg(file)
}

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}
