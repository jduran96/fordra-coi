import Link from 'next/link'
import { getSessionUser } from '@/lib/auth-helpers'
import { C } from '@/lib/theme'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Fordra | Access denied' }

/** Shown when a signed-in, non-admin account tries to open the admin console. */
export default async function AccessDenied() {
  const user = await getSessionUser()
  return (
    <div style={{
      minHeight: '100vh', background: C.paper, display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: '36px 40px', maxWidth: 460, fontFamily: C.sans,
      }}>
        <h1 style={{ fontFamily: C.serif, fontSize: 26, fontWeight: 400, color: C.txt, margin: '0 0 10px' }}>
          Admin access required
        </h1>
        <p style={{ fontSize: 14.5, color: C.txt2, lineHeight: 1.6, margin: '0 0 6px' }}>
          This account does not have access to the admin console.
        </p>
        {user?.email && (
          <p style={{ fontSize: 13, color: C.txt3, margin: '0 0 20px' }}>
            Signed in as <span style={{ fontFamily: C.mono }}>{user.email}</span>
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link href="/app" style={{
            padding: '10px 20px', background: C.txt, color: C.onDark, fontSize: 14,
            fontWeight: 600, borderRadius: 9999, textDecoration: 'none',
          }}>
            Go to your portal
          </Link>
          <a href="/auth/signout" style={{ fontSize: 14, color: C.txt2 }}>Sign out</a>
        </div>
      </div>
    </div>
  )
}
