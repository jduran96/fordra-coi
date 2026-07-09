'use client'

import { useState } from 'react'
import { C } from '@/lib/theme'
import PendingButton from '@/components/PendingButton'
import { ConditionChip } from '@/components/RequirementsEditor'

interface Requirement { coverage_type?: string; minimum_limit?: string; notes?: string | null }
interface Item { requirement: Requirement; status: 'met' | 'not_met' | 'uncertain'; evidence?: string }

/**
 * The admin's requirement-by-requirement review. Rows are client-state so the
 * admin can add and remove checks freely; field names stay req_<i>_* so the
 * saveAssessment server action reads them unchanged.
 */
export default function AssessmentForm({
  action,
  items,
  summaryDefault,
  published,
}: {
  action: (formData: FormData) => Promise<void>
  items: Item[]
  summaryDefault: string
  published: boolean
}) {
  const [rows, setRows] = useState(() => items.map((it, i) => ({ ...it, key: i })))
  const [nextKey, setNextKey] = useState(items.length)

  function addRow() {
    setRows(r => [...r, { requirement: { coverage_type: '', minimum_limit: '', notes: null }, status: 'uncertain' as const, evidence: '', key: nextKey }])
    setNextKey(k => k + 1)
  }
  function removeRow(key: number) {
    setRows(r => r.filter(x => x.key !== key))
  }
  function editName(key: number, coverage_type: string) {
    setRows(r => r.map(x => (x.key === key ? { ...x, requirement: { ...x.requirement, coverage_type } } : x)))
  }

  return (
    <form action={action} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input type="hidden" name="row_count" value={rows.length} />
      {rows.map((item, i) => (
        <div key={item.key} style={{ paddingBottom: 14, borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input type="hidden" name={`req_${i}_requirement`} value={JSON.stringify(item.requirement)} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={item.requirement.coverage_type ?? ''}
              onChange={e => editName(item.key, e.target.value)}
              placeholder="Requirement name"
              style={{ ...input(), flex: 1, fontWeight: 700 }}
            />
            {item.requirement.minimum_limit
              ? <span style={{ fontSize: 13, color: C.txt3, whiteSpace: 'nowrap' }}>{item.requirement.minimum_limit}</span>
              : <ConditionChip />}
            <button type="button" onClick={() => removeRow(item.key)} title="Remove this requirement"
              style={{ ...smallBtn(), color: C.error, padding: '6px 10px' }}>
              Remove
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <select name={`req_${i}_status`} defaultValue={item.status} style={{ ...input(), width: 160, flexShrink: 0 }}>
              <option value="met">Passed</option>
              <option value="not_met">Discrepancy</option>
              <option value="uncertain">Unconfirmed</option>
            </select>
            <input
              name={`req_${i}_evidence`}
              defaultValue={item.evidence ?? ''}
              placeholder="Reason / evidence shown to the customer"
              style={{ ...input(), flex: 1 }}
            />
          </div>
        </div>
      ))}
      <button type="button" onClick={addRow} style={{ ...smallBtn(), alignSelf: 'flex-start' }}>+ Add requirement</button>
      <div>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 8px' }}>Summary</h3>
        <textarea
          name="narrative_summary"
          defaultValue={summaryDefault}
          rows={4}
          placeholder="Overall verdict in plain language: what passed, what did not, what remains unconfirmed…"
          style={{ ...input(), width: '100%', resize: 'vertical' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <PendingButton name="intent" value="save" pendingLabel="Saving…" style={smallBtn()}>Save draft</PendingButton>
        <PendingButton name="intent" value="reject" pendingLabel="Rejecting…"
          style={{ ...smallBtn(), color: C.error, borderColor: C.error }}>
          Reject
        </PendingButton>
        <PendingButton name="intent" value="publish" pendingLabel="Publishing…" style={primaryBtn()}>
          {published ? 'Republish to customer' : 'Publish to customer'}
        </PendingButton>
      </div>
    </form>
  )
}

const input = () => ({ padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const })
const smallBtn = () => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' })
const primaryBtn = () => ({ padding: '8px 20px', background: C.earthy, color: C.onDark, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer' })
