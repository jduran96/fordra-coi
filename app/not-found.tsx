import Link from 'next/link'
import { C } from '@/lib/theme'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.paper, fontFamily: C.sans, padding: 24,
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: '36px 40px', maxWidth: 460, textAlign: 'center',
      }}>
        <h1 style={{ fontFamily: C.serif, fontSize: 26, fontWeight: 400, color: C.txt, margin: '0 0 10px' }}>
          Page not found
        </h1>
        <p style={{ fontSize: 14.5, color: C.txt2, lineHeight: 1.6, margin: '0 0 20px' }}>
          Does not exist or extra permissions required. Contact a Fordra admin for help.
        </p>
        <Link href="/app" style={{
          padding: '10px 24px', background: C.txt, color: C.onDark, fontSize: 14,
          fontWeight: 600, borderRadius: 9999, textDecoration: 'none', display: 'inline-block',
        }}>
          Go to your portal
        </Link>
      </div>
    </div>
  )
}
