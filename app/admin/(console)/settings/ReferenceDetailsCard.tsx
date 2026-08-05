'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { COMPUTED_ROW_KINDS, type ComputedRowKind, type ReferenceDetail, type ReferenceLabelOverrides } from '@/lib/call-config'
import { saveReferenceDetails } from './actions'

/**
 * Org-level reference details config: exactly the rows that land in the
 * agent's {{reference_details}} variable, in dispatch order. Two editable
 * groups: the org's own label/value rows (sent first on every call), then the
 * per-deal computed rows whose TITLES are org-configurable here while their
 * values fill from each deal's COI/standards at call time. Renders only once
 * an org is picked.
 */

export default function ReferenceDetailsCard({ orgs, byOrg }: {
  orgs: { id: string; name: string }[]
  byOrg: Record<string, { details: ReferenceDetail[]; labels: ReferenceLabelOverrides }>
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
        <DetailsEditor
          key={`${orgId}:${JSON.stringify(byOrg[orgId] ?? {})}`}
          orgId={orgId}
          stored={byOrg[orgId]?.details ?? []}
          storedLabels={byOrg[orgId]?.labels ?? {}}
        />
      )}
    </div>
  )
}

function DetailsEditor({ orgId, stored, storedLabels }: {
  orgId: string
  stored: ReferenceDetail[]
  storedLabels: ReferenceLabelOverrides
}) {
  const [rows, setRows] = useState<ReferenceDetail[]>(stored.length ? stored : [{ label: '', value: '' }])
  const [labels, setLabels] = useState<Record<ComputedRowKind, string>>(() => {
    const init = {} as Record<ComputedRowKind, string>
    for (const { kind, defaultLabel } of COMPUTED_ROW_KINDS) init[kind] = storedLabels[kind] ?? defaultLabel
    return init
  })
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const setRow = (i: number, patch: Partial<ReferenceDetail>) => {
    setMessage(null)
    setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  const save = () => {
    setMessage(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('org_id', orgId)
      fd.set('details', JSON.stringify(rows))
      fd.set('labels', JSON.stringify(labels))
      const res = await saveReferenceDetails(fd)
      if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
      else setMessage({ kind: 'ok', text: 'Saved.' })
    })
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <p style={sectionTitleStyle}>Org rows (sent first, every call)</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row, i) => (
            <div key={i} className="fx-q-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input
                value={row.label}
                placeholder="Title (e.g. Loan number)"
                onChange={e => setRow(i, { label: e.target.value })}
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                value={row.value}
                placeholder="Value the agent can give the office"
                onChange={e => setRow(i, { value: e.target.value })}
                style={{ ...inputStyle, flex: 2 }}
              />
              <button type="button" onClick={() => { setMessage(null); setRows(prev => prev.filter((_, j) => j !== i)) }}
                style={{ ...tinyBtn, color: C.error }} aria-label="Remove">✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => { setMessage(null); setRows(prev => [...prev, { label: '', value: '' }]) }}
          style={{ ...btnStyle(false), marginTop: 8 }}>
          Add row
        </button>
      </div>
      <div>
        <p style={sectionTitleStyle}>Per-deal rows (titles editable, values fill from each deal)</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {COMPUTED_ROW_KINDS.map(({ kind, placeholder }) => (
            <div key={kind} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input
                value={labels[kind]}
                placeholder={placeholder}
                onChange={e => { setMessage(null); setLabels(prev => ({ ...prev, [kind]: e.target.value })) }}
                style={{ ...inputStyle, flex: 1 }}
              />
              <input value="" placeholder={valueHint(kind)} disabled readOnly
                style={{ ...inputStyle, flex: 2, opacity: 0.55, cursor: 'default' }} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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

/** Disabled value-cell placeholder: where each computed row's value comes from. */
function valueHint(kind: ComputedRowKind): string {
  switch (kind) {
    case 'policy_number': return 'Each policy number on the COI (one row per coverage)'
    case 'insured_address': return 'Named insured address on the COI'
    case 'certificate_holder': return 'Certificate holder on the COI'
    case 'certificate_holder_address': return 'Certificate holder address on the COI'
    case 'vehicle': return 'Year/make/model from the submitted standards'
    case 'vin': return 'Each VIN in the submitted standards (one row per VIN)'
    case 'usdot': return 'USDOT number on the COI'
    case 'mc': return 'MC number on the COI'
  }
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.txt2, display: 'block', marginBottom: 4 }
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: C.sans, color: C.txt, background: C.surface, borderRadius: 7, border: `1px solid ${C.border}` }
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: C.txt3, margin: '0 0 8px',
}
const btnStyle = (pending: boolean): React.CSSProperties => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1 })
const tinyBtn: React.CSSProperties = { padding: '2px 8px', background: C.surface, color: C.txt2, fontSize: 12, borderRadius: 6, border: `1px solid ${C.border}`, cursor: 'pointer' }
