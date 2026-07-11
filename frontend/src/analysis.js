// Swap-analysis engine for ecocompass.
//
// This is the single seam between the UI and the (future) backend. `analyzeBom`
// is async and returns the exact shape a `POST /analyze-bom` response would —
// today it computes locally from the material library; when the service is
// ready, only the body of `analyzeBom` changes (see the fetch hook there).
//
// For every BOM line the engine:
//   1. resolves the line's functional requirements (explicit, else derived from
//      the original material),
//   2. splits the library into VIABLE candidates (meet every requirement) and
//      REJECTED ones (with the specific reason each failed — the credibility
//      feature),
//   3. ranks the viable pool by a carbon↔cost weighted score (the priority
//      slider), and
//   4. assigns a green / yellow / red status.

import { DATA, mat } from './materials.js'

// The endpoint the real analyzer will expose; referenced by the fetch hook.
export const ANALYZE_ENDPOINT = '/analyze-bom'

// --- library-wide normalisation ranges (for radar axes) --------------------
const rangeOf = (key) => {
  const vals = DATA.map((d) => d[key]).filter((v) => v != null)
  return { min: Math.min(...vals), max: Math.max(...vals) }
}
const RANGES = {
  co2e: rangeOf('co2e_per_kg'),
  cost: rangeOf('cost_per_kg'),
  durability: rangeOf('durability_years'),
}
const norm01 = (v, { min, max }) => (max === min ? 0.5 : (v - min) / (max - min))

// Four radar axes, each 0–100 where HIGHER = better. Carbon and cost are
// inverted (cheaper / lower-carbon scores higher); recyclability is already 0–1.
export function radarAxes(m) {
  return {
    carbon: Math.round((1 - norm01(m.co2e_per_kg, RANGES.co2e)) * 100),
    cost: Math.round((1 - norm01(m.cost_per_kg, RANGES.cost)) * 100),
    durability: Math.round(norm01(m.durability_years, RANGES.durability) * 100),
    recyclability: Math.round(m.recyclability_score * 100),
  }
}

// Build the Recharts-friendly series comparing an original material against a
// candidate (candidate may be null → single polygon).
export function radarSeries(original, candidate) {
  const o = radarAxes(original)
  const c = candidate ? radarAxes(candidate) : null
  return [
    { axis: 'Carbon', original: o.carbon, suggestion: c?.carbon ?? null },
    { axis: 'Cost', original: o.cost, suggestion: c?.cost ?? null },
    { axis: 'Durability', original: o.durability, suggestion: c?.durability ?? null },
    { axis: 'Recyclability', original: o.recyclability, suggestion: c?.recyclability ?? null },
  ]
}

// --- requirements ----------------------------------------------------------
// Explicit per-line requirements win. With none, we derive a conservative bar
// from the original material: keep ≥60% of its tensile strength and meet its
// service temperature / food / outdoor ratings (mirrors the parser's heuristic).
function requirementsFor(line, f) {
  if (line.req) {
    return {
      tensile: line.req.tensile ?? 0,
      maxTemp: line.req.maxTemp ?? -Infinity,
      foodSafe: !!line.req.foodSafe,
      outdoorSafe: !!line.req.outdoorSafe,
      derived: false,
    }
  }
  return {
    tensile: +(f.tensile_strength_mpa * 0.6).toFixed(1),
    maxTemp: f.max_temp_c,
    foodSafe: f.food_safe,
    outdoorSafe: f.outdoor_safe,
    derived: true,
  }
}

// A short human phrase describing the bar a swap must clear.
export function requirementSummary(reqs) {
  const parts = []
  if (reqs.tensile > 0) parts.push(`≥ ${reqs.tensile} MPa tensile`)
  if (reqs.maxTemp > -Infinity) parts.push(`≥ ${reqs.maxTemp}°C service`)
  if (reqs.foodSafe) parts.push('food-contact safe')
  if (reqs.outdoorSafe) parts.push('outdoor-rated')
  return parts.join(' · ') || 'no hard constraints'
}

// Every reason a candidate fails the requirements (empty ⇒ viable).
function rejectionReasons(cand, reqs) {
  const reasons = []
  if (cand.tensile_strength_mpa < reqs.tensile)
    reasons.push(`tensile strength ${cand.tensile_strength_mpa} MPa < required ${reqs.tensile} MPa`)
  if (cand.max_temp_c < reqs.maxTemp)
    reasons.push(`max service temp ${cand.max_temp_c}°C < required ${reqs.maxTemp}°C`)
  if (reqs.foodSafe && !cand.food_safe)
    reasons.push('not food-contact safe (required for this part)')
  if (reqs.outdoorSafe && !cand.outdoor_safe)
    reasons.push('not rated for outdoor use (required for this part)')
  return reasons
}

// --- scoring ---------------------------------------------------------------
// Keep swaps within a sensible material family: a same-category candidate gets a
// standing bonus so e.g. a plastic part swaps to another plastic rather than to
// whatever scores marginally best on raw numbers (recycled steel is cheap, low-
// carbon AND durable, so without this it would win almost everything). A cross-
// family swap still wins when it's clearly, not marginally, better.
function affinity(cand, f) {
  return cand.category === f.category ? 0.35 : 0
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Weighted improvement of a candidate over the original. `carbonWeight` ∈ [0,1]
// slides the objective from cost-focused (0) to carbon-focused (1); recyclability
// and durability act as fixed secondary tie-breakers, plus a family-affinity
// bonus. Gains are clamped so a single lopsided metric (e.g. a 3× longer service
// life, or a near-zero-carbon material) can't run away with the ranking.
// 0 ⇒ no better than keeping the original.
function scoreCandidate(cand, f, carbonWeight) {
  const carbonGain = clamp((f.co2e_per_kg - cand.co2e_per_kg) / f.co2e_per_kg, -1, 1)
  const costGain = clamp((f.cost_per_kg - cand.cost_per_kg) / f.cost_per_kg, -1, 1)
  const recycGain = cand.recyclability_score - f.recyclability_score
  const durGain = clamp((cand.durability_years - f.durability_years) / Math.max(f.durability_years, 1), -1, 1)
  const w = carbonWeight
  return w * carbonGain + (1 - w) * costGain + 0.15 * recycGain + 0.05 * durGain + affinity(cand, f)
}

// Reuse across the app: derive the pros/cons of a from→to swap.
export function prosConsFor(f, t) {
  const pros = [], cons = []
  if (!f || !t) return { pros, cons }

  const co2eCut = Math.round((1 - t.co2e_per_kg / f.co2e_per_kg) * 100)
  if (co2eCut >= 5) pros.push(co2eCut + '% lower embodied carbon per kg')
  else if (co2eCut <= -5) cons.push(Math.abs(co2eCut) + '% higher embodied carbon per kg')

  const costDeltaPct = Math.round((t.cost_per_kg / f.cost_per_kg - 1) * 100)
  if (costDeltaPct <= -5) pros.push('Lower material cost (' + costDeltaPct + '%/kg)')
  else if (costDeltaPct >= 5) cons.push('Higher material cost (+' + costDeltaPct + '%/kg)')

  const recycDelta = t.recyclability_score - f.recyclability_score
  if (recycDelta >= 0.08) pros.push('More recyclable at end of life')
  else if (recycDelta <= -0.08) cons.push('Less recyclable at end of life')

  if (t.durability_years >= f.durability_years + 3) pros.push('Longer expected service life')
  else if (t.durability_years <= f.durability_years - 3) cons.push('Shorter expected service life')

  const tensileDeltaPct = (t.tensile_strength_mpa - f.tensile_strength_mpa) / f.tensile_strength_mpa
  if (tensileDeltaPct <= -0.2) cons.push('Lower tensile strength than original')
  else if (tensileDeltaPct >= 0.2) pros.push('Higher tensile strength than original')

  if (t.max_temp_c <= f.max_temp_c - 30) cons.push('Lower maximum service temperature')
  if (f.food_safe && !t.food_safe) cons.push('No longer food-contact safe')
  if (f.outdoor_safe && !t.outdoor_safe) cons.push('No longer rated for outdoor use')

  return { pros: pros.slice(0, 3), cons: cons.slice(0, 2) }
}

// Compact candidate record for the per-component results table.
const candRow = (cand, f, carbonWeight, status, reasons) => ({
  material: cand.name,
  category: cand.category,
  source: cand.source || null,
  co2e: cand.co2e_per_kg,
  cost: cand.cost_per_kg,
  recyclability: cand.recyclability_score,
  tensile: cand.tensile_strength_mpa,
  score: scoreCandidate(cand, f, carbonWeight),
  status,                       // 'viable' | 'rejected'
  reasons: reasons || [],
})

// --- per-line analysis -----------------------------------------------------
function analyzeLine(line, carbonWeight) {
  const f = mat(line.from)
  const kg = line.kg
  const reqs = requirementsFor(line, f)

  const viable = [], rejected = []
  for (const cand of DATA) {
    if (cand.name === f.name) continue
    const reasons = rejectionReasons(cand, reqs)
    if (reasons.length) rejected.push(candRow(cand, f, carbonWeight, 'rejected', reasons))
    else viable.push(candRow(cand, f, carbonWeight, 'viable'))
  }
  viable.sort((a, b) => b.score - a.score)
  // Rejected sorted by carbon appeal — the most tempting low-carbon options that
  // we had to turn down surface first (that's the story worth telling).
  rejected.sort((a, b) => a.co2e - b.co2e)

  const top = viable[0] || null
  let status, statusReason, suggestion
  if (!top) {
    status = 'red'
    suggestion = null
    statusReason = 'No viable alternative — every lower-impact candidate fails a functional requirement.'
  } else if (top.score <= 0) {
    status = 'yellow'
    suggestion = null // keeping the original is the better call under these priorities
    statusReason = 'Original is already the best available choice under these priorities.'
  } else {
    suggestion = top
    const carbonCut = (f.co2e_per_kg - top.co2e) / f.co2e_per_kg
    const costDelta = (top.cost - f.cost_per_kg) / f.cost_per_kg
    if (carbonCut >= 0.10 && costDelta <= 0.15) {
      status = 'green'
      statusReason = 'Strong swap: meaningfully lower carbon within cost tolerance.'
    } else {
      status = 'yellow'
      statusReason = costDelta > 0.15
        ? 'Viable swap, but at a cost premium worth reviewing.'
        : 'Viable swap with a modest carbon gain.'
    }
  }

  const to = suggestion ? mat(suggestion.material) : f
  const { pros, cons } = suggestion ? prosConsFor(f, to) : { pros: [], cons: [] }

  return {
    component: line.component,
    kg,
    from: f.name,
    original: f,
    requirements: reqs,
    requirementText: requirementSummary(reqs),
    status,
    statusReason,
    swapped: !!suggestion,
    suggestion,                      // candRow of the chosen swap, or null
    to: to.name,
    viable,                          // ranked viable candidates
    rejected,                        // rejected candidates + reasons
    pros,
    cons,
    radar: radarSeries(f, suggestion ? to : null),
    // per-unit contributions (chosen material, or original when kept/flagged)
    costFrom: f.cost_per_kg * kg,
    costTo: to.cost_per_kg * kg,
    co2eFrom: f.co2e_per_kg * kg,
    co2eTo: to.co2e_per_kg * kg,
    recycFrom: f.recyclability_score,
    recycTo: to.recyclability_score,
  }
}

// --- summary roll-up -------------------------------------------------------
function summarise(lines) {
  let costFrom = 0, costTo = 0, co2eFrom = 0, co2eTo = 0, recycFrom = 0, recycTo = 0
  let green = 0, yellow = 0, red = 0, swapCount = 0
  for (const l of lines) {
    costFrom += l.costFrom; costTo += l.costTo
    co2eFrom += l.co2eFrom; co2eTo += l.co2eTo
    recycFrom += l.recycFrom; recycTo += l.recycTo
    if (l.status === 'green') green++
    else if (l.status === 'yellow') yellow++
    else red++
    if (l.swapped) swapCount++
  }
  const n = lines.length || 1
  const co2eSaved = co2eFrom - co2eTo
  const co2ePct = Math.round((1 - co2eTo / (co2eFrom || 1)) * 100)
  const costDelta = costTo - costFrom
  const recycPts = Math.round((recycTo / n - recycFrom / n) * 100)

  // Composite eco score (kept compatible with the PDF report).
  const costUp = costDelta > 0
  let ecoScore = Math.round(55 + co2ePct * 0.32 + recycPts * 0.22 + (costUp ? -6 : 6) - red * 4)
  ecoScore = Math.max(0, Math.min(99, ecoScore))
  const ecoGrade = ecoScore >= 90 ? 'A' : ecoScore >= 75 ? 'B' : ecoScore >= 60 ? 'C' : ecoScore >= 45 ? 'D' : 'F'

  return {
    costFrom, costTo, costDelta, costUp,
    co2eFrom, co2eTo, co2eSaved, co2ePct,
    recycFrom: recycFrom / n, recycTo: recycTo / n, recycPts,
    green, yellow, red,
    viableCount: swapCount,        // lines with a recommended swap
    flaggedCount: red,             // lines with no viable swap
    keptCount: lines.length - swapCount - red,
    ecoScore, ecoGrade,
  }
}

// --- public entry point ----------------------------------------------------
// `weights.carbon` ∈ [0,1] is the priority-slider position (0 = cost, 1 = carbon).
export async function analyzeBom(bom, weights = { carbon: 0.6 }) {
  // ── Backend hook ─────────────────────────────────────────────────────────
  // When POST /analyze-bom is live, replace everything below with:
  //   const res = await fetch(ANALYZE_ENDPOINT, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ bom, weights }),
  //   })
  //   if (!res.ok) throw new Error(`analyze-bom failed: ${res.status}`)
  //   return res.json()
  // ─────────────────────────────────────────────────────────────────────────
  const carbonWeight = Math.max(0, Math.min(1, weights?.carbon ?? 0.6))
  const lines = bom.map((line) => analyzeLine(line, carbonWeight))
  const summary = summarise(lines)
  return { weights: { carbon: carbonWeight }, lines, summary }
}
