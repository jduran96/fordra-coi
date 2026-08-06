'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { C } from '@/lib/theme'
import type { EmailAccountPublic } from '@/lib/email-shared'
import RichTextInput from '@/components/RichTextInput'
import { approveAndSendEmail, saveEmailDraft } from './emails/actions'

/**
 * The Emails-tab Draft section: the exact email an admin approves before
 * anything sends. Prefilled server-side from the org+standard draft template
 * (settings → Emails → Drafts) with per-deal tokens substituted, recipient
 * from the saved insurer contact or the COI; everything stays editable here.
 * Send validation is a courtesy copy of the server gate in emails/actions.ts.
 */

export interface EmailDraftDefaults {
  to: string
  cc: string
  subject: string
  body: string
  attachmentIds: string[]
}

interface Props {
  verificationId: string
  account: EmailAccountPublic | null
  defaults: EmailDraftDefaults
  attachmentOptions: { document_id: string; file_name: string }[]
  /** The {tokens} usable in this deal's subject/body: the standard's per-deal
   *  variables plus the always-available ones (org name). Typed tokens
   *  substitute server-side at send. */
  tokens: string[]
  caseIsClosed: boolean
}

export default function EmailDraftCard({ verificationId, account, defaults, attachmentOptions, tokens, caseIsClosed }: Props) {
  const [to, setTo] = useState(defaults.to)
  const [cc, setCc] = useState(defaults.cc)
  const [subject, setSubject] = useState(defaults.subject)
  const [body, setBody] = useState(defaults.body)
  const [attachmentIds, setAttachmentIds] = useState<string[]>(defaults.attachmentIds)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const disabled = caseIsClosed || !account || account.status === 'error' || pending

  const formData = () => {
    const fd = new FormData()
    fd.set('to', to)
    fd.set('cc', cc)
    fd.set('subject', subject)
    fd.set('body', body)
    fd.set('attachments_json', JSON.stringify(attachmentIds))
    return fd
  }

  const save = () => {
    setMessage(null)
    startTransition(async () => {
      const res = await saveEmailDraft(verificationId, formData())
      if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
      else setMessage({ kind: 'ok', text: 'Draft saved.' })
    })
  }

  const send = () => {
    const recipients = to.split(',').map(e => e.trim()).filter(Boolean)
    if (!recipients.length) {
      setMessage({ kind: 'error', text: 'Add at least one recipient.' })
      return
    }
    if (!window.confirm(`Send this email to ${recipients.join(', ')}?`)) return
    setMessage(null)
    startTransition(async () => {
      const res = await approveAndSendEmail(verificationId, formData())
      if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
      else setMessage({ kind: 'ok', text: 'Sent. The thread appears below.' })
    })
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {caseIsClosed && (
        <p style={{ fontSize: 13, color: C.txt3, margin: 0 }}>
          This case is closed. Click Edit Status to reopen it before sending emails.
        </p>
      )}
      {!account ? (
        <p style={{ fontSize: 13, color: C.txt2, margin: 0 }}>
          No mailbox is connected for this org yet. Connect one under{' '}
          <Link href="/admin/settings?tab=emails" style={{ color: C.txt, fontWeight: 600 }}>Settings, Emails</Link> to send verification emails.
        </p>
      ) : (
        <>
          {tokens.length > 0 && (
            <div>
              <p style={{ ...fieldLabel, margin: '0 0 6px' }}>Variables</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {tokens.map(t => (
                  <code key={t} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, background: C.paper, padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.border}`, color: C.txt }}>
                    {`{${t}}`}
                  </code>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 14, rowGap: 8, alignItems: 'center' }}>
            <span style={fieldLabel}>From</span>
            <span style={{ fontSize: 13.5, color: account.status === 'error' ? C.error : C.txt }}>
              {account.email_address}
              {account.status === 'error' && ' (needs reconnecting in Settings, Emails)'}
            </span>
            <label style={fieldLabel} htmlFor="email-to">To</label>
            <input id="email-to" type="text" value={to} placeholder="agent@insurer.com, another@insurer.com"
              onChange={e => { setMessage(null); setTo(e.target.value) }} disabled={disabled} style={inputStyle} />
            <label style={fieldLabel} htmlFor="email-cc">Cc</label>
            <input id="email-cc" type="text" value={cc} placeholder="Optional, comma-separated"
              onChange={e => { setMessage(null); setCc(e.target.value) }} disabled={disabled} style={inputStyle} />
            <label style={fieldLabel} htmlFor="email-subject">Subject</label>
            <input id="email-subject" type="text" value={subject}
              onChange={e => { setMessage(null); setSubject(e.target.value) }} disabled={disabled} style={inputStyle} />
          </div>
          <RichTextInput name="body" value={body} onChange={html => { setMessage(null); setBody(html) }} />
          {attachmentOptions.length > 0 && (
            <div>
              <p style={{ ...fieldLabel, margin: '0 0 6px' }}>Attachments</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {attachmentOptions.map(d => (
                  <label key={d.document_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.txt2, cursor: disabled ? 'default' : 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={attachmentIds.includes(d.document_id)}
                      disabled={disabled}
                      onChange={e => {
                        setMessage(null)
                        setAttachmentIds(prev => e.target.checked
                          ? [...prev, d.document_id]
                          : prev.filter(x => x !== d.document_id))
                      }}
                      style={{ accentColor: C.txt2 }}
                    />
                    {d.file_name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={save} disabled={disabled} style={btnStyle(pending)}>
              {pending ? 'Working...' : 'Save draft'}
            </button>
            <button type="button" onClick={send} disabled={disabled}
              style={{ ...btnStyle(pending), background: C.earthy, color: C.onDark, border: 'none' }}>
              {pending ? 'Working...' : 'Approve and send'}
            </button>
            {message && (
              <span style={{ fontSize: 13, fontWeight: 600, color: message.kind === 'error' ? C.error : C.ok }}>{message.text}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.txt3 }
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: C.sans, color: C.txt, background: C.surface, borderRadius: 7, border: `1px solid ${C.border}` }
const btnStyle = (pending: boolean): React.CSSProperties => ({ padding: '8px 18px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1 })
