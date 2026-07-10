'use client'

import { Suspense, useState, FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { C } from '@/lib/theme'

/**
 * Admin console sign-in: magic link only, separate from the customer /login
 * (which also offers password sign-in). The callback routes admins to /admin.
 */
function AdminLoginForm() {
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || ''
  const expired = searchParams.get('expired') === '1'
  const linkError = searchParams.get('error') === 'link'
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
      // Keep the redirect URL query-free: the email template appends
      // ?token_hash=...&type=magiclink to it. `next` rides in a short-lived
      // cookie the callback reads instead.
      document.cookie = next
        ? `login-next=${encodeURIComponent(next)}; path=/; max-age=3600; samesite=lax`
        : 'login-next=; path=/; max-age=0'
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/link`, shouldCreateUser: false },
      })
      if (error) {
        setError(/signup|not allowed|not found/i.test(error.message)
          ? 'No account found for that email.'
          : error.message)
      } else setSent(true)
    } catch {
      setError('Unexpected sign-in error. Please contact a Fordra admin for help.')
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
      {linkError && (
        <p style={{ fontSize: 13, color: C.error, margin: 0, fontFamily: C.sans, lineHeight: 1.5 }}>
          That sign-in link didn&rsquo;t work. It may have expired or already been used, and only
          the most recently requested link is valid. Enter your email for a fresh one.
        </p>
      )}
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@fordra.com"
        autoComplete="email"
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

export default function AdminLoginPage() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.paper, padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 380, background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 16, padding: '40px 36px', boxShadow: '0 4px 24px oklch(0% 0 0 / 0.06)',
      }}>
        <p style={{ fontFamily: C.serif, fontSize: 26, letterSpacing: '-0.5px', color: C.txt, margin: '0 0 6px' }}>
          Fordra
        </p>
        <p style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: C.txt3, fontFamily: C.sans, margin: '0 0 28px',
        }}>
          Admin console
        </p>
        <Suspense>
          <AdminLoginForm />
        </Suspense>
      </div>
    </div>
  )
}
