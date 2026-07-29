'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '@/lib/theme'
import type { COICoverage, COIExtracted, FieldLocation } from '@/lib/types'

/**
 * Split review: the customer's ACTUAL submitted certificate beside the
 * requirement-check cards. Hovering (or tapping) a check highlights the
 * region of the document it was verified against. Images render directly;
 * PDFs render page-by-page via pdf.js (worker at /pdf.worker.min.mjs),
 * stacked vertically inside a scrollable, zoomable frame.
 *
 * HOW HIGHLIGHTS ARE LOCATED, most precise first:
 * 1. TEXT ANCHORING (PDFs with a text layer): highlights are found by
 *    searching the pdf.js text layer for the values extraction already read —
 *    the policy number for a coverage row, the insured's name, the VIN in a
 *    vehicle requirement, the policy dates. This is exact and works across
 *    pages (e.g. the ACORD 101 vehicle schedule on page 2). The model's boxes
 *    are used only to disambiguate when a value appears more than once.
 * 2. SNAPPED MODEL BOXES (scanned images / no text layer): the extraction
 *    model's percent-of-page boxes, snapped onto the document's printed rules
 *    detected from the rendered pixels (see snapLocations). Vision coordinates
 *    drift several % down the page — never trust them raw when a snap or
 *    anchor is available.
 * 3. RAW MODEL BOXES: last resort when detection fails (tainted canvas,
 *    photo without clean rules).
 * A check whose location cannot be established at all simply renders as a
 * non-interactive card — never a wrong highlight by construction.
 */

export interface CheckItem {
  requirement: { coverage_type?: string; minimum_limit?: string; notes?: string | null }
  status: 'met' | 'not_met' | 'uncertain'
  evidence?: string
  insurer_confirmation?: 'call' | 'email'
}
export interface CoiDocFile {
  url: string
  mime: string
  fileName: string
}

const TAG = {
  met:       { label: 'Passed',  color: C.ok },
  not_met:   { label: 'Failed',  color: C.error },
  uncertain: { label: 'Warning', color: C.warn },
} as const

// ─── Check → rule classification ─────────────────────────────────────────────
// Requirement names are free text from the gap analysis; coverage types are
// free text from extraction. Both funnel through canonical keys so
// "Auto Liability $1M CSL" finds the "AUTOMOBILE LIABILITY" row.

const COVERAGE_ALIASES: [RegExp, string][] = [
  [/general liability|\bcgl\b|\bgl\b/, 'gl'],
  [/auto(mobile)?\b|combined single limit|\bcsl\b/, 'auto'],
  [/cargo/, 'cargo'],
  [/workers?s? comp|\bwc\b|employers? liability/, 'wc'],
  [/umbrella|excess/, 'umbrella'],
  [/physical damage|\bapd\b/, 'apd'],
  [/trailer interchange/, 'ti'],
  [/garage/, 'garage'],
]

function norm(s?: string | null): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
function coverageKey(s?: string): string | null {
  const n = norm(s)
  if (!n) return null
  for (const [re, key] of COVERAGE_ALIASES) if (re.test(n)) return key
  return null
}

type RegionKey = 'producer' | 'insured' | 'insurers' | 'certificate_holder' | 'additional_insured' | 'description_of_operations'
type Rule =
  | { type: 'region'; key: RegionKey }
  | { type: 'coverage'; index: number }
  | { type: 'dates' }
  | { type: 'search' }

/** Classify a requirement check into how its document location is found. */
function ruleFor(item: CheckItem, coverages: COICoverage[]): Rule {
  const r = norm(item.requirement?.coverage_type)
  if (!r) return { type: 'search' }
  // Identity / party checks first: their wording often also mentions a coverage.
  if (r.includes('certificate holder')) return { type: 'region', key: 'certificate_holder' }
  if (r.includes('additional insured')) return { type: 'region', key: 'additional_insured' }
  if (r.includes('loss payee')) return { type: 'region', key: 'description_of_operations' }
  if (r.includes('policyholder') || r.includes('named insured') || r.includes('carrier name') || r.includes('insured party')) return { type: 'region', key: 'insured' }
  if (r.includes('usdot') || r.includes('mc number')) return { type: 'region', key: 'insured' }
  if (r.includes('producer') || r.includes('agency')) return { type: 'region', key: 'producer' }
  if (r.includes('insurance company') || r.includes('insurer name') || r.includes('am best') || r.includes('rating')) return { type: 'region', key: 'insurers' }
  // Vehicle / VIN / driver checks carry their own distinctive values (a VIN, a
  // make/model) — text search finds them wherever they sit (often the ACORD
  // 101 schedule page).
  if (/\bvins?\b/.test(r) || r.includes('vehicle') || r.includes('driver')) return { type: 'search' }
  const rKey = coverageKey(r)
  const covIdx = coverages.findIndex(c => {
    const cn = norm(c.type)
    if (!cn) return false
    if (rKey && coverageKey(cn) === rKey) return true
    return cn.includes(r) || r.includes(cn)
  })
  if (covIdx >= 0) return { type: 'coverage', index: covIdx }
  if (r.includes('active') || r.includes('in force') || r.includes('expir') || r.includes('effective') || r.includes('date')) return { type: 'dates' }
  if (r.includes('restriction') || r.includes('endorsement') || r.includes('radius') || r.includes('deductible')) return { type: 'region', key: 'description_of_operations' }
  return { type: 'search' }
}

// ─── Rule-line detection + model-box snapping (image / no-text fallback) ────

interface RuleLine { pct: number }

/** Horizontal rule positions (% of page height) from a rendered page canvas. */
function detectLines(canvas: HTMLCanvasElement): RuleLine[] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx || !canvas.width || !canvas.height) return []
  const { width: W, height: H } = canvas
  let img: ImageData
  try {
    img = ctx.getImageData(0, 0, W, H)
  } catch {
    return [] // tainted canvas (cross-origin image without CORS) — no snapping
  }
  const d = img.data
  const lines: RuleLine[] = []
  let start = -1
  for (let y = 0; y <= H; y++) {
    let on = false
    if (y < H) {
      let dark = 0, darkL = 0, darkR = 0
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        if (lum < 150) { dark++; if (x < W / 2) darkL++; else darkR++ }
      }
      on = dark / W > 0.5 || darkL / (W / 2) > 0.7 || darkR / (W / 2) > 0.7
    }
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      lines.push({ pct: ((start + y - 1) / 2 / H) * 100 })
      start = -1
    }
  }
  return lines
}

/**
 * The coverage table's K row boundaries are K consecutive detected rules.
 * Slide a window of K consecutive rules and score each against the model's
 * boundary chain after removing a linear drift (least-squares on offsets);
 * the lowest residual wins. Null when nothing fits sanely. NOTE: only valid
 * when the extracted coverages really are adjacent table rows — real
 * certificates often have empty rows between them, which is why PDFs use
 * text anchoring instead and this stays a scanned-image fallback.
 */
function fitChain(modelChain: number[], L: number[]): number[] | null {
  const K = modelChain.length
  if (K < 3 || L.length < K) return null
  let best: { score: number; window: number[]; resid: number } | null = null
  for (let s = 0; s + K <= L.length; s++) {
    const window = L.slice(s, s + K)
    const off = window.map((v, i) => v - modelChain[i])
    const n = K
    const sx = (n - 1) * n / 2, sxx = (n - 1) * n * (2 * n - 1) / 6
    const sy = off.reduce((a, v) => a + v, 0)
    const sxy = off.reduce((a, v, i) => a + v * i, 0)
    const denom = n * sxx - sx * sx
    const b = denom ? (n * sxy - sx * sy) / denom : 0
    const a = (sy - b * sx) / n
    const resid = off.reduce((acc, v, i) => acc + (v - (a + b * i)) ** 2, 0) / n
    const meanAbs = off.reduce((acc, v) => acc + Math.abs(v), 0) / n
    // The row-spacing pattern (residual after drift removal) is the real
    // fingerprint; |offset| only breaks ties. Large constant offsets are real:
    // a letterboxed page shifts every box by 15-25%.
    if (meanAbs > 30) continue
    const score = resid + meanAbs * 0.03
    if (!best || score < best.score) best = { score, window, resid }
  }
  return best && best.resid <= 6 ? best.window : null
}

/** Least-squares affine map y' = p*y + q from model boundaries to fitted lines. */
function affineFrom(model: number[], fitted: number[]): (y: number) => number {
  const n = model.length
  const sx = model.reduce((a, v) => a + v, 0)
  const sy = fitted.reduce((a, v) => a + v, 0)
  const sxx = model.reduce((a, v) => a + v * v, 0)
  const sxy = model.reduce((a, v, i) => a + v * fitted[i], 0)
  const denom = n * sxx - sx * sx
  const p = denom ? (n * sxy - sx * sy) / denom : 1
  const q = (sy - p * sx) / n
  return y => p * y + q
}

function nearestLine(v: number, L: number[], tol: number): number | null {
  let bestL: number | null = null
  for (const c of L) {
    if (Math.abs(c - v) <= tol && (bestL === null || Math.abs(c - v) < Math.abs(bestL - v))) bestL = c
  }
  return bestL
}

/** Corrected copy of the extraction's locations, snapped to detected rules. */
function snapLocations(coi: COIExtracted, linesByPage: Record<number, RuleLine[]>): COIExtracted {
  const out: COIExtracted = { ...coi, coverages: (coi.coverages ?? []).map(c => ({ ...c })), field_locations: { ...(coi.field_locations ?? {}) } }
  const snapBox = (loc: FieldLocation | null | undefined, y0: number, y1: number): FieldLocation | null =>
    loc ? { ...loc, box: [loc.box[0], y0, loc.box[2], y1] } : null

  const pages = new Set((out.coverages ?? []).map(c => c.location?.page).filter(Boolean) as number[])
  for (const page of pages) {
    const L = (linesByPage[page] ?? []).map(l => l.pct)
    if (!L.length) continue
    const covs = (out.coverages ?? []).filter(c => c.location?.page === page && Array.isArray(c.location?.box))
      .sort((a, b) => a.location!.box[1] - b.location!.box[1])
    // Chain: each row's top plus the last row's bottom (rows are adjacent).
    const chain = [...covs.map(c => c.location!.box[1]), covs[covs.length - 1]?.location!.box[3]].filter(v => v != null)
    const fitted = fitChain(chain, L)
    // Correction for boxes outside the coverage table: the chain fit tells us
    // the page's systematic drift/stretch; identity when no fit was possible.
    const correct = fitted ? affineFrom(chain, fitted) : (y: number) => y
    if (fitted) {
      covs.forEach((c, i) => { c.location = snapBox(c.location, fitted[i], fitted[i + 1]) })
      // ACORD adjacency: the remarks box starts where the table ends and the
      // certificate-holder box starts where the remarks end.
      const fl = out.field_locations!
      const chainBottom = fitted[fitted.length - 1]
      if (fl.description_of_operations?.page === page) {
        const below = L.filter(v => v > chainBottom + 2)
        const descBottom = below.length ? below[0] : chainBottom + 9
        fl.description_of_operations = snapBox(fl.description_of_operations, chainBottom, descBottom)
        if (fl.certificate_holder?.page === page) {
          const below2 = L.filter(v => v > descBottom + 2)
          fl.certificate_holder = snapBox(fl.certificate_holder, descBottom, below2.length ? below2[0] : descBottom + 9)
        }
      }
    }
    // Sparse boxes above the table: drift-correct, then nearest-rule snap.
    const fl = out.field_locations!
    for (const key of ['producer', 'insured', 'insurers', 'additional_insured'] as const) {
      const loc = fl[key]
      if (!loc || loc.page !== page || !Array.isArray(loc.box)) continue
      const c0 = correct(loc.box[1])
      const c1 = correct(loc.box[3])
      // Vision boxes drift DOWN the page (the calibration note in
      // lib/claude.ts), so a top edge with no rule tight against it prefers
      // the nearest rule ABOVE within 7% over a nearer one below — snapping
      // the top downward compounds the drift onto the next section (how
      // VRF-1087's insured highlight landed a full cell low). The bottom then
      // snaps after removing the same shift, so the box keeps its height
      // instead of stretching to a rule that only looked near because the
      // whole box sat too low.
      const tight0 = nearestLine(c0, L, 1.5)
      const above0 = nearestLine(c0, L.filter(v => v < c0), 7)
      const y0 = tight0 ?? above0 ?? nearestLine(c0, L, 4.5) ?? c0
      const shift = c0 - y0
      const y1 = nearestLine(c1 - shift, L, 4.5) ?? (c1 - shift)
      if (y1 > y0 + 1) fl[key] = snapBox(loc, y0, y1)
    }
  }
  return out
}

// ─── Text anchoring (PDF text layer) ─────────────────────────────────────────

interface TextItem { str: string; x: number; y: number; w: number; h: number }
type TextByPage = Record<number, TextItem[]>

const normText = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Text items containing the needle (or fully contained by it, for split runs). */
function findMatches(items: TextItem[], needle: string): TextItem[] {
  const n = normText(needle)
  if (n.length < 4) return []
  return items.filter(it => {
    const s = normText(it.str)
    if (s.length < 4) return false
    return s.includes(n) || (n.includes(s) && s.length >= Math.min(8, n.length))
  })
}

const padBox = (x0: number, y0: number, x1: number, y1: number): [number, number, number, number] =>
  [Math.max(0, x0 - 1), Math.max(0, y0 - 0.5), Math.min(100, x1 + 1), Math.min(100, y1 + 0.5)]

/** Grow a text bbox vertically to the enclosing printed rules when nearby. */
function growToLines(y0: number, y1: number, lines: number[], tol = 6): [number, number] {
  const above = lines.filter(l => l <= y0 + 0.2 && y0 - l <= tol)
  const below = lines.filter(l => l >= y1 - 0.2 && l - y1 <= tol)
  return [above.length ? Math.max(...above) : y0 - 0.6, below.length ? Math.min(...below) : y1 + 0.6]
}

/**
 * Anchor one region by searching for values extraction already read. Needles
 * are tried in order (most distinctive first); when a needle matches in
 * several places the match nearest the model's box wins.
 */
function anchorByNeedles(
  needles: (string | undefined)[],
  textByPage: TextByPage,
  linesByPage: Record<number, RuleLine[]>,
  prior: FieldLocation | null | undefined,
  opts: { fullWidth?: boolean; lineTol?: number } = {},
): FieldLocation[] {
  for (const needle of needles) {
    if (!needle || normText(needle).length < 4) continue
    const all: { page: number; it: TextItem }[] = []
    for (const [pageStr, items] of Object.entries(textByPage)) {
      const page = Number(pageStr)
      for (const it of findMatches(items, needle)) all.push({ page, it })
    }
    if (!all.length) continue
    // The model knows which PAGE a region sits on even when its box drifts.
    // A needle that only matches elsewhere (e.g. the insured's name quoted on
    // the remarks page while page 1 is a scan) is the wrong anchor — skip it
    // and let the snapped box handle the region. A needle matching exactly
    // once in the whole document is exempt: one printed occurrence of a full
    // value outranks the model's page guess.
    if (prior && all.length > 1 && !all.some(m => m.page === prior.page)) continue
    let chosen = all
    if (all.length > 1 && prior) {
      // Disambiguate repeats (e.g. the holder's name also quoted in the
      // remarks) with the model's approximate location.
      const cy = (prior.box[1] + prior.box[3]) / 2
      chosen = [all.reduce((best, cand) => {
        const d = (c: { page: number; it: TextItem }) =>
          Math.abs((c.it.y + c.it.h / 2) - cy) + (c.page === prior.page ? 0 : 200)
        return d(cand) < d(best) ? cand : best
      })]
    }
    // Group by page, one box per page around the matched runs.
    const byPage = new Map<number, TextItem[]>()
    for (const { page, it } of chosen) byPage.set(page, [...(byPage.get(page) ?? []), it])
    const locs: FieldLocation[] = []
    for (const [page, its] of byPage) {
      const x0 = Math.min(...its.map(i => i.x))
      const x1 = Math.max(...its.map(i => i.x + i.w))
      const [gy0, gy1] = growToLines(Math.min(...its.map(i => i.y)), Math.max(...its.map(i => i.y + i.h)), (linesByPage[page] ?? []).map(l => l.pct), opts.lineTol)
      locs.push({ page, box: padBox(opts.fullWidth ? 2 : x0, gy0, opts.fullWidth ? 98 : x1, gy1) })
    }
    if (locs.length) return locs
  }
  return []
}

// Words too generic to locate a check by on an insurance form.
const STOPWORDS = new Set(['vehicle', 'vehicles', 'listed', 'certificate', 'policy', 'policies', 'insurance', 'insured', 'liability', 'coverage', 'holder', 'active', 'currently', 'must', 'match', 'matches', 'minimum', 'amount', 'with', 'that', 'this', 'every', 'each', 'deal'])

/**
 * Last-chance anchor for the insured region. Whole-needle matching fails when
 * the name is split across text runs ("ABC TRUCKING" + "LLC"), and the raw
 * model box it falls back to is the one that drifts down the page. Cluster
 * individual words of the name on the model's page instead: two distinct
 * words on the same printed line, or one long distinctive word, locate the
 * INSURED box.
 */
function anchorInsuredByWords(
  name: string | undefined,
  textByPage: TextByPage,
  linesByPage: Record<number, RuleLine[]>,
  prior: FieldLocation | null | undefined,
): FieldLocation[] {
  if (!name || !prior) return []
  const words = [...new Set(
    name.split(/[^A-Za-z0-9]+/)
      .filter(w => !STOPWORDS.has(w.toLowerCase()))
      .map(normText)
      .filter(w => w.length >= 4),
  )]
  if (!words.length) return []
  const hits: { it: TextItem; word: string }[] = []
  for (const it of textByPage[prior.page] ?? []) {
    const s = normText(it.str)
    if (s.length < 4) continue
    const word = words.find(w => s.includes(w))
    if (word) hits.push({ it, word })
  }
  let best: TextItem[] | null = null
  for (const h of hits) {
    const cy = h.it.y + h.it.h / 2
    const near = hits.filter(o => Math.abs((o.it.y + o.it.h / 2) - cy) <= 2.5)
    if (new Set(near.map(o => o.word)).size >= 2 && (!best || near.length > best.length)) best = near.map(o => o.it)
  }
  if (!best) {
    // One long word (TRUCKING, WERNER…) is distinctive enough alone; if it
    // appears in several places, the model's approximate y disambiguates.
    const strong = hits.filter(h => h.word.length >= 7)
    if (!strong.length) return []
    const cy = (prior.box[1] + prior.box[3]) / 2
    best = [strong.reduce((a, b) =>
      Math.abs((b.it.y + b.it.h / 2) - cy) < Math.abs((a.it.y + a.it.h / 2) - cy) ? b : a).it]
  }
  const x0 = Math.min(...best.map(i => i.x))
  const x1 = Math.max(...best.map(i => i.x + i.w))
  const [gy0, gy1] = growToLines(
    Math.min(...best.map(i => i.y)), Math.max(...best.map(i => i.y + i.h)),
    (linesByPage[prior.page] ?? []).map(l => l.pct),
  )
  return [{ page: prior.page, box: padBox(x0, gy0, x1, gy1) }]
}

/**
 * Locate a check by its own distinctive values (a VIN, a make/model, a
 * limit) anywhere in the document — how vehicle-schedule requirements find
 * the ACORD 101 page. Every line containing enough of the tokens lights up.
 */
/** The check's searchable words: coverage type, limit, AND notes — condition
 *  rows carry their whole substance (a VIN, a make/model, a value) in notes. */
function checkTokens(item: CheckItem): string[] {
  const source = `${item.requirement?.minimum_limit ?? ''} ${item.requirement?.coverage_type ?? ''} ${item.requirement?.notes ?? ''}`
  return [...new Set(
    source.split(/[^A-Za-z0-9$,.]+/)
      .map(t => t.replace(/[$,.]/g, ''))
      .filter(t => t.length >= 4 && !STOPWORDS.has(t.toLowerCase())),
  )]
}

function tokenSearch(item: CheckItem, textByPage: TextByPage, linesByPage: Record<number, RuleLine[]>, additionalTerms?: string): FieldLocation[] {
  const tokens = checkTokens(item)
  if (!tokens.length) return []
  // A number the extraction also read in the remarks text (an insured value,
  // a model year) is distinctive on its own even under 7 characters.
  const terms = normText(additionalTerms ?? '')
  const isStrong = (t: string) => t.length >= 7 || (/^\d{4,}$/.test(t) && !!terms && terms.includes(normText(t)))
  const locs: FieldLocation[] = []
  for (const [pageStr, items] of Object.entries(textByPage)) {
    const page = Number(pageStr)
    const lines = (linesByPage[page] ?? []).map(l => l.pct)
    // Group runs into printed lines first: ACORD remarks boxes emit many short
    // runs per line, so per-run matching missed values split across runs
    // ("2022" + "INTERNATIONAL LT625", or a VIN broken in half — VRF-1095).
    const rows: TextItem[][] = []
    for (const it of [...items].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))) {
      const last = rows[rows.length - 1]
      if (last && Math.abs((it.y + it.h / 2) - (last[0].y + last[0].h / 2)) <= 1) last.push(it)
      else rows.push([it])
    }
    for (const row of rows) {
      const rowText = normText(row.slice().sort((a, b) => a.x - b.x).map(i => i.str).join(''))
      if (rowText.length < 4) continue
      const hits = tokens.filter(t => rowText.includes(normText(t)))
      // Two corroborating tokens, or one distinctive one, on the same line.
      if (!(hits.length >= 2 || (hits.length === 1 && isStrong(hits[0])))) continue
      // Box only the runs carrying a token (or a fragment of one), so the
      // highlight hugs the value instead of the whole line.
      const carrying = row.filter(it => {
        const s = normText(it.str)
        return s.length >= 2 && hits.some(t => { const n = normText(t); return s.includes(n) || n.includes(s) })
      })
      const boxItems = carrying.length ? carrying : row
      const [gy0, gy1] = growToLines(
        Math.min(...boxItems.map(i => i.y)), Math.max(...boxItems.map(i => i.y + i.h)), lines)
      locs.push({ page, box: padBox(Math.min(...boxItems.map(i => i.x)), gy0, Math.max(...boxItems.map(i => i.x + i.w)), gy1) })
    }
  }
  return locs.length <= 12 ? locs : [] // a token that lights half the page located nothing
}

/** Resolve every check to its document locations. */
function resolveChecks(
  items: CheckItem[],
  coi: COIExtracted | null,
  textByPage: TextByPage,
  linesByPage: Record<number, RuleLine[]>,
): FieldLocation[][] {
  if (!coi) return items.map(() => [])
  const coverages = (coi.coverages ?? []).filter(c => c?.type)
  const hasText = Object.values(textByPage).some(a => a.length > 0)
  const snapped = Object.keys(linesByPage).length ? snapLocations(coi, linesByPage) : coi
  const snappedCovs = (snapped.coverages ?? []).filter(c => c?.type)
  const fl = snapped.field_locations ?? {}

  const regionNeedles: Record<RegionKey, (string | undefined)[]> = {
    insured: [coi.named_insured, coi.named_insured_address?.split(/[\n,]/)[0], coi.usdot_number && `USDOT ${coi.usdot_number}`],
    producer: [coi.producer],
    insurers: [coi.insurance_company, coi.insurance_company?.split(',')[0]],
    certificate_holder: [coi.certificate_holder],
    additional_insured: [coi.additional_insured, coi.certificate_holder],
    description_of_operations: ['DESCRIPTION OF OPERATIONS', coi.additional_terms?.slice(0, 40)],
  }

  const coverageLocs = (i: number): FieldLocation[] => {
    const cov = coverages[i]
    if (hasText) {
      // The row LABEL comes first: policy numbers are often shared across
      // rows on real certificates (one policy, several coverages).
      const anchored = anchorByNeedles(
        [cov.type, cov.policy_number, cov.each_occurrence_limit],
        textByPage, linesByPage, cov.location, { fullWidth: true, lineTol: 9.5 },
      )
      if (anchored.length) return anchored
    }
    return snappedCovs[i]?.location ? [snappedCovs[i].location!] : []
  }

  // A check whose value the extraction read in the remarks text (VINs,
  // vehicle descriptions, insured-at-purchase amounts routinely live there —
  // VRF-1095) can always fall back to lighting the Description of Operations
  // box, even on scans with no text layer.
  const remarksNorm = normText(coi.additional_terms ?? '')
  const valueInRemarks = (item: CheckItem) =>
    !!remarksNorm && checkTokens(item).some(t => remarksNorm.includes(normText(t)))
  const remarksRegion = (): FieldLocation[] => {
    if (hasText) {
      const anchored = anchorByNeedles(
        regionNeedles.description_of_operations, textByPage, linesByPage,
        fl.description_of_operations, { fullWidth: true },
      )
      if (anchored.length) return anchored
    }
    return fl.description_of_operations ? [fl.description_of_operations] : []
  }

  return items.map(item => {
    const rule = ruleFor(item, coverages)
    switch (rule.type) {
      case 'region': {
        const prior = fl[rule.key]
        if (hasText) {
          const anchored = anchorByNeedles(
            regionNeedles[rule.key], textByPage, linesByPage, prior,
            { fullWidth: rule.key === 'description_of_operations' },
          )
          if (anchored.length) return anchored
          if (rule.key === 'insured') {
            const clustered = anchorInsuredByWords(coi.named_insured, textByPage, linesByPage, prior)
            if (clustered.length) return clustered
          }
        }
        // The model's (snapped) box outranks token search here: a region the
        // anchor couldn't confirm on its own page shouldn't jump to a stray
        // mention elsewhere in the document.
        if (prior) return [prior]
        return hasText ? tokenSearch(item, textByPage, linesByPage, coi.additional_terms) : []
      }
      case 'coverage': {
        const locs = coverageLocs(rule.index)
        // e.g. a physical-damage insured amount graded against the vehicle
        // value in the remarks: light the remarks box alongside the row.
        return valueInRemarks(item) ? [...locs, ...remarksRegion()] : locs
      }
      case 'dates': {
        if (hasText) {
          // Light the policy-period cells themselves: exact date strings.
          const dates = [...new Set(coverages.flatMap(c => [c.effective_date, c.expiration_date]).filter(Boolean))] as string[]
          const locs: FieldLocation[] = []
          for (const [pageStr, pageItems] of Object.entries(textByPage)) {
            const page = Number(pageStr)
            for (const it of pageItems) {
              const s = it.str.trim()
              if (dates.some(d => s === d || s.startsWith(`${d} `) || s.endsWith(` ${d}`))) {
                locs.push({ page, box: padBox(it.x, it.y - 0.3, it.x + it.w, it.y + it.h + 0.3) })
              }
            }
          }
          if (locs.length && locs.length <= 12) return locs
        }
        return coverages.map((_, i) => coverageLocs(i)).flat()
      }
      case 'search': {
        const found = hasText ? tokenSearch(item, textByPage, linesByPage, coi.additional_terms) : []
        if (found.length) return found
        // The value lives in the remarks text but the text layer could not
        // pin it (scan, odd run splitting): light the whole remarks box so
        // the card is still interactive and points at the right place.
        return valueInRemarks(item) ? remarksRegion() : []
      }
    }
  })
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CoiSplitReview({
  coi,
  items,
  doc,
}: {
  coi: COIExtracted | null
  items: CheckItem[]
  doc: CoiDocFile | null
}) {
  const [active, setActive] = useState<{ locs: FieldLocation[]; color: string } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [linesByPage, setLinesByPage] = useState<Record<number, RuleLine[]>>({})
  const [textByPage, setTextByPage] = useState<TextByPage>({})
  const scrollBoxRef = useRef<HTMLDivElement>(null)
  const resolved = useMemo(
    () => resolveChecks(items, coi, textByPage, linesByPage),
    [items, coi, textByPage, linesByPage],
  )

  if (!doc && items.length === 0) return null

  /** Bring the first highlight into view inside the document's scroll frame. */
  const revealLoc = (loc: FieldLocation | undefined) => {
    const box = scrollBoxRef.current
    if (!box || !loc) return
    const pageEl = box.querySelector<HTMLElement>(`[data-doc-page="${loc.page}"]`)
    if (!pageEl) return
    // Rect math, not offsetTop: the page wrappers' offsetParent is unrelated
    // to the scroll frame.
    const pageRect = pageEl.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    const target = pageRect.top - boxRect.top + box.scrollTop + (loc.box[1] / 100) * pageRect.height
    const viewTop = box.scrollTop
    const viewBottom = viewTop + box.clientHeight
    if (target < viewTop + 30 || target > viewBottom - 80) {
      box.scrollTo({ top: Math.max(0, target - box.clientHeight * 0.3), behavior: 'smooth' })
    }
  }

  const checkCards = (
    <div style={{ flex: 1, minWidth: 300 }}>
      <h2 style={h2()}>Requirement check</h2>
      {items.map((item, i) => {
        const locs = resolved[i] ?? []
        const tag = TAG[item.status] ?? TAG.uncertain
        const interactive = !!doc && locs.length > 0
        const activate = () => { setActive({ locs, color: tag.color }); revealLoc(locs[0]) }
        return (
          <div
            key={i}
            onMouseEnter={interactive ? activate : undefined}
            onMouseLeave={interactive ? () => setActive(null) : undefined}
            onClick={interactive ? activate : undefined}
            style={{
              background: C.surface, border: `1px solid ${C.border}`, borderLeft: `4px solid ${tag.color}`,
              borderRadius: 12, padding: '13px 16px', marginBottom: 10,
              cursor: interactive ? 'pointer' : 'default',
              transition: 'box-shadow .15s',
              boxShadow: active?.locs === locs && interactive ? '0 3px 14px rgba(20,20,19,0.10)' : 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: C.txt, margin: 0 }}>
                {item.requirement?.coverage_type || 'Requirement'}
                {item.requirement?.minimum_limit && (
                  <span style={{ fontWeight: 400, color: C.txt3 }}> · {item.requirement.minimum_limit}</span>
                )}
              </p>
              <span style={{
                fontSize: 12, fontWeight: 600, color: tag.color, whiteSpace: 'nowrap',
                background: `color-mix(in oklch, ${tag.color} 12%, transparent)`,
                padding: '3px 10px', borderRadius: 20,
              }}>{tag.label}</span>
            </div>
            {item.evidence && (
              <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, margin: '6px 0 0' }}>{item.evidence}</p>
            )}
            {item.insurer_confirmation ? (
              <p style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"
                  stroke={C.ok} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.txt, whiteSpace: 'nowrap' }}>
                  Verified with insurer via {item.insurer_confirmation === 'call' ? 'call' : 'email'}
                </span>
              </p>
            ) : (
              /* Explicit negative state (owner call 2026-07-29): a small red
                 x, so "no insurer confirmation" never reads as an omission. */
              <p style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"
                  stroke={C.error} strokeWidth="3.5" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.txt3, whiteSpace: 'nowrap' }}>
                  Not confirmed with insurer
                </span>
              </p>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div>
      <style>{`
        .coi-split { display: flex; gap: 24px; align-items: flex-start; }
        .coi-split .coi-doc-col { position: sticky; top: 24px; width: 560px; max-width: 100%; flex-shrink: 0; }
        @media (max-width: 900px) {
          .coi-split { flex-direction: column; }
          .coi-split .coi-doc-col { position: static; width: 100%; }
        }
        @media print {
          .coi-split { display: block; }
          .coi-split .coi-doc-col { position: static; width: 100%; margin-bottom: 16px; }
        }
      `}</style>
      <div className="coi-split">
        {doc && (
          <div className="coi-doc-col">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 10px' }}>
              <h2 style={{ ...h2(), margin: 0 }}>Uploaded COI</h2>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ZoomButton label="−" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, +(z - 0.25).toFixed(2)))} />
                <span style={{ fontSize: 12, color: C.txt3, minWidth: 38, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{Math.round(zoom * 100)}%</span>
                <ZoomButton label="+" disabled={zoom >= 2.5} onClick={() => setZoom(z => Math.min(2.5, +(z + 0.25).toFixed(2)))} />
              </div>
            </div>
            <div ref={scrollBoxRef} style={{
              overflow: 'auto', maxHeight: 'calc(100vh - 120px)',
              border: `1px solid ${C.border}`, borderRadius: 8, background: C.cream, padding: 10,
            }}>
              <div style={{ width: `${zoom * 100}%` }}>
                <DocumentView
                  doc={doc}
                  active={active}
                  onLines={(page, lines) => setLinesByPage(prev => ({ ...prev, [page]: lines }))}
                  onText={(page, text) => setTextByPage(prev => ({ ...prev, [page]: text }))}
                />
              </div>
            </div>
          </div>
        )}
        {items.length > 0 && checkCards}
      </div>
    </div>
  )
}

function ZoomButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label === '+' ? 'Zoom in' : 'Zoom out'}
      style={{
        width: 26, height: 26, borderRadius: '50%', border: `1px solid ${C.border}`,
        background: C.surface, color: disabled ? C.txtMuted : C.txt, fontSize: 15, lineHeight: 1,
        cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, fontFamily: C.sans,
      }}
    >{label}</button>
  )
}

// ─── The submitted document, with highlight overlays ────────────────────────

function Highlights({ page, active }: { page: number; active: { locs: FieldLocation[]; color: string } | null }) {
  if (!active) return null
  return (
    <>
      {active.locs.filter(l => l.page === page && Array.isArray(l.box) && l.box.length === 4).map((l, i) => {
        const [x0, y0, x1, y1] = l.box
        return (
          <div key={i} style={{
            position: 'absolute', pointerEvents: 'none', borderRadius: 3,
            left: `${x0}%`, top: `${y0}%`, width: `${x1 - x0}%`, height: `${y1 - y0}%`,
            background: `color-mix(in oklch, ${active.color} 15%, transparent)`,
            boxShadow: `inset 0 0 0 2px ${active.color}`,
          }} />
        )
      })}
    </>
  )
}

const pageFrame = (): React.CSSProperties => ({
  position: 'relative', background: '#fff',
  border: `1px solid ${C.borderStrong}`, boxShadow: '0 2px 14px rgba(20,20,19,0.09)',
})

interface DocViewProps {
  doc: CoiDocFile
  active: { locs: FieldLocation[]; color: string } | null
  onLines: (page: number, lines: RuleLine[]) => void
  onText: (page: number, text: TextItem[]) => void
}

function DocumentView({ doc, active, onLines, onText }: DocViewProps) {
  if (doc.mime === 'application/pdf') return <PdfView url={doc.url} active={active} onLines={onLines} onText={onText} />
  return <ImageView doc={doc} active={active} onLines={onLines} onText={onText} />
}

function ImageView({ doc, active, onLines }: DocViewProps) {
  // Rule detection uses a SEPARATE crossOrigin fetch of the image so a CORS
  // hiccup can never break the visible <img>; it only skips the snapping.
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const w = Math.min(img.naturalWidth, 2000)
      const h = Math.round(img.naturalHeight * (w / img.naturalWidth))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, w, h)
      onLines(1, detectLines(canvas))
    }
    img.src = doc.url
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.url])
  return (
    <div style={pageFrame()} data-doc-page={1}>
      <img src={doc.url} alt={doc.fileName} style={{ display: 'block', width: '100%', height: 'auto' }} />
      <Highlights page={1} active={active} />
    </div>
  )
}

/**
 * Renders each PDF page to a canvas via pdf.js (client-only dynamic import so
 * the worker and DOM APIs never run on the server), reporting each page's
 * detected rules and positioned text runs (both in percent-of-page units) for
 * highlight anchoring. Canvases render at 2.5x the column width for sharp
 * text at max zoom; highlight overlays use percent coordinates so no pixel
 * math is needed.
 */
function PdfView({ url, active, onLines, onText }: { url: string } & Omit<DocViewProps, 'doc'>) {
  const holder = useRef<HTMLDivElement>(null)
  const [pageCount, setPageCount] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const pdf = await pdfjs.getDocument({ url }).promise
        if (cancelled) return
        setPageCount(pdf.numPages)
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p)
          if (cancelled) return
          const canvas = holder.current?.querySelector<HTMLCanvasElement>(`canvas[data-page="${p}"]`)
          if (!canvas) continue
          const base = page.getViewport({ scale: 1 })
          const scale = 1600 / base.width // sharp at max zoom (2.5x the 560px column)
          const viewport = page.getViewport({ scale })
          canvas.width = viewport.width
          canvas.height = viewport.height
          await page.render({ canvas, viewport }).promise
          if (cancelled) return
          onLines(p, detectLines(canvas))
          // Positioned text runs for anchor-by-value highlighting.
          try {
            const content = await page.getTextContent()
            const items: TextItem[] = []
            for (const raw of content.items as { str?: string; transform?: number[]; width?: number }[]) {
              if (!raw.str?.trim() || !raw.transform) continue
              const m = pdfjs.Util.transform(viewport.transform, raw.transform)
              const fh = Math.hypot(m[2], m[3])
              items.push({
                str: raw.str,
                x: (m[4] / viewport.width) * 100,
                y: ((m[5] - fh) / viewport.height) * 100,
                w: (((raw.width ?? 0) * scale) / viewport.width) * 100,
                h: (fh / viewport.height) * 100,
              })
            }
            if (!cancelled) onText(p, items)
          } catch (e) {
            console.error('PDF text layer read failed', e)
          }
        }
      } catch (e) {
        console.error('PDF render failed', e)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  if (failed) {
    return (
      <p style={{ fontSize: 13, color: C.txt2, margin: 0 }}>
        The certificate preview could not be rendered.{' '}
        <a href={url} target="_blank" rel="noreferrer" style={{ color: C.txt, textDecorationColor: C.limeDeep, textUnderlineOffset: 3 }}>Open the document ↗</a>
      </p>
    )
  }

  return (
    <div ref={holder} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: Math.max(pageCount, 1) }, (_, i) => (
        <div key={i} style={pageFrame()} data-doc-page={i + 1}>
          <canvas data-page={i + 1} style={{ display: 'block', width: '100%', height: 'auto' }} />
          <Highlights page={i + 1} active={active} />
        </div>
      ))}
    </div>
  )
}

const h2 = () => ({ fontSize: 13, fontWeight: 600 as const, color: C.txt3, textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '0 0 10px' })
