import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { C } from '@/lib/theme'
import InstallLinkForm from './InstallLinkForm'
import { revokeInstallation, setAllowedUsers } from './actions'
import PaginatedTable from '@/components/PaginatedTable'

export const dynamic = 'force-dynamic'

interface Install {
  id: string
  team_id: string
  team_name: string | null
  org_id: string
  allowed_slack_users: string[] | null
  created_at: string
  revoked_at: string | null
  orgs: { name: string } | null
}

export default async function SlackPage() {
  await requireAdmin()
  const svc = createServiceClient()
  const { data: orgs, error: orgErr } = await svc.from('orgs').select('id, name').order('name')
  const { data: installs, error: instErr } = await svc
    .from('slack_installations')
    .select('id, team_id, team_name, org_id, allowed_slack_users, created_at, revoked_at, orgs(name)')
    .order('created_at', { ascending: false })
  if (orgErr || instErr) throw new Error(orgErr?.message || instErr?.message)

  const rows = (installs ?? []) as unknown as Install[]

  return (
    <div style={{ maxWidth: 920, fontFamily: C.sans, color: C.txt }}>
      <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: '0 0 6px', fontWeight: 400 }}>Slack</h1>
      <p style={{ color: C.txt3, fontSize: 14, margin: '0 0 20px' }}>
        Generate an install link per org and send it to the partner. Only holders of a valid link can
        connect a workspace; revoke to cut a workspace off instantly.
      </p>

      <InstallLinkForm orgs={(orgs ?? []).map(o => ({ id: o.id, name: o.name }))} />

      <h2 style={{ fontFamily: C.serif, fontSize: 20, fontWeight: 400, margin: '28px 0 12px' }}>Connected workspaces</h2>
      <PaginatedTable
        head={
          <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <th style={th()}>Workspace</th><th style={th()}>Org</th><th style={th()}>Allowed users</th><th style={th()}>Status</th><th style={th()} />
          </tr>
        }
        rows={rows.length === 0
          ? [<tr key="empty"><td style={{ ...td(), color: C.txt3 }} colSpan={5}>No workspaces connected yet.</td></tr>]
          : rows.map(i => (
              <tr key={i.id} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={td()}>{i.team_name ?? i.team_id}</td>
                <td style={td()}>{i.orgs?.name ?? i.org_id}</td>
                <td style={td()}>
                  <form action={setAllowedUsers} style={{ display: 'flex', gap: 6 }}>
                    <input type="hidden" name="install_id" value={i.id} />
                    <input
                      name="allowed_users"
                      defaultValue={(i.allowed_slack_users ?? []).join(', ')}
                      placeholder="everyone"
                      style={{ fontFamily: C.mono, fontSize: 12, padding: '6px 8px', border: `1px solid ${C.border}`, borderRadius: 8, width: 180, background: C.paper, color: C.txt }}
                    />
                    <button type="submit" style={smallBtn()}>Save</button>
                  </form>
                </td>
                <td style={{ ...td(), color: i.revoked_at ? '#b3261e' : C.txt }}>
                  {i.revoked_at ? 'Revoked' : 'Active'}
                </td>
                <td style={td()}>
                  {!i.revoked_at && (
                    <form action={revokeInstallation.bind(null, i.id)}>
                      <button type="submit" style={{ ...smallBtn(), color: '#b3261e' }}>Revoke</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
      />
      <p style={{ color: C.txt3, fontSize: 12, marginTop: 10 }}>
        Allowed users: comma-separated Slack user IDs (blank allows the whole workspace). Unauthorized
        users are told their ID in the bot&apos;s reply so you can paste it here.
      </p>
    </div>
  )
}

const th = () => ({ padding: '12px 16px', fontWeight: 600 as const })
const td = () => ({ padding: '13px 16px', color: C.txt })
const smallBtn = () => ({
  fontFamily: C.sans, fontSize: 12, padding: '6px 12px', borderRadius: 999,
  border: `1px solid ${C.border}`, background: C.surface, color: C.txt, cursor: 'pointer' as const,
})
