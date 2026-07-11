// The scan result card — the heart of consumer scan mode.
//
// Shows BOTH grades (repairability + carbon) as 0-100 scores with a 4-band
// colour verdict, each carrying a provenance badge that makes "Verified" and
// "Estimated" impossible to confuse. Plus the grounded narrative, one better
// alternative, and the call-out-brand action.
import React from 'react'
import { T, Icon, ICONS, bandStyle } from './tokens.jsx'
import CallOutBrand from './CallOutBrand.jsx'

// Provenance badge — the trust requirement. Verified = solid green + check;
// Estimated = dashed amber + spark + confidence. Deliberately distinct.
function ProvenanceBadge({ kind, confidence }) {
  if (kind === 'verified') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700,
        letterSpacing: '0.03em', textTransform: 'uppercase', color: '#2F6B43',
        background: 'rgba(47,107,67,0.12)', border: '1px solid rgba(47,107,67,0.34)',
        borderRadius: 7, padding: '3px 8px', whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        <Icon d={ICONS.check} size={11} stroke="#2F6B43" sw={2.6} /> Verified
      </span>
    )
  }
  if (kind === 'estimated') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700,
        letterSpacing: '0.03em', textTransform: 'uppercase', color: T.warn,
        background: 'rgba(168,122,60,0.12)', border: '1px dashed rgba(168,122,60,0.6)',
        borderRadius: 7, padding: '3px 8px', whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        <Icon d={ICONS.spark} size={11} stroke={T.warn} sw={2} /> Estimated{confidence ? ` · ${confidence}` : ''}
      </span>
    )
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700,
      letterSpacing: '0.03em', textTransform: 'uppercase', color: T.muted,
      background: T.cardAlt, border: `1px solid ${T.line}`, borderRadius: 7, padding: '3px 8px',
    }}>
      No data
    </span>
  )
}

// A single grade tile: big score, band verdict, provenance, sub-caption.
function GradeTile({ title, score, band, provenanceKind, confidence, caption }) {
  const b = bandStyle(band)
  const has = score != null
  return (
    <div style={{ flex: 1, minWidth: 200, background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</span>
        <ProvenanceBadge kind={provenanceKind} confidence={confidence} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 76, height: 76, flexShrink: 0, borderRadius: '50%',
          border: `5px solid ${has ? b.ring : T.line}`, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, color: has ? b.fg : T.faint }}>
            {has ? score : '—'}
          </span>
          <span style={{ fontSize: 9, color: T.faint, marginTop: 2 }}>/ 100</span>
        </div>
        <div>
          <div style={{
            display: 'inline-block', fontSize: 13, fontWeight: 800, color: b.fg,
            background: b.bg, borderRadius: 8, padding: '4px 11px',
          }}>{has ? b.label : 'No data yet'}</div>
          {caption && <div style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.5, marginTop: 8, maxWidth: 240 }}>{caption}</div>}
        </div>
      </div>
    </div>
  )
}

// Horizontal bars for the repairability sub-criteria (verified detail).
function CriteriaBars({ criteria }) {
  const entries = Object.entries(criteria || {})
  if (!entries.length) return null
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ink3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Repairability breakdown
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {entries.map(([label, val]) => {
          const b = bandStyle(bandFromScore(val))
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: T.ink2, width: 168, flexShrink: 0 }}>{label}</span>
              <div style={{ flex: 1, height: 7, background: T.cardAlt, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${val}%`, height: '100%', background: b.ring, borderRadius: 99 }} />
              </div>
              <span className="mono" style={{ fontSize: 11, color: T.muted, width: 30, textAlign: 'right' }}>{val}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Local mirror of the backend band thresholds (Bad<25≤Poor<50≤Good<75≤Excellent).
function bandFromScore(s) {
  if (s >= 75) return 'Excellent'
  if (s >= 50) return 'Good'
  if (s >= 25) return 'Poor'
  return 'Bad'
}

export default function ScanResultCard({ scan }) {
  const r = scan.repairability || {}
  const c = scan.carbon
  const alt = scan.alternative

  return (
    <div>
      <div style={{ marginBottom: 4, fontSize: 12, color: T.muted }}>
        {scan.brand ? scan.brand + ' · ' : ''}{scan.category || 'Product'}{scan.gtin ? ` · ${scan.gtin}` : ''}
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 18px' }}>
        {scan.productName || 'Scanned product'}
      </h2>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <GradeTile
          title="Repairability"
          score={r.score}
          band={r.band}
          provenanceKind={r.source === 'verified_fr_index' ? 'verified' : 'none'}
          caption={r.provenance || 'No verified repairability data yet.'}
        />
        <GradeTile
          title="Carbon"
          score={c?.score}
          band={c?.band}
          provenanceKind={c ? 'estimated' : 'none'}
          confidence={c?.confidence}
          caption={c ? (c.provenance + (c.rationale ? ` — ${c.rationale}` : '')) : 'No carbon estimate available.'}
        />
      </div>

      {/* Grounded plain-language verdict. */}
      {scan.narrative && (
        <div style={{ marginTop: 16, background: T.cardAlt, border: `1px solid ${T.line2}`, borderRadius: 14, padding: '15px 17px', fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>
          {scan.narrative}
        </div>
      )}

      <CriteriaBars criteria={r.criteria} />

      {/* One better-scoring alternative. */}
      {alt && (
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(47,107,67,0.06)', border: '1px solid rgba(47,107,67,0.22)', borderRadius: 14, padding: '14px 16px' }}>
          <div style={{ width: 46, height: 46, flexShrink: 0, borderRadius: '50%', border: `4px solid ${bandStyle(alt.band).ring}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: bandStyle(alt.band).fg }}>
            {alt.score}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.accent, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Better-scoring option</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{alt.productName}</div>
            <div style={{ fontSize: 12, color: T.ink3 }}>{alt.brand ? alt.brand + ' · ' : ''}scores {alt.score}/100 for repairability ({bandStyle(alt.band).label.toLowerCase()})</div>
          </div>
        </div>
      )}

      {/* Call out the brand. */}
      <div style={{ marginTop: 18 }}>
        <CallOutBrand scan={scan} />
      </div>
    </div>
  )
}
