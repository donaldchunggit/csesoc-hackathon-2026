// PDF report generator for the ecocompass results page.
//
// Builds a branded, multi-page, text-based (vector) PDF from the derived
// swap analysis and triggers a client-side download — no server round-trip and
// no browser print dialog. jsPDF lays everything out in points on A4 portrait.

import { jsPDF } from 'jspdf'

// --- ecocompass palette as [r,g,b], mirroring theme.css --------------------
const C = {
  ink: [35, 33, 28],
  ink2: [74, 70, 60],
  ink3: [110, 106, 95],
  muted: [138, 133, 122],
  faint: [163, 156, 140],
  line: [227, 220, 205],
  line2: [237, 231, 218],
  card: [251, 250, 246],
  cardAlt: [242, 238, 227],
  accent: [30, 61, 43],
  good: [91, 122, 78],
  warn: [168, 122, 60],
  bad: [176, 87, 110],
  white: [255, 255, 255],
}

// A4 portrait in points, with a comfortable margin.
const PAGE_W = 595.28
const PAGE_H = 841.89
const M = 48 // page margin
const CONTENT_W = PAGE_W - M * 2

// The standard jsPDF fonts (Helvetica/Courier) only encode WinAnsi/latin1, so
// map the few typographic characters the app uses that fall outside it — the
// Unicode minus, dashes, curly quotes and ellipsis — to safe equivalents.
function sanitize(s) {
  return String(s)
    .replace(/−/g, '-')          // minus sign → hyphen
    .replace(/[–—]/g, '-')  // en / em dash → hyphen
    .replace(/≥/g, '>=')         // greater-or-equal
    .replace(/≤/g, '<=')         // less-or-equal
    .replace(/[‘’]/g, "'")  // curly single quotes
    .replace(/[“”]/g, '"')  // curly double quotes
    .replace(/…/g, '...')        // ellipsis
}

// Turn a product name into a safe file-name stem.
function slugify(s) {
  return String(s || 'report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'report'
}

// A stateful drawing cursor over a jsPDF doc: tracks the current y, paginates
// automatically, and paints the shared page chrome (footer + page number).
class Report {
  constructor() {
    this.doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
    // Route every text draw through the latin1 sanitizer so stray Unicode
    // punctuation (e.g. the app's − sign) can't render as a wrong glyph.
    const rawText = this.doc.text.bind(this.doc)
    this.doc.text = (txt, ...rest) =>
      rawText(Array.isArray(txt) ? txt.map(sanitize) : sanitize(txt), ...rest)
    this.y = M
    this.page = 1
    this._footer()
  }

  set(color) { this.doc.setTextColor(color[0], color[1], color[2]); return this }
  fill(color) { this.doc.setFillColor(color[0], color[1], color[2]); return this }
  stroke(color) { this.doc.setDrawColor(color[0], color[1], color[2]); return this }
  font(style = 'normal', size = 10, family = 'helvetica') {
    this.doc.setFont(family, style)
    this.doc.setFontSize(size)
    return this
  }

  // Ensure `h` points of vertical space remain, else start a new page.
  need(h) {
    if (this.y + h > PAGE_H - M) this.addPage()
    return this
  }

  addPage() {
    this.doc.addPage()
    this.page += 1
    this.y = M
    this._footer()
    return this
  }

  // Footer rule + attribution + page number, drawn once per page.
  _footer() {
    const d = this.doc
    const fy = PAGE_H - 30
    d.setDrawColor(C.line[0], C.line[1], C.line[2])
    d.setLineWidth(0.6)
    d.line(M, fy, PAGE_W - M, fy)
    d.setFont('helvetica', 'normal').setFontSize(7.5)
    d.setTextColor(C.faint[0], C.faint[1], C.faint[2])
    d.text('ecocompass · sustainable swap engine', M, fy + 13)
    d.text(`Page ${this.page}`, PAGE_W - M, fy + 13, { align: 'right' })
  }

  // Draw wrapped text at the cursor; advances y. Returns the block height.
  paragraph(text, { size = 10, style = 'normal', color = C.ink2, family = 'helvetica', lh = 1.45, gap = 0, width = CONTENT_W, x = M } = {}) {
    this.font(style, size, family).set(color)
    const lines = this.doc.splitTextToSize(sanitize(String(text)), width)
    const lineH = size * lh
    for (const line of lines) {
      this.need(lineH)
      this.doc.text(line, x, this.y + size)
      this.y += lineH
    }
    this.y += gap
    return this
  }
}

// A colored soft-band pill (e.g. the eco grade / metric chips).
function chip(r, x, y, w, h, bg) {
  r.fill(bg).doc.roundedRect(x, y, w, h, 5, 5, 'F')
}

// --- section builders ------------------------------------------------------

function header(r, data) {
  const d = r.doc
  // Brand wordmark + accent tick.
  r.fill(C.accent).doc.roundedRect(M, r.y, 18, 18, 4, 4, 'F')
  d.setFont('helvetica', 'bold').setFontSize(9)
  r.set(C.white)
  d.text('e', M + 6, r.y + 13)
  r.font('bold', 15).set(C.ink)
  d.text('ecocompass', M + 26, r.y + 14)

  r.font('normal', 8.5).set(C.muted)
  d.text('SUSTAINABLE SWAP REPORT', PAGE_W - M, r.y + 7, { align: 'right' })
  d.text(data.dateStr, PAGE_W - M, r.y + 18, { align: 'right' })
  r.y += 34

  r.stroke(C.line).doc.setLineWidth(0.8)
  d.line(M, r.y, PAGE_W - M, r.y)
  r.y += 22

  // Product title + meta line.
  r.font('bold', 21).set(C.ink)
  d.text(data.meta.productName, M, r.y + 16)
  r.y += 30
  r.font('normal', 10).set(C.muted)
  const sub = `${data.componentCount} components  ·  ${data.totalKg.toFixed(1)} kg / unit  ·  ${data.meta.note}`
  d.text(sub, M, r.y)
  r.y += 22
}

function ecoScoreBlock(r, data) {
  const d = r.doc
  const boxH = 118
  r.need(boxH + 10)
  const top = r.y
  const scoreColor = data.ecoScore >= 75 ? C.good : data.ecoScore >= 50 ? C.warn : C.bad

  // Panel background.
  r.fill(C.card).stroke(C.line).doc.setLineWidth(0.8)
  d.roundedRect(M, top, CONTENT_W, boxH, 10, 10, 'FD')

  // Score tile on the left.
  const tileW = 150
  r.fill(C.cardAlt).doc.roundedRect(M + 16, top + 16, tileW, boxH - 32, 8, 8, 'F')
  const cx = M + 16 + tileW / 2
  r.font('normal', 7.5).set(C.muted)
  d.text('ECO SCORE · THIS BUILD', cx, top + 34, { align: 'center' })
  r.font('bold', 40).set(scoreColor)
  d.text(String(data.ecoScore), cx, top + 78, { align: 'center' })
  r.font('bold', 10).set(C.muted)
  d.text(`GRADE ${data.ecoGrade}`, cx, top + 95, { align: 'center' })

  // Three metric columns on the right.
  const metrics = [
    { label: 'CARBON', value: `-${data.co2ePct}%`, color: C.accent },
    { label: 'COST', value: data.costDelta, color: data.costUp ? C.warn : C.good },
    { label: 'RECYCLABILITY', value: `+${data.recycPts} pts`, color: C.ink },
  ]
  const colX = M + 16 + tileW + 28
  const colW = (CONTENT_W - (16 + tileW + 28) - 16) / 3
  metrics.forEach((m, i) => {
    const x = colX + colW * i
    r.font('normal', 7.5).set(C.muted)
    d.text(m.label, x, top + 34)
    r.font('bold', 18).set(m.color)
    d.text(m.value, x, top + 58)
  })

  // Headline sentence under the metrics.
  r.font('normal', 9).set(C.ink2)
  const hl = d.splitTextToSize(data.headline, CONTENT_W - (16 + tileW + 28) - 16)
  let hy = top + 74
  for (const line of hl.slice(0, 2)) { d.text(line, colX, hy); hy += 12 }

  r.y = top + boxH + 24
}

function totalsBlock(r, data) {
  const d = r.doc
  const rows = [
    ['Material cost / unit', money(data.costFrom), money(data.costTo), data.costUp ? C.warn : C.good],
    ['Embodied carbon / unit', `${data.co2eFrom.toFixed(1)} kg`, `${data.co2eTo.toFixed(1)} kg`, C.accent],
  ]
  r.font('bold', 12).set(C.ink)
  r.need(30)
  d.text('Baseline vs. optimised', M, r.y + 10)
  r.y += 26

  const rowH = 30
  const c1 = M + 14                 // metric label
  const c2 = M + CONTENT_W * 0.52   // baseline
  const c3 = M + CONTENT_W * 0.76   // optimised
  // Column headers.
  r.font('normal', 7.5).set(C.muted)
  d.text('METRIC', c1, r.y)
  d.text('BASELINE', c2, r.y)
  d.text('OPTIMISED', c3, r.y)
  r.y += 8

  r.fill(C.card).stroke(C.line).doc.setLineWidth(0.8)
  d.roundedRect(M, r.y, CONTENT_W, rowH * rows.length, 8, 8, 'FD')
  rows.forEach((row, i) => {
    const ry = r.y + rowH * i
    if (i > 0) { r.stroke(C.line2).doc.setLineWidth(0.6); d.line(M + 8, ry, M + CONTENT_W - 8, ry) }
    const baseline = ry + rowH / 2 + 3.5
    r.font('normal', 10).set(C.ink2)
    d.text(row[0], c1, baseline)
    r.font('normal', 10, 'courier').set(C.faint)
    d.text(row[1], c2, baseline)
    r.font('bold', 10, 'courier').set(row[3])
    d.text(row[2], c3, baseline)
  })
  r.y += rowH * rows.length + 26
}

function swapsSection(r, data) {
  const d = r.doc
  r.need(30)
  r.font('bold', 12).set(C.ink)
  d.text(`Suggested replacements`, M, r.y + 10)
  r.font('normal', 10).set(C.muted)
  d.text(`${data.swaps.length} components`, M + 168, r.y + 10)
  r.y += 26

  for (const s of data.swaps) swapCard(r, s)
}

function swapCard(r, s) {
  const d = r.doc
  const padX = 16
  const innerW = CONTENT_W - padX * 2

  // Pre-measure pros/cons to size the card and keep it on one page.
  r.font('normal', 9)
  const colW = innerW / 2 - 8
  const prosLines = (s.pros.length ? s.pros : ['No notable gains flagged.'])
    .map((t) => d.splitTextToSize('-  ' + sanitize(t), colW))
  const consLines = (s.cons.length ? s.cons : ['No material trade-offs identified.'])
    .map((t) => d.splitTextToSize('-  ' + sanitize(t), colW))
  const prosH = prosLines.reduce((a, l) => a + l.length * 12, 0)
  const consH = consLines.reduce((a, l) => a + l.length * 12, 0)
  const bodyH = Math.max(prosH, consH)
  const cardH = 54 + bodyH + 22

  r.need(cardH + 12)
  const top = r.y
  r.fill(C.card).stroke(C.line).doc.setLineWidth(0.8)
  d.roundedRect(M, top, CONTENT_W, cardH, 9, 9, 'FD')

  // Component + from→to line.
  r.font('bold', 11).set(C.ink)
  d.text(s.component, M + padX, top + 22)
  r.font('normal', 9, 'courier')
  if (s.swapped) {
    r.set(C.faint)
    const fromW = d.getTextWidth(s.from)
    d.text(s.from, M + padX, top + 39)
    // strike-through on the baseline material
    r.stroke(C.faint).doc.setLineWidth(0.7)
    d.line(M + padX, top + 36, M + padX + fromW, top + 36)
    r.set(C.muted); d.text('->', M + padX + fromW + 6, top + 39)
    r.set(C.ink); d.text(s.to, M + padX + fromW + 22, top + 39)
  } else if (s.flagged) {
    r.set(C.bad)
    d.text(`${s.from}  ·  no viable swap (flagged)`, M + padX, top + 39)
  } else {
    r.set(C.ink2)
    d.text(`${s.from}  ·  already lowest-carbon`, M + padX, top + 39)
  }

  // Cost / CO2e on the right.
  r.font('normal', 7).set(C.muted)
  d.text('COST/UNIT', PAGE_W - M - 150, top + 16)
  d.text('CO2e/UNIT', PAGE_W - M - 70, top + 16)
  r.font('bold', 10, 'courier').set(C.ink)
  d.text(String(s.cost), PAGE_W - M - 150, top + 32)
  r.set(C.accent)
  d.text(`${s.co2e}`, PAGE_W - M - 70, top + 32)

  // Divider under the header row.
  const divY = top + 50
  r.stroke(C.line2).doc.setLineWidth(0.6)
  d.line(M + padX, divY, M + CONTENT_W - padX, divY)

  // Pros (left) / Cons (right).
  const colLx = M + padX
  const colRx = M + padX + innerW / 2 + 8
  let py = divY + 16
  r.font('bold', 7.5).set(C.accent)
  d.text(s.flagged ? 'REQUIREMENT NOT MET' : 'PROS', colLx, py)
  r.font('bold', 7.5).set(C.bad)
  d.text(s.flagged ? 'REJECTED CANDIDATES' : 'CONS', colRx, py)
  py += 12

  const drawCol = (lines, x, hasContent, contentColor) => {
    r.font('normal', 9).set(hasContent ? C.ink2 : C.muted)
    let cy = py
    for (const block of lines) {
      for (const line of block) { d.text(line, x, cy); cy += 12 }
    }
  }
  drawCol(prosLines, colLx, s.pros.length)
  drawCol(consLines, colRx, s.cons.length)

  r.y = top + cardH + 12
}

function disclaimer(r) {
  r.need(40)
  r.y += 6
  r.paragraph(
    'Cost and CO2e are computed from the ecocompass material library; figures marked "estimated" in the dataset are indicative, not sourced to a single figure. Materiom recipe families carry directional numbers for a material class, not measured values from one recipe.',
    { size: 8, color: C.faint, lh: 1.5 }
  )
}

function money(v) { return '$' + Number(v).toFixed(2) }

// --- public entry point ----------------------------------------------------

// `data` is the fully-derived report payload assembled by ResultsView.
export function generateEcoReport(data) {
  const r = new Report()
  header(r, data)
  ecoScoreBlock(r, data)
  totalsBlock(r, data)
  swapsSection(r, data)
  disclaimer(r)

  const name = `ecocompass_${slugify(data.meta.productName)}_report.pdf`
  r.doc.save(name)
}
