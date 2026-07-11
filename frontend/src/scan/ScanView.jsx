// The free consumer "scan a product" page (Yuka-style wedge).
//
// Visually on-brand with the B2B app but deliberately set apart with a "Free"
// eyebrow and a lighter, single-column layout so a shopper understands this is
// the free tool, not the paid BOM dashboard.
import React, { useRef, useState } from 'react'
import { T, Icon, ICONS, btnGhost } from './tokens.jsx'
import BarcodeScanner from './BarcodeScanner.jsx'
import ScanResultCard from './ScanResultCard.jsx'
import ContributePrompt from './ContributePrompt.jsx'
import { scanBarcode, scanPhoto } from '../scanApi.js'

export default function ScanView() {
  const [scan, setScan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [error, setError] = useState('')
  const photoInputRef = useRef(null)

  const runBarcode = async (gtin) => {
    setBusy(true); setBusyLabel('Scoring…'); setError(''); setScan(null)
    try {
      setScan(await scanBarcode(gtin))
    } catch (e) {
      setError(e.message || 'Scan failed. Is the backend running?')
    } finally {
      setBusy(false)
    }
  }

  const runPhoto = async (e) => {
    const file = e.target.files?.[0]
    if (file) e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setBusy(true); setBusyLabel('Reading photo…'); setError(''); setScan(null)
    try {
      setScan(await scanPhoto(file))
    } catch (err) {
      setError(err.message || 'Couldn\'t read that photo.')
    } finally {
      setBusy(false)
    }
  }

  const reset = () => { setScan(null); setError('') }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '48px 24px 96px' }}>
      {/* Header — clearly the free consumer tool. */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(91,122,78,0.12)', border: '1px solid rgba(91,122,78,0.32)', color: T.good, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', padding: '5px 11px', borderRadius: 99 }}>
        Free · no sign-up
      </div>
      <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', margin: '16px 0 10px', lineHeight: 1.1 }}>
        Scan a product
      </h1>
      <p style={{ fontSize: 15.5, color: T.ink3, lineHeight: 1.6, margin: '0 0 28px' }}>
        Point your camera at a barcode — or snap the product — for an instant repairability and carbon
        score. Verified data where it exists, a clearly-labelled AI estimate where it doesn't.
      </p>

      {!scan && (
        <>
          <BarcodeScanner onDetected={runBarcode} busy={busy} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0' }}>
            <div style={{ flex: 1, height: 1, background: T.line }} />
            <span style={{ fontSize: 11.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>or</span>
            <div style={{ flex: 1, height: 1, background: T.line }} />
          </div>

          <label style={{ ...btnGhost, width: '100%', boxSizing: 'border-box', padding: '13px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            <Icon d={ICONS.camera} size={16} stroke={T.ink} sw={1.9} /> Upload a product photo
            <input ref={photoInputRef} type="file" accept="image/*" onChange={runPhoto} disabled={busy} style={{ display: 'none' }} />
          </label>
        </>
      )}

      {busy && (
        <div style={{ textAlign: 'center', padding: '28px 0', color: T.muted, fontSize: 13.5 }}>
          <Icon d={ICONS.spark} size={20} stroke={T.accent} sw={2} /> <div style={{ marginTop: 8 }}>{busyLabel}</div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 18, background: 'rgba(176,87,110,0.08)', border: '1px solid rgba(176,87,110,0.34)', color: '#8A3F52', fontSize: 13, lineHeight: 1.55, borderRadius: 12, padding: '13px 16px' }}>
          {error}
        </div>
      )}

      {scan && (
        <div>
          <ScanResultCard scan={scan} />

          {scan.needs_contribution && (
            <div style={{ marginTop: 22 }}>
              <ContributePrompt gtin={scan.gtin} productName={scan.productName} />
            </div>
          )}

          <button onClick={reset} style={{ ...btnGhost, marginTop: 22 }}>
            <Icon d={ICONS.barcode} size={14} stroke={T.ink} sw={1.9} /> Scan another product
          </button>
        </div>
      )}

      <p style={{ fontSize: 11, color: T.faint, lineHeight: 1.6, marginTop: 40 }}>
        Repairability scores come from the French durability/repairability index (verified). Carbon grades
        are coarse AI estimates from the product category — a starting point, not a measured figure. Every
        score on this page is labelled with where it came from.
      </p>
    </div>
  )
}
