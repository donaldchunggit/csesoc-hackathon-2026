// Webcam barcode scanner for consumer scan mode.
//
// Uses the browser-native BarcodeDetector API (Chrome/Edge/Android) — zero new
// dependencies. Where it's unavailable (Firefox/Safari today), we degrade to a
// manual barcode-number entry, which is always offered as a fallback anyway.
import React, { useEffect, useRef, useState } from 'react'
import { T, Icon, ICONS, btnAccent, btnGhost } from './tokens.jsx'

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']
const hasDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window

export default function BarcodeScanner({ onDetected, busy }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(0)
  const [live, setLive] = useState(false)
  const [manual, setManual] = useState('')
  const [error, setError] = useState('')

  // Tear down camera + detection loop.
  const stop = () => {
    cancelAnimationFrame(rafRef.current)
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
      setError('Live scanning isn\'t supported in this browser — type the barcode number below instead.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setLive(true)
      const detector = new window.BarcodeDetector({ formats: FORMATS })
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return
        try {
          const codes = await detector.detect(videoRef.current)
          const hit = codes.find((c) => c.rawValue && /\d{6,}/.test(c.rawValue))
          if (hit) {
            const gtin = hit.rawValue.replace(/\D/g, '')
            stop()
            onDetected(gtin)
            return
          }
        } catch {
          // transient decode error — keep scanning
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (e) {
      setError('Couldn\'t open the camera — check permissions, or type the barcode number below.')
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
        position: 'relative', aspectRatio: '3 / 2', borderRadius: 16, overflow: 'hidden',
        background: '#1A2117', border: `1px solid ${T.line}`, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <video ref={videoRef} playsInline muted style={{
          width: '100%', height: '100%', objectFit: 'cover',
          display: live ? 'block' : 'none',
        }} />
        {live && (
          // Scan reticle.
          <div style={{
            position: 'absolute', left: '12%', right: '12%', top: '34%', height: '32%',
            border: '2px solid rgba(255,255,255,0.85)', borderRadius: 12,
            boxShadow: '0 0 0 100vmax rgba(0,0,0,0.28)',
          }} />
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
          ? <button onClick={start} disabled={busy} style={{ ...btnAccent, opacity: busy ? 0.6 : 1 }}>
              <Icon d={ICONS.camera} size={15} stroke={T.page} sw={1.9} /> Start camera
            </button>
          : <button onClick={stop} style={btnGhost}>Stop camera</button>}
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
            inputMode="numeric"
            placeholder="e.g. 3701234567890"
            style={{
              flex: 1, padding: '11px 13px', fontSize: 14, fontFamily: 'ui-monospace, monospace',
              background: T.card, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10, outline: 'none',
            }}
          />
          <button type="submit" disabled={busy} style={{ ...btnGhost, opacity: busy ? 0.6 : 1 }}>Look up</button>
        </div>
      </form>
    </div>
  )
}
