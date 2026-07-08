'use client'

import { useState, useEffect, useActionState } from 'react'
import { inviteUser, type InviteUserState } from '../actions'
import { C } from '@/lib/theme'

/** "Invite User" button + modal: email an invite and assign the org in one step. */
export default function InviteUserModal({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [state, formAction, pending] = useActionState<InviteUserState, FormData>(inviteUser, {})

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button onClick={() => setOpen(true)} style={primaryBtn}>Invite User</button>

      {open && (
        <div onClick={e => { if (e.target === e.currentTarget) setOpen(false) }} style={overlay}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={{ fontFamily: C.serif, fontSize: 22, fontWeight: 400, color: C.txt, margin: 0 }}>Invite user</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" style={closeBtn}>×</button>
            </div>

            {state.ok ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ fontSize: 13.5, color: C.txt2, fontFamily: C.sans, margin: 0 }}>
                  Invitation sent. If the email does not arrive, hand them this one-time sign-in link:
                </p>
                {state.signinLink && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <code style={{
                      flex: 1, fontSize: 11, fontFamily: C.mono, color: C.txt2, background: C.paper,
                      border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {state.signinLink}
                    </code>
                    <button
                      type="button"
                      onClick={async () => { await navigator.clipboard.writeText(state.signinLink!); setCopied(true) }}
                      style={ghostBtn}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}
                <button type="button" onClick={() => setOpen(false)} style={{ ...primaryBtn, alignSelf: 'flex-start' }}>Done</button>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 13.5, color: C.txt2, fontFamily: C.sans, margin: '0 0 20px' }}>
                  Send an email invite and assign the new user to an organization.
                </p>
                <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <label style={lbl}>Email
                    <input name="email" type="email" required placeholder="user@company.com" style={input} />
                  </label>
                  <label style={lbl}>Org
                    <select name="org_id" required defaultValue="" style={input}>
                      <option value="" disabled>Select an org…</option>
                      {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </label>

                  {state.error && <p style={{ color: C.error, fontSize: 13, margin: 0, fontFamily: C.sans }}>{state.error}</p>}

                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button type="submit" disabled={pending} style={{ ...primaryBtn, opacity: pending ? 0.6 : 1 }}>
                      {pending ? 'Inviting…' : 'Send invite'}
                    </button>
                    <button type="button" onClick={() => setOpen(false)} style={ghostBtn}>Cancel</button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const primaryBtn = { padding: '10px 20px', background: C.earthy, color: C.onDark, fontSize: 14, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer' }
const ghostBtn = { padding: '10px 18px', background: 'transparent', color: C.txt2, fontSize: 14, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`, cursor: 'pointer' }
const closeBtn = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.paper, border: 'none', color: C.txt3, fontSize: 20, cursor: 'pointer', borderRadius: 9999, lineHeight: 1 }
const overlay = { position: 'fixed' as const, inset: 0, background: 'rgba(20,20,19,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: '0 25px 50px -12px rgba(20,20,19,0.25)' }
const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 6, fontSize: 13, fontWeight: 600 as const, color: C.txt2, fontFamily: C.sans }
const input = { padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt }
