import React, { useMemo, useState, useEffect } from 'react'
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Legend, Tooltip,
} from 'recharts'
import {
  DATA, BOM, CATEGORIES, CAT_COLORS,
  mat, co2eColor, recycColor, fmtCost, datasetCsv,
} from './materials.js'
import { parseBomFile, bomTemplateCsv } from './bomParser.js'
import { generateEcoReport } from './pdfReport.js'
import { analyzeBom } from './analysis.js'

// --- ecocompass palette (mirrors the CSS vars in theme.css) ----------------
const T = {
  page: '#F4F1EA', card: '#FBFAF6', cardAlt: '#F2EEE3',
  ink: '#23211C', ink2: '#4A463C', ink3: '#6E6A5F', muted: '#8A857A', faint: '#A39C8C',
  line: '#E3DCCD', line2: '#EDE7DA',
  accent: '#1E3D2B', accentSoft: 'rgba(30,61,43,0.10)',
  good: '#5B7A4E', warn: '#A87A3C', bad: '#B0576E',
}

// Trigger a client-side download of CSV text without shipping a static file.
function downloadCsv(text, name) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const downloadDataset = () => downloadCsv(datasetCsv(), 'materials_dataset.csv')

// Meta describing the built-in sample BOM (the ergonomic task chair).
const SAMPLE_META = {
  productName: 'Ergo Task Chair · TC-200',
  componentCount: BOM.length,
  totalKg: BOM.reduce((s, b) => s + b.kg, 0),
  note: 'sample bill of materials',
}

// --- tiny inline icons -----------------------------------------------------
const Icon = ({ d, size = 24, stroke = 'currentColor', sw = 2, fill = 'none', ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
    {d.map((path, i) => <path key={i} d={path} />)}
  </svg>
)

const ARROW = ['M5 12h14', 'm12 5 7 7-7 7']

// Shared button styles.
const btnSolid = { display: 'inline-flex', alignItems: 'center', gap: 7, background: T.ink, color: T.page, border: 'none', fontSize: 13, fontWeight: 500, padding: '10px 16px', borderRadius: 9, cursor: 'pointer' }
const btnGhost = { display: 'inline-flex', alignItems: 'center', gap: 7, background: T.card, color: T.ink, border: `1px solid ${T.line}`, fontSize: 13, fontWeight: 500, padding: '10px 15px', borderRadius: 9, cursor: 'pointer' }
const eyebrow = { fontSize: 11, fontWeight: 400, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.18em' }

// How many library entries are credited to the Materiom Commons.
const MATERIOM_COUNT = DATA.filter((d) => d.source === 'materiom').length

// Credits a bio-based recipe family to the Materiom Commons.
function MateriomBadge({ big }) {
  return (
    <span title="Bio-based recipe family catalogued in the Materiom Commons" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(91,122,78,0.12)', border: '1px solid rgba(91,122,78,0.34)', color: T.good, fontSize: big ? 10.5 : 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: big ? '3px 9px' : '2px 6px', borderRadius: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: T.good }} /> Materiom
    </span>
  )
}

// ---------------------------------------------------------------------------
// Top navigation
// ---------------------------------------------------------------------------
function TopNav({ view, setView }) {
  const tab = (active) => ({
    background: 'transparent', border: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
    borderBottom: `2px solid ${active ? T.accent : 'transparent'}`,
    color: active ? T.ink : T.muted, fontSize: 14, fontWeight: 500, padding: '6px 1px',
    cursor: 'pointer',
  })
  return (
    <div className="no-print" style={{ position: 'sticky', top: 0, zIndex: 30, background: 'rgba(244,241,234,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: `1px solid ${T.line}` }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 32px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <img src="/logo-icon.svg" alt="ecocompass logo" width={30} height={30} style={{ display: 'block' }} />
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em', color: '#1A2117' }}>ecocompass</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <button onClick={() => setView(view === 'library' ? 'upload' : view)} style={tab(view !== 'library')}>Analyze BOM</button>
          <button onClick={() => setView('library')} style={tab(view === 'library')}>Material library</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload view
// ---------------------------------------------------------------------------
function UploadView({ fileName, onFile, onSample, busy, error }) {
  return (
    <div style={{ maxWidth: 660, margin: '0 auto', padding: '104px 32px 88px' }}>
      <div className="mono" style={eyebrow}>Sustainable swap engine</div>
      <h1 style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.035em', margin: '18px 0 18px', lineHeight: 1.08 }}>Know your material impact, precisely.</h1>
      <p style={{ fontSize: 17, color: T.ink3, lineHeight: 1.6, margin: '0 0 40px', maxWidth: 520 }}>Drop in your bill of materials and ecocompass maps every component to a lower-carbon alternative, with updated cost, embodied carbon and recyclability worked out for you.</p>

      <label style={{ display: 'block', background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: '44px 30px', cursor: busy ? 'default' : 'pointer', textAlign: 'center', transition: 'border-color .18s, background .18s' }}
        onMouseOver={(e) => { if (busy) return; e.currentTarget.style.borderColor = '#C9C1AE'; e.currentTarget.style.background = '#FEFDFB' }}
        onMouseOut={(e) => { e.currentTarget.style.borderColor = T.line; e.currentTarget.style.background = T.card }}>
        <input type="file" accept=".csv,.xlsx,.xls" disabled={busy} style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); e.target.value = '' }} />
        <div style={{ width: 46, height: 46, margin: '0 auto 16px', borderRadius: 11, border: `1px solid ${T.line}`, background: T.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={22} stroke={T.ink2} sw={1.6} d={['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12']} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 500 }}>{busy ? 'Reading…' : (fileName || 'Drop your BOM file here')}</div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 5 }}>CSV · component, material, kg · click to browse</div>
      </label>

      {error && (
        <div style={{ marginTop: 20, background: 'rgba(176,87,110,0.08)', border: '1px solid rgba(176,87,110,0.34)', color: '#8A3F52', fontSize: 13, lineHeight: 1.55, borderRadius: 12, padding: '12px 15px' }}>{error}</div>
      )}

      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        <button onClick={onSample} style={btnSolid}>Analyze sample BOM</button>
        <a href="#" onClick={(e) => { e.preventDefault(); downloadCsv(bomTemplateCsv(), 'bom_template.csv') }} style={{ fontSize: 13.5, fontWeight: 500, color: T.ink3, borderBottom: '1px solid #C9C1AE' }}>Download a BOM template</a>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Results view
// ---------------------------------------------------------------------------

// Per-line status identity — the green / yellow / red language used everywhere.
const STATUS = {
  green: { color: T.good, soft: 'rgba(91,122,78,0.12)', ring: 'rgba(91,122,78,0.34)', label: 'Recommended swap' },
  yellow: { color: T.warn, soft: 'rgba(168,122,60,0.12)', ring: 'rgba(168,122,60,0.34)', label: 'Review trade-offs' },
  red: { color: T.bad, soft: 'rgba(176,87,110,0.12)', ring: 'rgba(176,87,110,0.40)', label: 'Flagged — no viable swap' },
}

const signedMoney = (v) => (v < -0.005 ? '−$' : '+$') + Math.abs(v).toFixed(2)

function StatusDot({ status, size = 9 }) {
  const s = STATUS[status]
  return <span style={{ width: size, height: size, borderRadius: 99, background: s.color, boxShadow: `0 0 0 3px ${s.soft}`, display: 'inline-block', flexShrink: 0 }} />
}

// The carbon↔cost priority slider. Moving it re-calls the analyzer with new
// weights, which live-updates every ranking below.
function PrioritySlider({ value, onChange, loading }) {
  const pct = Math.round(value * 100)
  return (
    <div className="no-print" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: '18px 22px', marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          Ranking priority
          {loading && <span style={{ color: T.muted, fontWeight: 400 }}> · re-ranking…</span>}
        </div>
        <div className="mono" style={{ fontSize: 11.5, color: T.muted }}>{pct}% carbon / {100 - pct}% cost</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
        <span style={{ fontSize: 11.5, color: value < 0.5 ? T.ink : T.muted, fontWeight: 500, whiteSpace: 'nowrap' }}>Cost-focused</span>
        <input type="range" min={0} max={100} value={pct}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          style={{ flex: 1, accentColor: T.accent, cursor: 'pointer' }} />
        <span style={{ fontSize: 11.5, color: value > 0.5 ? T.ink : T.muted, fontWeight: 500, whiteSpace: 'nowrap' }}>Carbon-focused</span>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: '16px 18px' }}>
      <div className="mono" style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 8, color: color || T.ink }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: T.muted, marginTop: 4, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  )
}

// Annual-volume input × per-unit carbon saved → tonnes of CO₂e avoided a year.
function ScaledImpact({ co2eSavedPerUnit, annualVolume, setAnnualVolume }) {
  const tons = Math.max(0, co2eSavedPerUnit * annualVolume / 1000)
  return (
    <div style={{ background: T.accent, color: T.page, borderRadius: 16, padding: '22px 26px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 26 }}>
      <div>
        <div className="mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.14em', opacity: 0.72 }}>Scaled annual impact</div>
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em', marginTop: 6, lineHeight: 1 }}>
          {tons.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          <span style={{ fontSize: 17, fontWeight: 500, opacity: 0.85, marginLeft: 8 }}>t CO₂e / year</span>
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.82, marginTop: 8 }}>{co2eSavedPerUnit.toFixed(1)} kg saved per unit × annual production volume</div>
      </div>
      <div className="no-print">
        <div className="mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.72, marginBottom: 6 }}>Units / year</div>
        <input type="number" min={0} value={annualVolume}
          onChange={(e) => setAnnualVolume(Math.max(0, Number(e.target.value) || 0))}
          className="mono"
          style={{ width: 150, padding: '10px 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.25)', fontSize: 15, background: 'rgba(255,255,255,0.14)', color: T.page, outline: 'none' }} />
      </div>
    </div>
  )
}

// Radar comparing the original material vs the top suggestion across the four
// normalised axes (higher = better on every axis).
function RadarPanel({ line }) {
  return (
    <div style={{ width: '100%', height: 250, minWidth: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={line.radar} outerRadius="70%">
          <PolarGrid stroke={T.line} />
          <PolarAngleAxis dataKey="axis" tick={{ fill: T.ink3, fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar name={line.from} dataKey="original" stroke={T.muted} fill={T.muted} fillOpacity={0.16} strokeWidth={1.5} />
          {line.swapped && <Radar name={line.to} dataKey="suggestion" stroke={T.accent} fill={T.accent} fillOpacity={0.24} strokeWidth={1.6} />}
          <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'Geist Mono', monospace" }} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${T.line}`, background: T.card }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

// The per-component "results table": the top few viable candidates the engine
// ranked, plus the most tempting rejected ones with the reason they were cut.
function CandidatesTable({ line }) {
  const viable = line.viable.slice(0, 4)
  const rejected = line.rejected.slice(0, 3)
  const th = { fontFamily: "'Geist Mono', monospace", fontSize: 9.5, fontWeight: 400, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', padding: '7px 10px', borderBottom: `1px solid ${T.line}` }
  const td = { padding: '9px 10px', borderBottom: `1px solid ${T.line2}`, fontSize: 12 }
  const numTd = { ...td, textAlign: 'right', fontFamily: "'Geist Mono', monospace" }
  return (
    <div style={{ border: `1px solid ${T.line}`, borderRadius: 11, overflow: 'hidden', background: T.page }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 380 }}>
          <thead>
            <tr>
              <th style={th}>Candidate</th>
              <th style={{ ...th, textAlign: 'right' }}>CO₂e</th>
              <th style={{ ...th, textAlign: 'right' }}>Cost</th>
              <th style={{ ...th, textAlign: 'right' }}>Recyc</th>
              <th style={{ ...th, textAlign: 'right' }}>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {viable.map((c, i) => {
              const chosen = line.suggestion && c.material === line.suggestion.material
              return (
                <tr key={c.material} style={{ background: chosen ? STATUS.green.soft : 'transparent' }}>
                  <td style={td}>
                    <span className="mono" style={{ fontWeight: chosen ? 700 : 500, fontSize: 11.5 }}>{c.material}</span>
                    {c.source === 'materiom' && <span style={{ marginLeft: 6 }}><MateriomBadge /></span>}
                  </td>
                  <td style={{ ...numTd, color: co2eColor(c.co2e) }}>{c.co2e.toFixed(2)}</td>
                  <td style={numTd}>{fmtCost(c.cost)}</td>
                  <td style={numTd}>{c.recyclability.toFixed(2)}</td>
                  <td style={{ ...numTd, color: T.good, fontWeight: chosen ? 700 : 500 }}>{chosen ? '★ chosen' : `#${i + 1} viable`}</td>
                </tr>
              )
            })}
            {rejected.map((c) => (
              <tr key={c.material}>
                <td style={{ ...td, color: T.ink3 }}>
                  <span className="mono" style={{ fontSize: 11.5, textDecoration: 'line-through', textDecorationColor: STATUS.red.ring }}>{c.material}</span>
                </td>
                <td style={{ ...numTd, color: co2eColor(c.co2e) }}>{c.co2e.toFixed(2)}</td>
                <td style={numTd}>{fmtCost(c.cost)}</td>
                <td style={numTd}>{c.recyclability.toFixed(2)}</td>
                <td style={{ ...numTd, color: T.bad }} title={c.reasons.join('; ')}>✕ rejected</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Prominent rejection callout — the credibility feature. Names the requirement
// that must be met, then the seductive low-carbon options and exactly why each
// was turned down.
function RejectionPanel({ line }) {
  const shown = line.rejected.slice(0, 4)
  return (
    <div style={{ background: STATUS.red.soft, border: `1px solid ${STATUS.red.ring}`, borderRadius: 12, padding: '15px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={15} stroke={T.bad} sw={2.2} d={['M12 9v4', 'M12 17h.01', 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z']} />
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8A3F52' }}>No viable swap — kept the original</div>
      </div>
      <div style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.55, marginBottom: 12 }}>
        This part must clear <strong>{line.requirementText}</strong>. Every lower-impact candidate fails at least one of those bars:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map((c) => (
          <div key={c.material} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12, lineHeight: 1.5 }}>
            <span className="mono" style={{ fontWeight: 600, color: T.ink, minWidth: 128, flexShrink: 0 }}>{c.material}</span>
            <span style={{ color: T.bad }}>{c.reasons[0]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Pros / cons split for a viable swap.
function ProsCons({ line }) {
  const col = (title, items, color, mark, empty) => (
    <div>
      <div className="mono" style={{ fontSize: 10, color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{title}</div>
      {items.length ? items.map((t, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12.5, color: T.ink2, lineHeight: 1.5, marginBottom: 8 }}>
          <Icon size={13} stroke={color} sw={2.4} d={mark} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ flex: 1 }}>{t}</span>
        </div>
      )) : <div style={{ fontSize: 12.5, color: T.muted }}>{empty}</div>}
    </div>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
      {col('Pros', line.pros, T.accent, ['M20 6 9 17l-5-5'], 'No notable gains flagged.')}
      {col('Cons', line.cons, T.bad, ['M18 6 6 18M6 6l12 12'], 'No material trade-offs identified.')}
    </div>
  )
}

// One expandable results row: the scannable summary always shows; the detail
// (radar + candidate table + reasons) drops down when opened.
function LineRow({ line, open, onToggle }) {
  const s = STATUS[line.status]
  const carbonSaved = line.co2eFrom - line.co2eTo
  const costDelta = line.costTo - line.costFrom
  const cell = { padding: '13px 12px', borderBottom: open ? 'none' : `1px solid ${T.line2}`, fontSize: 13, verticalAlign: 'middle' }
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: open ? T.cardAlt : 'transparent' }}
        onMouseOver={(e) => { if (!open) e.currentTarget.style.background = T.cardAlt }}
        onMouseOut={(e) => { if (!open) e.currentTarget.style.background = 'transparent' }}>
        <td style={{ ...cell, paddingLeft: 18, width: 30 }}><StatusDot status={line.status} /></td>
        <td style={cell}>
          <div style={{ fontWeight: 600 }}>{line.component}</div>
          <div style={{ fontSize: 11.5, color: s.color, marginTop: 2 }}>{s.label}</div>
        </td>
        <td style={{ ...cell }} className="mono">
          {line.swapped ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ color: T.faint, textDecoration: 'line-through' }}>{line.from}</span>
              <Icon size={12} stroke={T.muted} sw={2} d={ARROW} />
              <span style={{ color: T.ink, fontWeight: 600 }}>{line.to}</span>
            </span>
          ) : (
            <span style={{ fontSize: 12, color: T.ink2 }}>{line.from} <span style={{ color: T.muted }}>· kept</span></span>
          )}
        </td>
        <td style={{ ...cell, textAlign: 'right' }} className="mono">
          {carbonSaved > 0.05
            ? <span style={{ color: T.good, fontWeight: 600 }}>−{carbonSaved.toFixed(1)} kg</span>
            : <span style={{ color: T.muted }}>—</span>}
        </td>
        <td style={{ ...cell, textAlign: 'right' }} className="mono">
          {line.swapped
            ? <span style={{ color: costDelta > 0.005 ? T.warn : T.good, fontWeight: 600 }}>{signedMoney(costDelta)}</span>
            : <span style={{ color: T.muted }}>—</span>}
        </td>
        <td style={{ ...cell, textAlign: 'right', paddingRight: 18, width: 40 }}>
          <Icon size={16} stroke="#BEB6A3" sw={2} d={open ? ['m18 15-6-6-6 6'] : ['m6 9 6 6 6-6']} />
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ padding: 0, borderBottom: `1px solid ${T.line2}`, background: T.cardAlt }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 340px) 1fr', gap: 22, padding: '8px 20px 22px', alignItems: 'start' }}>
              <div>
                <div className="mono" style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Property profile</div>
                <RadarPanel line={line} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, paddingTop: 6 }}>
                <div style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.55 }}>{line.statusReason}</div>
                {line.status === 'red' ? <RejectionPanel line={line} /> : <ProsCons line={line} />}
                <div>
                  <div className="mono" style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                    Candidates considered <span style={{ textTransform: 'none', letterSpacing: 0 }}>· {line.viable.length} viable / {line.rejected.length} rejected</span>
                  </div>
                  <CandidatesTable line={line} />
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ResultsView({ setView, bom: bomInput, meta, warnings }) {
  const [carbonWeight, setCarbonWeight] = useState(0.6)
  const [annualVolume, setAnnualVolume] = useState(10000)
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set())

  // The upload/slider → analyzer seam. Re-runs whenever the BOM or the priority
  // weight changes; this is the single call site a real POST /analyze-bom
  // backend slots into (see analysis.js).
  useEffect(() => {
    let live = true
    setLoading(true)
    analyzeBom(bomInput, { carbon: carbonWeight }).then((res) => {
      if (!live) return
      setAnalysis(res)
      setLoading(false)
      // On the first analysis, auto-open any flagged line so the rejection
      // reasoning is visible without a click.
      setExpanded((prev) => (prev.size ? prev : new Set(res.lines.filter((l) => l.status === 'red').map((l) => l.component))))
    })
    return () => { live = false }
  }, [bomInput, carbonWeight])

  const totalKg = bomInput.reduce((s, b) => s + b.kg, 0)
  const toggle = (name) => setExpanded((prev) => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const summary = analysis?.summary
  const headline = summary
    ? (summary.flaggedCount > 0
      ? `${summary.viableCount} of ${bomInput.length} components have a recommended lower-impact swap; ${summary.flaggedCount} flagged for review.`
      : (summary.ecoGrade <= 'B'
        ? 'This build meaningfully cuts embodied carbon while holding cost and function.'
        : 'Solid carbon and recyclability gains with a few trade-offs to review.'))
    : ''

  // Assemble the payload the PDF generator renders from the live analysis.
  const exportPdf = () => {
    if (!analysis) return
    generateEcoReport({
      meta,
      componentCount: bomInput.length,
      totalKg,
      dateStr: new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }),
      ecoScore: summary.ecoScore, ecoGrade: summary.ecoGrade, headline,
      co2ePct: summary.co2ePct, costDelta: signedMoney(summary.costDelta), costUp: summary.costUp, recycPts: summary.recycPts,
      costFrom: summary.costFrom, costTo: summary.costTo,
      co2eFrom: summary.co2eFrom, co2eTo: summary.co2eTo,
      swaps: analysis.lines.map((l) => ({
        component: l.component,
        from: l.from,
        to: l.to,
        swapped: l.swapped,
        flagged: l.status === 'red',
        note: l.status === 'red' ? (l.rejected[0] ? `${l.rejected[0].material}: ${l.rejected[0].reasons[0]}` : l.statusReason) : '',
        cost: fmtCost(l.costTo),
        co2e: l.co2eTo.toFixed(1),
        pros: l.status === 'red' ? [`Must clear ${l.requirementText}`] : l.pros,
        cons: l.status === 'red' ? l.rejected.slice(0, 2).map((r) => `${r.material}: ${r.reasons[0]}`) : l.cons,
      })),
    })
  }

  const th = { fontFamily: "'Geist Mono', monospace", fontSize: 10.5, fontWeight: 400, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: `1px solid ${T.line}`, padding: '12px', textAlign: 'left' }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '44px 32px 96px' }}>
      <div className="no-print" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 26 }}>
        <div>
          <a href="#" onClick={(e) => { e.preventDefault(); setView('upload') }} style={{ fontSize: 13, fontWeight: 500, color: T.muted, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon size={14} sw={2} d={['M19 12H5', 'm12 19-7-7 7-7']} /> New analysis
          </a>
          <div style={{ fontSize: 27, fontWeight: 600, letterSpacing: '-0.03em', marginTop: 12 }}>{meta.productName}</div>
          <div style={{ fontSize: 13.5, color: T.muted, marginTop: 4 }}>{bomInput.length} components · {totalKg.toFixed(1)} kg / unit · {meta.note}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={downloadDataset} style={btnGhost}>
            <Icon size={14} sw={2} d={['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3']} /> Export dataset
          </button>
          <button onClick={exportPdf} disabled={!analysis} style={{ ...btnSolid, opacity: analysis ? 1 : 0.5 }}>
            <Icon size={14} stroke={T.page} sw={2} d={['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M9 15h6M9 11h3']} /> Export PDF report
          </button>
        </div>
      </div>

      {warnings && warnings.length > 0 && (
        <div className="no-print" style={{ background: 'rgba(168,122,60,0.08)', border: '1px solid rgba(168,122,60,0.34)', borderRadius: 12, padding: '13px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.warn, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{warnings.length} note{warnings.length > 1 ? 's' : ''} while parsing</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: T.ink2, lineHeight: 1.6 }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <PrioritySlider value={carbonWeight} onChange={setCarbonWeight} loading={loading} />

      {!summary ? (
        <div style={{ padding: '80px 0', textAlign: 'center', color: T.muted, fontSize: 14 }}>Analyzing bill of materials…</div>
      ) : (
        <>
          {/* Summary dashboard */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '4px 0 14px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Analysis summary</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: T.card, border: `1px solid ${T.line}`, borderRadius: 99, padding: '5px 13px' }}>
              <span className="mono" style={{ fontSize: 10.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Eco score</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: summary.ecoScore >= 75 ? T.good : summary.ecoScore >= 50 ? T.warn : T.bad }}>{summary.ecoScore}</span>
              <span className="mono" style={{ fontSize: 11, color: T.muted }}>{summary.ecoGrade}</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
            <StatCard label="CO₂e saved / unit" value={`${summary.co2eSaved.toFixed(1)} kg`} sub={`−${summary.co2ePct}% vs baseline spec`} color={T.accent} />
            <StatCard label="Cost delta / unit" value={signedMoney(summary.costDelta)} sub={summary.costUp ? 'added material cost' : 'net material saving'} color={summary.costUp ? T.warn : T.good} />
            <StatCard label="Viable swaps" value={`${summary.viableCount}`} sub={`of ${bomInput.length} components`} color={T.good} />
            <StatCard label="Flagged" value={`${summary.flaggedCount}`} sub={summary.flaggedCount ? 'no viable swap — review' : 'none — all resolved'} color={summary.flaggedCount ? T.bad : T.ink3} />
          </div>

          <ScaledImpact co2eSavedPerUnit={summary.co2eSaved} annualVolume={annualVolume} setAnnualVolume={setAnnualVolume} />

          {/* Per-component results table (expand a row for radar + reasoning) */}
          <div style={{ fontSize: 15, fontWeight: 600, margin: '30px 0 12px' }}>
            Component suggestions <span style={{ color: T.muted, fontWeight: 400 }}>· click a row for the property radar &amp; candidate breakdown</span>
          </div>
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 660 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, paddingLeft: 18 }}></th>
                    <th style={th}>Component</th>
                    <th style={th}>Suggested swap</th>
                    <th style={{ ...th, textAlign: 'right' }}>Carbon</th>
                    <th style={{ ...th, textAlign: 'right' }}>Cost Δ</th>
                    <th style={{ ...th, textAlign: 'right', paddingRight: 18 }}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.lines.map((line) => (
                    <LineRow key={line.component} line={line} open={expanded.has(line.component)} onToggle={() => toggle(line.component)} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="no-print" style={{ fontSize: 11.5, color: T.faint, marginTop: 18, lineHeight: 1.65 }}>
            Rankings recompute live from the priority slider. A swap is only offered when it clears the part's functional requirements — anything that fails is flagged with the specific reason, never silently dropped. Figures marked <em>estimated</em> in the dataset are indicative.
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Material library view
// ---------------------------------------------------------------------------
function LibraryView({ query, setQuery, category, setCategory, sortKey, sortDir, setSort, setSelected, openSuggest }) {
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = DATA.filter((d) => {
      const okCat = category === 'all' || d.category === category
      const okQ = !q || d.name.toLowerCase().includes(q) || d.category.includes(q) || d.source_note.toLowerCase().includes(q)
      return okCat && okQ
    })
    return list.slice().sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string') return sortDir * av.localeCompare(bv)
      return sortDir * (av - bv)
    })
  }, [query, category, sortKey, sortDir])

  const thBase = { fontFamily: "'Geist Mono', monospace", fontSize: 10.5, fontWeight: 400, color: T.muted, cursor: 'pointer', borderBottom: `1px solid ${T.line}`, textTransform: 'uppercase', letterSpacing: '0.08em', userSelect: 'none' }
  const sortableTh = (key, label, unit) => (
    <th onClick={() => setSort(key)} style={{ ...thBase, textAlign: unit ? 'right' : 'left', padding: unit ? '13px 12px' : '13px 22px', whiteSpace: unit ? 'nowrap' : undefined, color: sortKey === key ? T.ink : T.muted }}>
      {label}{unit && <span style={{ color: '#B4AD9C' }}> {unit}</span>}{sortKey === key && <span>{sortDir > 0 ? ' ↑' : ' ↓'}</span>}
    </th>
  )

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '44px 32px 88px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 26 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.03em' }}>Material library</div>
          <div style={{ fontSize: 13.5, color: T.muted, marginTop: 4 }}>{DATA.length} materials · <span style={{ color: T.good }}>{MATERIOM_COUNT} bio-based via the Materiom Commons</span></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={openSuggest} style={btnGhost}>
            <Icon size={14} sw={2} d={['M12 5v14', 'M5 12h14']} /> Suggest a material
          </button>
          <button onClick={downloadDataset} style={btnSolid}>
            <Icon size={14} stroke={T.page} sw={2} d={['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3']} /> Download CSV
          </button>
        </div>
      </div>

      <div style={{ fontSize: 13, color: T.muted, margin: '-14px 0 22px', lineHeight: 1.6 }}>This library is community-sourced. See a gap or a better figure? <a href="#" onClick={(e) => { e.preventDefault(); openSuggest() }} style={{ color: T.accent, fontWeight: 500, borderBottom: '1px solid currentColor' }}>Suggest a material</a> and we'll review it for inclusion.</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <svg style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#A39C8C" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
          <input type="text" placeholder="Search materials…" value={query} onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', padding: '11px 13px 11px 38px', border: `1px solid ${T.line}`, borderRadius: 9, fontSize: 13.5, fontFamily: 'Nunito, sans-serif', color: T.ink, background: T.card, outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORIES.map((c) => {
            const on = category === c
            return (
              <button key={c} onClick={() => setCategory(c)} style={{
                background: on ? T.ink : T.card, color: on ? T.page : T.ink3,
                border: `1px solid ${on ? T.ink : T.line}`,
                fontSize: 12.5, fontWeight: 500, padding: '8px 13px', borderRadius: 8, cursor: 'pointer', textTransform: 'capitalize',
              }}>{c === 'all' ? 'All' : c}</button>
            )
          })}
        </div>
      </div>

      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 760 }}>
            <thead>
              <tr>
                {sortableTh('name', 'Material')}
                {sortableTh('tensile_strength_mpa', 'Tensile', 'MPa')}
                {sortableTh('cost_per_kg', 'Cost', '$/kg')}
                {sortableTh('co2e_per_kg', 'CO₂e', 'kg/kg')}
                <th onClick={() => setSort('recyclability_score')} style={{ ...thBase, textAlign: 'left', padding: '13px 12px', color: sortKey === 'recyclability_score' ? T.ink : T.muted }}>Recyclability{sortKey === 'recyclability_score' && <span>{sortDir > 0 ? ' ↑' : ' ↓'}</span>}</th>
                <th style={{ textAlign: 'right', padding: '13px 22px', borderBottom: `1px solid ${T.line}` }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cc = CAT_COLORS[r.category] || T.muted
                return (
                  <tr key={r.name} onClick={() => setSelected(r.name)} style={{ cursor: 'pointer' }}
                    onMouseOver={(e) => { e.currentTarget.style.background = T.cardAlt }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent' }}>
                    <td style={{ padding: '14px 22px', borderBottom: `1px solid ${T.line2}` }}>
                      <div className="mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{r.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                        <span className="mono" style={{ fontSize: 10, fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.06em', color: cc }}>{r.category}</span>
                        {r.source === 'materiom' && <MateriomBadge />}
                      </div>
                    </td>
                    <td className="mono" style={{ padding: '14px 12px', textAlign: 'right', borderBottom: `1px solid ${T.line2}`, color: T.ink2 }}>{r.tensile_strength_mpa}</td>
                    <td className="mono" style={{ padding: '14px 12px', textAlign: 'right', borderBottom: `1px solid ${T.line2}`, color: T.ink2 }}>{fmtCost(r.cost_per_kg)}</td>
                    <td className="mono" style={{ padding: '14px 12px', textAlign: 'right', fontWeight: 500, borderBottom: `1px solid ${T.line2}` }}>
                      <span style={{ color: co2eColor(r.co2e_per_kg) }}>{r.co2e_per_kg.toFixed(2)}</span>
                    </td>
                    <td style={{ padding: '14px 12px', borderBottom: `1px solid ${T.line2}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div style={{ width: 52, height: 5, background: '#E7E1D3', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: Math.round(r.recyclability_score * 100) + '%', height: '100%', background: recycColor(r.recyclability_score), borderRadius: 4 }} />
                        </div>
                        <span className="mono" style={{ fontSize: 12, color: T.ink2 }}>{r.recyclability_score.toFixed(2)}</span>
                      </div>
                    </td>
                    <td style={{ padding: '14px 22px', textAlign: 'right', borderBottom: `1px solid ${T.line2}` }}>
                      <Icon size={15} stroke="#BEB6A3" sw={2} d={['m9 18 6-6-6-6']} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Suggest-a-material modal
// ---------------------------------------------------------------------------
const SUGGEST_CATEGORIES = ['metal', 'plastic', 'bioplastic', 'wood', 'natural', 'biocomposite', 'composite']

function SuggestModal({ open, sent, form, setForm, onClose, onSubmit }) {
  if (!open) return null
  const label = { fontSize: 12, fontWeight: 600, color: T.ink2, marginBottom: 6 }
  const field = { width: '100%', padding: '11px 13px', border: `1px solid ${T.line}`, borderRadius: 9, fontSize: 13.5, fontFamily: 'Nunito, sans-serif', color: T.ink, background: T.page, outline: 'none' }
  const closeBtn = <button onClick={onClose} style={{ border: `1px solid ${T.line}`, background: T.page, width: 32, height: 32, borderRadius: 8, cursor: 'pointer', color: T.ink3, fontSize: 17, lineHeight: 1, flexShrink: 0 }}>×</button>
  const canSubmit = form.name.trim().length > 0

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(35,33,28,0.28)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px,100%)', maxHeight: '88vh', overflowY: 'auto', background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: '0 24px 60px rgba(35,33,28,0.18)', padding: '28px 28px 30px' }}>
        {sent ? (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>Thanks for the suggestion</div>
              {closeBtn}
            </div>
            <div style={{ fontSize: 14, color: T.ink2, lineHeight: 1.6, marginTop: 10 }}>We'll review <strong>{form.name || 'your material'}</strong> and, if the data checks out, add it to the library with a source citation.</div>
            <button onClick={onClose} style={{ ...btnSolid, marginTop: 22, padding: '12px 22px', fontSize: 14 }}>Done</button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>Suggest a material</div>
                <div style={{ fontSize: 13, color: T.muted, marginTop: 5, lineHeight: 1.5 }}>Know a material with good sourced data on cost, carbon or recyclability? Add it here.</div>
              </div>
              {closeBtn}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 22 }}>
              <div>
                <div style={label}>Material name</div>
                <input type="text" placeholder="e.g. recycled_carbon_fiber" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={field} />
              </div>
              <div>
                <div style={label}>Category</div>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={field}>
                  {SUGGEST_CATEGORIES.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div>
                <div style={label}>Why should we add it?</div>
                <textarea placeholder="Notable properties, where you'd use it, why it's a good swap…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} style={{ ...field, resize: 'vertical' }} />
              </div>
              <div>
                <div style={label}>Source link <span style={{ fontWeight: 400, color: T.muted }}>(optional but preferred)</span></div>
                <input type="text" placeholder="https://…" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} style={field} />
              </div>
              <div>
                <div style={label}>Your email <span style={{ fontWeight: 400, color: T.muted }}>(optional, in case we have questions)</span></div>
                <input type="text" placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={field} />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 24 }}>
              <button onClick={onSubmit} disabled={!canSubmit} style={{ border: 'none', fontSize: 14, fontWeight: 500, padding: '12px 22px', borderRadius: 9, fontFamily: 'Nunito, sans-serif', ...(canSubmit ? { background: T.ink, color: T.page, cursor: 'pointer' } : { background: T.line, color: T.faint, cursor: 'not-allowed' }) }}>Submit suggestion</button>
              <button onClick={onClose} style={{ background: 'transparent', color: T.ink3, border: 'none', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------
function DetailDrawer({ material, onClose }) {
  if (!material) return null
  const m = material
  const accent = CAT_COLORS[m.category] || T.accent
  const specs = [
    { label: 'Density', value: m.density.toLocaleString() + ' kg/m³' },
    { label: 'Tensile strength', value: m.tensile_strength_mpa + ' MPa' },
    { label: 'Max service temp', value: m.max_temp_c + ' °C' },
    { label: 'Cost (approx)', value: fmtCost(m.cost_per_kg) + '/kg' },
    { label: 'CO₂e (cradle-gate)', value: m.co2e_per_kg.toFixed(2) + ' kg/kg' },
    { label: 'Recyclability', value: m.recyclability_score.toFixed(2) },
    { label: 'Durability', value: m.durability_years + ' yrs' },
    { label: 'Outdoor / Food', value: (m.outdoor_safe ? 'Yes' : 'No') + ' / ' + (m.food_safe ? 'Yes' : 'No') },
  ]
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(35,33,28,0.28)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', zIndex: 40, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px,92vw)', height: '100%', background: T.card, borderLeft: `1px solid ${T.line}`, boxShadow: '-14px 0 40px rgba(35,33,28,0.10)', overflowY: 'auto', padding: '28px 28px 44px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div className="mono" style={{ fontSize: 10.5, fontWeight: 400, color: accent, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{m.category}</div>
              {m.source === 'materiom' && <MateriomBadge big />}
            </div>
            <div className="mono" style={{ fontSize: 21, fontWeight: 600, marginTop: 6, color: T.ink }}>{m.name}</div>
          </div>
          <button onClick={onClose} style={{ border: `1px solid ${T.line}`, background: T.page, width: 32, height: 32, borderRadius: 8, cursor: 'pointer', color: T.ink3, fontSize: 17, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: T.line, border: `1px solid ${T.line}`, borderRadius: 11, overflow: 'hidden', marginTop: 24 }}>
          {specs.map((s) => (
            <div key={s.label} style={{ background: T.page, padding: '12px 14px' }}>
              <div className="mono" style={{ fontSize: 10, fontWeight: 400, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 500, marginTop: 4, color: T.ink }}>{s.value}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 24 }}>
          <div className="mono" style={{ fontSize: 10.5, fontWeight: 400, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 9 }}>Source note &amp; rationale</div>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: T.ink2, background: T.page, border: `1px solid ${T.line}`, borderRadius: 11, padding: '15px 16px' }}>{m.source_note}</div>
        </div>
        <a href={m.source_url} target="_blank" rel="noopener noreferrer" style={{ ...btnSolid, marginTop: 20, textDecoration: 'none' }}>
          <Icon size={15} stroke={T.page} d={['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6']} /> {m.source === 'materiom' ? 'Explore in the Materiom Commons' : 'Open primary source'}
        </a>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
const EMPTY_SUGGEST = { name: '', category: 'metal', notes: '', source: '', email: '' }

export default function App() {
  const [view, setView] = useState('upload') // upload | results | library
  const [fileName, setFileName] = useState(null)
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [bom, setBom] = useState(BOM)          // rows currently shown in results
  const [meta, setMeta] = useState(SAMPLE_META)
  const [warnings, setWarnings] = useState([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sortKey, setSortKey] = useState('co2e_per_kg')
  const [sortDir, setSortDir] = useState(1)
  const [selectedName, setSelectedName] = useState(null)
  const [showSuggest, setShowSuggest] = useState(false)
  const [suggestSent, setSuggestSent] = useState(false)
  const [suggestForm, setSuggestForm] = useState(EMPTY_SUGGEST)

  const setSort = (key) => {
    setSortDir((d) => (sortKey === key ? -d : 1))
    setSortKey(key)
  }
  const selected = DATA.find((d) => d.name === selectedName) || null

  const openSuggest = () => { setSuggestForm(EMPTY_SUGGEST); setSuggestSent(false); setShowSuggest(true) }
  const submitSuggest = () => { if (suggestForm.name.trim()) setSuggestSent(true) }

  const analyzeSample = () => {
    setBom(BOM); setMeta(SAMPLE_META); setWarnings([]); setUploadError(null)
    setFileName(null); setView('results')
  }

  const analyzeFile = async (file) => {
    setFileName(file.name); setUploadError(null); setBusy(true)
    const { rows, warnings: warn, meta: m, error } = await parseBomFile(file)
    setBusy(false)
    if (error) { setUploadError(error); return }
    if (!rows.length) {
      setUploadError((warn && warn[0]) || 'No usable rows found in the file.')
      return
    }
    setBom(rows); setMeta(m); setWarnings(warn || []); setView('results')
  }

  return (
    <div style={{ minHeight: '100vh', background: T.page, color: T.ink }}>
      <TopNav view={view} setView={setView} />

      {view === 'upload' && <UploadView fileName={fileName} onFile={analyzeFile} onSample={analyzeSample} busy={busy} error={uploadError} />}
      {view === 'results' && <ResultsView setView={setView} bom={bom} meta={meta} warnings={warnings} />}
      {view === 'library' && (
        <LibraryView
          query={query} setQuery={setQuery}
          category={category} setCategory={setCategory}
          sortKey={sortKey} sortDir={sortDir} setSort={setSort}
          setSelected={setSelectedName} openSuggest={openSuggest}
        />
      )}

      <SuggestModal open={showSuggest} sent={suggestSent} form={suggestForm} setForm={setSuggestForm}
        onClose={() => setShowSuggest(false)} onSubmit={submitSuggest} />
      <DetailDrawer material={selected} onClose={() => setSelectedName(null)} />
    </div>
  )
}
