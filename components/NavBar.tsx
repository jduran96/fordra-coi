import Link from 'next/link'
import LogoMark from '@/components/LogoMark'
import { C } from '@/lib/theme'

/** Top nav shared by the customer portal and admin console. Server component. */
export default function NavBar({
  title,
  links,
  email,
  orgName,
}: {
  title?: string
  links: { href: string; label: string }[]
  email?: string | null
  orgName?: string | null
}) {
  return (
    <header className="fx-nav" style={{
      display: 'flex', alignItems: 'center', gap: 24, padding: '14px 28px',
      borderBottom: `1px solid ${C.border}`, background: C.surface,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <LogoMark size={22} />
        {/* +1.5px: optically centers the descender-less wordmark on the mark */}
        <span style={{ fontFamily: C.serif, fontSize: 20, color: C.txt, letterSpacing: '-0.4px', transform: 'translateY(1.5px)' }}>
          Fordra
        </span>
      </span>
      {title && (
        <span className="fx-hide" style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
          {title}
        </span>
      )}
      {/* On phones this drops to its own full-width line and scrolls
          sideways, so the link count never squeezes out Sign out. */}
      <nav className="fx-nav-links fx-scroll-x" style={{ display: 'flex', gap: 18, marginLeft: 12 }}>
        {links.map(l => (
          <Link key={l.href} href={l.href}
            style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
        {email && (
          <span className="fx-hide" style={{ fontSize: 13, color: C.txt3, fontFamily: C.sans }}>
            {orgName && <span style={{ color: C.txt2, fontWeight: 600 }}>{orgName}</span>}
            {orgName && ' | '}
            {email}
          </span>
        )}
        <form action="/auth/signout" method="post">
          <button type="submit" style={{
            fontSize: 13, color: C.txt2, fontFamily: C.sans, background: 'none',
            border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
          }}>
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
