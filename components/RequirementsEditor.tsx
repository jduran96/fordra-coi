'use client'

import { useLayoutEffect, useRef } from 'react'
import type { Requirement } from '@/lib/types'
import { requirementKind } from '@/lib/types'
import { C } from '@/lib/theme'

/**
 * Shared requirements grid used by /app/settings templates, the admin
 * org-standard editor, and the new-verification form. Each row is one of:
 * - limit: a coverage with a fixed dollar minimum
 * - variable: a coverage whose dollar amount changes per deal — the Amount cell
 *   holds the human title ("Asset Sale Price"); normalizeRequirementRows turns
 *   it into an {asset_sale_price} token at save time
 * - condition: a qualitative check with no dollar amount, judged by its notes
 */

export const BLANK_REQUIREMENT: Requirement = { coverage_type: '', minimum_limit: '', notes: '', kind: 'limit' }

// ─── Currency helpers ────────────────────────────────────────────────────────
export function formatCurrencyInput(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  const trimmed = digits.replace(/^0+(?=\d)/, '')
  return `$${Number(trimmed).toLocaleString('en-US')}`
}
export function parseCurrencyAmount(formatted: string): number | null {
  const digits = formatted.replace(/\D/g, '')
  if (!digits) return null
  return Number(digits)
}

/**
 * Dollar-format limit values as they are typed, but only when the value is
 * purely numeric: a hand-typed {token} or any text passes through untouched
 * (formatCurrencyInput strips non-digits, which would eat placeholders).
 */
function smartLimitInput(raw: string): string {
  return /^[\s$0-9,.]*$/.test(raw) && /\d/.test(raw) ? formatCurrencyInput(raw) : raw
}

/** Shared empty height for every grid field: 10px padding x2 + 19px line + 3px borders. */
const FIELD_H = 42

export default function RequirementsEditor({ rows, onChange, minRows = 0, reorderable = true, titlePlaceholder = 'e.g. General Liability' }: {
  rows: Requirement[]
  onChange: (next: Requirement[]) => void
  /** Rows cannot be removed below this count. */
  minRows?: number
  /** false: hide the move arrows (per-deal editing on /app/new), keep remove. */
  reorderable?: boolean
  /** Placeholder for the Title cell of limit/variable rows (conditions keep their own). */
  titlePlaceholder?: string
}) {
  // Coverage and notes wrap onto extra lines; Type is just wide enough for
  // "Condition"; the trailing column holds ↑ ↓ × (settings) or just × (per-deal).
  const GRID = `1.2fr 100px 1.25fr 1.35fr ${reorderable ? '84px' : '26px'}`
  // Every field pins to the same height when empty (browsers round textarea,
  // input, and select intrinsic heights differently); textareas grow past it.
  const inputS = {
    width: '100%', boxSizing: 'border-box' as const, height: FIELD_H, padding: '10px 12px', fontSize: 13,
    lineHeight: 1.45, fontFamily: C.sans, borderRadius: 6, border: `1.5px solid ${C.border}`,
    background: C.surface, color: C.txt, outline: 'none',
  }
  const miniBtn = {
    width: 24, height: 24, padding: 0, borderRadius: 6, border: `1px solid ${C.border}`,
    background: 'transparent', color: C.txt3, cursor: 'pointer', fontSize: 12, lineHeight: 1,
  }

  function updateRow(i: number, patch: Partial<Requirement>) {
    onChange(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }
  function setKind(i: number, kind: 'limit' | 'condition' | 'variable') {
    // The Amount cell means something different per kind: clear it on switch.
    updateRow(i, { kind, minimum_limit: '' })
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: GRID, gap: 8,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
        color: C.txt3, fontFamily: C.sans,
      }}>
        <span>Title</span><span>Type</span><span>Amount</span><span>Description</span><span />
      </div>

      {rows.map((row, i) => {
        const kind = requirementKind(row)
        return (
          <div key={i}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, alignItems: 'start' }}>
            <AutoGrowTextarea
              value={row.coverage_type}
              onChange={v => updateRow(i, { coverage_type: v })}
              placeholder={kind === 'condition' ? 'e.g. Loss Payee' : titlePlaceholder}
              style={inputS}
            />
            <select value={kind} onChange={e => setKind(i, e.target.value as 'limit' | 'condition' | 'variable')}
              title="Limit: fixed dollar minimum. Variable: dollar amount entered on each deal. Condition: no dollar amount, judged by its notes."
              style={{ ...inputS, padding: '10px 8px', color: C.txt2 }}>
              <option value="limit">Limit</option>
              <option value="variable">Variable</option>
              <option value="condition">Condition</option>
            </select>
            {kind === 'condition' ? (
              <input value="" disabled placeholder="No dollar amount"
                style={{ ...inputS, background: C.paper, color: C.txt3, cursor: 'not-allowed' }} />
            ) : kind === 'variable' ? (
              <input value={row.minimum_limit}
                onChange={e => updateRow(i, { minimum_limit: e.target.value })}
                placeholder="e.g. Asset Sale Price"
                title="Name what the amount depends on; the dollar value is entered on each new verification"
                style={inputS} />
            ) : (
              <input value={row.minimum_limit}
                onChange={e => updateRow(i, { minimum_limit: smartLimitInput(e.target.value) })}
                placeholder="e.g. $1,000,000"
                style={inputS} />
            )}
            <AutoGrowTextarea
              value={row.notes ?? ''}
              onChange={v => updateRow(i, { notes: v })}
              placeholder={kind === 'condition' ? 'Describe the condition and when it passes' : 'Optional'}
              style={inputS}
            />
            <div style={{ display: 'flex', gap: 4, paddingTop: 9 }}>
              {reorderable && (
                <>
                  <button type="button" title="Move up" disabled={i === 0}
                    onClick={() => move(i, -1)}
                    style={{ ...miniBtn, opacity: i === 0 ? 0.35 : 1, cursor: i === 0 ? 'default' : 'pointer' }}>
                    ↑
                  </button>
                  <button type="button" title="Move down" disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                    style={{ ...miniBtn, opacity: i === rows.length - 1 ? 0.35 : 1, cursor: i === rows.length - 1 ? 'default' : 'pointer' }}>
                    ↓
                  </button>
                </>
              )}
              {rows.length > minRows && (
                <button type="button" title="Remove row"
                  onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                  style={{ ...miniBtn, fontSize: 14 }}>
                  ×
                </button>
              )}
            </div>
          </div>
          </div>
        )
      })}

      <button type="button" onClick={() => onChange([...rows, { ...BLANK_REQUIREMENT }])}
        style={{
          alignSelf: 'center', marginTop: 2, fontSize: 12, fontWeight: 600, fontFamily: C.sans,
          padding: '6px 12px', borderRadius: 6, border: `1px dashed ${C.border}`,
          background: 'transparent', color: C.txt2, cursor: 'pointer',
        }}>
        + Add requirement
      </button>
    </div>
  )
}

/** One-line notes cell that grows with its content instead of scrolling sideways. */
function AutoGrowTextarea({ value, onChange, placeholder, style }: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  style: React.CSSProperties
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Pin to the shared field height first; only grow when the actual value
    // overflows it. Measuring from height:auto let a wrapping *placeholder*
    // (and sub-pixel rounding at some zoom levels) inflate scrollHeight, which
    // made empty cells render taller than their sibling input/select boxes.
    el.style.height = `${FIELD_H}px`
    if (!value) return
    // scrollHeight excludes borders; with box-sizing: border-box the height
    // must include them or the field renders shorter than sibling inputs.
    const borders = el.offsetHeight - el.clientHeight
    if (el.scrollHeight > el.clientHeight + 4) el.style.height = `${el.scrollHeight + borders}px`
  }, [value])
  return (
    <textarea
      ref={ref} rows={1} value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      style={{ ...style, resize: 'none', overflow: 'hidden', display: 'block' }}
    />
  )
}

/** Small tag shown wherever a condition row renders without a dollar limit. */
export function ConditionChip() {
  return (
    <span style={{
      marginLeft: 8, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase' as const, fontFamily: C.mono, color: C.txt2,
      background: C.paper, border: `1px solid ${C.border}`, borderRadius: 4,
      padding: '1.5px 6px', verticalAlign: 'middle',
    }}>
      Condition
    </span>
  )
}
