import { getProfile } from '@/lib/auth-helpers'
import { createClient } from '@/lib/supabase/server'
import { listTemplates } from '@/lib/templates'
import { C } from '@/lib/theme'
import Link from 'next/link'
import NewVerificationForm from './NewVerificationForm'

export const dynamic = 'force-dynamic'

export default async function NewVerification() {
  const profile = await getProfile()
  if (!profile?.org_id) {
    return (
      <div style={cardS()}>
        <h1 style={h1S()}>New verification</h1>
        <p style={{ color: C.txt2, fontFamily: C.sans, fontSize: 14 }}>
          Your account isn’t linked to an organization yet. <Link href="/app" style={{ color: C.txt, fontWeight: 600, textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3 }}>Back</Link>
        </p>
      </div>
    )
  }

  const supabase = await createClient()
  const templates = await listTemplates(supabase, profile.org_id)

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={h1S()}>New verification</h1>
      <p style={{ color: C.txt2, fontFamily: C.sans, fontSize: 14, margin: '0 0 24px' }}>
        Upload the carrier’s COI and your insurance standards. The rate confirmation is optional.
        We’ll parse them and queue the deal for review.
      </p>
      <NewVerificationForm templates={templates} />
    </div>
  )
}

const h1S = () => ({ fontFamily: C.serif, fontSize: 28, color: C.txt, margin: '0 0 6px', fontWeight: 400 as const })
const cardS = () => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 })
