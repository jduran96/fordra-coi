import { createServiceClient } from '@/lib/supabase/server'
import { pacificDateTime } from '@/lib/dates'

/**
 * Email alert on every new verification submission, so the review SLA clock
 * never depends on someone polling /admin. Sent via the Resend REST API
 * (requires RESEND_API_KEY; the Supabase SMTP setup only covers auth emails).
 * Recipients are admin-configurable at /admin/settings (app_config), with a
 * hardcoded fallback so alerts flow before anything is configured.
 */

export const NOTIFICATION_EMAILS_KEY = 'notification_emails'
export const DEFAULT_NOTIFICATION_EMAILS = ['jullianalfonso96@gmail.com']

/** Configured recipient list; falls back to the default when unset/invalid. */
export async function getNotificationEmails(): Promise<string[]> {
  const svc = createServiceClient()
  const { data } = await svc.from('app_config').select('value').eq('key', NOTIFICATION_EMAILS_KEY).maybeSingle()
  const raw = typeof data?.value === 'string' ? data.value : ''
  const emails = raw.split(',').map(e => e.trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
  return emails.length ? emails : DEFAULT_NOTIFICATION_EMAILS
}

const SOURCE_LABEL: Record<string, string> = { web: 'the web portal', api: 'the API', slack: 'Slack' }

export interface NewVerificationNotice {
  verificationId: string
  displayId?: string
  carrierName: string
  orgId: string
  source: string
}

/**
 * Fire the new-submission alert. NEVER throws: a notification failure must
 * not fail the submission it announces. Missing RESEND_API_KEY logs + skips.
 */
export async function notifyNewVerification(n: NewVerificationNotice): Promise<void> {
  try {
    const key = process.env.RESEND_API_KEY
    if (!key) {
      console.error('notifyNewVerification: RESEND_API_KEY not set, skipping email alert')
      return
    }
    const svc = createServiceClient()
    const [{ data: org }, to] = await Promise.all([
      svc.from('orgs').select('name').eq('id', n.orgId).maybeSingle(),
      getNotificationEmails(),
    ])
    const orgName = org?.name ?? 'Unknown org'
    const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://app.fordra.com'
    const link = `${base}/admin/${n.verificationId}`
    const label = n.displayId ? ` (${n.displayId})` : ''
    const when = pacificDateTime(new Date().toISOString())

    const subject = `New verification: ${n.carrierName}${label}`
    const text =
      `${orgName} submitted a new verification for ${n.carrierName} via ${SOURCE_LABEL[n.source] ?? n.source}.\n`
      + `Submitted: ${when}\n\nReview it: ${link}\n`
    const html =
      `<p>${orgName} submitted a new verification for <strong>${n.carrierName}</strong> via ${SOURCE_LABEL[n.source] ?? n.source}.</p>`
      + `<p>Submitted: ${when}</p>`
      + `<p><a href="${link}">Review it in the Fordra admin console</a></p>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.NOTIFY_EMAIL_FROM || 'Fordra <notifications@fordra.com>',
        to,
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error(`notifyNewVerification: Resend responded ${res.status}: ${await res.text().catch(() => '')}`)
  } catch (e) {
    console.error('notifyNewVerification failed', e)
  }
}
