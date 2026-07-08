import Link from 'next/link'
import { getProfile } from '@/lib/auth-helpers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { listTemplates } from '@/lib/templates'
import { getExtractionConfig } from '@/lib/config'
import { DEFAULT_BASELINE_REQUIREMENTS } from '@/lib/claude'
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
          Your account isn&rsquo;t linked to an organization yet. Call (727) 729-9594 to get set up.{' '}
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
  const { data: members } = await svc
    .from('profiles')
    .select('id, email, full_name')
    .eq('org_id', profile.org_id)
    .order('email')

  // New templates start pre-filled with the baseline checks so orgs can see and
  // tailor the minimum checks (policyholder name, policy active) per template.
  const cfg = await getExtractionConfig()
  const starterRows = (cfg.baselineRequirements?.length ? cfg.baselineRequirements : DEFAULT_BASELINE_REQUIREMENTS)
    .map(r => ({ ...r }))

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={h1S()}>Settings</h1>
      <p style={{ color: C.txt2, fontFamily: C.sans, fontSize: 14, margin: '0 0 24px' }}>
        Save your insurance standards once and reuse them on every verification. Use
        a <span style={{ fontFamily: C.mono, fontSize: 13 }}>{'{placeholder}'}</span> in a limit for
        deal-specific values, like <span style={{ fontFamily: C.mono, fontSize: 13 }}>{'{asset_sale_price}'}</span>.
      </p>
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
