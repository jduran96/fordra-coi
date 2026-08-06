'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import type { EmailAccountPublic } from '@/lib/email-shared'
import { deleteEmailAccount } from './actions'

/**
 * Per-org sending mailboxes (settings → Emails → Accounts): one connected
 * mailbox per org; Connect Gmail runs the OAuth flow (the /api/admin/
 * email-oauth routes), reconnecting replaces the stored credential. The
 * component only ever sees EmailAccountPublic — token columns never leave the
 * server.
 */
export default function EmailAccountsCard({ orgs, accounts }: {
  orgs: { id: string; name: string }[]
  accounts: EmailAccountPublic[]
}) {
  const byOrg = new Map(accounts.map(a => [a.org_id, a]))
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const disconnect = (orgId: string) => {
    setConfirming(null)
    startTransition(async () => {
      const res = await deleteEmailAccount(orgId)
      setMessage(res.error ?? null)
    })
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {orgs.map(o => {
        const account = byOrg.get(o.id)
        return (
          <div key={o.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', border: `1px solid ${C.border}`, borderRadius: 9, padding: '10px 12px', background: C.paper }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, margin: 0, color: C.txt }}>{o.name}</p>
              {account ? (
                <p style={{ fontSize: 12.5, margin: '2px 0 0', color: account.status === 'error' ? C.error : C.txt2 }}>
                  {account.email_address}
                  {account.status === 'error'
                    ? ` (needs reconnecting${account.error ? `: ${account.error}` : ''})`
                    : ` (connected by ${account.connected_by})`}
                </p>
              ) : (
                <p style={{ fontSize: 12.5, margin: '2px 0 0', color: C.txt3 }}>No mailbox connected</p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <a
                href={`/api/admin/email-oauth/google/start?org_id=${o.id}`}
                style={{ padding: '6px 12px', background: C.surface, color: C.txt, fontSize: 12.5, fontWeight: 600, fontFamily: C.sans, borderRadius: 999, border: `1px solid ${C.borderStrong}`, textDecoration: 'none', whiteSpace: 'nowrap' }}
              >
                {account ? 'Reconnect Gmail' : 'Connect Gmail'}
              </a>
              {account && (confirming === o.id ? (
                <button type="button" disabled={pending} onClick={() => disconnect(o.id)}
                  style={{ ...pillBtn(pending), color: C.error, borderColor: C.error }}>
                  Sure?
                </button>
              ) : (
                <button type="button" disabled={pending} onClick={() => { setMessage(null); setConfirming(o.id) }}
                  style={{ ...pillBtn(pending), color: C.txt3 }}>
                  Disconnect
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {message && <p style={{ fontSize: 13, fontWeight: 600, color: C.error, margin: 0 }}>{message}</p>}
      <p style={{ fontSize: 12.5, color: C.txt3, margin: 0, lineHeight: 1.6 }}>
        Verification emails send from the connected mailbox and replies are read from it.
        Microsoft 365 mailboxes are not supported yet.
      </p>
    </div>
  )
}

const pillBtn = (pending: boolean): React.CSSProperties => ({ padding: '6px 12px', background: C.surface, fontSize: 12.5, fontWeight: 600, fontFamily: C.sans, borderRadius: 999, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1, whiteSpace: 'nowrap' })
