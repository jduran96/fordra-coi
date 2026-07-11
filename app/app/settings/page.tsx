import Link from 'next/link'
import { getProfile } from '@/lib/auth-helpers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { listTemplates, STARTER_REQUIREMENTS } from '@/lib/templates'
import { C } from '@/lib/theme'
import SettingsClient from './SettingsClient'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const profile = await getProfile()
  if (!profile?.org_id) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
        <h1 style={h1S()}>Settings</h1>
        <p style={{ color: C.txt2, fontFamily: C.sans, fontSize: 14 }}>
          Please contact a Fordra admin to set up your account.{' '}
          <Link href="/app" style={{ color: C.txt, fontWeight: 600 }}>Back</Link>
        </p>
      </div>
    )
  }

  const supabase = await createClient()
  const templates = await listTemplates(supabase, profile.org_id)

  // Profiles RLS only exposes the caller's own row; list teammates via the
  // service client, scoped strictly to the caller's org.
  const svc = createServiceClient()
  const { data: members, error: membersErr } = await svc
    .from('profiles')
    .select('id, email, full_name')
    .eq('org_id', profile.org_id)
    .order('email')
  if (membersErr) throw new Error(`Could not load team members: ${membersErr.message}`)

  // New templates start pre-filled with the starter condition checks so orgs can
  // see and tailor them (policyholder name, policy active) per template.
  const starterRows = STARTER_REQUIREMENTS.map(r => ({ ...r }))

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ ...h1S(), marginBottom: 24 }}>Settings</h1>
      <SettingsClient
        templates={templates}
        starterRows={starterRows}
        members={(members ?? []).map(m => ({ id: m.id, email: m.email, full_name: m.full_name }))}
        selfId={profile.id}
      />
    </div>
  )
}

const h1S = () => ({ fontFamily: C.serif, fontSize: 28, color: C.txt, margin: '0 0 6px', fontWeight: 400 as const })
