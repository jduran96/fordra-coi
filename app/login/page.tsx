'use client'

import { Suspense, useState, FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { C } from '@/lib/theme'

function LoginForm() {
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || ''
  const expired = searchParams.get('expired') === '1'
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email) return
    setError('')
    setLoading(true)
    try {
      const supabase = createClient()
      const redirectTo = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      })
      if (error) setError(error.message)
      else setSent(true)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <p style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, lineHeight: 1.6, margin: 0 }}>
        Check <strong style={{ color: C.txt }}>{email}</strong> for a sign-in link. You can close
        this tab once you click it.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {expired && (
        <p style={{ fontSize: 13, color: C.txt2, margin: 0, fontFamily: C.sans, lineHeight: 1.5 }}>
          Your session expired after 24 hours. Sign in again to continue.
        </p>
      )}
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@company.com"
        autoFocus
        required
        style={{
          width: '100%', padding: '11px 14px', fontSize: 15, fontFamily: C.sans,
          border: `1px solid ${error ? C.error : C.border}`, borderRadius: 8, outline: 'none',
          background: C.paper, color: C.txt, boxSizing: 'border-box',
        }}
      />
      {error && <p style={{ fontSize: 13, color: C.error, margin: 0, fontFamily: C.sans }}>{error}</p>}
      <button
        type="submit"
        disabled={!email || loading}
        style={{
          width: '100%', padding: 12, background: email ? C.earthy : C.border,
          color: email ? C.onDark : C.txt3, fontSize: 14, fontWeight: 600,
          fontFamily: C.sans, borderRadius: 9999, border: 'none',
          cursor: email && !loading ? 'pointer' : 'not-allowed',
        }}
      >
        {loading ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.paper, padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 380, background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 16, padding: '40px 36px', boxShadow: '0 4px 24px oklch(0% 0 0 / 0.06)',
      }}>
        <p style={{ fontFamily: C.serif, fontSize: 26, letterSpacing: '-0.5px', color: C.txt, margin: '0 0 32px' }}>
          Fordra
        </p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
