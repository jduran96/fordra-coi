'use client'

import { Suspense, useState, FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import LogoMark from '@/components/LogoMark'
import { C } from '@/lib/theme'

function LoginForm() {
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || ''
  const expired = searchParams.get('expired') === '1'
  const linkError = searchParams.get('error') === 'link'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<'password' | 'link' | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkEmail, setLinkEmail] = useState('')
  const [popupError, setPopupError] = useState('')

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
        setError('Incorrect email or password. If you have not created a password yet, click "Email me a sign-in link" below.')
        return
      }
      window.location.assign(`/auth/after-login${next ? `?next=${encodeURIComponent(next)}` : ''}`)
      return // keep the button in its loading state while the browser navigates
    } catch {
      setError('Unexpected sign-in error. Please contact a Fordra admin for help.')
    } finally {
      setLoading(null)
    }
  }

  // Secondary: magic link, sent from the popup. Also the recovery path for
  // forgotten passwords (sign in with a link, then set a new one in Settings).
  async function handleLinkSubmit() {
    if (!linkEmail) return
    setPopupError('')
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
        email: linkEmail,
        // Invite-only: a link never creates a brand-new account.
        options: { emailRedirectTo: `${window.location.origin}/auth/link`, shouldCreateUser: false },
      })
      if (error) {
        setPopupError(/signup|not allowed|not found/i.test(error.message)
          ? 'No account found for that email. Contact a Fordra admin to get invited.'
          : error.message)
      } else {
        setSentTo(linkEmail)
        setSent(true)
        setLinkOpen(false)
      }
    } catch {
      setPopupError('Unexpected sign-in error. Please contact a Fordra admin for help.')
    } finally {
      setLoading(null)
    }
  }

  if (sent) {
    return (
      <p style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, lineHeight: 1.6, margin: 0 }}>
        Check <strong style={{ color: C.txt }}>{sentTo}</strong> for a sign-in link. You can close
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
          Your sign-in link expired. Contact a Fordra admin for help.
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
      <p style={{ fontSize: 12.5, color: C.txt3, margin: '4px 0 0', fontFamily: C.sans, lineHeight: 1.5 }}>
        Need to create an account? Contact a Fordra admin.
      </p>

      <hr style={{ width: '100%', border: 'none', borderTop: `1px solid ${C.border}`, margin: '10px 0' }} />

      <button
        type="button"
        onClick={() => { setLinkEmail(email); setPopupError(''); setLinkOpen(true) }}
        disabled={loading !== null}
        style={{
          width: '100%', padding: 11, background: 'transparent',
          color: C.txt2, fontSize: 13.5, fontWeight: 600,
          fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        Email me a sign-in link
      </button>
      <p style={{ fontSize: 12.5, color: C.txt3, margin: 0, fontFamily: C.sans, lineHeight: 1.5 }}>
        Forgot your password? Sign in via your email instead.
      </p>

      {linkOpen && (
        <div
          onClick={() => { if (!loading) setLinkOpen(false) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(20, 20, 19, 0.4)', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 380, background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 16, padding: '28px 28px 24px', boxShadow: '0 12px 40px oklch(0% 0 0 / 0.18)',
            }}
          >
            <p style={{ fontFamily: C.serif, fontSize: 20, color: C.txt, margin: '0 0 6px' }}>
              Sign in via email link
            </p>
            <p style={{ fontSize: 13, color: C.txt2, fontFamily: C.sans, lineHeight: 1.5, margin: '0 0 16px' }}>
              Input your email, and we&apos;ll send you a one-time sign-in URL.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                type="email"
                value={linkEmail}
                onChange={e => setLinkEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                autoFocus
                style={{ ...inputS, borderColor: popupError ? C.error : C.border }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLinkSubmit() } }}
              />
              {popupError && <p style={{ fontSize: 13, color: C.error, margin: 0, fontFamily: C.sans, lineHeight: 1.5 }}>{popupError}</p>}
              <button
                type="button"
                onClick={handleLinkSubmit}
                disabled={!linkEmail || loading !== null}
                style={{
                  width: '100%', padding: 12, background: linkEmail ? C.earthy : C.border,
                  color: linkEmail ? C.onDark : C.txt3, fontSize: 14, fontWeight: 600,
                  fontFamily: C.sans, borderRadius: 9999, border: 'none',
                  cursor: linkEmail && !loading ? 'pointer' : 'not-allowed',
                }}
              >
                {loading === 'link' ? 'Sending…' : 'Send'}
              </button>
              <button
                type="button"
                onClick={() => setLinkOpen(false)}
                disabled={loading !== null}
                style={{
                  width: '100%', padding: 8, background: 'transparent', color: C.txt3,
                  fontSize: 13, fontWeight: 600, fontFamily: C.sans, border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, margin: '0 0 32px' }}>
          <LogoMark size={24} />
          <p style={{ fontFamily: C.serif, fontSize: 26, letterSpacing: '-0.5px', color: C.txt, margin: 0, transform: 'translateY(1px)' }}>
            Fordra
          </p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
