'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { EMAIL_CONNECT_OPTIONS, EMAIL_PROVIDER_LABELS, type EmailAccountPublic } from '@/lib/email-shared'
import { deleteEmailAccount } from './actions'

/**
 * Per-org sending mailboxes (settings → Emails → Accounts): one connected
 * mailbox per org; each Connect button runs that provider's OAuth flow (the
 * /api/admin/email-oauth/[provider] routes), and reconnecting replaces the
 * stored credential, including across providers. The component only ever sees
 * EmailAccountPublic — token columns never leave the server.
 */
export default function EmailAccountsCard({ orgs, accounts }: {
  orgs: { id: string; name: string }[]
  accounts: EmailAccountPublic[]
}) {
  const byOrg = new Map(accounts.map(a => [a.org_id, a]))
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  // Connecting the OTHER provider replaces the org's mailbox, so that click
  // asks once ("Switch to Outlook?") before starting the OAuth flow.
  const [switching, setSwitching] = useState<string | null>(null)
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
                    : ` (${EMAIL_PROVIDER_LABELS[account.provider] ?? account.provider}, connected by ${account.connected_by})`}
                </p>
              ) : (
                <p style={{ fontSize: 12.5, margin: '2px 0 0', color: C.txt3 }}>No mailbox connected</p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {EMAIL_CONNECT_OPTIONS.map(opt => {
                const key = `${o.id}:${opt.segment}`
                const replaces = !!account && account.provider !== opt.provider
                const confirmingSwitch = switching === key
                const label = account?.provider === opt.provider
                  ? `Reconnect ${opt.label}`
                  : confirmingSwitch ? `Switch to ${opt.label}?` : `Connect ${opt.label}`
                return (
                  <a
                    key={opt.segment}
                    href={`/api/admin/email-oauth/${opt.segment}/start?org_id=${o.id}`}
                    onClick={e => {
                      if (replaces && !confirmingSwitch) {
                        e.preventDefault()
                        setMessage(null)
                        setSwitching(key)
                      }
                    }}
                    style={{ padding: '6px 12px', background: C.surface, color: confirmingSwitch ? C.error : C.txt, fontSize: 12.5, fontWeight: 600, fontFamily: C.sans, borderRadius: 999, border: `1px solid ${confirmingSwitch ? C.error : C.borderStrong}`, textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    {label}
                  </a>
                )
              })}
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
    </div>
  )
}

const pillBtn = (pending: boolean): React.CSSProperties => ({ padding: '6px 12px', background: C.surface, fontSize: 12.5, fontWeight: 600, fontFamily: C.sans, borderRadius: 999, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1, whiteSpace: 'nowrap' })
