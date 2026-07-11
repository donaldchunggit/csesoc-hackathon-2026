// Shown when a scanned product has no verified data. Invites the user to
// contribute a photo + details so we can score it later (POST /contribute-product).
import React, { useState } from 'react'
import { T, Icon, ICONS, btnAccent, btnGhost } from './tokens.jsx'
import { contributeProduct } from '../scanApi.js'

// Read a File into a base64 data URL for upload.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function ContributePrompt({ gtin, productName }) {
  const [name, setName] = useState(productName && productName !== 'Unknown product' ? productName : '')
  const [materials, setMaterials] = useState('')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState(null)      // { dataUrl, name }
  const [status, setStatus] = useState('idle')  // idle | saving | done | error
  const [error, setError] = useState('')

  const onPhoto = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await fileToDataUrl(file)
      setPhoto({ dataUrl, name: file.name })
    } catch {
      setError('Could not read that image.')
    }
  }

  const submit = async () => {
    setStatus('saving'); setError('')
    try {
      await contributeProduct({
        gtin,
        productName: name,
        submittedMaterials: materials,
        notes,
        photos: photo ? [photo.dataUrl] : [],
      })
      setStatus('done')
    } catch (e) {
      setStatus('error'); setError(e.message || 'Submission failed.')
    }
  }

  if (status === 'done') {
    return (
      <div style={{ background: 'rgba(91,122,78,0.10)', border: '1px solid rgba(91,122,78,0.34)', borderRadius: 16, padding: '20px 22px', textAlign: 'center' }}>
        <Icon d={ICONS.check} size={26} stroke={T.good} sw={2.2} />
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 8 }}>Thank you!</div>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55, marginTop: 5, maxWidth: 360, marginInline: 'auto' }}>
          Your submission helps us score this product for the next person who scans it.
        </div>
      </div>
    )
  }

  const input = {
    width: '100%', boxSizing: 'border-box', padding: '10px 13px', fontSize: 13.5,
    fontFamily: 'Nunito, sans-serif', background: T.page, color: T.ink,
    border: `1px solid ${T.line}`, borderRadius: 10, outline: 'none',
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, padding: '22px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
        <Icon d={ICONS.camera} size={18} stroke={T.accent} sw={1.9} />
        <span style={{ fontSize: 16, fontWeight: 700 }}>Help us score this product</span>
      </div>
      <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55, marginBottom: 16, maxWidth: 460 }}>
        We don't have verified data for this one yet{gtin ? ` (barcode ${gtin})` : ''}. Add what you know — a
        photo of the product or its label helps most — and we'll use it to score it.
      </div>

      <div style={{ display: 'grid', gap: 11 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name (e.g. Acme Kettle K10)" style={input} />
        <input value={materials} onChange={(e) => setMaterials(e.target.value)} placeholder="Main materials, if you know them (e.g. steel, ABS plastic)" style={input} />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything else — repairability, spare parts, etc." style={{ ...input, resize: 'vertical' }} />

        <label style={{ ...btnGhost, alignSelf: 'flex-start', cursor: 'pointer' }}>
          <Icon d={ICONS.upload} size={14} stroke={T.ink} sw={1.9} />
          {photo ? 'Change photo' : 'Add a photo'}
          <input type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
        </label>
        {photo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={photo.dataUrl} alt="preview" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 10, border: `1px solid ${T.line}` }} />
            <span style={{ fontSize: 12, color: T.muted }}>{photo.name}</span>
          </div>
        )}
      </div>

      {error && <div style={{ marginTop: 12, fontSize: 12.5, color: '#8A3F52' }}>{error}</div>}

      <div style={{ marginTop: 16 }}>
        <button onClick={submit} disabled={status === 'saving'} style={{ ...btnAccent, opacity: status === 'saving' ? 0.6 : 1 }}>
          {status === 'saving' ? 'Submitting…' : 'Submit contribution'}
        </button>
      </div>
    </div>
  )
}
