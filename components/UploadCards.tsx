'use client'

import { useRef, useState } from 'react'
import type { Requirement } from '@/lib/types'
import { C } from '@/lib/theme'
import RequirementsEditor from '@/components/RequirementsEditor'

/**
 * Shared upload UI used by the demo pipeline and the customer portal's
 * "New verification" form so the two stay visually identical.
 */
export function DropZone({ boxTitle, hint, file, accept, onChange }: {
  boxTitle: string; hint: string; file: File | null; accept: string; onChange: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  return (
    <div>
      {boxTitle && (
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase' as const, color: C.txt3,
          marginBottom: 8, display: 'block', fontFamily: C.sans,
        }}>
          {boxTitle}
        </span>
      )}

      {file ? (
        <div style={{
          border: `1.5px solid ${C.success}`, borderRadius: 12,
          padding: '20px 24px',
          background: C.surfaceHover,
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <span style={{ fontSize: 22, color: C.success, lineHeight: 1, fontWeight: 700 }}>✓</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: 14, fontWeight: 600, color: C.txt, fontFamily: C.sans,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, marginBottom: 2,
            }}>
              {file.name}
            </p>
            <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans }}>{(file.size / 1024).toFixed(0)} KB</p>
          </div>
          <button
            onClick={() => ref.current?.click()}
            style={{
              fontSize: 11, fontWeight: 600, fontFamily: C.sans, letterSpacing: '0.01em',
              color: C.txt3, background: 'transparent',
              border: `1px solid ${C.border}`, borderRadius: 4,
              padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' as const,
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <div
          onClick={() => ref.current?.click()}
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onChange(f) }}
          style={{
            border: `1.5px dashed ${over ? C.txt : C.border}`,
            borderRadius: 12, padding: '28px 20px',
            textAlign: 'center' as const, cursor: 'pointer',
            background: over ? 'rgba(212, 253, 142, 0.35)' : C.paper,
            transition: 'all 150ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <p style={{ fontSize: 22, marginBottom: 8 }}>↑</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.txt, marginBottom: 4, fontFamily: C.sans }}>
            Drop file or click to browse
          </p>
          <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans }}>{hint}</p>
        </div>
      )}

      <input
        ref={ref} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f); e.target.value = '' }}
      />
    </div>
  )
}

// ─── Currency helpers (manual requirements) ──────────────────────────────────
// Canonical implementations live in RequirementsEditor; re-exported here so
// existing imports keep working.
export { formatCurrencyInput, parseCurrencyAmount } from '@/components/RequirementsEditor'

// ─── ManualRequirementsForm ───────────────────────────────────────────────────
export function ManualRequirementsForm({ rows, onChange, notes, onNotesChange }: {
  rows: Requirement[]
  onChange: (next: Requirement[]) => void
  notes: string
  onNotesChange: (next: string) => void
}) {
  return (
    <div style={{
      border: `1.5px solid ${C.border}`, borderRadius: 12,
      padding: 16, background: C.surface,
      display: 'flex', flexDirection: 'column' as const, gap: 12,
    }}>
      <RequirementsEditor rows={rows} onChange={onChange} minRows={1} reorderable={false} titlePlaceholder="e.g. Cargo" />

      <div style={{ marginTop: 4 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase' as const, color: C.txt3,
          fontFamily: C.sans, display: 'block', marginBottom: 6,
        }}>
          Other Required Coverage Details <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
        </span>
        <textarea
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          placeholder="Anything the fields above didn't capture: extra coverages, conditions, endorsements, etc."
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box' as const,
            padding: '10px 12px', fontSize: 13, fontFamily: C.sans,
            borderRadius: 6, border: `1.5px solid ${C.border}`,
            background: C.surface, color: C.txt, outline: 'none',
            resize: 'vertical' as const, minHeight: 64,
          }}
        />
      </div>
    </div>
  )
}
