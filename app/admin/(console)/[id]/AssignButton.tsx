'use client'

import { useEffect, useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { adminInitials } from '@/lib/admin-activity'

/**
 * Top-right Assign button on the detail page (replaced Log activity,
 * 2026-07-29): opens a popup listing the admin emails from the ADMIN_EMAIL
 * allowlist. The selection shows the current assignment, can be changed, and
 * takes effect only on Confirm. The queue's Admin column and the header
 * initials tag render from the saved assignment.
 */
export default function AssignButton({ assigned, admins, action, buttonStyle }: {
  /** Currently assigned admin email, '' when unassigned. */
  assigned: string
  /** Admin emails from the allowlist, the popup's options. */
  admins: string[]
  action: (formData: FormData) => Promise<{ error?: string } | void>
  /** Overrides the trigger pill's default look (header button row). */
  buttonStyle?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        title={assigned ? `Assigned to ${assigned}` : 'Assign this verification to an admin'}
        style={{
          fontSize: 12, fontWeight: 600, fontFamily: C.sans, color: C.txt2,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20,
          padding: '4px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
          ...buttonStyle,
        }}>
        Assign
      </button>
      {open && (
        <AssignDialog assigned={assigned} admins={admins} action={action} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function AssignDialog({ assigned, admins, action, onClose }: {
  assigned: string
  admins: string[]
  action: (formData: FormData) => Promise<{ error?: string } | void>
  onClose: () => void
}) {
  const [choice, setChoice] = useState(assigned)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function confirm() {
    setError('')
    const fd = new FormData()
    fd.set('assignee', choice)
    startTransition(async () => {
      const res = await action(fd)
      if (res && 'error' in res && res.error) { setError(res.error); return }
      onClose()
    })
  }

  return (
    <div className="fx-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }} style={overlay}>
      <div className="fx-modal-card" style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontFamily: C.serif, fontSize: 22, fontWeight: 400, color: C.txt, margin: 0 }}>Assign verification</h2>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>×</button>
        </div>
        <p style={{ fontSize: 13, color: C.txt3, fontFamily: C.sans, margin: '0 0 16px' }}>
          The assigned admin owns this verification. Takes effect on Confirm.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: C.sans }}>
          {admins.map(email => (
            <label key={email} style={{
              display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: C.txt,
              border: `1px solid ${choice === email ? C.txt : C.border}`, borderRadius: 9,
              padding: '10px 12px', cursor: 'pointer', background: choice === email ? C.paper : C.surface,
            }}>
              <input type="radio" name="assignee" value={email} checked={choice === email}
                onChange={() => { setChoice(email); setError('') }} style={{ accentColor: C.txt }} />
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: C.txt2,
                background: C.paper, border: `1px solid ${C.border}`, borderRadius: 4,
                padding: '1.5px 6px', width: 26, textAlign: 'center', flexShrink: 0,
              }}>
                {adminInitials(email)}
              </span>
              <span style={{ overflowWrap: 'anywhere' }}>{email}</span>
              {assigned === email && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: C.txt3, whiteSpace: 'nowrap' }}>current</span>}
            </label>
          ))}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: C.txt2,
            border: `1px solid ${choice === '' ? C.txt : C.border}`, borderRadius: 9,
            padding: '10px 12px', cursor: 'pointer', background: choice === '' ? C.paper : C.surface,
          }}>
            <input type="radio" name="assignee" value="" checked={choice === ''}
              onChange={() => { setChoice(''); setError('') }} style={{ accentColor: C.txt }} />
            Unassigned
          </label>
        </div>
        {error && <p style={{ fontSize: 12.5, color: C.error, fontFamily: C.sans, margin: '10px 0 0' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
          <button type="button" onClick={confirm} disabled={pending || choice === assigned}
            style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 600, fontFamily: C.sans,
              background: C.earthy, color: C.onDark, border: 'none', borderRadius: 9999,
              cursor: pending || choice === assigned ? 'default' : 'pointer',
              opacity: pending || choice === assigned ? 0.6 : 1,
            }}>
            {pending ? 'Assigning...' : 'Confirm'}
          </button>
          <button type="button" onClick={onClose} style={{
            padding: '8px 14px', background: 'transparent', color: C.txt2, fontSize: 13, fontWeight: 600,
            fontFamily: C.sans, borderRadius: 7, border: 'none', cursor: 'pointer',
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay = { position: 'fixed' as const, inset: 0, background: 'rgba(20,20,19,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 25px 50px -12px rgba(20,20,19,0.25)' }
const closeBtn = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.paper, border: 'none', color: C.txt3, fontSize: 20, cursor: 'pointer', borderRadius: 9999, lineHeight: 1 }
