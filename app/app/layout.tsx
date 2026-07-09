import NavBar from '@/components/NavBar'
import { getProfile } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { C } from '@/lib/theme'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Fordra | App' }

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  // Org name for the header; service client scoped strictly to the caller's org.
  let orgName: string | undefined
  if (profile?.org_id) {
    const { data: org } = await createServiceClient()
      .from('orgs').select('name').eq('id', profile.org_id).maybeSingle()
    orgName = org?.name ?? undefined
  }
  return (
    <div style={{ minHeight: '100vh', background: C.paper, color: C.txt }}>
      <NavBar
        email={profile?.email}
        orgName={orgName}
        links={[
          { href: '/app', label: 'Verifications' },
          { href: '/app/docs', label: 'API Docs' },
          { href: '/app/settings', label: 'Settings' },
        ]}
      />
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '32px 28px' }}>{children}</main>
    </div>
  )
}
