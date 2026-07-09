'use client'

import { useState, useEffect, useActionState } from 'react'
import { createOrg, type CreateOrgState } from '../actions'
import { C } from '@/lib/theme'

/**
 * "New Org" button + modal: create a customer org, then invite users into it.
 * The dialog is remounted (key) on every open so a previous creation's
 * success screen never masks the blank form.
 */
export default function CreateOrgModal() {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState(0)

  return (
    <>
      <button onClick={() => { setSession(s => s + 1); setOpen(true) }} style={ghostBtn}>New Org</button>
      {open && <CreateOrgDialog key={session} onClose={() => setOpen(false)} />}
    </>
  )
}

function CreateOrgDialog({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState<CreateOrgState, FormData>(createOrg, {})

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={overlay}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontFamily: C.serif, fontSize: 22, fontWeight: 400, color: C.txt, margin: 0 }}>New org</h2>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>×</button>
        </div>

        {state.ok ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13.5, color: C.txt2, fontFamily: C.sans, margin: 0 }}>
              Org created. Use Invite User to add its first member.
            </p>
            <button type="button" onClick={onClose} style={{ ...primaryBtn, alignSelf: 'flex-start' }}>Done</button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 13.5, color: C.txt2, fontFamily: C.sans, margin: '0 0 20px' }}>
              Create a customer organization. You can invite members right after.
            </p>
            <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={lbl}>Org name
                <input name="name" required placeholder="e.g. Dakota Financial" style={input} />
              </label>

              {state.error && <p style={{ color: C.error, fontSize: 13, margin: 0, fontFamily: C.sans }}>{state.error}</p>}

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button type="submit" disabled={pending} style={{ ...primaryBtn, opacity: pending ? 0.6 : 1 }}>
                  {pending ? 'Creating…' : 'Create org'}
                </button>
                <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

const primaryBtn = { padding: '10px 20px', background: C.earthy, color: C.onDark, fontSize: 14, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer' }
const ghostBtn = { padding: '10px 18px', background: 'transparent', color: C.txt2, fontSize: 14, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`, cursor: 'pointer' }
const closeBtn = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.paper, border: 'none', color: C.txt3, fontSize: 20, cursor: 'pointer', borderRadius: 9999, lineHeight: 1 }
const overlay = { position: 'fixed' as const, inset: 0, background: 'rgba(20,20,19,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: '0 25px 50px -12px rgba(20,20,19,0.25)' }
const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 6, fontSize: 13, fontWeight: 600 as const, color: C.txt2, fontFamily: C.sans }
const input = { padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt }
