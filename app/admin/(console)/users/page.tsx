import { createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin-emails'
import { C } from '@/lib/theme'
import EditUserModal from './EditUserModal'
import InviteUserModal from './InviteUserModal'
import CreateOrgModal from './CreateOrgModal'
import OrgsTable from './OrgsTable'

export const dynamic = 'force-dynamic'

interface Prof { id: string; email: string; role: string; org_id: string | null; orgs: { name: string } | null }

export default async function UsersPage() {
  // Admin-only route (gated by the layout). Service client so we can read every
  // profile plus each user's last sign-in from the auth admin API.
  const svc = createServiceClient()
  const { data: profiles } = await svc
    .from('profiles')
    .select('id, email, role, org_id, orgs(name)')
    .order('created_at', { ascending: true })
  const { data: orgs } = await svc.from('orgs').select('id, name').order('name')
  const { data: authData } = await svc.auth.admin.listUsers()
  const { data: verifOrgs } = await svc.from('verifications').select('org_id')

  const rows = (profiles ?? []) as unknown as Prof[]
  const orgRows = (orgs ?? []).map(o => ({
    id: o.id,
    name: o.name,
    members: rows.filter(p => p.org_id === o.id).length,
    verifications: (verifOrgs ?? []).filter(v => v.org_id === o.id).length,
  }))
  const lastSeen = new Map<string, string | null>()
  for (const u of authData?.users ?? []) lastSeen.set(u.id, u.last_sign_in_at ?? null)
  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')

  return (
    <div style={{ maxWidth: 920, fontFamily: C.sans, color: C.txt }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: 0, fontWeight: 400 }}>Users</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <CreateOrgModal />
          <InviteUserModal orgs={(orgs ?? []).map(o => ({ id: o.id, name: o.name }))} />
          <EditUserModal
            users={rows.map(r => ({ id: r.id, email: r.email, isAdmin: isAdminEmail(r.email) }))}
            orgs={(orgs ?? []).map(o => ({ id: o.id, name: o.name }))}
          />
        </div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <th style={th()}>User email</th><th style={th()}>Role</th><th style={th()}>Org</th><th style={th()}>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={td()}>{p.email}</td>
                {/* Real admin access is the ADMIN_EMAIL allowlist, not profiles.role
                    (which nothing ever promotes) — display the same truth auth uses. */}
                <td style={{ ...td(), textTransform: 'capitalize' }}>{isAdminEmail(p.email) ? 'admin' : 'customer'}</td>
                <td style={{ ...td(), color: p.org_id ? C.txt : C.txt3 }}>{p.orgs?.name ?? 'unassigned'}</td>
                <td style={{ ...td(), color: C.txt3 }}>{fmt(lastSeen.get(p.id))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontFamily: C.serif, fontSize: 20, fontWeight: 400, margin: '28px 0 12px' }}>Organizations</h2>
      <OrgsTable orgs={orgRows} />
      <p style={{ color: C.txt3, fontSize: 12, marginTop: 10 }}>
        Edit a name and Save to rename; use New Org above to create one. Deleting an org also
        deletes its members (sign-in accounts included) and its verifications with their stored
        documents. Admin accounts are never deleted, only unassigned.
      </p>
    </div>
  )
}

const th = () => ({ padding: '12px 16px', fontWeight: 600 as const })
const td = () => ({ padding: '13px 16px', color: C.txt })
