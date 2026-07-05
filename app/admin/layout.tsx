import NavBar from '@/components/NavBar'
import { requireAdmin } from '@/lib/auth-helpers'
import { C } from '@/lib/theme'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin()
  return (
    <div style={{ minHeight: '100vh', background: C.paper, color: C.txt }}>
      <NavBar
        email={user.email}
        links={[
          { href: '/admin', label: 'Queue' },
          { href: '/admin/users', label: 'Users' },
          { href: '/admin/configs', label: 'Configs' },
        ]}
      />
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 28px' }}>{children}</main>
    </div>
  )
}
