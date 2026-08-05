'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { COMPUTED_ROW_KINDS, type ComputedRowKind, type ReferenceLabelOverrides } from '@/lib/call-config'
import { saveReferenceDetails } from './actions'

/**
 * Org-level reference details config: the rows that prefill each deal's call.
 * Top: the always-sent identity rows (locked; each is its own Retell variable,
 * so retitling means an agent change). Below: the per-deal computed rows —
 * title editable per org, value fills from the deal at call time, red ✕
 * removes the row kind from every call (restorable). Renders only once an
 * org is picked.
 */

/** Always-sent rows: dedicated dispatch variables, not part of
 *  {{reference_details}}; shown so the admin sees the full picture here. */
const FIXED_ROWS: { label: string; hint: string }[] = [
  { label: 'Insured name', hint: 'Named insured on the COI' },
  { label: 'Insurer name', hint: 'Producer/agency on the COI' },
  { label: 'Insurer contact', hint: 'Insurance company contact on the COI' },
]

export default function ReferenceDetailsCard({ orgs, byOrg }: {
  orgs: { id: string; name: string }[]
  byOrg: Record<string, { labels: ReferenceLabelOverrides; hidden: ComputedRowKind[] }>
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
          storedLabels={byOrg[orgId]?.labels ?? {}}
          storedHidden={byOrg[orgId]?.hidden ?? []}
        />
      )}
    </div>
  )
}

function DetailsEditor({ orgId, storedLabels, storedHidden }: {
  orgId: string
  storedLabels: ReferenceLabelOverrides
  storedHidden: ComputedRowKind[]
}) {
  const [labels, setLabels] = useState<Record<ComputedRowKind, string>>(() => {
    const init = {} as Record<ComputedRowKind, string>
    for (const { kind, defaultLabel } of COMPUTED_ROW_KINDS) init[kind] = storedLabels[kind] ?? defaultLabel
    return init
  })
  const [hidden, setHidden] = useState<ComputedRowKind[]>(storedHidden)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const save = () => {
    setMessage(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('org_id', orgId)
      fd.set('labels', JSON.stringify(labels))
      fd.set('hidden', JSON.stringify(hidden))
      const res = await saveReferenceDetails(fd)
      if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
      else setMessage({ kind: 'ok', text: 'Saved.' })
    })
  }

  const removed = COMPUTED_ROW_KINDS.filter(k => hidden.includes(k.kind))

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {FIXED_ROWS.map(r => (
          <div key={r.label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input value={r.label} disabled readOnly style={{ ...inputStyle, flex: 1, opacity: 0.55, cursor: 'default' }} />
            <input value="" placeholder={r.hint} disabled readOnly style={{ ...inputStyle, flex: 2, opacity: 0.55, cursor: 'default' }} />
          </div>
        ))}
        {COMPUTED_ROW_KINDS.filter(k => !hidden.includes(k.kind)).map(({ kind, placeholder }) => (
          <div key={kind} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              value={labels[kind]}
              placeholder={placeholder}
              onChange={e => { setMessage(null); setLabels(prev => ({ ...prev, [kind]: e.target.value })) }}
              style={{ ...inputStyle, flex: 1 }}
            />
            <input value="" placeholder={valueHint(kind)} disabled readOnly
              style={{ ...inputStyle, flex: 2, opacity: 0.55, cursor: 'default' }} />
            <button type="button" onClick={() => { setMessage(null); setHidden(prev => [...prev, kind]) }}
              style={{ ...tinyBtn, color: C.error }} aria-label="Remove">✕</button>
          </div>
        ))}
      </div>
      {removed.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt2 }}>Removed:</span>
          {removed.map(({ kind, defaultLabel, placeholder }) => (
            <button key={kind} type="button"
              onClick={() => { setMessage(null); setHidden(prev => prev.filter(k => k !== kind)) }}
              style={tinyBtn} title="Restore">
              {(labels[kind] || defaultLabel || placeholder)} ↩
            </button>
          ))}
        </div>
      )}
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
    case 'producer': return 'Producer (agency) name on the COI'
    case 'producer_address': return 'Producer address on the COI (insurer address if absent)'
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
const btnStyle = (pending: boolean): React.CSSProperties => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1 })
const tinyBtn: React.CSSProperties = { padding: '2px 8px', background: C.surface, color: C.txt2, fontSize: 12, borderRadius: 6, border: `1px solid ${C.border}`, cursor: 'pointer' }
