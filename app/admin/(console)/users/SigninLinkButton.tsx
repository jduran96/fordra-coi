'use client'

import { useState, useEffect, useTransition } from 'react'
import { mintSigninLink } from '../actions'
import { C } from '@/lib/theme'

/**
 * Per-user "Invite link" button in the users table: mints a fresh one-time
 * sign-in link (magic-link token_hash) and shows it in a pop-up to copy.
 * For re-inviting someone whose original invite link expired.
 */
export default function SigninLinkButton({ email }: { email: string }) {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  function mint() {
    setOpen(true)
    setLink(''); setError(''); setCopied(false)
    startTransition(async () => {
      const res = await mintSigninLink(email)
      if (res.error) setError(res.error)
      else setLink(res.signinLink ?? '')
    })
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button type="button" onClick={mint} title={`Mint a fresh one-time sign-in link for ${email}`} style={smallBtn}>
        Invite link
      </button>

      {open && (
        <div onClick={e => { if (e.target === e.currentTarget) setOpen(false) }} style={overlay}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={{ fontFamily: C.serif, fontSize: 22, fontWeight: 400, color: C.txt, margin: 0 }}>Sign-in link</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" style={closeBtn}>×</button>
            </div>
            <p style={{ fontSize: 13.5, color: C.txt2, fontFamily: C.sans, margin: '0 0 16px' }}>
              Fresh one-time sign-in link for <strong>{email}</strong>. It expires per the auth
              settings and dies once clicked, so send it straight to them.
            </p>

            {pending && <p style={{ fontSize: 13, color: C.txt3, fontFamily: C.sans, margin: 0 }}>Generating…</p>}
            {error && <p style={{ color: C.error, fontSize: 13, margin: 0, fontFamily: C.sans }}>{error}</p>}
            {link && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{
                  flex: 1, fontSize: 11, fontFamily: C.mono, color: C.txt2, background: C.paper,
                  border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {link}
                </code>
                <button
                  type="button"
                  onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true) }}
                  style={ghostBtn}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const smallBtn = {
  fontFamily: C.sans, fontSize: 12, padding: '6px 12px', borderRadius: 999,
  border: `1px solid ${C.border}`, background: C.surface, color: C.txt, cursor: 'pointer' as const,
}
const ghostBtn = { padding: '10px 18px', background: 'transparent', color: C.txt2, fontSize: 14, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`, cursor: 'pointer' }
const closeBtn = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.paper, border: 'none', color: C.txt3, fontSize: 20, cursor: 'pointer', borderRadius: 9999, lineHeight: 1 }
const overlay = { position: 'fixed' as const, inset: 0, background: 'rgba(20,20,19,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, boxShadow: '0 25px 50px -12px rgba(20,20,19,0.25)' }
