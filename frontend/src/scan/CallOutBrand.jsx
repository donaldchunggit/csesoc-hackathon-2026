// "Call out this brand" — turns a scan result into a pre-drafted, editable
// message the shopper can copy or open in their mail client. No backend.
import React, { useMemo, useState } from 'react'
import { T, Icon, ICONS, btnGhost } from './tokens.jsx'

// Build the default message purely from figures already in the scan result.
function draftMessage(scan) {
  const brand = scan.brand || 'there'
  const product = scan.productName && scan.productName !== 'Unknown product'
    ? `your ${scan.productName}`
    : 'one of your products'
  const r = scan.repairability
  let reasonLine = ''
  if (r && r.score != null) {
    const worst = Object.entries(r.criteria || {}).sort((a, b) => a[1] - b[1])[0]
    const because = worst ? ` — the lowest mark was for ${worst[0].toLowerCase()}` : ''
    reasonLine = `It scored ${r.score}/100 for repairability${because}. `
  }
  return (
    `Hi ${brand},\n\n` +
    `I scanned ${product} on EcoCompass. ${reasonLine}` +
    `As a customer, repairability and product lifespan matter to me. ` +
    `Could you share what repair options, spare parts or documentation you offer for it — and whether you plan to improve them?\n\n` +
    `Thanks!`
  )
}

export default function CallOutBrand({ scan }) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const initial = useMemo(() => draftMessage(scan), [scan])

  const openPanel = () => { setMsg(initial); setOpen(true); setCopied(false) }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — the textarea is still selectable */ }
  }

  const subject = `About the repairability of ${scan.productName || 'your product'}`
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`

  if (!open) {
    return (
      <button onClick={openPanel} className="eco-btn" style={{ ...btnGhost, borderColor: T.line }}>
        <Icon d={ICONS.megaphone} size={15} stroke={T.ink} sw={1.9} /> Call out this brand
      </button>
    )
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>Send {scan.brand || 'the brand'} a note</div>
      <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginBottom: 11 }}>
        Pre-drafted from your scan — edit it however you like, then copy it or open your mail app.
      </div>
      <textarea
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        rows={8}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '11px 13px',
          fontSize: 13, lineHeight: 1.55, fontFamily: 'Nunito, sans-serif',
          background: T.page, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10, outline: 'none',
        }}
      />
      <div style={{ display: 'flex', gap: 9, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={copy} className="eco-btn" style={{ ...btnGhost, background: copied ? 'rgba(91,122,78,0.14)' : T.card, borderColor: copied ? T.good : T.line, color: copied ? T.good : T.ink }}>
          <Icon d={copied ? ICONS.check : ICONS.copy} size={14} stroke={copied ? T.good : T.ink} sw={2} />
          {copied ? 'Copied' : 'Copy message'}
        </button>
        <a href={mailto} className="eco-btn" style={{ ...btnGhost, textDecoration: 'none' }}>
          <Icon d={ICONS.mail} size={14} stroke={T.ink} sw={1.9} /> Open in mail
        </a>
        <button onClick={() => setOpen(false)} className="eco-btn" style={{ ...btnGhost, border: 'none', background: 'transparent', color: T.muted }}>Cancel</button>
      </div>
    </div>
  )
}
