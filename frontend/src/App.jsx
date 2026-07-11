import React, { useMemo, useState, useEffect, useRef } from 'react'
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
import { analyzeBom, lastSource } from './analysis.js'
import { extractBom, fetchNarrative, fetchIncentives } from './api.js'
import ScanView from './scan/ScanView.jsx'

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

// Meta describing the built-in sample BOM (the cordless handheld vacuum).
const SAMPLE_META = {
  productName: 'Cordless Handheld Vacuum · HV-90',
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

// Human-readable material name for dropdowns / labels (drops the internal underscores).
const prettyMat = (name) => String(name || '').replace(/_/g, ' ')

// Library materials grouped by category — powers the material-review dropdown.
const MATERIAL_GROUPS = CATEGORIES.filter((c) => c !== 'all')
  .map((cat) => ({ cat, items: DATA.filter((d) => d.category === cat) }))
  .filter((g) => g.items.length)

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
          {(() => {
            const isBom = view === 'upload' || view === 'results'
            return (
              <>
                <button onClick={() => setView(isBom ? view : 'upload')} style={tab(isBom)}>Analyze BOM</button>
                <button onClick={() => setView('library')} style={tab(view === 'library')}>Material library</button>
                <button onClick={() => setView('scan')} style={{ ...tab(view === 'scan'), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  Scan a product
                  <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.good, background: 'rgba(91,122,78,0.14)', borderRadius: 5, padding: '1px 5px' }}>Free</span>
                </button>
              </>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload view
// ---------------------------------------------------------------------------
function UploadView({ fileName, onFile, onSample, onLoadSample, busy, busyLabel, error }) {
  const chip = { background: T.card, color: T.ink3, border: `1px solid ${T.line}`, fontSize: 12.5, fontWeight: 500, padding: '6px 12px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', fontFamily: 'Nunito, sans-serif' }
  return (
    <div style={{ maxWidth: 660, margin: '0 auto', padding: '104px 32px 88px' }}>
      <div className="mono" style={eyebrow}>Carbon + repairability engine</div>
      <h1 style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.035em', margin: '18px 0 18px', lineHeight: 1.08 }}>Score any build on carbon and repairability.</h1>
      <p style={{ fontSize: 17, color: T.ink3, lineHeight: 1.6, margin: '0 0 24px', maxWidth: 540 }}>Drop in a bill of materials. ecocompass finds lower-carbon material swaps — and refuses the ones it can't justify, telling you why — then scores how repairable and long-lived the design is, with concrete fixes to raise it.</p>
      <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, margin: '0 0 34px', maxWidth: 540 }}>Every figure is a transparent, sourced estimate — each material links to its primary source and the reason behind a rejected swap, so you can check our working, not just trust a number.</p>

      <label style={{ display: 'block', background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: '44px 30px', cursor: busy ? 'default' : 'pointer', textAlign: 'center', transition: 'border-color .18s, background .18s' }}
        onMouseOver={(e) => { if (busy) return; e.currentTarget.style.borderColor = '#C9C1AE'; e.currentTarget.style.background = '#FEFDFB' }}
        onMouseOut={(e) => { e.currentTarget.style.borderColor = T.line; e.currentTarget.style.background = T.card }}>
        <input type="file" accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.gif" disabled={busy} style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); e.target.value = '' }} />
        <div style={{ width: 46, height: 46, margin: '0 auto 16px', borderRadius: 11, border: `1px solid ${T.line}`, background: T.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={22} stroke={T.ink2} sw={1.6} d={['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12']} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 500 }}>{busy ? (busyLabel || 'Reading…') : (fileName || 'Drop your BOM file here')}</div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 5 }}>CSV parsed instantly · PDF, Excel or a photo read with AI · click to browse</div>
      </label>

      {error && (
        <div style={{ marginTop: 20, background: 'rgba(176,87,110,0.08)', border: '1px solid rgba(176,87,110,0.34)', color: '#8A3F52', fontSize: 13, lineHeight: 1.55, borderRadius: 12, padding: '12px 15px' }}>{error}</div>
      )}

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: T.muted }}>No file? Try a sample CSV:</span>
        <button disabled={busy} onClick={() => onLoadSample('good')} style={chip}>Clean</button>
        <button disabled={busy} onClick={() => onLoadSample('mixed')} style={chip}>Mixed</button>
        <button disabled={busy} onClick={() => onLoadSample('bad')} style={chip}>Messy</button>
      </div>

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
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

// Reference-library detail for a component/material — repairability, failure
// risk, service life and end-of-life notes sourced from backend/data (the
// component_library / material_library CSVs). Only rendered when the backend
// enriched this line (line.library); the offline engine leaves it undefined.

// Maps a qualitative reference rating to the app's green/amber/red language.
const RATING_TONE = {
  high: T.good, medium: T.warn, low: T.bad,
  good: T.good, moderate: T.warn, poor: T.bad,
}
function RefChip({ label, value, tone }) {
  if (!value) return null
  const color = tone || RATING_TONE[String(value).toLowerCase()] || T.ink3
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: T.page, border: `1px solid ${T.line}`, borderRadius: 7, padding: '3px 8px', fontSize: 11, color: T.ink2 }}>
      <span className="mono" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.muted }}>{label}</span>
      <span style={{ fontWeight: 600, color, textTransform: 'capitalize' }}>{value}</span>
    </span>
  )
}

function RefCard({ kind, matchedTo, known, chips, life, notes, footer }) {
  return (
    <div style={{ background: T.page, border: `1px solid ${T.line}`, borderRadius: 10, padding: '12px 13px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: known ? 9 : 0 }}>
        <span className="mono" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: T.muted }}>{kind}</span>
        {known
          ? <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: T.ink }}>{matchedTo}</span>
          : <span style={{ fontSize: 11.5, color: T.faint }}>not in reference library</span>}
      </div>
      {known && (
        <>
          {chips.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9 }}>{chips}</div>}
          {life && <div style={{ fontSize: 11.5, color: T.ink3, marginBottom: notes ? 7 : 0 }}>Typical service life <strong style={{ color: T.ink2 }}>{life}</strong></div>}
          {notes && <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5 }}>{notes}</div>}
          {footer}
        </>
      )}
    </div>
  )
}

// A single longevity-score factor (+/- points with its reason).
function FactorRow({ f }) {
  const up = f.delta > 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, padding: '3px 0' }}>
      <span className="mono" style={{ flexShrink: 0, width: 34, textAlign: 'right', fontWeight: 700, color: up ? T.good : f.delta < 0 ? T.bad : T.muted }}>{up ? '+' : ''}{f.delta}</span>
      <span style={{ color: T.ink2, textTransform: 'capitalize' }}>{f.label}</span>
    </div>
  )
}

function LibraryPanel({ library, repair }) {
  if (!library) return null
  const c = library.componentRef
  const m = library.materialRef
  const yrs = (a, b) => (a != null && b != null ? `${a}–${b} yrs` : null)
  return (
    <div>
      {repair && (
        <div style={{ background: T.page, border: `1px solid ${T.line}`, borderRadius: 10, padding: '12px 13px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <span className="mono" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: T.muted }}>Longevity score · this part</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: scoreColor(repair.score) }}>{repair.score}<span className="mono" style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}>/100</span></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 18 }}>
            {repair.factors.map((f, i) => <FactorRow key={i} f={f} />)}
          </div>
        </div>
      )}
      <div className="mono" style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}>
        Reference library
        <span style={{ textTransform: 'none', letterSpacing: 0, color: T.faint, fontFamily: 'Nunito, sans-serif', fontSize: 10.5 }}>· repairability &amp; circularity · backend/data</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <RefCard
          kind="Component" known={library.componentKnown} matchedTo={c?.component_type}
          chips={[
            <RefChip key="fr" label="failure risk" value={c?.typical_failure_risk} tone={RATING_TONE[String(c?.typical_failure_risk).toLowerCase()] && (c?.typical_failure_risk === 'low' ? T.good : c?.typical_failure_risk === 'high' ? T.bad : T.warn)} />,
            <RefChip key="ri" label="repair value" value={c?.repair_importance} tone={c?.repair_importance === 'high' ? T.good : c?.repair_importance === 'low' ? T.muted : T.warn} />,
          ].filter(Boolean)}
          life={yrs(c?.expected_service_life_years_min, c?.expected_service_life_years_max)}
          notes={c?.repairability_notes}
          footer={c?.suggested_alternative && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 9, fontSize: 11.5, color: T.ink3, lineHeight: 1.45 }}>
              <Icon size={12} stroke={T.accent} sw={2.2} d={['M12 2 2 7l10 5 10-5-10-5z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5']} style={{ flexShrink: 0, marginTop: 2 }} />
              <span><span style={{ color: T.accent, fontWeight: 600 }}>Design tip · </span>{c.suggested_alternative}</span>
            </div>
          )}
        />
        <RefCard
          kind="Material" known={library.materialKnown} matchedTo={m?.material_name}
          chips={[
            <RefChip key="rec" label="recycling" value={m?.recycling_potential} />,
            <RefChip key="cat" label="class" value={m?.material_category} tone={T.ink3} />,
            m?.durability_score != null && <RefChip key="dur" label="durability" value={`${m.durability_score}/10`} tone={m.durability_score >= 7 ? T.good : m.durability_score >= 4 ? T.warn : T.bad} />,
          ].filter(Boolean)}
          life={yrs(m?.estimated_life_years_min, m?.estimated_life_years_max)}
          notes={m?.end_of_life_notes}
          footer={m?.risk_notes && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 9, fontSize: 11.5, color: T.ink3, lineHeight: 1.45 }}>
              <Icon size={12} stroke={T.warn} sw={2.2} d={['M12 9v4', 'M12 17h.01', 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z']} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{m.risk_notes}</span>
            </div>
          )}
        />
      </div>
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
                {line.library && <LibraryPanel library={line.library} repair={line.repair} />}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// Returns `value` delayed by `delay` ms — updates only after it stops changing.
function useDebounced(value, delay) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

// AI-written plain-language briefing, grounded on the engine's own numbers
// (backend /narrative → Claude). Degrades to a quiet note if unavailable.
function AiSummary({ narrative, onRegenerate }) {
  const sparkle = ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'm6.3 6.3 2.8 2.8', 'm14.9 14.9 2.8 2.8', 'm17.7 6.3-2.8 2.8', 'm9.1 14.9-2.8 2.8']
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (!narrative.text) return
    navigator.clipboard?.writeText(narrative.text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1600)
    }).catch(() => {})
  }
  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: '18px 20px', marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={15} stroke={T.accent} sw={1.9} d={sparkle} />
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>AI summary</span>
          <span className="mono no-print" style={{ fontSize: 9.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', border: `1px solid ${T.line}`, borderRadius: 99, padding: '2px 7px' }}>Claude</span>
        </div>
        {!narrative.loading && (
          <div className="no-print" style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
            {narrative.text && (
              <button onClick={copy} style={{ background: 'transparent', border: 'none', color: copied ? T.good : T.ink3, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Icon size={13} sw={2} d={copied ? ['M20 6 9 17l-5-5'] : ['M9 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4', 'M13 9H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4']} /> {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            <button onClick={onRegenerate} style={{ background: 'transparent', border: 'none', color: T.ink3, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon size={13} sw={2} d={['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5']} /> Regenerate
            </button>
          </div>
        )}
      </div>
      {narrative.loading ? (
        <div style={{ fontSize: 13, color: T.muted }}>Writing a grounded summary…</div>
      ) : narrative.error ? (
        <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.55 }}>
          AI summary unavailable — <span style={{ color: T.ink3 }}>{narrative.error}</span> The analysis above is unaffected.
        </div>
      ) : (
        <div style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.65 }}>{narrative.text}</div>
      )}
    </div>
  )
}

// Green/amber/red for a 0-100 score.
const scoreColor = (v) => (v >= 75 ? T.good : v >= 50 ? T.warn : T.bad)

// The headline dual-lens scorecard: one blended score built from CARBON (the
// swap engine) and LONGEVITY (the repairability engine, backend/data). This is
// the reframe — the product scores a build on both, not just embodied carbon.
function ScoreBanner({ summary }) {
  const rep = summary.repairability
  const overall = summary.overall
  const Tile = ({ label, score, grade, sub, big }) => (
    <div style={{ flex: big ? 1.25 : 1, minWidth: 150, background: big ? T.accent : T.card, color: big ? T.page : T.ink, border: `1px solid ${big ? T.accent : T.line}`, borderRadius: 14, padding: '16px 18px' }}>
      <div className="mono" style={{ fontSize: 10, color: big ? 'rgba(244,241,234,0.72)' : T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: big ? 36 : 27, fontWeight: 700, letterSpacing: '-0.03em', color: big ? T.page : scoreColor(score) }}>{score}</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: big ? 'rgba(244,241,234,0.9)' : T.muted }}>{grade}</span>
      </div>
      {sub && <div style={{ fontSize: 11.5, color: big ? 'rgba(244,241,234,0.8)' : T.muted, marginTop: 5, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  )
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
      {overall && <Tile big label="Overall eco score" score={overall.score} grade={overall.grade} sub="carbon impact + design longevity, blended" />}
      <Tile label="Carbon impact" score={summary.ecoScore} grade={summary.ecoGrade} sub={`${summary.co2ePct}% embodied CO₂e cut vs baseline`} />
      {rep && <Tile label="Repairability" score={rep.score} grade={rep.grade} sub={rep.label} />}
    </div>
  )
}

// Actionable design fixes ranked by the point gain each unlocks — the output
// that turns a score into advice. Sourced from scoring_rules.json deltas.
const FIX_ICON = {
  fastening: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
  sourcing: ['M20 7h-9', 'M14 17H5', 'M17 3l3 3-3 3', 'M7 21l-3-3 3-3'],
  design: ['M12 2 2 7l10 5 10-5-10-5z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'],
  material: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
}
function DesignFixes({ recommendations }) {
  if (!recommendations || !recommendations.length) return null
  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: '18px 20px', marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={15} stroke={T.accent} sw={1.9} d={['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z']} />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>Design for longevity</span>
        <span className="mono" style={{ fontSize: 9.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', border: `1px solid ${T.line}`, borderRadius: 99, padding: '2px 7px' }}>{recommendations.length} fixes</span>
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.55, marginBottom: 14 }}>
        Concrete changes that raise the repairability score, ranked by the points each recovers.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {recommendations.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: T.page, border: `1px solid ${T.line}`, borderRadius: 10, padding: '11px 13px' }}>
            <Icon size={15} stroke={T.accent} sw={1.9} d={FIX_ICON[f.kind] || FIX_ICON.design} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: T.ink }}>{f.component}</span>
              <span style={{ fontSize: 12.5, color: T.ink2 }}> · {f.action}</span>
            </div>
            {f.gain != null && (
              <span className="mono" style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: T.good, background: 'rgba(91,122,78,0.12)', border: '1px solid rgba(91,122,78,0.34)', borderRadius: 7, padding: '3px 9px' }}>+{f.gain} pts</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// One friendly mass entry: type freely, or nudge with − / +. Holds its own text
// state so mid-typing (e.g. "0.", "0.3") never fights the coerced model value,
// while every change still flows to onSet so the analysis stays live. When the
// field carries a not-yet-confirmed estimate, an accept (✓) button confirms it
// as-is; typing or nudging also counts as confirming.
function MassField({ index, initial, filled, estimated, inputRef, onSet, onEnter }) {
  const [text, setText] = useState(initial)

  const commit = (v) => { setText(v); onSet(index, v) }
  const accept = () => onSet(index, text || '1')
  const nudge = (delta) => {
    const base = parseFloat(text)
    const next = Math.max(0, Math.round(((Number.isFinite(base) ? base : 0) + delta) * 1000) / 1000)
    commit(String(next))
  }

  // Palette shifts from "estimated" (ochre) to "using your number" (green).
  const rgb = filled ? '91,122,78' : '168,122,60'
  const stepBtn = {
    width: 30, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', background: 'transparent', color: T.ink3, fontSize: 18, lineHeight: 1,
    cursor: 'pointer', padding: 0, fontFamily: 'Nunito, sans-serif',
  }
  const hover = (on) => (e) => { e.currentTarget.style.background = on ? 'rgba(35,33,28,0.06)' : 'transparent' }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', background: `rgba(${rgb},0.07)`, border: `1px solid rgba(${rgb},0.5)`, borderRadius: 10, overflow: 'hidden', transition: 'border-color .16s, background .16s' }}>
        <button type="button" onClick={() => nudge(-0.1)} onMouseEnter={hover(true)} onMouseLeave={hover(false)}
          aria-label={`Decrease mass by 0.1 kilograms`} title="−0.1 kg" style={stepBtn}>−</button>
        <input
          ref={inputRef}
          type="text" inputMode="decimal" placeholder="1"
          aria-label={`Mass in kilograms`}
          value={text}
          onChange={(e) => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) commit(v) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(index) } }}
          onFocus={(e) => e.target.select()}
          className="mono"
          style={{ width: 52, textAlign: 'right', padding: '8px 2px 8px 6px', fontSize: 13.5, background: 'transparent', color: T.ink, border: 'none', outline: 'none' }}
        />
        <span className="mono" style={{ fontSize: 11.5, color: T.muted, padding: '0 5px 0 3px', userSelect: 'none' }}>kg</span>
        <button type="button" onClick={() => nudge(0.1)} onMouseEnter={hover(true)} onMouseLeave={hover(false)}
          aria-label={`Increase mass by 0.1 kilograms`} title="+0.1 kg" style={stepBtn}>+</button>
      </div>
      {estimated && !filled && (
        <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: T.warn, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>est</span>
      )}
      <span style={{ width: 24, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
        {filled
          ? <Icon size={16} stroke={T.good} sw={2.5} d={['M20 6 9 17l-5-5']} />
          : (text && (
              <button type="button" onClick={accept} title="Use this mass" aria-label="Confirm this mass"
                style={{ width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid rgba(91,122,78,0.5)`, background: 'rgba(91,122,78,0.08)', borderRadius: 7, cursor: 'pointer', padding: 0 }}>
                <Icon size={13} stroke={T.good} sw={2.5} d={['M20 6 9 17l-5-5']} />
              </button>
            ))}
      </span>
    </div>
  )
}

// Rows whose mass couldn't be read from the file get a friendly entry here so the
// user supplies their real figure; each entry updates the BOM and re-runs the
// analysis. Blank inputs keep the provisional 1 kg estimate. The panel tracks
// progress and turns calm-green once every mass is filled in.
function MissingMassPanel({ bom, missing, onSet }) {
  const inputRefs = useRef({})
  if (!missing.length) return null
  const total = missing.length
  const filled = missing.filter((i) => !bom[i].kgMissing).length
  const allDone = filled === total
  const anyEst = missing.some((i) => bom[i].kgEstimated)
  const pct = Math.round((filled / total) * 100)
  const rgb = allDone ? '91,122,78' : '168,122,60'
  const headColor = allDone ? T.good : T.warn

  // Enter on a field hops to the next one still missing a mass, wrapping around;
  // if none are left, it just blurs so the keyboard/focus gets out of the way.
  const focusNextEmpty = (fromIndex) => {
    const start = missing.indexOf(fromIndex)
    for (let k = 1; k <= total; k++) {
      const idx = missing[(start + k) % total]
      if (idx === fromIndex) break
      if (bom[idx].kgMissing) {
        const el = inputRefs.current[idx]
        if (el) { el.focus(); el.select?.() }
        return
      }
    }
    inputRefs.current[fromIndex]?.blur()
  }

  return (
    <div className="no-print" style={{ background: `rgba(${rgb},0.07)`, border: `1px solid rgba(${rgb},0.34)`, borderRadius: 14, padding: '16px 18px', marginBottom: 20, transition: 'background .2s, border-color .2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', background: `rgba(${rgb},0.15)` }}>
            {allDone
              ? <Icon size={15} stroke={T.good} sw={2.4} d={['M20 6 9 17l-5-5']} />
              : <Icon size={15} stroke={T.warn} sw={2.1} d={['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01']} />}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>
            {allDone ? 'All masses added' : 'Add the missing masses'}
          </span>
        </div>
        <div className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: headColor }}>
          {allDone ? 'Using your figures' : `${filled} of ${total} added`}
        </div>
      </div>

      <div style={{ height: 5, borderRadius: 99, background: `rgba(${rgb},0.18)`, overflow: 'hidden', marginBottom: 13 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: headColor, borderRadius: 99, transition: 'width .3s ease' }} />
      </div>

      <div style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.5, marginBottom: 14 }}>
        {allDone
          ? 'Every component now uses the mass you confirmed — the carbon and cost figures below reflect your real numbers.'
          : anyEst
            ? <>We couldn't read a mass for these components, so we've estimated one for each (marked <span className="mono" style={{ fontWeight: 700, color: T.warn }}>EST</span>). Accept it with ✓, nudge it, or type the real figure — the numbers below update instantly.</>
            : <>We couldn't read a mass for these components, so each is a provisional 1&nbsp;kg. Enter the real figure to make the carbon and cost numbers accurate.</>}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {missing.map((i) => {
          const done = !bom[i].kgMissing
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: '10px 13px' }}>
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bom[i].component}</div>
                <div className="mono" style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{prettyMat(bom[i].from)}</div>
              </div>
              <MassField
                index={i}
                initial={done || bom[i].kgEstimated ? String(bom[i].kg) : ''}
                filled={done}
                estimated={!!bom[i].kgEstimated}
                inputRef={(el) => { inputRefs.current[i] = el }}
                onSet={onSet}
                onEnter={focusNextEmpty}
              />
            </div>
          )
        })}
      </div>

      {total > 1 && !allDone && (
        <div className="mono" style={{ fontSize: 10.5, color: T.faint, marginTop: 11 }}>
          Tip — press Enter to jump to the next field.
        </div>
      )}
    </div>
  )
}

// A material the file used that wasn't in the swap library gets a best-guess
// stand-in (from the parser) plus a dropdown here to confirm or correct it —
// rather than being silently dropped. Picking a material re-runs the analysis.
function MaterialReviewPanel({ bom, review, onSetMaterial }) {
  if (!review.length) return null
  const total = review.length
  const done = review.filter((i) => bom[i].materialReviewed).length
  const allDone = done === total
  const rgb = allDone ? '91,122,78' : '30,61,43'   // green when confirmed, else forest accent
  const headColor = allDone ? T.good : T.accent
  const pct = Math.round((done / total) * 100)

  const select = {
    appearance: 'none', WebkitAppearance: 'none', maxWidth: 210,
    padding: '8px 30px 8px 11px', fontSize: 12.5, fontFamily: "'Geist Mono', monospace",
    background: `${T.page} url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A857A' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>") no-repeat right 9px center`,
    color: T.ink, border: `1px solid ${T.line}`, borderRadius: 9, cursor: 'pointer', outline: 'none',
  }

  return (
    <div className="no-print" style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.30)`, borderRadius: 14, padding: '16px 18px', marginBottom: 20, transition: 'background .2s, border-color .2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', background: `rgba(${rgb},0.14)` }}>
            {allDone
              ? <Icon size={15} stroke={T.good} sw={2.4} d={['M20 6 9 17l-5-5']} />
              : <Icon size={15} stroke={T.accent} sw={2.1} d={['M11 3 8 9l-6 .75 4.13 4.62L5 21l6-3 6 3-1.13-6.63L20 9.75 14 9z']} />}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>
            {allDone ? 'Materials confirmed' : 'Confirm the materials we matched'}
          </span>
        </div>
        <div className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: headColor }}>
          {allDone ? 'Using your choices' : `${done} of ${total} confirmed`}
        </div>
      </div>

      <div style={{ height: 5, borderRadius: 99, background: `rgba(${rgb},0.16)`, overflow: 'hidden', marginBottom: 13 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: headColor, borderRadius: 99, transition: 'width .3s ease' }} />
      </div>

      <div style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.5, marginBottom: 14 }}>
        {allDone
          ? 'Every material below now uses a library material you picked — nothing was dropped.'
          : "These materials weren't an exact match in the swap library, so we stood in the closest one. Confirm each or choose a better fit — the analysis updates instantly."}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {review.map((i) => {
          const row = bom[i]
          const reviewed = !!row.materialReviewed
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: '10px 13px' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
                  {row.component}
                  {row.materialRaw && <span style={{ color: T.muted, fontWeight: 400 }}> · read as “{row.materialRaw}”</span>}
                </div>
                <div style={{ fontSize: 11.5, color: reviewed ? T.good : T.ink3, marginTop: 2, lineHeight: 1.45 }}>
                  {reviewed ? `Now using ${prettyMat(row.from)}` : row.materialReason}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <select value={row.from} onChange={(e) => onSetMaterial(i, e.target.value)}
                  aria-label={`Material for ${row.component}`} style={select}>
                  {MATERIAL_GROUPS.map((g) => (
                    <optgroup key={g.cat} label={g.cat}>
                      {g.items.map((d) => (
                        <option key={d.name} value={d.name}>
                          {prettyMat(d.name)}{d.co2e_per_kg != null ? ` · ${d.co2e_per_kg} CO₂e/kg` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span style={{ width: 18, display: 'inline-flex', flexShrink: 0 }}>
                  {reviewed && <Icon size={16} stroke={T.good} sw={2.5} d={['M20 6 9 17l-5-5']} />}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Regions the incentive finder can search. Australia leads (this is a UNSW build),
// but every figure comes from a live web search scoped to the chosen region.
const INCENTIVE_REGIONS = ['Australia', 'United States', 'United Kingdom', 'European Union', 'Canada', 'New Zealand', 'Singapore']

const LEVEL_STYLE = {
  federal: { bg: 'rgba(30,61,43,0.10)', fg: T.accent, label: 'Federal' },
  state: { bg: 'rgba(168,122,60,0.14)', fg: T.warn, label: 'State' },
  local: { bg: 'rgba(91,122,78,0.14)', fg: T.good, label: 'Local' },
  other: { bg: T.cardAlt, fg: T.muted, label: 'Program' },
}

// A live-web-search section: Claude finds real government grants / rebates / tax
// credits for the chosen region and product, each with a source link to verify.
// Triggered on demand (it hits the web, so it's slower and costs a search).
function IncentivesPanel({ productName, materials }) {
  const [region, setRegion] = useState('Australia')
  const [state, setState] = useState({ status: 'idle', items: [], error: '' }) // idle|loading|done|error

  const run = () => {
    setState({ status: 'loading', items: [], error: '' })
    fetchIncentives({ productName, materials, region })
      .then((res) => setState({ status: 'done', items: res.incentives || [], error: '' }))
      .catch((err) => setState({ status: 'error', items: [], error: err.message || 'Lookup failed.' }))
  }

  const select = {
    appearance: 'none', WebkitAppearance: 'none',
    padding: '9px 30px 9px 12px', fontSize: 13, fontFamily: 'Nunito, sans-serif',
    background: `${T.card} url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A857A' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>") no-repeat right 10px center`,
    color: T.ink, border: `1px solid ${T.line}`, borderRadius: 9, cursor: 'pointer', outline: 'none',
  }

  return (
    <div className="no-print" style={{ marginTop: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={16} stroke={T.accent} sw={1.9} d={['M3 21h18', 'M5 21V10l7-5 7 5v11', 'M9 21v-6h6v6']} />
        <span style={{ fontSize: 15, fontWeight: 600 }}>Government incentives that could help</span>
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.55, marginBottom: 14, maxWidth: 640 }}>
        Building greener can pay back twice. ecocompass searches the live web for grants, rebates and tax credits in your region that reward lower-carbon materials, recycled content and repairable design — each with a source link so you can check it yourself.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: state.status === 'idle' ? 0 : 18 }}>
        <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region" style={select}>
          {INCENTIVE_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={run} disabled={state.status === 'loading'} style={{ ...btnSolid, opacity: state.status === 'loading' ? 0.6 : 1 }}>
          <Icon size={14} stroke={T.page} sw={2} d={['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'm21 21-4.35-4.35']} />
          {state.status === 'loading' ? 'Searching the web…' : state.status === 'done' ? 'Search again' : 'Find incentives'}
        </button>
        {state.status === 'loading' && <span style={{ fontSize: 12, color: T.muted }}>This can take ~15 seconds — reading live sources.</span>}
      </div>

      {state.status === 'error' && (
        <div style={{ background: 'rgba(176,87,110,0.08)', border: '1px solid rgba(176,87,110,0.34)', color: '#8A3F52', fontSize: 12.5, lineHeight: 1.55, borderRadius: 12, padding: '12px 15px' }}>
          Couldn't fetch incentives — {state.error} This needs the backend running with web search and an API key; the analysis above is unaffected.
        </div>
      )}

      {state.status === 'done' && state.items.length === 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: '16px 18px', fontSize: 13, color: T.ink3 }}>
          No matching programs surfaced for {region} right now. Try another region, or check your local sustainability / manufacturing agency directly.
        </div>
      )}

      {state.status === 'done' && state.items.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          {state.items.map((it, i) => {
            const lvl = LEVEL_STYLE[it.level] || LEVEL_STYLE.other
            return (
              <div key={i} style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{it.name}</span>
                  <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: lvl.fg, background: lvl.bg, borderRadius: 6, padding: '2px 7px' }}>{lvl.label}</span>
                  {it.provider && <span style={{ fontSize: 12, color: T.muted }}>{it.provider}</span>}
                </div>
                {it.summary && <div style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.55, marginTop: 6 }}>{it.summary}</div>}
                {it.relevance && <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 5 }}><span style={{ color: T.accent, fontWeight: 600 }}>Why it fits: </span>{it.relevance}</div>}
                {it.url && (
                  <a href={it.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: T.accent, marginTop: 9, textDecoration: 'none' }}>
                    View source
                    <Icon size={12} stroke={T.accent} sw={2} d={['M7 17 17 7', 'M7 7h10v10']} />
                  </a>
                )}
              </div>
            )
          })}
          <div style={{ fontSize: 11, color: T.faint, lineHeight: 1.6, marginTop: 2 }}>
            Gathered by AI from a live web search of {region} sources — treat as a starting point and confirm eligibility and current status at each program's official page before relying on it.
          </div>
        </div>
      )}
    </div>
  )
}

function ResultsView({ setView, bom: initialBom, meta, warnings }) {
  // Editable copy of the parsed BOM. Rows flagged kgMissing get filled in via the
  // MissingMassPanel below, which updates a mass here and re-runs the analysis.
  const [bomInput, setBomInput] = useState(initialBom)
  useEffect(() => { setBomInput(initialBom) }, [initialBom])

  // Indices of rows that were missing a mass on upload (stable across edits, so the
  // input stays put once filled rather than disappearing mid-type).
  const missingMass = initialBom
    .map((row, i) => (row.kgMissing ? i : -1))
    .filter((i) => i >= 0)

  const setRowKg = (index, value) => setBomInput((prev) => prev.map((row, i) => {
    if (i !== index) return row
    const n = parseFloat(value)
    return (Number.isFinite(n) && n > 0)
      ? { ...row, kg: Math.round(n * 1000) / 1000, kgMissing: false }
      : { ...row, kg: 1, kgMissing: true }
  }))

  // Indices of rows whose material wasn't an exact library match (stood in with a
  // proxy). Stable across edits so the dropdown row stays put once confirmed.
  const materialReview = initialBom
    .map((row, i) => (row.materialConfidence === 'proxy' ? i : -1))
    .filter((i) => i >= 0)

  const setRowMaterial = (index, name) => setBomInput((prev) => prev.map((row, i) =>
    i === index ? { ...row, from: name, materialReviewed: true } : row))

  const [carbonWeight, setCarbonWeight] = useState(0.6)
  const [annualVolume, setAnnualVolume] = useState(10000)
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState('local') // 'backend' | 'local'
  const [expanded, setExpanded] = useState(() => new Set()) // set of line indices
  const [narrative, setNarrative] = useState({ text: '', loading: true, error: '' })

  // The slider updates carbonWeight instantly (for the label) but the expensive
  // work keys on a debounced copy, so dragging fires one analyze + one summary
  // once the slider settles rather than on every tick.
  const debouncedWeight = useDebounced(carbonWeight, 220)
  // Debounced so filling in several missing masses fires one analyze pass, not one per keystroke.
  const debouncedBom = useDebounced(bomInput, 350)

  // The upload/slider → analyzer seam. This is the single call site a real
  // POST /analyze-bom backend slots into (see analysis.js).
  useEffect(() => {
    let live = true
    setLoading(true)
    analyzeBom(debouncedBom, { carbon: debouncedWeight }).then((res) => {
      if (!live) return
      setAnalysis(res)
      setSource(lastSource)
      setLoading(false)
      // On the first analysis, auto-open any flagged line (by index, so duplicate
      // component names don't collide) so the rejection reasoning shows at once.
      setExpanded((prev) => (prev.size ? prev
        : new Set(res.lines.map((l, i) => (l.status === 'red' ? i : -1)).filter((i) => i >= 0))))
    })
    return () => { live = false }
  }, [debouncedBom, debouncedWeight])

  // Grounded plain-language summary (Claude). Re-runs when the BOM changes or the
  // slider settles; the "Regenerate" control forces a fresh one. Degrades quietly
  // if the backend / API key isn't available.
  const runNarrative = (weight, guard) => {
    setNarrative({ text: '', loading: true, error: '' })
    return fetchNarrative(bomInput, { carbon: weight }, meta.productName)
      .then((res) => { if (!guard || guard()) setNarrative({ text: (res.narrative || '').trim(), loading: false, error: '' }) })
      .catch((err) => { if (!guard || guard()) setNarrative({ text: '', loading: false, error: err.message || 'AI summary unavailable.' }) })
  }
  useEffect(() => {
    let live = true
    runNarrative(debouncedWeight, () => live)
    return () => { live = false }
  }, [debouncedBom, debouncedWeight])

  const totalKg = bomInput.reduce((s, b) => s + b.kg, 0)
  const toggle = (i) => setExpanded((prev) => {
    const next = new Set(prev)
    next.has(i) ? next.delete(i) : next.add(i)
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
      narrative: narrative.text || '',
      ecoScore: summary.ecoScore, ecoGrade: summary.ecoGrade, headline,
      overallScore: summary.overall?.score, overallGrade: summary.overall?.grade,
      repairScore: summary.repairability?.score, repairGrade: summary.repairability?.grade,
      repairLabel: summary.repairability?.label,
      fixes: summary.repairability?.recommendations || [],
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

      <MaterialReviewPanel bom={bomInput} review={materialReview} onSetMaterial={setRowMaterial} />

      <MissingMassPanel bom={bomInput} missing={missingMass} onSet={setRowKg} />

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
          <ScoreBanner summary={summary} />

          {/* Summary dashboard */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '4px 0 14px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Analysis summary</div>
              <span className="no-print mono" title={source === 'backend' ? 'Scored by the FastAPI backend (/analyze-bom)' : 'Backend unreachable — scored by the built-in engine'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: source === 'backend' ? T.good : T.muted, background: source === 'backend' ? 'rgba(91,122,78,0.12)' : T.cardAlt, border: `1px solid ${source === 'backend' ? 'rgba(91,122,78,0.34)' : T.line}`, borderRadius: 99, padding: '3px 9px' }}>
                <span style={{ width: 5, height: 5, borderRadius: 99, background: source === 'backend' ? T.good : T.faint }} />
                {source === 'backend' ? 'via API' : 'offline engine'}
              </span>
              {summary.library && (
                <span className="no-print mono" title="Components / materials recognised in the backend/data reference library (repairability & circularity)"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.ink3, background: T.cardAlt, border: `1px solid ${T.line}`, borderRadius: 99, padding: '3px 10px' }}>
                  <Icon size={11} stroke={T.accent} sw={2} d={['M12 2 2 7l10 5 10-5-10-5z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5']} />
                  library {summary.library.componentsKnown}/{summary.library.total} comp · {summary.library.materialsKnown}/{summary.library.total} mat
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
            <StatCard label="CO₂e saved / unit" value={`${summary.co2eSaved.toFixed(1)} kg`} sub={`−${summary.co2ePct}% vs baseline spec`} color={T.accent} />
            <StatCard label="Cost delta / unit" value={signedMoney(summary.costDelta)} sub={summary.costUp ? 'added material cost' : 'net material saving'} color={summary.costUp ? T.warn : T.good} />
            <StatCard label="Viable swaps" value={`${summary.viableCount}`} sub={`of ${bomInput.length} components`} color={T.good} />
            <StatCard label="Flagged" value={`${summary.flaggedCount}`} sub={summary.flaggedCount ? 'no viable swap — review' : 'none — all resolved'} color={summary.flaggedCount ? T.bad : T.ink3} />
          </div>

          <ScaledImpact co2eSavedPerUnit={summary.co2eSaved} annualVolume={annualVolume} setAnnualVolume={setAnnualVolume} />

          {summary.repairability && <DesignFixes recommendations={summary.repairability.recommendations} />}

          <AiSummary narrative={narrative} onRegenerate={() => runNarrative(carbonWeight)} />

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
                  {analysis.lines.map((line, i) => (
                    <LineRow key={i} line={line} open={expanded.has(i)} onToggle={() => toggle(i)} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="no-print" style={{ fontSize: 11.5, color: T.faint, marginTop: 18, lineHeight: 1.65 }}>
            Rankings recompute live from the priority slider. A swap is only offered when it clears the part's functional requirements — anything that fails is flagged with the specific reason, never silently dropped. The repairability score is a transparent point model (base 70 ± deltas for fastening, sourcing, failure risk, recycling and service life — see <span className="mono">scoring_rules.json</span>). Figures marked <em>estimated</em> in the dataset are indicative.
          </div>

          <IncentivesPanel
            productName={meta.productName}
            materials={[...new Set(bomInput.map((r) => prettyMat(r.from)))].slice(0, 12).join(', ')}
          />
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
  // /scan is a real, shareable URL (the consumer wedge); other views live at /.
  const [view, setView] = useState(
    () => (typeof window !== 'undefined' && window.location.pathname === '/scan' ? 'scan' : 'upload'),
  ) // upload | results | library | scan
  const [fileName, setFileName] = useState(null)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('Reading…')
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

  // Keep the URL in sync with the scan view so /scan is shareable and the
  // browser back/forward buttons work, without pulling in a router dependency.
  useEffect(() => {
    const onPop = () => setView(window.location.pathname === '/scan' ? 'scan' : 'upload')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    const desired = view === 'scan' ? '/scan' : '/'
    if (window.location.pathname !== desired) window.history.pushState({}, '', desired)
  }, [view])

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
    setFileName(file.name); setUploadError(null); setBusyLabel('Reading…'); setBusy(true)
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    try {
      let result
      if (ext === 'csv') {
        // Fast path: the offline parser handles a tidy component/material/kg CSV.
        result = await parseBomFile(file)
        // If it struggled (odd headers, missing columns, unmatched materials),
        // re-read the same file with the AI extractor, which copes with real-world
        // layouts. Falls back to the client parse if the backend/key is unavailable.
        const rowCount = result.rows ? result.rows.length : 0
        const weak = !!result.error || rowCount === 0 || (result.warnings?.length || 0) >= rowCount
        if (weak) {
          try {
            setBusyLabel('Reading with AI…')
            const ai = await extractBom(file)
            if (ai.rows && ai.rows.length) result = ai
          } catch { /* keep the client-side result */ }
        }
      } else {
        // PDF, Excel, images — always read with AI.
        setBusyLabel('Reading with AI…')
        result = await extractBom(file)
      }
      const { rows, warnings: warn, meta: m, error } = result
      if (error) { setUploadError(error); return }
      if (!rows || !rows.length) {
        setUploadError((warn && warn[0]) || 'No usable rows found in the file.')
        return
      }
      setBom(rows); setMeta(m); setWarnings(warn || []); setView('results')
    } catch (err) {
      setUploadError(err.message || 'Could not read the file.')
    } finally {
      setBusy(false)
    }
  }

  // Load a bundled sample CSV (public/samples) and run it through the normal
  // upload path — a quick way to try the analyzer (and the AI-CSV fallback).
  const loadSample = async (name) => {
    setUploadError(null); setBusyLabel('Loading sample…'); setBusy(true)
    try {
      const res = await fetch(`/samples/sample_bom_${name}.csv`)
      if (!res.ok) throw new Error('Could not load the sample file.')
      const blob = await res.blob()
      await analyzeFile(new File([blob], `sample_bom_${name}.csv`, { type: 'text/csv' }))
    } catch (err) {
      setUploadError(err.message || 'Could not load the sample file.')
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: T.page, color: T.ink }}>
      <TopNav view={view} setView={setView} />

      {view === 'upload' && <UploadView fileName={fileName} onFile={analyzeFile} onSample={analyzeSample} onLoadSample={loadSample} busy={busy} busyLabel={busyLabel} error={uploadError} />}
      {view === 'results' && <ResultsView setView={setView} bom={bom} meta={meta} warnings={warnings} />}
      {view === 'scan' && <ScanView />}
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
