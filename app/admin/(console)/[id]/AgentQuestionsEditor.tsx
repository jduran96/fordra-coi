'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { C } from '@/lib/theme'
import type { AiCallQuestion } from '@/lib/call-config'
import { saveAgentQuestions, regenerateAgentQuestions } from './call/actions'

/**
 * The verification's master question list (verifications.agent_questions),
 * editable in place on the AI tab. Saved lists are curated: extraction re-runs
 * stop regenerating over them, and the pre-dial modal prefills from here.
 * Regenerate is the explicit way back to a fresh standards-derived list.
 */

interface Props {
  verificationId: string
  questions: AiCallQuestion[]
  caseIsClosed: boolean
}

export default function AgentQuestionsEditor({ verificationId, questions: initial, caseIsClosed }: Props) {
  const router = useRouter()
  const [questions, setQuestions] = useState<AiCallQuestion[]>(initial)
  const [dirty, setDirty] = useState(false)
  const [regenConfirming, setRegenConfirming] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const edit = (fn: (prev: AiCallQuestion[]) => AiCallQuestion[]) => {
    setQuestions(fn)
    setDirty(true)
    setMessage(null)
  }
  const setQuestion = (i: number, patch: Partial<AiCallQuestion>) =>
    edit(prev => prev.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  const move = (i: number, dir: -1 | 1) =>
    edit(prev => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  // A checked follow-up must carry both its condition and its question text
  // before the list can be saved (the flow rule needs both to act on it).
  const incompleteFollowUp = questions.some(q => q.followUp && (!q.followUp.condition.trim() || !q.followUp.text.trim()))

  const save = () => {
    if (incompleteFollowUp) {
      setMessage({ kind: 'error', text: 'A follow-up needs both its condition and its question text. Fill them in or uncheck Follow-up.' })
      return
    }
    setMessage(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('questions_json', JSON.stringify(questions))
      const res = await saveAgentQuestions(verificationId, fd)
      if (res && 'error' in res && res.error) {
        setMessage({ kind: 'error', text: res.error })
      } else {
        setMessage({ kind: 'ok', text: 'Questions saved. New calls will use this list.' })
        setDirty(false)
        router.refresh()
      }
    })
  }

  const regenerate = () => {
    setRegenConfirming(false)
    setMessage(null)
    startTransition(async () => {
      const res = await regenerateAgentQuestions(verificationId)
      if (res && 'error' in res && res.error) {
        setMessage({ kind: 'error', text: res.error })
      } else {
        setMessage({ kind: 'ok', text: 'Questions regenerated from the current standards.' })
        setDirty(false)
        router.refresh()
      }
    })
  }

  const fieldStyle = (blank: boolean): React.CSSProperties => ({
    width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: C.sans,
    color: C.txt, background: C.surface, borderRadius: 7,
    border: `1px solid ${blank ? `color-mix(in oklch, ${C.warn} 55%, transparent)` : C.border}`,
  })

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {questions.length === 0 && (
          <p style={{ fontSize: 13.5, color: C.txt3, margin: 0 }}>No questions yet. Add one, or regenerate from the standards.</p>
        )}
        {questions.map((q, i) => (
          <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 9, padding: 12, background: C.paper }}>
            {/* On a phone the reorder/remove controls wrap onto their own
                line so the question text keeps the full width. */}
            <div className="fx-q-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.txt3, paddingTop: 9, fontFamily: C.mono }}>{i + 1}.</span>
              {/* fx-q-text drops these to 14px on a phone. They are read far
                  more often than edited, and the 16px anti-zoom size fits so
                  little of a question in two rows that it is hard to scan. */}
              <textarea value={q.text} rows={2} disabled={caseIsClosed}
                onChange={e => setQuestion(i, { text: e.target.value })}
                className="fx-q-text"
                style={{ ...fieldStyle(!q.text.trim()), resize: 'vertical', flex: 1, lineHeight: 1.45 }} />
              <div className="fx-q-tools" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button type="button" onClick={() => move(i, -1)} disabled={caseIsClosed || i === 0} style={tinyBtn(caseIsClosed || i === 0)} aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={caseIsClosed || i === questions.length - 1} style={tinyBtn(caseIsClosed || i === questions.length - 1)} aria-label="Move down">↓</button>
              </div>
              <button type="button" disabled={caseIsClosed} onClick={() => edit(prev => prev.filter((_, j) => j !== i))}
                style={{ ...tinyBtn(caseIsClosed), color: C.error }} aria-label="Remove">✕</button>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, marginLeft: 24 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: q.blocker ? C.error : C.txt2, cursor: caseIsClosed ? 'default' : 'pointer', userSelect: 'none', fontWeight: q.blocker ? 600 : 400 }}>
                <input type="checkbox" checked={!!q.blocker} disabled={caseIsClosed}
                  onChange={e => setQuestion(i, { blocker: e.target.checked || undefined })}
                  style={{ accentColor: C.error }} />
                Blocker: a negative answer ends the call
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.txt2, cursor: caseIsClosed ? 'default' : 'pointer', userSelect: 'none', fontWeight: q.followUp ? 600 : 400 }}>
                <input type="checkbox" checked={!!q.followUp} disabled={caseIsClosed}
                  onChange={e => setQuestion(i, { followUp: e.target.checked ? { condition: '', text: '' } : undefined })}
                  style={{ accentColor: C.earthy }} />
                Follow-up: ask a second question only when the answer matches a condition
              </label>
            </div>
            {q.followUp && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, marginLeft: 24 }}>
                <label style={{ fontSize: 12, color: C.txt3 }}>
                  Ask the follow-up only if...
                  <input type="text" value={q.followUp.condition} disabled={caseIsClosed}
                    placeholder={'e.g. they say yes'}
                    onChange={e => setQuestion(i, { followUp: { condition: e.target.value, text: q.followUp?.text ?? '' } })}
                    style={{ ...fieldStyle(!q.followUp.condition.trim()), marginTop: 4 }} />
                </label>
                <label style={{ fontSize: 12, color: C.txt3 }}>
                  Follow-up question
                  <textarea value={q.followUp.text} rows={2} disabled={caseIsClosed}
                    onChange={e => setQuestion(i, { followUp: { condition: q.followUp?.condition ?? '', text: e.target.value } })}
                    style={{ ...fieldStyle(!q.followUp.text.trim()), resize: 'vertical', lineHeight: 1.45, marginTop: 4 }} />
                </label>
              </div>
            )}
          </div>
        ))}
      </div>
      {message && (
        <p style={{ fontSize: 13.5, fontWeight: 600, color: message.kind === 'error' ? C.error : C.ok, margin: '12px 0 0' }}>{message.text}</p>
      )}
      {!caseIsClosed && (
        <div className="fx-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <button type="button" disabled={pending} onClick={() => edit(prev => [...prev, { text: '' }])} style={btn(pending)}>
            Add question
          </button>
          <button type="button" disabled={pending || !dirty || incompleteFollowUp} onClick={save} style={primaryBtn(pending || !dirty || incompleteFollowUp)}>
            {pending ? 'Saving...' : 'Save questions'}
          </button>
          {incompleteFollowUp && (
            <span style={{ fontSize: 12.5, color: C.warn }}>Fill in each follow-up&apos;s condition and question to save.</span>
          )}
          {!regenConfirming ? (
            <button type="button" disabled={pending} onClick={() => setRegenConfirming(true)} style={{ ...btn(pending), marginLeft: 'auto' }}>
              Regenerate from standards
            </button>
          ) : (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
              <span style={{ fontSize: 13, color: C.txt2 }}>Rebuilds from the settings Questions List and this deal&apos;s standards (no OCR rerun), replacing the whole list, edits included.</span>
              <button type="button" disabled={pending} onClick={regenerate} style={{ ...btn(pending), color: C.error }}>
                {pending ? 'Regenerating...' : 'Confirm regenerate'}
              </button>
              <button type="button" onClick={() => setRegenConfirming(false)} style={btn()}>Cancel</button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const btn = (disabled = false): React.CSSProperties => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 })
const primaryBtn = (disabled = false): React.CSSProperties => ({ padding: '8px 20px', background: C.earthy, color: C.onDark, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 })
const tinyBtn = (disabled: boolean): React.CSSProperties => ({ padding: '2px 8px', background: C.surface, color: C.txt2, fontSize: 12, borderRadius: 6, border: `1px solid ${C.border}`, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1 })
