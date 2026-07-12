'use client'

import { useActionState } from 'react'
import { C } from '@/lib/theme'
import { saveNotificationEmails, type NotifyEmailsState } from './actions'

/**
 * New-submission alert recipients. Comma-separated; empty resets to the
 * built-in default recipient.
 */
export default function NotificationEmails({ current, fallback }: { current: string; fallback: string }) {
  const [state, formAction, pending] = useActionState<NotifyEmailsState, FormData>(saveNotificationEmails, {})

  return (
    <form action={formAction} style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <input
        name="emails"
        defaultValue={current}
        placeholder={fallback}
        style={{
          padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`,
          borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box',
        }}
      />
      {state.error && <p style={{ color: C.error, fontSize: 13, margin: 0, fontFamily: C.sans }}>{state.error}</p>}
      {state.ok && !pending && <p style={{ color: C.success, fontSize: 13, margin: 0, fontFamily: C.sans }}>Saved.</p>}
      <div>
        <button type="submit" disabled={pending} style={{
          padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600,
          fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer',
          opacity: pending ? 0.6 : 1,
        }}>
          {pending ? 'Saving…' : 'Save recipients'}
        </button>
      </div>
    </form>
  )
}
