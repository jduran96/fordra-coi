import { C } from '@/lib/theme'

export const dynamic = 'force-dynamic'

/**
 * Interstitial for sign-in links (emails + admin-minted). Links point here
 * instead of straight at /auth/callback because the token is single-use:
 * link-preview crawlers (Slack, iMessage, mail scanners) GET every URL they
 * see, and a direct callback link would be consumed before the human clicks.
 * This page consumes nothing on GET.
 *
 * 2026-07-11 (owner-approved, supersedes the 2026-07-10 auto-continue
 * decision): the human clicks a Sign in button (form GET to the callback)
 * instead of being auto-redirected by JS. Corporate mail scanners that
 * EXECUTE JavaScript (Outlook SafeLinks, Proofpoint) were consuming tokens
 * through the old AutoContinue redirect; scanners render pages but do not
 * click buttons, so the token now survives them too. Keep this page free of
 * auto-navigation and of plain <a> links to the callback.
 */
export default async function AuthLinkPage({ searchParams }: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>
}) {
  const params = await searchParams
  const tokenHash = params.token_hash ?? ''
  const type = params.type ?? 'magiclink'
  const next = params.next ?? ''

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.paper, fontFamily: C.sans, padding: 24,
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: 36, width: '100%', maxWidth: 420, textAlign: 'center',
        boxShadow: '0 25px 50px -12px rgba(20,20,19,0.15)',
      }}>
        <p style={{ fontFamily: C.mono, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.txt3, margin: '0 0 10px' }}>
          Fordra
        </p>
        <h1 style={{ fontFamily: C.serif, fontSize: 26, fontWeight: 400, color: C.txt, margin: '0 0 10px' }}>
          Welcome!
        </h1>
        {tokenHash ? (
          <>
            <p style={{ fontSize: 14, color: C.txt2, lineHeight: 1.6, margin: '0 0 20px' }}>
              Click below to continue to your verification dashboard.
            </p>
            <form action="/auth/callback" method="GET" style={{ margin: 0 }}>
              <input type="hidden" name="token_hash" value={tokenHash} />
              <input type="hidden" name="type" value={type} />
              {next && <input type="hidden" name="next" value={next} />}
              <button type="submit" style={{
                padding: '12px 32px', background: C.txt, color: C.onDark, fontSize: 15,
                fontWeight: 600, fontFamily: C.sans, borderRadius: 9999, border: 'none',
                cursor: 'pointer',
              }}>
                Sign in
              </button>
            </form>
          </>
        ) : (
          <p style={{ fontSize: 14, color: C.txt2, lineHeight: 1.6, margin: 0 }}>
            This link is incomplete. Ask your Fordra admin for a new one.
          </p>
        )}
      </div>
    </div>
  )
}
