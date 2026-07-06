'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { signInstallState } from '@/Slack/slack'

export interface InstallLinkState { url?: string; error?: string }

/** Build a 7-day install link for an org. Only holders of a link can install the Slack app. */
export async function generateInstallLink(_prev: InstallLinkState, formData: FormData): Promise<InstallLinkState> {
  await requireAdmin()
  const orgId = String(formData.get('org_id') || '')
  if (!orgId) return { error: 'Pick an org first.' }
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  return { url: `${base}/api/slack/oauth?state=${encodeURIComponent(signInstallState(orgId))}` }
}

/** Disconnect a workspace immediately (events from it are ignored from now on). */
export async function revokeInstallation(installId: string) {
  await requireAdmin()
  const svc = createServiceClient()
  await svc.from('slack_installations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', installId)
  revalidatePath('/admin/slack')
}

/** Set the per-workspace user whitelist. Empty input clears it (whole workspace allowed). */
export async function setAllowedUsers(formData: FormData) {
  await requireAdmin()
  const installId = String(formData.get('install_id') || '')
  const raw = String(formData.get('allowed_users') || '').trim()
  const users = raw ? raw.split(/[\s,]+/).filter(Boolean) : null
  const svc = createServiceClient()
  await svc.from('slack_installations')
    .update({ allowed_slack_users: users })
    .eq('id', installId)
  revalidatePath('/admin/slack')
}
