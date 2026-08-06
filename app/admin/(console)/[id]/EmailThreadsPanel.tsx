'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { pacificDateTime } from '@/lib/dates'
import EditorModal from '@/components/EditorModal'
import {
  parseEmailList, stripQuotedReply, threadAwaitingReply, threadStatusLabel,
  type EmailMessage, type EmailThread,
} from '@/lib/email-shared'
import { logEmailThreadToContactLog, refreshEmailThread, refreshVerificationEmails, sendEmailReply } from './emails/actions'

/**
 * The Emails-tab Threads section: every sent (or failed) outreach thread,
 * each viewable in a modal with the full message history, a reply composer,
 * and add-to-contact-log — the email mirror of AiCallLauncher. Replies are
 * pulled on demand only (Refresh buttons + an auto-refresh when a thread
 * opens); the amber marker means the latest message is inbound and no one
 * has answered it yet.
 */

interface Props {
  verificationId: string
  /** Sent/approved/failed threads (no drafts), newest first, from the server render. */
  threads: EmailThread[]
  messagesByThread: Record<string, EmailMessage[]>
  caseIsClosed: boolean
}

type ModalState = null | { threadId: string }

export default function EmailThreadsPanel({ verificationId, threads, messagesByThread, caseIsClosed }: Props) {
  const [modal, setModal] = useState<ModalState>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const refreshAll = () => {
    setMessage(null)
    startTransition(async () => {
      const res = await refreshVerificationEmails(verificationId)
      setMessage(res && 'error' in res && res.error ? res.error : 'Threads refreshed.')
    })
  }

  const logThread = (threadId: string) => {
    setMessage(null)
    startTransition(async () => {
      const fd = new FormData()
      const res = await logEmailThreadToContactLog(verificationId, threadId, fd)
      setMessage(res && 'error' in res && res.error ? res.error : 'Added to the contact log.')
    })
  }

  if (!threads.length) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <p style={{ fontSize: 13, color: C.txt3, margin: 0 }}>No emails sent yet.</p>
      </div>
    )
  }

  const openThread = modal ? threads.find(t => t.id === modal.threadId) ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="fx-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={refreshAll} disabled={pending} style={pillBtn(pending)}>
          {pending ? 'Working...' : 'Refresh replies'}
        </button>
        {message && <span style={{ fontSize: 12.5, fontWeight: 600, color: message.endsWith('.') && !message.startsWith('Could') ? C.txt3 : C.error }}>{message}</span>}
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <table className="fx-only-desktop" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: C.sans }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <th style={th}>When</th><th style={th}>To</th><th style={th}>Subject</th>
              <th style={th}>Messages</th><th style={th}>Status</th><th style={th}>Log</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {threads.map(t => (
              <tr key={t.id} style={{ borderTop: `1px solid ${C.border}` }}>
                {/* When may wrap to two lines; the To address must not. */}
                <td style={{ ...td, color: C.txt3 }}>{pacificDateTime(t.approved_at ?? t.created_at)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{parseEmailList(t.to_emails).join(', ') || '—'}</td>
                <td style={{ ...td, overflowWrap: 'anywhere' }}>{t.subject || '—'}</td>
                <td style={{ ...td, fontFamily: C.mono, color: C.txt3 }}>{t.message_count || '—'}</td>
                <td style={td}>
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <StatusPill thread={t} />
                    {threadAwaitingReply(t) && <ReplyMarker />}
                  </span>
                </td>
                <td style={td}>
                  {!caseIsClosed && t.status === 'sent' && (
                    <button type="button" disabled={pending} onClick={() => logThread(t.id)} style={pillBtn(pending)}>
                      {t.published_note_at ? 'Refresh' : 'Log'}
                    </button>
                  )}
                  {caseIsClosed && t.published_note_at && <span style={{ fontSize: 12, color: C.txt3 }}>Logged</span>}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button type="button" onClick={() => setModal({ threadId: t.id })} style={pillBtn(false)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="fx-only-mobile">
          {threads.map(t => (
            <button key={t.id} type="button" onClick={() => setModal({ threadId: t.id })}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px',
                background: 'transparent', border: 'none', borderTop: `1px solid ${C.border}`,
                fontFamily: C.sans, cursor: 'pointer',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <StatusPill thread={t} />
                {threadAwaitingReply(t) && <ReplyMarker />}
                <span style={{ marginLeft: 'auto', fontFamily: C.mono, fontSize: 12, color: C.txt3 }}>
                  {t.message_count > 0 ? `${t.message_count} msg${t.message_count === 1 ? '' : 's'}` : ''}
                </span>
              </div>
              <div style={{ fontSize: 13.5, color: C.txt, marginTop: 6, overflowWrap: 'anywhere' }}>{t.subject || '(no subject)'}</div>
              <div style={{ fontSize: 12.5, color: C.txt2, marginTop: 2, overflowWrap: 'anywhere' }}>{parseEmailList(t.to_emails).join(', ')}</div>
              <div style={{ fontSize: 12, color: C.txt3, marginTop: 2 }}>{pacificDateTime(t.approved_at ?? t.created_at)}</div>
            </button>
          ))}
        </div>
      </div>

      {openThread && (
        <EditorModal title="Email thread" onClose={() => setModal(null)} maxWidth={760}>
          {/* Keyed by id ONLY: syncs bump updated_at, and remounting on that
              would wipe a half-typed reply mid-refresh. Message updates flow
              through props; local state must survive them. */}
          <ThreadView
            key={openThread.id}
            verificationId={verificationId}
            thread={openThread}
            messages={messagesByThread[openThread.id] ?? []}
            caseIsClosed={caseIsClosed}
          />
        </EditorModal>
      )}
    </div>
  )
}

function StatusPill({ thread }: { thread: EmailThread }) {
  const color = thread.status === 'sent' ? C.ok
    : thread.status === 'failed' ? C.error
    : C.neutral
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color, background: `color-mix(in oklch, ${color} 12%, transparent)`, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      {threadStatusLabel(thread)}
    </span>
  )
}

/** The latest message is from the other side: someone needs to answer it. */
function ReplyMarker() {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.warn, background: `color-mix(in oklch, ${C.warn} 13%, transparent)`, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      Reply received
    </span>
  )
}

/**
 * The modal body for one thread: full message history (inbound messages
 * tinted), a reply composer, and add-to-contact-log at the bottom. Refreshes
 * the thread once on open so a just-arrived reply shows without hunting for
 * the Refresh button.
 */
function ThreadView({ verificationId, thread, messages, caseIsClosed }: {
  verificationId: string
  thread: EmailThread
  messages: EmailMessage[]
  caseIsClosed: boolean
}) {
  const [reply, setReply] = useState('')
  const [summary, setSummary] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  // Refresh runs on its OWN transition: a background inbox pull must never
  // disable the composer buttons or flip them to "Working".
  const [pending, startTransition] = useTransition()
  const [refreshing, startRefresh] = useTransition()
  // One auto-refresh per open (the modal unmounts on close, so reopening
  // pulls fresh again).
  const refreshedOnce = useRef(false)
  useEffect(() => {
    if (refreshedOnce.current || thread.status !== 'sent') return
    refreshedOnce.current = true
    startRefresh(async () => { await refreshEmailThread(verificationId, thread.id) })
  }, [verificationId, thread.id, thread.status])

  const refresh = () => {
    setMessage(null)
    startRefresh(async () => {
      const res = await refreshEmailThread(verificationId, thread.id)
      if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
    })
  }

  const send = () => {
    setMessage(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('body', reply)
      const res = await sendEmailReply(verificationId, thread.id, fd)
      if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
      else { setReply(''); setMessage({ kind: 'ok', text: 'Reply sent.' }) }
    })
  }

  const log = () => {
    setMessage(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('summary_html', summary)
      const res = await logEmailThreadToContactLog(verificationId, thread.id, fd)
      if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
      else setMessage({ kind: 'ok', text: thread.published_note_at ? 'Contact log entry updated.' : 'Added to the contact log.' })
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: C.sans }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.txt, overflowWrap: 'anywhere' }}>{thread.subject || '(no subject)'}</span>
        <span style={{ fontSize: 12.5, color: C.txt3 }}>{pacificDateTime(thread.approved_at ?? thread.created_at)}</span>
        {thread.status === 'sent' && (
          <button type="button" onClick={refresh} disabled={refreshing} style={{ ...pillBtn(refreshing), marginLeft: 'auto' }}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>
      {thread.error && <p style={{ fontSize: 13, color: C.error, margin: 0 }}>{thread.error}</p>}

      {messages.length === 0 ? (
        <p style={{ fontSize: 13, color: C.txt3, margin: 0 }}>
          {thread.status === 'sent' ? 'Loading the thread...' : 'This email never sent.'}
        </p>
      ) : (
        /* One card, newest message first, older ones stacked underneath.
           Each section shows only that message's NEW text (quoted history
           stripped) so nothing repeats. */
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 9, overflow: 'hidden' }}>
          {messages.slice().reverse().map((m, i) => (
            <div key={m.id} style={{
              padding: 12,
              borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
              background: m.direction === 'inbound' ? `color-mix(in oklch, ${C.lime} 7%, ${C.paper})` : C.paper,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, overflowWrap: 'anywhere' }}>
                  {m.direction === 'inbound'
                    ? (m.from_name ? `${m.from_name} (${m.from_email ?? ''})` : (m.from_email ?? 'Unknown sender'))
                    : `You (${m.from_email ?? ''})`}
                </span>
                <span style={{ fontSize: 12, color: C.txt3, whiteSpace: 'nowrap' }}>
                  {m.sent_at ? pacificDateTime(m.sent_at) : ''}
                </span>
              </div>
              <div style={{ fontSize: 13, color: C.txt, whiteSpace: 'pre-wrap', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                {stripQuotedReply(m.body_text ?? '') || '(no text)'}
              </div>
              {(m.attachments ?? []).length > 0 && (
                <p style={{ fontSize: 12, color: C.txt3, margin: '8px 0 0' }}>
                  Attachments: {(m.attachments ?? []).map(a => a.filename).join(', ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {!caseIsClosed && thread.status === 'sent' && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.txt3 }} htmlFor={`reply-${thread.id}`}>Reply</label>
          <textarea
            id={`reply-${thread.id}`}
            value={reply}
            rows={4}
            placeholder="Your reply sends from the connected mailbox and stays in this thread"
            onChange={e => { setMessage(null); setReply(e.target.value) }}
            style={inputStyle}
          />
          <div className="fx-actions" style={{ display: 'flex' }}>
            <button type="button" onClick={send} disabled={pending || !reply.trim()} style={pillBtn(pending || !reply.trim())}>
              {pending ? 'Working...' : 'Send reply'}
            </button>
          </div>
        </div>
      )}

      {!caseIsClosed && thread.status === 'sent' && messages.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.txt3 }} htmlFor={`summary-${thread.id}`}>
            Contact log summary (optional)
          </label>
          <textarea
            id={`summary-${thread.id}`}
            value={summary}
            rows={3}
            placeholder="A short write-up shown above the thread in the report"
            onChange={e => { setMessage(null); setSummary(e.target.value) }}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={log} disabled={pending} style={{ ...pillBtn(pending), background: C.earthy, color: C.onDark, border: 'none' }}>
              {pending ? 'Working...' : thread.published_note_at ? 'Refresh log' : 'Add to Contact Log'}
            </button>
            {thread.published_note_at && (
              <span style={{ fontSize: 12.5, color: C.txt3 }}>In contact log · {pacificDateTime(thread.published_note_at)}</span>
            )}
          </div>
        </div>
      )}

      {message && (
        <p style={{ fontSize: 13, fontWeight: 600, color: message.kind === 'error' ? C.error : C.ok, margin: 0 }}>{message.text}</p>
      )}
    </div>
  )
}

const th: React.CSSProperties = { padding: '10px 14px', fontWeight: 600 }
const td: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' }
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: C.sans, color: C.txt, background: C.surface, borderRadius: 7, border: `1px solid ${C.border}` }
const pillBtn = (disabled: boolean): React.CSSProperties => ({ padding: '5px 14px', fontSize: 12.5, fontWeight: 600, fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`, background: 'transparent', color: C.txt2, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.65 : 1 })
