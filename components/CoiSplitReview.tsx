'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '@/lib/theme'
import type { COIExtracted, FieldLocation } from '@/lib/types'

/**
 * Split review: the customer's ACTUAL submitted certificate beside the
 * requirement-check cards. Hovering (or tapping) a check highlights the
 * region of the document it was verified against, using the percent-of-page
 * bounding boxes the extraction step records (`location` per coverage,
 * `field_locations` for the fixed boxes). Verifications extracted before
 * locations existed still render the document; their cards just don't
 * highlight. Images render directly; PDFs render page-by-page via pdf.js
 * (worker served from /pdf.worker.min.mjs).
 *
 * SNAP-TO-LINES: the model's boxes are treated as approximate anchors, not
 * gospel — vision coordinates drift several % down the page. Once a page is
 * rendered we detect the certificate's printed horizontal rules from its
 * pixels and snap the boxes onto them (see snapLocations below). Detection
 * failing (tainted canvas, photo with no clean rules) just leaves the raw
 * boxes in place.
 */

export interface CheckItem {
  requirement: { coverage_type?: string; minimum_limit?: string; notes?: string | null }
  status: 'met' | 'not_met' | 'uncertain'
  evidence?: string
}
export interface CoiDocFile {
  url: string
  mime: string
  fileName: string
}

const TAG = {
  met:       { label: 'Satisfied',   color: C.ok },
  not_met:   { label: 'Discrepancy', color: C.error },
  uncertain: { label: 'Unconfirmed', color: C.warn },
} as const

// ─── Check → document-region matching ───────────────────────────────────────
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

/** Document locations a requirement check anchors to (empty = no highlight). */
function locationsFor(item: CheckItem, coi: COIExtracted | null): FieldLocation[] {
  if (!coi) return []
  const fl = coi.field_locations ?? {}
  const coverages = (coi.coverages ?? []).filter(c => c?.type)
  const covLocs = coverages.map(c => c.location).filter(Boolean) as FieldLocation[]
  const r = norm(item.requirement?.coverage_type)
  if (!r) return []
  const one = (l?: FieldLocation | null) => (l ? [l] : [])
  // Identity / party checks first: their wording often also mentions a coverage.
  if (r.includes('certificate holder')) return one(fl.certificate_holder)
  if (r.includes('additional insured')) return one(fl.additional_insured ?? fl.description_of_operations)
  if (r.includes('loss payee')) return one(fl.description_of_operations)
  if (r.includes('policyholder') || r.includes('named insured') || r.includes('carrier name')) return one(fl.insured)
  if (r.includes('usdot') || r.includes('mc number')) return one(fl.insured)
  if (r.includes('producer') || r.includes('agency')) return one(fl.producer)
  if (r.includes('insurance company') || r.includes('insurer name') || r.includes('am best') || r.includes('rating')) return one(fl.insurers)
  const rKey = coverageKey(r)
  const cov = coverages.find(c => {
    const cn = norm(c.type)
    if (!cn) return false
    if (rKey && coverageKey(cn) === rKey) return true
    return cn.includes(r) || r.includes(cn)
  })
  if (cov) return one(cov.location)
  // Date/active checks light the whole coverage table when no single coverage
  // claimed them above.
  if (r.includes('active') || r.includes('in force') || r.includes('expir') || r.includes('effective') || r.includes('date')) return covLocs
  // Restrictions/endorsements without a coverage row live in the remarks box.
  if (r.includes('restriction') || r.includes('endorsement') || r.includes('radius') || r.includes('deductible')) return one(fl.description_of_operations)
  return []
}

// ─── Snap model boxes to the document's printed rules ───────────────────────

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
 * the lowest residual wins. Null when nothing fits sanely.
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
      const y0 = nearestLine(c0, L, 4.5) ?? c0
      const y1 = nearestLine(c1, L, 4.5) ?? c1
      if (y1 > y0 + 1) fl[key] = snapBox(loc, y0, y1)
    }
  }
  return out
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
  const snapped = useMemo(
    () => (coi && Object.keys(linesByPage).length ? snapLocations(coi, linesByPage) : coi),
    [coi, linesByPage],
  )
  const matched = items.map(item => ({ item, locs: locationsFor(item, snapped) }))

  if (!doc && items.length === 0) return null

  const checkCards = (
    <div style={{ flex: 1, minWidth: 300 }}>
      <h2 style={h2()}>Requirement check</h2>
      {matched.map(({ item, locs }, i) => {
        const tag = TAG[item.status] ?? TAG.uncertain
        const interactive = !!doc && locs.length > 0
        return (
          <div
            key={i}
            onMouseEnter={interactive ? () => setActive({ locs, color: tag.color }) : undefined}
            onMouseLeave={interactive ? () => setActive(null) : undefined}
            onClick={interactive ? () => setActive(a => (a?.locs === locs ? null : { locs, color: tag.color })) : undefined}
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
            <div style={{
              overflow: 'auto', maxHeight: 'calc(100vh - 120px)',
              border: `1px solid ${C.border}`, borderRadius: 8, background: C.cream, padding: 10,
            }}>
              <div style={{ width: `${zoom * 100}%` }}>
                <DocumentView
                  doc={doc}
                  active={active}
                  onLines={(page, lines) => setLinesByPage(prev => ({ ...prev, [page]: lines }))}
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
}

function DocumentView({ doc, active, onLines }: DocViewProps) {
  if (doc.mime === 'application/pdf') return <PdfView url={doc.url} active={active} onLines={onLines} />
  return <ImageView doc={doc} active={active} onLines={onLines} />
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
    <div style={pageFrame()}>
      <img src={doc.url} alt={doc.fileName} style={{ display: 'block', width: '100%', height: 'auto' }} />
      <Highlights page={1} active={active} />
    </div>
  )
}

/**
 * Renders each PDF page to a canvas via pdf.js (client-only dynamic import so
 * the worker and DOM APIs never run on the server). Canvases render at 2x the
 * column width for sharp text, displayed at 100% width; highlight overlays
 * use percent coordinates so no pixel math is needed.
 */
function PdfView({ url, active, onLines }: { url: string } & Omit<DocViewProps, 'doc'>) {
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
          if (!cancelled) onLines(p, detectLines(canvas))
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
        <div key={i} style={pageFrame()}>
          <canvas data-page={i + 1} style={{ display: 'block', width: '100%', height: 'auto' }} />
          <Highlights page={i + 1} active={active} />
        </div>
      ))}
    </div>
  )
}

const h2 = () => ({ fontSize: 13, fontWeight: 600 as const, color: C.txt3, textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '0 0 10px' })
