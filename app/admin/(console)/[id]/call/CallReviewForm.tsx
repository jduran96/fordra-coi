'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { C } from '@/lib/theme'
import {
  disclosurePreview, normalizeE164, validateDispatch,
  type AiCallQuestion, type CallContextFields, type NumberCandidate, type ReferenceDetail,
} from '@/lib/call-config'
import { saveCallDraft, approveAndDispatchCall, rejectCallDraft } from './actions'

/**
 * Pre-dial review screen (voice spec v5 §10): the admin edits and approves the
 * EXACT payload the agent will speak from. Validation here mirrors the server
 * exactly (same pure validator); the server re-runs it on dispatch, so this
 * form is a courtesy, never the gate. Dispatch uses a two-step inline confirm
 * instead of a browser dialog.
 */

interface Props {
  verificationId: string
  context: CallContextFields
  questions: AiCallQuestion[]
  details: ReferenceDetail[]
  numbers: NumberCandidate[]
  coiPhone: string
  draftId: string | null
  caseIsClosed: boolean
  /** Called with the ai_calls row id once a dispatch succeeds (the launcher
   *  modal advances to the live-call view). */
  onDispatched?: (callId: string) => void
}

// Identity: who the agent is. Deal parties (certificate holder, loss payee)
// are per-COI reference details below, not identity fields.
const IDENTITY_FIELDS: { field: keyof CallContextFields; label: string; hint?: string }[] = [
  { field: 'assistant_name', label: 'Assistant first name', hint: 'The name the agent introduces itself with' },
  { field: 'assistant_last_name', label: 'Assistant last name', hint: 'Given when a rep asks for a first and last name' },
]

// Legitimacy: who the agent is affiliated with and what they do. reply_email
// and reference_id are proof points, only spoken if the office asks
// (flow nodes G1 / N1q / N6c).
const LEGITIMACY_FIELDS: { field: keyof CallContextFields; label: string; hint?: string }[] = [
  { field: 'on_behalf_of', label: 'On behalf of', hint: 'The only org name the agent ever speaks' },
  { field: 'relationship_line', label: 'Relationship to the deal', hint: 'Completes "<On behalf of> is ..." when the office asks why we are calling' },
  { field: 'on_behalf_of_info', label: 'What the client does', hint: 'Said if the office asks who <On behalf of> is' },
  { field: 'reply_email', label: 'Reply email', hint: 'Offered only if the office asks to verify by email' },
  { field: 'reference_id', label: 'Reference ID' },
]

// Insurer name/contact are optional: many calls have no contact person, and a
// blank one just means the agent says it does not have it — so no warn border.
// The labels are UI-only; the dispatch variables stay agency_name/agent_name
// (renaming those means a Retell dashboard change).
const LOOKUP_FIELDS: { field: keyof CallContextFields; label: string; optional?: boolean }[] = [
  { field: 'insured_name', label: 'Insured name' },
  { field: 'agency_name', label: 'Insurer name', optional: true },
  { field: 'agent_name', label: 'Insurer contact', optional: true },
]

export default function CallReviewForm({ verificationId, context: initialContext, questions, details: initialDetails, numbers, coiPhone, draftId, caseIsClosed, onDispatched }: Props) {
  const router = useRouter()
  const [context, setContext] = useState<CallContextFields>(initialContext)
  const [details, setDetails] = useState<ReferenceDetail[]>(initialDetails)
  const [numberChoice, setNumberChoice] = useState<string>(numbers.length ? numbers[0].number : 'manual')
  const [manualNumber, setManualNumber] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const toNumber = numberChoice === 'manual' ? manualNumber : numberChoice
  const chosen = numbers.find(n => n.number === numberChoice)
  const e164 = normalizeE164(toNumber)

  const validation = useMemo(() => validateDispatch({
    context, questions, details, toNumber,
    coiPhone,
    numberStatus: chosen?.status ?? null,
  }), [context, questions, details, toNumber, coiPhone, chosen])

  const setField = (field: keyof CallContextFields, value: string) => {
    setContext(prev => ({ ...prev, [field]: value }))
    setConfirming(false)
  }
  const buildFormData = () => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(context)) fd.set(k, v)
    fd.set('details_json', JSON.stringify(details))
    fd.set('to_number', toNumber)
    fd.set('number_source', numberChoice === 'manual' ? 'manual' : (chosen?.source ?? 'manual'))
    return fd
  }

  const run = (fn: () => Promise<{ error?: string; callId?: string } | void>, okText: string) => {
    setMessage(null)
    startTransition(async () => {
      const res = await fn()
      if (res && 'error' in res && res.error) {
        setMessage({ kind: 'error', text: res.error })
      } else {
        setMessage({ kind: 'ok', text: okText })
        router.refresh()
      }
    })
  }

  const fieldStyle = (blank: boolean): React.CSSProperties => ({
    width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: C.sans,
    color: C.txt, background: C.surface, borderRadius: 7,
    border: `1px solid ${blank ? `color-mix(in oklch, ${C.warn} 55%, transparent)` : C.border}`,
  })
  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.txt2, display: 'block', marginBottom: 4 }

  if (caseIsClosed) {
    return <p style={{ color: C.txt3, fontSize: 13.5 }}>This case is closed. Reopen it from the Assessment section before dispatching a call.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 1. Config summary: identity + the disclosure exactly as spoken */}
      <section style={card()}>
        <Title>Caller identity</Title>
        <p style={{ fontSize: 13.5, color: C.txt, background: C.cream, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', margin: '0 0 14px', fontStyle: 'italic' }}>
          Opening line: &ldquo;{disclosurePreview(context)}&rdquo;
        </p>
        <div className="fx-cols-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {IDENTITY_FIELDS.map(({ field, label, hint }) => (
            <div key={field}>
              <label style={labelStyle}>{label}</label>
              <input value={context[field]} onChange={e => setField(field, e.target.value)} style={fieldStyle(!context[field].trim())} />
              {hint && <p style={{ fontSize: 11.5, color: C.txt3, margin: '3px 0 0' }}>{hint}</p>}
            </div>
          ))}
          <div>
            <label style={labelStyle}>Languages</label>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', padding: '8px 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: C.txt }}>
                <input type="checkbox" checked readOnly disabled />
                English
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: C.txt, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={context.languages.split(',').map(s => s.trim()).includes('es')}
                  onChange={e => setField('languages', e.target.checked ? 'en,es' : 'en')}
                />
                Spanish
              </label>
            </div>
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, marginTop: 14 }}>
          <p style={{ ...labelStyle, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.txt3, marginBottom: 10 }}>Legitimacy</p>
          <div className="fx-cols-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {LEGITIMACY_FIELDS.map(({ field, label, hint }) => (
              <div key={field}>
                <label style={labelStyle}>{label}</label>
                <input value={context[field]} onChange={e => setField(field, e.target.value)} style={fieldStyle(field === 'on_behalf_of' || field === 'relationship_line' ? !context[field].trim() : false)} />
                {hint && <p style={{ fontSize: 11.5, color: C.txt3, margin: '3px 0 0' }}>{hint}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 2. Questions live in the master list (AI tab); the dispatch action
          reads them from the verification, so this modal only points there. */}
      <section style={card()}>
        <Title>Questions</Title>
        <p style={{ fontSize: 13.5, color: C.txt2, margin: 0 }}>
          This call asks the {questions.filter(q => q.text.trim()).length} questions from the master list in the AI tab
          {questions.some(q => q.blocker) ? `, ${questions.filter(q => q.blocker).length} of them blockers asked first` : ''}
          {questions.some(q => q.followUp) ? `, ${questions.filter(q => q.followUp).length} with a conditional follow-up` : ''}. Edit them there before dispatching.
        </p>
      </section>

      {/* 3. Identity core + generic reference details the agent may state */}
      <section style={card()}>
        <Title>Reference details</Title>
        {/* Title | Value | remove, one grid PER ROW rather than one grid for
            the whole block: the fixed column template keeps every row aligned
            on desktop exactly as a single grid did, and on a phone each row
            can restack on its own (title over value, remove button beside
            them) instead of every cell becoming its own full-width line. The
            first rows are the identity core (fixed titles — they dispatch as
            their own variables); below them the free-form detail rows. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="fx-hide" style={detailRow}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>Title</span>
            <span style={{ ...labelStyle, marginBottom: 0 }}>Value</span>
            <span />
          </div>
          {LOOKUP_FIELDS.map(({ field, label, optional }) => (
            <div key={field} className="fx-detail-row" style={detailRow}>
              <span style={{ fontSize: 13.5, color: C.txt, fontWeight: 500, paddingLeft: 2 }}>{label}</span>
              <input value={context[field]} onChange={e => setField(field, e.target.value)} style={fieldStyle(!optional && !context[field].trim())} />
              <span />
            </div>
          ))}
          {details.map((d, i) => (
            <div key={i} className="fx-detail-row" style={detailRow}>
              <input value={d.label} placeholder="Title (e.g. VIN, 2019 Freightliner)"
                onChange={e => { setDetails(prev => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))); setConfirming(false) }}
                style={fieldStyle(!d.label.trim())} />
              <input value={d.value} placeholder="Value"
                onChange={e => { setDetails(prev => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x))); setConfirming(false) }}
                style={fieldStyle(!d.value.trim())} />
              <button type="button" onClick={() => { setDetails(prev => prev.filter((_, j) => j !== i)); setConfirming(false) }}
                style={{ ...tinyBtn(false), color: C.error }} aria-label="Remove detail">✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setDetails(prev => [...prev, { label: '', value: '' }])}
          style={{ ...btn(), marginTop: 10 }}>
          Add detail
        </button>
      </section>

      {/* 4. Number panel: COI number vs independently found numbers */}
      <section style={card()}>
        <Title>Number to dial</Title>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {numbers.map(n => (
            <label key={n.number} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: C.txt, cursor: 'pointer' }}>
              <input type="radio" name="number_choice" checked={numberChoice === n.number}
                onChange={() => { setNumberChoice(n.number); setConfirming(false) }} style={{ accentColor: C.txt }} />
              <span style={{ fontFamily: C.mono, fontSize: 13 }}>{n.number}</span>
              <span style={{ fontSize: 11.5, color: C.txt3 }}>{n.label}</span>
              {n.status && <StatusChip status={n.status} />}
            </label>
          ))}
          <label className="fx-wrap" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: C.txt, cursor: 'pointer' }}>
            <input type="radio" name="number_choice" checked={numberChoice === 'manual'}
              onChange={() => { setNumberChoice('manual'); setConfirming(false) }} style={{ accentColor: C.txt }} />
            <span>Other number:</span>
            <input value={manualNumber} onChange={e => { setManualNumber(e.target.value); setNumberChoice('manual'); setConfirming(false) }}
              placeholder="(555) 555-0100" className="fx-full" style={{ ...fieldStyle(false), width: 190 }} />
          </label>
        </div>
      </section>

      {/* 5. Validation panel */}
      <section style={card()}>
        <Title>Pre-dial checks</Title>
        {validation.blocks.length === 0 && validation.warnings.length === 0 && (
          <p style={{ fontSize: 13.5, color: C.ok, margin: 0 }}>All checks pass.</p>
        )}
        {validation.blocks.map((b, i) => (
          <p key={`b${i}`} style={{ fontSize: 13, color: C.error, margin: '0 0 6px' }}>Blocked: {b}</p>
        ))}
        {validation.warnings.map((w, i) => (
          <p key={`w${i}`} style={{ fontSize: 13, color: C.warn, margin: '0 0 6px' }}>Warning: {w}</p>
        ))}
      </section>

      {/* 6. Actions */}
      {message && (
        <p style={{ fontSize: 13.5, fontWeight: 600, color: message.kind === 'error' ? C.error : C.ok, margin: 0 }}>{message.text}</p>
      )}
      <div className="fx-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" disabled={pending}
          onClick={() => run(() => saveCallDraft(verificationId, buildFormData()), 'Draft saved.')}
          style={btn(pending)}>
          Save draft
        </button>
        {!confirming ? (
          <button type="button" disabled={pending || validation.blocks.length > 0}
            onClick={() => setConfirming(true)}
            style={primaryBtn(pending || validation.blocks.length > 0)}>
            Approve and dispatch
          </button>
        ) : (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: C.txt2 }}>This places a real, billed call to <span style={{ fontFamily: C.mono }}>{e164}</span>.</span>
            <button type="button" disabled={pending}
              onClick={() => {
                setConfirming(false)
                setMessage(null)
                startTransition(async () => {
                  const res = await approveAndDispatchCall(verificationId, buildFormData())
                  if (res && 'error' in res && res.error) {
                    setMessage({ kind: 'error', text: res.error })
                  } else {
                    setMessage({ kind: 'ok', text: 'Call dispatched.' })
                    router.refresh()
                    if (res && 'callId' in res && res.callId) onDispatched?.(res.callId)
                  }
                })
              }}
              style={primaryBtn(pending)}>
              {pending ? 'Dispatching...' : 'Confirm dispatch'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} style={btn()}>Cancel</button>
          </span>
        )}
        {draftId && !rejecting && (
          <button type="button" onClick={() => setRejecting(true)} style={{ ...btn(), marginLeft: 'auto', color: C.error }}>
            Reject draft
          </button>
        )}
        {draftId && rejecting && (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason"
              className="fx-full" style={{ ...fieldStyle(false), width: 220 }} />
            <button type="button" disabled={pending || !rejectReason.trim()}
              onClick={() => {
                const fd = new FormData()
                fd.set('rejected_reason', rejectReason)
                run(() => rejectCallDraft(verificationId, draftId, fd), 'Draft rejected.')
                setRejecting(false)
              }}
              style={{ ...btn(pending), color: C.error }}>
              Confirm reject
            </button>
            <button type="button" onClick={() => setRejecting(false)} style={btn()}>Cancel</button>
          </span>
        )}
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: 'verified' | 'not_found' | 'differs' }) {
  const color = status === 'verified' ? C.ok : status === 'differs' ? C.error : C.warn
  const label = status === 'verified' ? 'Verified' : status === 'differs' ? 'Differs' : 'Not found'
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color, background: `color-mix(in oklch, ${color} 12%, transparent)`, padding: '2px 8px', borderRadius: 20 }}>
      {label}
    </span>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 12, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 10px' }}>{children}</h3>
}
const card = (): React.CSSProperties => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 })
const detailRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: '280px 1fr 28px', gap: 8, alignItems: 'center' }
const btn = (disabled = false): React.CSSProperties => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 })
const primaryBtn = (disabled = false): React.CSSProperties => ({ padding: '8px 20px', background: C.earthy, color: C.onDark, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 })
const tinyBtn = (disabled: boolean): React.CSSProperties => ({ padding: '2px 8px', background: C.surface, color: C.txt2, fontSize: 12, borderRadius: 6, border: `1px solid ${C.border}`, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1 })
