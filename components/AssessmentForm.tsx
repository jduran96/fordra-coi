'use client'

import { useState } from 'react'
import { C } from '@/lib/theme'
import PendingButton from '@/components/PendingButton'
import EditorModal from '@/components/EditorModal'
import { ConditionChip } from '@/components/RequirementsEditor'
import { useAnalysisBodyVisible } from '@/components/AdminTabs'

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
  failed,
}: {
  action: (formData: FormData) => Promise<{ error?: string } | void>
  items: Item[]
  summaryDefault: string
  published: boolean
  failed: boolean
}) {
  const [rows, setRows] = useState(() => items.map((it, i) => ({ ...it, key: i })))
  const [nextKey, setNextKey] = useState(items.length)
  const [error, setError] = useState('')
  // The Failed flow needs a reason: the button opens this dialog instead of
  // submitting directly. The dialog lives INSIDE the <form> so its textarea
  // submits with the assessment fields.
  const [failOpen, setFailOpen] = useState(false)
  // Inside AdminTabs the body (rows + summary) belongs to the Analysis tab;
  // the action footer below stays visible under every tab. Hidden, not
  // unmounted: in-progress edits and the hidden inputs must keep submitting.
  const bodyVisible = useAnalysisBodyVisible()
  // Published and failed cases are closed: the form is read-only and the
  // only action is Edit Status, which reopens the case into the review queue.
  const closed = published || failed

  // Publish/fail redirect on success; a returned error means nothing was
  // written and must be shown, never silently swallowed.
  async function submit(formData: FormData) {
    setError('')
    const res = await action(formData)
    if (res?.error) setError(res.error)
  }

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
    <form action={submit} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input type="hidden" name="row_count" value={rows.length} />
      <div style={{ display: bodyVisible ? 'flex' : 'none', flexDirection: 'column', gap: 14 }}>
      {rows.map((item, i) => (
        <div key={item.key} style={{ paddingBottom: 14, borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input type="hidden" name={`req_${i}_requirement`} value={JSON.stringify(item.requirement)} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={item.requirement.coverage_type ?? ''}
              onChange={e => editName(item.key, e.target.value)}
              placeholder="Requirement name"
              disabled={closed}
              style={{ ...input(), flex: 1, fontWeight: 700 }}
            />
            {item.requirement.minimum_limit
              ? <span style={{ fontSize: 13, color: C.txt3, whiteSpace: 'nowrap' }}>{item.requirement.minimum_limit}</span>
              : <ConditionChip />}
            {!closed && (
              <button type="button" onClick={() => removeRow(item.key)} title="Remove this requirement"
                style={{ ...smallBtn(), color: C.error, padding: '6px 10px' }}>
                Remove
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <select name={`req_${i}_status`} defaultValue={item.status} disabled={closed} style={{ ...input(), width: 160, flexShrink: 0 }}>
              <option value="met">Passed</option>
              <option value="not_met">Discrepancy</option>
              <option value="uncertain">Unconfirmed</option>
            </select>
            <input
              name={`req_${i}_evidence`}
              defaultValue={item.evidence ?? ''}
              placeholder="Reason / evidence shown to the customer"
              disabled={closed}
              style={{ ...input(), flex: 1 }}
            />
          </div>
        </div>
      ))}
      {!closed && <button type="button" onClick={addRow} style={{ ...smallBtn(), alignSelf: 'flex-start' }}>+ Add requirement</button>}
      <div>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 8px' }}>Summary</h3>
        <textarea
          name="narrative_summary"
          defaultValue={summaryDefault}
          rows={4}
          placeholder="Overall verdict in plain language: what passed, what did not, what remains unconfirmed…"
          disabled={closed}
          style={{ ...input(), width: '100%', resize: 'vertical' }}
        />
      </div>
      </div>
      {error && <p style={{ fontSize: 13, color: C.error, fontFamily: C.sans, margin: 0 }}>{error}</p>}
      {closed ? (
        // A published or failed case is closed: read-only, and the only
        // action is reopening it. The reopen intent never writes final_report
        // (the disabled fields above are not submitted), so the saved report
        // is untouched until the admin edits and saves after reopening.
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <PendingButton name="intent" value="reopen" pendingLabel="Reopening…" style={primaryBtn()}>
              Edit Status
            </PendingButton>
          </div>
          <p style={{ fontSize: 12.5, color: C.txt3, fontFamily: C.sans, margin: 0 }}>
            {failed
              ? 'This verification is failed. The customer sees the Failed status and your reason. Edit Status returns it to the review queue.'
              : 'This report is live for the customer. Edit Status takes it down and returns it to the review queue.'}
          </p>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <PendingButton name="intent" value="save" pendingLabel="Saving…" style={smallBtn()}>Save draft</PendingButton>
          <button type="button" onClick={() => setFailOpen(true)}
            style={{ ...smallBtn(), color: C.error, borderColor: C.error }}>
            Failed
          </button>
          <PendingButton name="intent" value="publish" pendingLabel="Publishing…" style={primaryBtn()}>
            Publish to customer
          </PendingButton>
        </div>
      )}
      {failOpen && (
        <EditorModal title="Mark as Failed" onClose={() => setFailOpen(false)} maxWidth={520}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13.5, color: C.txt2, fontFamily: C.sans, lineHeight: 1.6, margin: 0 }}>
              Closes this verification without a report. The customer sees the status
              Failed and the reason you write below.
            </p>
            <textarea
              name="failure_reason"
              required
              rows={4}
              placeholder="Reason shown to the customer"
              style={{ ...input(), width: '100%', resize: 'vertical' }}
            />
            {error && <p style={{ fontSize: 13, color: C.error, fontFamily: C.sans, margin: 0 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setFailOpen(false)} style={smallBtn()}>Cancel</button>
              <PendingButton name="intent" value="fail" pendingLabel="Saving…"
                style={{ ...primaryBtn(), background: C.error }}>
                Mark as Failed
              </PendingButton>
            </div>
          </div>
        </EditorModal>
      )}
    </form>
  )
}

const input = () => ({ padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const })
const smallBtn = () => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' })
const primaryBtn = () => ({ padding: '8px 20px', background: C.earthy, color: C.onDark, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer' })
