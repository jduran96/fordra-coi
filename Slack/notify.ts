import { createServiceClient } from '@/lib/supabase/server'
import { postMessage } from './slack'

export interface SlackReportReadyNotice {
  verificationId: string
  displayId?: string
  carrierName: string
  outcome: 'completed' | 'failed'
  slackContext: { team_id: string; channel_id: string; user_id: string }
}

/**
 * Opt-in DM to the Slack submitter of a verification, sent only when the
 * admin checks the notify box while publishing or failing the case. Status +
 * portal link only: verdict details stay behind login. NEVER throws, same
 * contract as notifyVerificationResult.
 */
export async function notifySlackReportReady(n: SlackReportReadyNotice): Promise<void> {
  try {
    const svc = createServiceClient()
    const { data: install, error } = await svc
      .from('slack_installations')
      .select('bot_token')
      .eq('team_id', n.slackContext.team_id)
      .is('revoked_at', null)
      .maybeSingle()
    if (error) {
      console.error('notifySlackReportReady: installation lookup failed', error)
      return
    }
    if (!install?.bot_token) {
      console.error(`notifySlackReportReady: no active installation for team ${n.slackContext.team_id}, skipping`)
      return
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://app.fordra.com'
    const link = `${base}/app/${n.verificationId}`
    const label = n.displayId ? ` (${n.displayId})` : ''
    // Owner-approved copy (2026-07-22); no em dashes.
    const text = n.outcome === 'completed'
      ? `<@${n.slackContext.user_id}> Your verification for ${n.carrierName}${label} is complete. View the report: ${link}`
      : `<@${n.slackContext.user_id}> We could not complete your verification for ${n.carrierName}${label}. A Fordra admin will follow up with details.`

    await postMessage(install.bot_token, n.slackContext.channel_id, text)
  } catch (e) {
    console.error('notifySlackReportReady failed', e)
  }
}
