// Webcam barcode scanner for consumer scan mode.
//
// Uses the browser-native BarcodeDetector API (Chrome/Edge/Android) — zero new
// dependencies. Where it's unavailable (Firefox/Safari today), we degrade to a
// manual barcode-number entry, which is always offered as a fallback anyway.
//
// Detection is throttled to ~8 fps (not every animation frame): barcode decode
// on a full video frame is expensive, and hammering it once per frame janks the
// live preview for no accuracy gain.
import React, { useEffect, useRef, useState } from 'react'
import { T, Icon, ICONS, btnAccent, btnGhost } from './tokens.jsx'

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']
const DETECT_INTERVAL_MS = 120
const hasDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window

const inputStyle = {
  flex: 1, padding: '11px 13px', fontSize: 14, fontFamily: 'ui-monospace, monospace',
  background: T.card, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10, outline: 'none',
}

export default function BarcodeScanner({ onDetected, busy }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(0)
  const detectorRef = useRef(null)
  const [live, setLive] = useState(false)
  const [manual, setManual] = useState('')
  const [error, setError] = useState('')

  // Tear down camera + detection timer.
  const stop = () => {
    clearTimeout(timerRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setLive(false)
  }

  useEffect(() => stop, []) // cleanup on unmount

  const start = async () => {
    setError('')
    if (!hasDetector) {
      setError("Live scanning isn't supported in this browser — type the barcode number below instead.")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setLive(true)
      detectorRef.current = detectorRef.current || new window.BarcodeDetector({ formats: FORMATS })

      // Throttled detection loop — one decode every DETECT_INTERVAL_MS.
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return
        try {
          const codes = await detectorRef.current.detect(videoRef.current)
          const hit = codes.find((c) => c.rawValue && /\d{6,}/.test(c.rawValue))
          if (hit) {
            const gtin = hit.rawValue.replace(/\D/g, '')
            stop()
            onDetected(gtin)
            return
          }
        } catch {
          /* transient decode error — keep scanning */
        }
        timerRef.current = setTimeout(tick, DETECT_INTERVAL_MS)
      }
      timerRef.current = setTimeout(tick, DETECT_INTERVAL_MS)
    } catch {
      setError("Couldn't open the camera — check permissions, or type the barcode number below.")
      stop()
    }
  }

  const submitManual = (e) => {
    e.preventDefault()
    const gtin = manual.replace(/\D/g, '')
    if (gtin.length >= 6) onDetected(gtin)
    else setError('Enter at least 6 digits from the barcode.')
  }

  return (
    <div>
      <div style={{
        position: 'relative', aspectRatio: '3 / 2', borderRadius: 18, overflow: 'hidden',
        background: '#1A2117', border: `1px solid ${T.line}`, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <video ref={videoRef} playsInline muted style={{
          width: '100%', height: '100%', objectFit: 'cover', display: live ? 'block' : 'none',
        }} />
        {live && (
          <div style={{
            position: 'absolute', left: '12%', right: '12%', top: '32%', height: '36%',
            border: '2px solid rgba(255,255,255,0.9)', borderRadius: 14,
            boxShadow: '0 0 0 100vmax rgba(0,0,0,0.34)',
          }}>
            {/* Sweeping scan line. */}
            <div style={{ position: 'absolute', left: 8, right: 8, height: 2, borderRadius: 2, background: 'rgba(122,182,120,0.95)', boxShadow: '0 0 12px rgba(122,182,120,0.9)' }} className="eco-scan-line" />
          </div>
        )}
        {!live && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.82)', padding: 24 }}>
            <Icon d={ICONS.barcode} size={40} stroke="rgba(255,255,255,0.9)" sw={1.6} />
            <div style={{ fontSize: 13.5, marginTop: 12, maxWidth: 260, lineHeight: 1.5 }}>
              Point your camera at a product barcode to get an instant score.
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        {!live
          ? <button onClick={start} disabled={busy} className="eco-btn" style={{ ...btnAccent, opacity: busy ? 0.55 : 1 }}>
              <Icon d={ICONS.camera} size={15} stroke={T.page} sw={1.9} /> Start camera
            </button>
          : <button onClick={stop} className="eco-btn" style={btnGhost}>Stop camera</button>}
      </div>

      {error && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: '#8A3F52', lineHeight: 1.5 }}>{error}</div>
      )}

      <form onSubmit={submitManual} style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 7 }}>
          {hasDetector ? 'Or enter the barcode number' : 'Enter the barcode number (digits under the bars)'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onFocus={(e) => { e.target.style.borderColor = T.accent }}
            onBlur={(e) => { e.target.style.borderColor = T.line }}
            inputMode="numeric"
            placeholder="e.g. 3701234567890"
            style={inputStyle}
          />
          <button type="submit" disabled={busy} className="eco-btn" style={{ ...btnGhost, opacity: busy ? 0.55 : 1 }}>Look up</button>
        </div>
      </form>
    </div>
  )
}
