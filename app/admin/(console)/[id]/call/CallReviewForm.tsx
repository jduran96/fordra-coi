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
}

const IDENTITY_FIELDS: { field: keyof CallContextFields; label: string; hint?: string }[] = [
  { field: 'assistant_name', label: 'Assistant name' },
  { field: 'on_behalf_of', label: 'On behalf of', hint: 'The only org name the agent ever speaks' },
  { field: 'relationship_line', label: 'Relationship line', hint: 'Answers "what is your relationship?"' },
  { field: 'holder_legal_name', label: 'Certificate holder (legal name)' },
  { field: 'holder_address', label: 'Certificate holder address' },
  { field: 'reply_email', label: 'Reply email' },
  { field: 'on_behalf_of_info', label: 'About the client (1-2 sentences)' },
  // callback_number intentionally absent: return-call handling was removed
  // from the flow (no inbound agent); the payload no longer carries it.
]

const LOOKUP_FIELDS: { field: keyof CallContextFields; label: string }[] = [
  { field: 'insured_name', label: 'Insured name' },
  { field: 'agency_name', label: 'Agency name' },
  { field: 'agent_name', label: 'Agent name' },
]

export default function CallReviewForm({ verificationId, context: initialContext, questions: initialQuestions, details: initialDetails, numbers, coiPhone, draftId, caseIsClosed }: Props) {
  const router = useRouter()
  const [context, setContext] = useState<CallContextFields>(initialContext)
  const [questions, setQuestions] = useState<AiCallQuestion[]>(initialQuestions)
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
  const setQuestion = (i: number, patch: Partial<AiCallQuestion>) => {
    setQuestions(prev => prev.map((q, j) => (j === i ? { ...q, ...patch } : q)))
    setConfirming(false)
  }
  const moveQuestion = (i: number, dir: -1 | 1) => {
    setQuestions(prev => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const buildFormData = () => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(context)) fd.set(k, v)
    fd.set('questions_json', JSON.stringify(questions))
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {IDENTITY_FIELDS.map(({ field, label, hint }) => (
            <div key={field}>
              <label style={labelStyle}>{label}</label>
              <input value={context[field]} onChange={e => setField(field, e.target.value)} style={fieldStyle(!context[field].trim())} />
              {hint && <p style={{ fontSize: 11.5, color: C.txt3, margin: '3px 0 0' }}>{hint}</p>}
            </div>
          ))}
          <div>
            <label style={labelStyle}>Email channel</label>
            <select value={context.email_enabled} onChange={e => setField('email_enabled', e.target.value)} style={fieldStyle(false)}>
              <option value="false">Off (a colleague will follow up)</option>
              <option value="true">On (agent may promise the reply email)</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Entity type</label>
            <select value={context.entity_type} onChange={e => setField('entity_type', e.target.value)} style={fieldStyle(false)}>
              <option value="agency">Agency</option>
              <option value="carrier">Carrier</option>
              <option value="mga">MGA</option>
            </select>
          </div>
        </div>
      </section>

      {/* 2. Question editor: plain text rows + blocker toggle */}
      <section style={card()}>
        <Title>Questions</Title>
        <p style={{ fontSize: 12.5, color: C.txt3, margin: '0 0 12px' }}>
          The agent asks each question exactly as written, in this order. Write them the way you would say them on the phone.
          Blocker questions are asked first; a negative answer (policy not active, vehicle not listed) ends the call immediately.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {questions.map((q, i) => (
            <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 9, padding: 12, background: C.paper }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.txt3, paddingTop: 9, fontFamily: C.mono }}>{i + 1}.</span>
                <textarea value={q.text} rows={2} onChange={e => setQuestion(i, { text: e.target.value })}
                  style={{ ...fieldStyle(!q.text.trim()), resize: 'vertical', flex: 1 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button type="button" onClick={() => moveQuestion(i, -1)} disabled={i === 0} style={tinyBtn(i === 0)} aria-label="Move up">↑</button>
                  <button type="button" onClick={() => moveQuestion(i, 1)} disabled={i === questions.length - 1} style={tinyBtn(i === questions.length - 1)} aria-label="Move down">↓</button>
                </div>
                <button type="button" onClick={() => { setQuestions(prev => prev.filter((_, j) => j !== i)); setConfirming(false) }} style={{ ...tinyBtn(false), color: C.error }} aria-label="Remove">✕</button>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, marginLeft: 24, fontSize: 12.5, color: q.blocker ? C.error : C.txt2, cursor: 'pointer', userSelect: 'none', fontWeight: q.blocker ? 600 : 400 }}>
                <input type="checkbox" checked={!!q.blocker}
                  onChange={e => setQuestion(i, { blocker: e.target.checked || undefined })}
                  style={{ accentColor: C.error }} />
                Blocker: a negative answer ends the call
              </label>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setQuestions(prev => [...prev, { text: '' }])}
          style={{ ...btn(), marginTop: 10 }}>
          Add question
        </button>
      </section>

      {/* 3. Identity core + generic reference details the agent may state */}
      <section style={card()}>
        <Title>Reference details</Title>
        <p style={{ fontSize: 12.5, color: C.txt3, margin: '0 0 12px' }}>
          Facts the agent may state to help the office find the account, prefilled from the COI extraction.
          Add whatever the deal needs (one row per VIN, MC number, invoice ref). Long identifiers automatically
          get a spoken form; the agent leads with the last four and gives more only if asked. Anything not
          listed here, the agent says it does not have.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
          {LOOKUP_FIELDS.map(({ field, label }) => (
            <div key={field}>
              <label style={labelStyle}>{label}</label>
              <input value={context[field]} onChange={e => setField(field, e.target.value)} style={fieldStyle(!context[field].trim())} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {details.map((d, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={d.label} placeholder="Label (e.g. VIN, 2019 Freightliner)"
                onChange={e => { setDetails(prev => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))); setConfirming(false) }}
                style={{ ...fieldStyle(!d.label.trim()), width: 280, flexShrink: 0 }} />
              <input value={d.value} placeholder="Value"
                onChange={e => { setDetails(prev => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x))); setConfirming(false) }}
                style={{ ...fieldStyle(!d.value.trim()), flex: 1 }} />
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: C.txt, cursor: 'pointer' }}>
            <input type="radio" name="number_choice" checked={numberChoice === 'manual'}
              onChange={() => { setNumberChoice('manual'); setConfirming(false) }} style={{ accentColor: C.txt }} />
            <span>Other number:</span>
            <input value={manualNumber} onChange={e => { setManualNumber(e.target.value); setNumberChoice('manual'); setConfirming(false) }}
              placeholder="(555) 555-0100" style={{ ...fieldStyle(false), width: 190 }} />
          </label>
          <p style={{ fontSize: 12.5, color: C.txt3, margin: '4px 0 0' }}>
            Will dial: <span style={{ fontFamily: C.mono, color: e164 ? C.txt : C.error }}>{e164 ?? 'not a valid number yet'}</span>
          </p>
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
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
              onClick={() => { setConfirming(false); run(() => approveAndDispatchCall(verificationId, buildFormData()), 'Call dispatched.') }}
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
              style={{ ...fieldStyle(false), width: 220 }} />
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
const btn = (disabled = false): React.CSSProperties => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 })
const primaryBtn = (disabled = false): React.CSSProperties => ({ padding: '8px 20px', background: C.earthy, color: C.onDark, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 })
const tinyBtn = (disabled: boolean): React.CSSProperties => ({ padding: '2px 8px', background: C.surface, color: C.txt2, fontSize: 12, borderRadius: 6, border: `1px solid ${C.border}`, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1 })
