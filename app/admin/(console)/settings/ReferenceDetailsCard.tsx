'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import type { ReferenceDetail } from '@/lib/call-config'
import { saveReferenceDetails } from './actions'

/**
 * Org-level predefined reference details: label/value rows prepended to every
 * pre-dial prefill for that org's verifications, ahead of the per-deal rows
 * computed from the COI. The card also spells out that computed logic so the
 * admin can see exactly where prefilled rows come from. Renders only once an
 * org is picked.
 */

/** The per-deal rows draftFromVerification computes (lib/call-config.ts) —
 *  keep this list in sync with that function. */
const COMPUTED_ROWS: { label: string; source: string }[] = [
  { label: 'Policy number (one row per coverage)', source: 'each distinct policy number on the COI, labeled with its coverage type' },
  { label: 'Insured address', source: 'the named insured address on the COI' },
  { label: 'Certificate holder / holder address', source: 'the certificate holder box on the COI' },
  { label: 'VIN (one row each)', source: 'every 17-character VIN found on the COI or in the submitted standards' },
  { label: 'USDOT number / MC number', source: 'the COI when present' },
]

export default function ReferenceDetailsCard({ orgs, byOrg }: {
  orgs: { id: string; name: string }[]
  byOrg: Record<string, ReferenceDetail[]>
}) {
  const [orgId, setOrgId] = useState('')
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div>
        <label style={labelStyle}>Org</label>
        <select value={orgId} onChange={e => setOrgId(e.target.value)} style={inputStyle}>
          <option value="">Pick an org</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      {orgId && (
        /* Keyed by org + stored data so switching orgs remounts the editor
           with the right rows (React 19 stale-state rule). */
        <DetailsEditor key={`${orgId}:${JSON.stringify(byOrg[orgId] ?? [])}`} orgId={orgId} stored={byOrg[orgId] ?? []} />
      )}
    </div>
  )
}

function DetailsEditor({ orgId, stored }: { orgId: string; stored: ReferenceDetail[] }) {
  const [rows, setRows] = useState<ReferenceDetail[]>(stored.length ? stored : [{ label: '', value: '' }])
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const setRow = (i: number, patch: Partial<ReferenceDetail>) => {
    setMessage(null)
    setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  const move = (i: number, dir: -1 | 1) => {
    setMessage(null)
    setRows(prev => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const save = () => {
    setMessage(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('org_id', orgId)
      fd.set('details', JSON.stringify(rows))
      const res = await saveReferenceDetails(fd)
      if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
      else setMessage({ kind: 'ok', text: 'Saved.' })
    })
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: C.paper, border: `1px solid ${C.border}`, borderRadius: 9, padding: 12 }}>
        <p style={sectionTitleStyle}>How reference details prefill on each deal</p>
        <p style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6, margin: '0 0 8px' }}>
          The rows you save here come first on every pre-dial screen for this org. After them, these
          rows are added automatically from the deal itself (a row appears only when the value exists;
          everything stays editable per call):
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {COMPUTED_ROWS.map(r => (
            <li key={r.label} style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600, color: C.txt }}>{r.label}</span>: {r.source}
            </li>
          ))}
        </ul>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="fx-q-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input
            value={row.label}
            placeholder="Label (e.g. Loan number)"
            onChange={e => setRow(i, { label: e.target.value })}
            style={{ ...inputStyle, flex: 1 }}
          />
          <input
            value={row.value}
            placeholder="Value the agent can give the office"
            onChange={e => setRow(i, { value: e.target.value })}
            style={{ ...inputStyle, flex: 2 }}
          />
          <div className="fx-q-tools" style={{ display: 'flex', gap: 4 }}>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={tinyBtn(i === 0)} aria-label="Move up">↑</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} style={tinyBtn(i === rows.length - 1)} aria-label="Move down">↓</button>
            <button type="button" onClick={() => { setMessage(null); setRows(prev => prev.filter((_, j) => j !== i)) }}
              style={{ ...tinyBtn(false), color: C.error }} aria-label="Remove">✕</button>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" onClick={() => { setMessage(null); setRows(prev => [...prev, { label: '', value: '' }]) }} style={btnStyle(false)}>
          Add row
        </button>
        <button type="button" onClick={save} disabled={pending} style={btnStyle(pending)}>
          {pending ? 'Saving...' : 'Save reference details'}
        </button>
        {message && (
          <span style={{ fontSize: 13, fontWeight: 600, color: message.kind === 'error' ? C.error : C.ok }}>{message.text}</span>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.txt2, display: 'block', marginBottom: 4 }
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: C.sans, color: C.txt, background: C.surface, borderRadius: 7, border: `1px solid ${C.border}` }
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: C.txt3, margin: '0 0 8px',
}
const btnStyle = (pending: boolean): React.CSSProperties => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1 })
const tinyBtn = (disabled: boolean): React.CSSProperties => ({ padding: '2px 8px', background: C.surface, color: C.txt2, fontSize: 12, borderRadius: 6, border: `1px solid ${C.border}`, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1 })
