// BOM parser for MaterialSwap.
//
// Turns an uploaded bill-of-materials file into the { component, from, to, kg }
// rows the results view renders. CSV is parsed natively (no dependencies).
// Excel (.xlsx/.xls) is a binary/zip format that needs SheetJS — see
// parseBomFile() for the single hook where that would slot in.

import { DATA, mat } from './materials.js'

// --- CSV -------------------------------------------------------------------
// A small RFC-4180-ish parser: handles quoted fields, escaped quotes (""),
// embedded commas/newlines, and both LF and CRLF line endings. The leading
// strip is a UTF-8 byte-order mark (BOM) — the one BOM this app doesn't try to
// recommend a swap for.
export function parseCsv(text) {
  text = String(text).replace(/^﻿/, '')
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\r') { /* swallow, \n handles the break */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  // drop fully blank lines
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

// --- column + material matching -------------------------------------------
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

// Header aliases — a user's BOM won't use our exact column names.
const COL_ALIASES = {
  component: ['component', 'part', 'partname', 'name', 'item', 'description', 'desc', 'assembly'],
  material: ['material', 'from', 'frommaterial', 'current', 'currentmaterial', 'spec', 'composition', 'substance', 'mat'],
  kg: ['kg', 'mass', 'masskg', 'weight', 'weightkg', 'quantitykg', 'qtykg', 'massperunit', 'perunitkg'],
  to: ['to', 'swap', 'target', 'tomaterial', 'alternative', 'recommended'],
  // Drive the repairability/longevity score (see backend/data/scoring_rules.json).
  fastening: ['fastening', 'fasteningtype', 'attachment', 'joining', 'joiningmethod', 'fixing', 'assemblymethod'],
  sourcing: ['sourcing', 'sourcingtype', 'supply', 'availability', 'supplier', 'source', 'procurement'],
}

// Common names people write for each library material.
const MAT_SYNONYMS = {
  aluminum_6061: ['aluminum', 'aluminium', 'al', '6061', 'aluminum6061', 'aluminium6061', 'aluminumalloy', 'aluminiumalloy'],
  steel: ['steel', 'mildsteel', 'carbonsteel', 'structuralsteel', 'a36'],
  recycled_steel: ['recycledsteel', 'eafsteel', 'scrapsteel', 'secondarysteel'],
  recycled_aluminum: ['recycledaluminum', 'recycledaluminium', 'secondaryaluminum', 'secondaryaluminium'],
  ABS: ['abs', 'absplastic'],
  polypropylene: ['polypropylene', 'pp'],
  PET: ['pet', 'pete', 'polyester'],
  recycled_PET: ['recycledpet', 'rpet'],
  bamboo_composite: ['bamboo', 'bamboocomposite'],
  FSC_plywood: ['plywood', 'fscplywood', 'ply'],
  oak: ['oak', 'oakwood', 'hardwood'],
  cork: ['cork'],
  hemp_composite: ['hemp', 'hempcomposite'],
  PLA: ['pla'],
  glass_fiber_composite: ['glassfiber', 'glassfibre', 'gfrp', 'fiberglass', 'fibreglass', 'glassfibercomposite'],
  flax_fiber_composite: ['flax', 'flaxfiber', 'flaxfibre', 'flaxcomposite'],
  mycelium_foam: ['mycelium', 'myceliumfoam'],
  wool_felt: ['wool', 'woolfelt', 'felt'],
}

function detectColumns(header) {
  const idx = {}
  header.forEach((h, i) => {
    const n = norm(h)
    for (const key of Object.keys(COL_ALIASES)) {
      if (idx[key] === undefined && COL_ALIASES[key].includes(n)) idx[key] = i
    }
  })
  return idx
}

// Resolve a free-text material name to a library entry, or null if unknown.
export function matchMaterial(raw) {
  const n = norm(raw)
  if (!n) return null
  const direct = DATA.find((d) => norm(d.name) === n)
  if (direct) return direct.name
  for (const [name, syns] of Object.entries(MAT_SYNONYMS)) {
    if (syns.includes(n)) return name
  }
  // Loose substring match, but only for tokens long enough to be unambiguous
  // (keeps "al"/"pp" from matching "metal"/"apple crate" etc.).
  if (n.length >= 4) {
    for (const [name, syns] of Object.entries(MAT_SYNONYMS)) {
      if (syns.some((s) => s.length >= 4 && (n.includes(s) || s.includes(n)))) return name
    }
  }
  return null
}

// When a material isn't in the library, stand in the closest representative of
// its category so the row survives (flagged for the user to confirm) instead of
// being dropped. Names must exist in DATA.
const CATEGORY_PROXY = {
  metal: 'steel', plastic: 'ABS', bioplastic: 'PLA', wood: 'FSC_plywood',
  natural: 'cork', biocomposite: 'bamboo_composite', composite: 'glass_fiber_composite',
}

// Keyword → category, checked in order (bioplastic before plastic so "biopolymer"
// isn't swallowed by the "plastic" substring, etc.).
const CATEGORY_KEYWORDS = [
  ['metal', ['metal', 'alloy', 'steel', 'iron', 'alumin', 'zinc', 'brass', 'copper', 'bronze', 'titanium', 'magnesium', 'chrome', 'nickel', 'tin']],
  ['wood', ['wood', 'timber', 'plywood', 'oak', 'bamboo', 'mdf', 'birch', 'pine', 'walnut', 'maple']],
  ['bioplastic', ['bioplastic', 'biopolymer', 'starch', 'alginate', 'chitosan', 'gelatin', 'agar']],
  ['biocomposite', ['composite', 'fiber', 'fibre', 'hemp', 'flax', 'cellulose', 'coir', 'jute']],
  ['natural', ['cork', 'wool', 'felt', 'leather', 'cotton', 'mycelium', 'paper', 'cardboard', 'rubber', 'silicone', 'latex']],
  ['plastic', ['plastic', 'polymer', 'resin', 'nylon', 'polyamide', 'polycarbonate', 'pvc', 'acrylic', 'pmma', 'abs', 'hdpe', 'ldpe', 'polyethylene', 'polypropylene', 'pet', 'tpu', 'tpe', 'foam', 'polyurethane', 'styrene']],
]

const prettyMat = (name) => String(name).replace(/_/g, ' ')

function inferCategory(raw) {
  const n = String(raw || '').toLowerCase()
  for (const [cat, kws] of CATEGORY_KEYWORDS) if (kws.some((k) => n.includes(k))) return cat
  return null
}

// Best-effort resolve a free-text material to a library entry. Returns
// { name, confidence: 'high' | 'proxy', reason }. 'proxy' means we stood in the
// closest category match for the user to confirm rather than dropping the row.
export function resolveMaterial(raw) {
  const direct = matchMaterial(raw)
  if (direct) return { name: direct, confidence: 'high', reason: '' }
  const clean = String(raw || '').trim() || 'this material'
  const cat = inferCategory(clean)
  const proxy = CATEGORY_PROXY[cat] || CATEGORY_PROXY.plastic
  const reason = cat
    ? `"${clean}" isn't in the swap library — using ${prettyMat(proxy)} as the closest ${cat} stand-in. Confirm or pick a better fit.`
    : `Couldn't place "${clean}" in the swap library — using ${prettyMat(proxy)} as a placeholder. Confirm or pick a better fit.`
  return { name: proxy, confidence: 'proxy', reason }
}

// --- swap recommendation ---------------------------------------------------
// Pick a lower-carbon library material that keeps enough structural strength.
// Prefers a recycled/same-family variant, then lowest embodied carbon, then
// lowest cost. Returns the original name if nothing beats it.
export function recommendSwap(fromName) {
  const f = mat(fromName)
  if (!f) return fromName
  const minStrength = f.tensile_strength_mpa * 0.6
  const stem = f.name.replace(/^recycled_/, '').split('_')[0].toLowerCase()

  // Only swap to something both lower-carbon AND strong enough to stand in for
  // the original — never recommend a structurally inadequate downgrade, and
  // never one whose carbon/cost isn't sourced (guards Materiom-style entries
  // with unsourced metrics from silently driving a recommendation).
  const pool = DATA.filter(
    (d) => d.name !== f.name && d.co2e_per_kg != null && d.cost_per_kg != null &&
      d.co2e_per_kg < f.co2e_per_kg && d.tensile_strength_mpa >= minStrength,
  )
  if (!pool.length) return f.name

  pool.sort((a, b) => {
    const stemA = a.name.toLowerCase().includes(stem) ? 0 : 1
    const stemB = b.name.toLowerCase().includes(stem) ? 0 : 1
    if (stemA !== stemB) return stemA - stemB
    const catA = a.category === f.category ? 0 : 1
    const catB = b.category === f.category ? 0 : 1
    if (catA !== catB) return catA - catB
    if (a.co2e_per_kg !== b.co2e_per_kg) return a.co2e_per_kg - b.co2e_per_kg
    return a.cost_per_kg - b.cost_per_kg
  })
  return pool[0].name
}

// --- top-level BOM parse ---------------------------------------------------
const parseKg = (v) => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

const prettyProduct = (fileName) =>
  String(fileName || 'Uploaded BOM')
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Uploaded BOM'

// Parse CSV text into BOM rows plus human-readable warnings and product meta.
export function parseBomCsv(text, fileName) {
  const grid = parseCsv(text)
  const warnings = []
  if (!grid.length) {
    return { rows: [], warnings: ['The file is empty or could not be read.'], meta: null }
  }

  // Decide whether the first line is a header. If our known headers show up,
  // use them; otherwise fall back to positional columns [component, material, kg].
  const detected = detectColumns(grid[0])
  const hasHeader = detected.component !== undefined || detected.material !== undefined
  const idx = hasHeader
    ? detected
    : { component: 0, material: 1, kg: 2 }
  const body = hasHeader ? grid.slice(1) : grid

  if (idx.material === undefined) {
    return {
      rows: [],
      warnings: ['Could not find a material column. Add a header row with a "material" (or "from") column.'],
      meta: null,
    }
  }

  const rows = []
  body.forEach((cells, r) => {
    const rawMat = cells[idx.material]
    if (rawMat === undefined || rawMat.trim() === '') return
    const lineNo = (hasHeader ? r + 2 : r + 1)

    const component = (idx.component !== undefined && cells[idx.component]?.trim())
      || `Component ${rows.length + 1}`

    // Never drop a component: an unmatched material is stood in with the closest
    // library material (flagged 'proxy' for the user to confirm below).
    const resolved = resolveMaterial(rawMat)
    const from = resolved.name

    let kg = idx.kg !== undefined ? parseKg(cells[idx.kg]) : NaN
    // Missing/invalid mass: flag the row so the results view can ask the user to
    // fill it in, but keep a provisional 1 kg so the analysis still runs meanwhile.
    let kgMissing = false
    if (!Number.isFinite(kg) || kg <= 0) {
      kgMissing = true
      kg = 1
    }

    // Honour an explicit swap target if the user supplied one and it resolves,
    // otherwise recommend the best lower-carbon alternative.
    let to = idx.to !== undefined ? matchMaterial(cells[idx.to]) : null
    if (!to) to = recommendSwap(from)

    // Fastening / sourcing feed the repairability score (kept as free text; the
    // backend normalises them against scoring_rules.json).
    const fastening = (idx.fastening !== undefined && cells[idx.fastening]?.trim()) || ''
    const sourcing = (idx.sourcing !== undefined && cells[idx.sourcing]?.trim()) || ''

    const row = { component, from, to, kg: Math.round(kg * 1000) / 1000, kgMissing, kgEstimated: false, fastening, sourcing }
    if (resolved.confidence === 'proxy') {
      row.materialConfidence = 'proxy'
      row.materialRaw = String(rawMat).trim()
      row.materialReason = resolved.reason
    }
    rows.push(row)
  })

  if (!rows.length && !warnings.length) {
    warnings.push('No usable rows found in the file.')
  }

  const proxyCount = rows.filter((r) => r.materialConfidence === 'proxy').length
  if (proxyCount) {
    warnings.push(`${proxyCount} material${proxyCount > 1 ? 's' : ''} weren't in the swap library — we filled in the closest match for you to confirm below.`)
  }

  const totalKg = rows.reduce((s, b) => s + b.kg, 0)
  const meta = {
    productName: prettyProduct(fileName),
    componentCount: rows.length,
    totalKg,
    note: `from ${fileName || 'uploaded file'}`,
  }
  return { rows, warnings, meta }
}

// Entry point used by the UI. Reads the file and dispatches by extension.
// CSV is handled natively; Excel is stubbed with an actionable message and a
// single clearly-marked place to drop SheetJS in later.
export function parseBomFile(file) {
  return new Promise((resolve) => {
    const name = file?.name || ''
    const ext = name.toLowerCase().split('.').pop()

    if (ext === 'xlsx' || ext === 'xls') {
      resolve({
        rows: [],
        warnings: [],
        meta: null,
        error:
          'Excel files need the "xlsx" (SheetJS) library, which isn\'t installed. ' +
          'Export your sheet as CSV and upload that, or ask to enable Excel support.',
      })
      // To enable Excel: `npm install xlsx`, then replace the block above with —
      //   const XLSX = await import('xlsx')
      //   const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      //   const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])
      //   resolve(parseBomCsv(csv, name))
      return
    }

    const reader = new FileReader()
    reader.onload = () => resolve(parseBomCsv(String(reader.result || ''), name))
    reader.onerror = () =>
      resolve({ rows: [], warnings: [], meta: null, error: 'Could not read the file.' })
    reader.readAsText(file)
  })
}

// A ready-to-fill CSV template so users know the expected shape.
export function bomTemplateCsv() {
  return [
    'component,material,kg',
    'Outer casing,ABS,0.35',
    'Motor housing,aluminum,0.22',
    'Drive motor,steel,0.4',
    'Dust filter,ABS,0.12',
  ].join('\n')
}
