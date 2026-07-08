import NavBar from '@/components/NavBar'
import { getProfile } from '@/lib/auth-helpers'
import { C } from '@/lib/theme'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Fordra | App' }

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  return (
    <div style={{ minHeight: '100vh', background: C.paper, color: C.txt }}>
      <NavBar
        email={profile?.email}
        links={[
          { href: '/app', label: 'Verifications' },
          { href: '/app/docs', label: 'API Docs' },
        ]}
      />
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '32px 28px' }}>{children}</main>
    </div>
  )
}
