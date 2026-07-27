'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { saveNotificationEmails } from './actions'

/**
 * New-submission alert recipients: one row per address, added via the input
 * above. Every add/remove persists the full list immediately (stored
 * comma-joined in app_config; an empty list falls back to the built-in
 * default recipient at read time).
 */
export default function NotificationEmails({ current }: { current: string }) {
  const [emails, setEmails] = useState(() => current.split(',').map(e => e.trim()).filter(Boolean))
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function persist(next: string[], onOk?: () => void) {
    setError('')
    const fd = new FormData()
    fd.set('emails', next.join(', '))
    startTransition(async () => {
      const res = await saveNotificationEmails({}, fd)
      if (res.error) setError(res.error)
      else {
        setEmails(next)
        onOk?.()
      }
    })
  }

  function add(e: React.FormEvent) {
    e.preventDefault()
    const v = draft.trim()
    if (!v) return
    if (emails.includes(v)) { setDraft(''); return }
    persist([...emails, v], () => setDraft(''))
  }

  return (
    <div style={{
      marginTop: 10, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: C.sans,
    }}>
      <form onSubmit={add} style={{ display: 'flex', gap: 10 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          type="email"
          style={{
            flex: 1, padding: '9px 11px', fontSize: 14, fontFamily: C.sans,
            border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none',
            background: C.surface, color: C.txt, boxSizing: 'border-box',
          }}
        />
        <button type="submit" disabled={pending} style={{
          padding: '7px 16px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600,
          fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer',
          opacity: pending ? 0.6 : 1,
        }}>
          {pending ? 'Saving…' : 'Add'}
        </button>
      </form>

      {error && <p style={{ color: C.error, fontSize: 13, margin: 0 }}>{error}</p>}

      {emails.map(email => (
        <div key={email} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 7,
        }}>
          <span style={{ fontSize: 14, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</span>
          <button
            type="button"
            aria-label={`Remove ${email}`}
            disabled={pending}
            onClick={() => persist(emails.filter(e => e !== email))}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px',
              color: C.txt2, fontSize: 18, lineHeight: 1, opacity: pending ? 0.5 : 1,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
