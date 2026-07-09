'use client'

import { Suspense, useState, FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { C } from '@/lib/theme'

function LoginForm() {
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || ''
  const expired = searchParams.get('expired') === '1'
  const linkError = searchParams.get('error') === 'link'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<'password' | 'link' | null>(null)

  // Primary: email + password. Sign-in is invite-only, so there is no signup
  // form; users without a password use the email-link path below.
  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    setError('')
    setLoading('password')
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError('Wrong email or password. If you have not set a password yet, sign in with an email link below.')
        return
      }
      window.location.assign(`/auth/after-login${next ? `?next=${encodeURIComponent(next)}` : ''}`)
      return // keep the button in its loading state while the browser navigates
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(null)
    }
  }

  // Secondary: magic link. Also the recovery path for forgotten passwords
  // (sign in with a link, then set a new password in Settings).
  async function handleLinkSubmit() {
    if (!email) return
    setError('')
    setLoading('link')
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
        // Invite-only: a link never creates a brand-new account.
        options: { emailRedirectTo: `${window.location.origin}/auth/link`, shouldCreateUser: false },
      })
      if (error) {
        setError(/signup|not allowed|not found/i.test(error.message)
          ? 'No account found for that email. Contact a Fordra admin to get invited.'
          : error.message)
      } else setSent(true)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(null)
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

  const inputS = {
    width: '100%', padding: '11px 14px', fontSize: 15, fontFamily: C.sans,
    border: `1px solid ${error ? C.error : C.border}`, borderRadius: 8, outline: 'none',
    background: C.paper, color: C.txt, boxSizing: 'border-box' as const,
  }

  return (
    <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
        placeholder="you@company.com"
        autoComplete="email"
        autoFocus
        required
        style={inputS}
      />
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        style={inputS}
      />
      {error && <p style={{ fontSize: 13, color: C.error, margin: 0, fontFamily: C.sans, lineHeight: 1.5 }}>{error}</p>}
      <button
        type="submit"
        disabled={!email || !password || loading !== null}
        style={{
          width: '100%', padding: 12, background: email && password ? C.earthy : C.border,
          color: email && password ? C.onDark : C.txt3, fontSize: 14, fontWeight: 600,
          fontFamily: C.sans, borderRadius: 9999, border: 'none',
          cursor: email && password && !loading ? 'pointer' : 'not-allowed',
        }}
      >
        {loading === 'password' ? 'Signing in…' : 'Sign in'}
      </button>
      <button
        type="button"
        onClick={handleLinkSubmit}
        disabled={!email || loading !== null}
        style={{
          width: '100%', padding: 11, background: 'transparent',
          color: email ? C.txt2 : C.txt3, fontSize: 13.5, fontWeight: 600,
          fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`,
          cursor: email && !loading ? 'pointer' : 'not-allowed',
        }}
      >
        {loading === 'link' ? 'Sending…' : 'Email me a sign-in link instead'}
      </button>
      <p style={{ fontSize: 12.5, color: C.txt3, margin: '4px 0 0', fontFamily: C.sans, lineHeight: 1.5 }}>
        Forgot your password? Sign in with an email link, then set a new one in Settings.
      </p>
      <p style={{ fontSize: 12.5, color: C.txt3, margin: 0, fontFamily: C.sans, lineHeight: 1.5 }}>
        Need to create an account? Contact a Fordra admin.
      </p>
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
