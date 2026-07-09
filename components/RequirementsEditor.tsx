'use client'

import type { Requirement } from '@/lib/types'
import { requirementKind } from '@/lib/types'
import { C } from '@/lib/theme'

/**
 * Shared requirements grid used by /app/settings templates, the admin
 * org-standard editor, and the new-verification form. Each row is either a
 * coverage minimum (numeric limit) or a qualitative condition (no dollar
 * amount, judged by its notes: loss payee, name match, endorsements).
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

const GRID = '1.3fr 108px 1.1fr 1.5fr 28px'

export default function RequirementsEditor({ rows, onChange, currencyLimits = false, minRows = 0 }: {
  rows: Requirement[]
  onChange: (next: Requirement[]) => void
  /**
   * true: limit inputs auto-format as dollars (manual per-deal entry).
   * false: plain text, so {placeholder} tokens pass through (templates).
   */
  currencyLimits?: boolean
  /** Rows cannot be removed below this count. */
  minRows?: number
}) {
  const inputS = {
    width: '100%', boxSizing: 'border-box' as const, padding: '10px 12px', fontSize: 13,
    fontFamily: C.sans, borderRadius: 6, border: `1.5px solid ${C.border}`,
    background: C.surface, color: C.txt, outline: 'none',
  }

  function updateRow(i: number, patch: Partial<Requirement>) {
    onChange(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }
  function setKind(i: number, kind: 'limit' | 'condition') {
    updateRow(i, kind === 'condition' ? { kind, minimum_limit: '' } : { kind })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: GRID, gap: 8,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
        color: C.txt3, fontFamily: C.sans,
      }}>
        <span>Required coverage</span><span>Type</span><span>Minimum limit</span><span>Notes</span><span />
      </div>

      {rows.map((row, i) => {
        const kind = requirementKind(row)
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, alignItems: 'center' }}>
            <input value={row.coverage_type} onChange={e => updateRow(i, { coverage_type: e.target.value })}
              placeholder={kind === 'condition' ? 'e.g. Loss Payee' : 'e.g. General Liability'} style={inputS} />
            <select value={kind} onChange={e => setKind(i, e.target.value as 'limit' | 'condition')}
              title="Limit rows carry a dollar minimum; condition rows are judged by their notes"
              style={{ ...inputS, padding: '10px 8px', color: C.txt2 }}>
              <option value="limit">Limit</option>
              <option value="condition">Condition</option>
            </select>
            {kind === 'condition' ? (
              <input value="" disabled placeholder="No dollar minimum"
                style={{ ...inputS, background: C.paper, color: C.txt3, cursor: 'not-allowed' }} />
            ) : (
              <input value={row.minimum_limit}
                inputMode={currencyLimits ? 'numeric' : undefined}
                onChange={e => updateRow(i, {
                  minimum_limit: currencyLimits ? formatCurrencyInput(e.target.value) : e.target.value,
                })}
                placeholder={currencyLimits ? 'e.g. $1,000,000' : '$1,000,000 or {asset_sale_price}'}
                style={inputS} />
            )}
            <input value={row.notes ?? ''} onChange={e => updateRow(i, { notes: e.target.value })}
              placeholder={kind === 'condition' ? 'Describe the condition and when it passes' : 'Optional'}
              style={inputS} />
            {rows.length > minRows ? (
              <button type="button" title="Remove row"
                onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                style={{
                  width: 28, height: 28, padding: 0, borderRadius: 6, border: `1px solid ${C.border}`,
                  background: 'transparent', color: C.txt3, cursor: 'pointer', fontSize: 14, lineHeight: 1,
                }}>
                ×
              </button>
            ) : <span />}
          </div>
        )
      })}

      <button type="button" onClick={() => onChange([...rows, { ...BLANK_REQUIREMENT }])}
        style={{
          alignSelf: 'flex-start', marginTop: 2, fontSize: 12, fontWeight: 600, fontFamily: C.sans,
          padding: '6px 12px', borderRadius: 6, border: `1px dashed ${C.border}`,
          background: 'transparent', color: C.txt2, cursor: 'pointer',
        }}>
        + Add requirement
      </button>
    </div>
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
