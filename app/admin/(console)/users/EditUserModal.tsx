'use client'

import { useState, useEffect, useActionState } from 'react'
import { grantAccess, deleteUser, type GrantState, type DeleteUserState } from '../actions'
import { C } from '@/lib/theme'

/**
 * "Edit User" button + modal: assign a registered user to an org, or delete
 * the account. Admin accounts can never be deleted here (the server action
 * enforces it too). The dialog is remounted (key) on every open so a stale
 * ok-state from a previous save can't instantly re-close it.
 */
export default function EditUserModal({
  users,
  orgs,
}: {
  users: { id: string; email: string; isAdmin: boolean }[]
  orgs: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState(0)

  return (
    <>
      <button onClick={() => { setSession(s => s + 1); setOpen(true) }} style={primaryBtn}>Edit User</button>
      {open && <EditUserDialog key={session} users={users} orgs={orgs} onClose={() => setOpen(false)} />}
    </>
  )
}

function EditUserDialog({ users, orgs, onClose }: {
  users: { id: string; email: string; isAdmin: boolean }[]
  orgs: { id: string; name: string }[]
  onClose: () => void
}) {
  const [selectedId, setSelectedId] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [state, formAction, pending] = useActionState<GrantState, FormData>(grantAccess, {})
  const [delState, delAction, delPending] = useActionState<DeleteUserState, FormData>(deleteUser, {})

  const selected = users.find(u => u.id === selectedId)

  // Close the modal once a save or delete succeeds (the table revalidates behind it).
  useEffect(() => { if (state.ok || delState.ok) onClose() }, [state.ok, delState.ok, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={overlay}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontFamily: C.serif, fontSize: 22, fontWeight: 400, color: C.txt, margin: 0 }}>Edit user</h2>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>×</button>
        </div>
        <p style={{ fontSize: 13.5, color: C.txt2, fontFamily: C.sans, margin: '0 0 20px' }}>
          Assign a registered user to an organization, or delete the account.
        </p>

        <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={lbl}>User
            <select
              name="profile_id" required value={selectedId}
              onChange={e => { setSelectedId(e.target.value); setConfirmDelete(false) }}
              style={input}
            >
              <option value="" disabled>Select a user…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
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
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
          </div>
        </form>

        {/* Delete: only for a selected, non-admin user; two clicks to confirm. */}
        {selected && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            {selected.isAdmin ? (
              <p style={{ fontSize: 12.5, color: C.txt3, fontFamily: C.sans, margin: 0 }}>
                Admin accounts cannot be deleted.
              </p>
            ) : (
              <form action={delAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input type="hidden" name="profile_id" value={selected.id} />
                {delState.error && <p style={{ color: C.error, fontSize: 13, margin: 0, fontFamily: C.sans }}>{delState.error}</p>}
                {confirmDelete ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button type="submit" disabled={delPending} style={{ ...dangerBtn, opacity: delPending ? 0.6 : 1 }}>
                      {delPending ? 'Deleting…' : `Yes, delete ${selected.email}`}
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)} style={ghostBtn}>Keep user</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    style={{ ...ghostBtn, color: C.error, alignSelf: 'flex-start' }}
                  >
                    Delete user…
                  </button>
                )}
                <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, margin: 0 }}>
                  Removes their sign-in and profile. The org&apos;s verifications are kept.
                </p>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const primaryBtn = { padding: '10px 20px', background: C.earthy, color: C.onDark, fontSize: 14, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer' }
const ghostBtn = { padding: '10px 18px', background: 'transparent', color: C.txt2, fontSize: 14, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`, cursor: 'pointer' }
const dangerBtn = { padding: '10px 18px', background: C.error, color: '#ffffff', fontSize: 14, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer' }
const closeBtn = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.paper, border: 'none', color: C.txt3, fontSize: 20, cursor: 'pointer', borderRadius: 9999, lineHeight: 1 }
const overlay = { position: 'fixed' as const, inset: 0, background: 'rgba(20,20,19,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 25px 50px -12px rgba(20,20,19,0.25)' }
const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 6, fontSize: 13, fontWeight: 600 as const, color: C.txt2, fontFamily: C.sans }
const input = { padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt }
