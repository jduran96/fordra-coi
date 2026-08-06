import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { providerFor, type EmailAccountRow } from '@/lib/email-provider'
import type { EmailThread } from '@/lib/email-shared'

/**
 * Reply ingestion for email outreach: re-fetch a thread from the provider and
 * mirror it into email_messages, deduping on (thread_id, provider_message_id)
 * so refreshes are idempotent and race-safe. Manual-refresh only today (the
 * Emails tab's Refresh buttons and every pre-reply/pre-log sync); pure
 * functions of the thread row, so a future cron route can loop
 * syncEmailThread over sent threads without changes here.
 */

export interface SyncResult {
  added: number
  error?: string
}

export async function syncEmailThread(svc: SupabaseClient, thread: EmailThread): Promise<SyncResult> {
  if (thread.status !== 'sent' || !thread.provider_thread_id || !thread.account_id) {
    return { added: 0 }
  }
  const { data: account, error: accountError } = await svc
    .from('email_accounts').select('*').eq('id', thread.account_id).maybeSingle()
  if (accountError) return { added: 0, error: accountError.message }
  if (!account) return { added: 0, error: 'The mailbox this thread was sent from is no longer connected.' }

  let fetched
  try {
    fetched = await providerFor(account as EmailAccountRow)
      .fetchThread(svc, account as EmailAccountRow, thread.provider_thread_id)
  } catch (e) {
    return { added: 0, error: e instanceof Error ? e.message : String(e) }
  }
  if (!fetched.length) return { added: 0 }

  const { count: before } = await svc.from('email_messages')
    .select('id', { count: 'exact', head: true }).eq('thread_id', thread.id)
  const { error: insertError } = await svc.from('email_messages').upsert(
    fetched.map(m => ({ ...m, thread_id: thread.id })),
    { onConflict: 'thread_id,provider_message_id', ignoreDuplicates: true },
  )
  if (insertError) return { added: 0, error: insertError.message }

  const last = fetched.reduce((a, b) =>
    new Date(a.sent_at ?? 0).getTime() >= new Date(b.sent_at ?? 0).getTime() ? a : b)
  await svc.from('email_threads').update({
    last_message_at: last.sent_at,
    last_direction: last.direction,
    message_count: fetched.length,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', thread.id)

  return { added: Math.max(0, fetched.length - (before ?? 0)) }
}

/** Sync every sent thread on one verification (the tab-level Refresh). */
export async function syncVerificationThreads(svc: SupabaseClient, verificationId: string): Promise<SyncResult> {
  const { data: threads, error } = await svc.from('email_threads')
    .select('*').eq('verification_id', verificationId).eq('status', 'sent')
  if (error) return { added: 0, error: error.message }
  let added = 0
  const errors: string[] = []
  for (const t of (threads ?? []) as EmailThread[]) {
    const r = await syncEmailThread(svc, t)
    added += r.added
    if (r.error) errors.push(r.error)
  }
  return { added, ...(errors.length ? { error: errors.join('; ') } : {}) }
}
