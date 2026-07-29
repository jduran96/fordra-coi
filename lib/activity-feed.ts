/**
 * Activity feed entries for a verification: the submission plus every status
 * event recorded in `events` (verification.* rows, stamped with
 * verification_id since 0035). Pure mapping — callers fetch the rows with
 * whichever client their surface requires (session on /app, service on
 * /admin).
 *
 * History note: status events only exist from 2026-07-28 on. Older rows show
 * the synthetic "Submitted" entry plus whatever created/updated events the
 * webhook path already recorded; publish history before that is
 * unrecoverable (published_at is overwritten on republish).
 */

export interface FeedEntry {
  at: string
  label: string
  /** Extra context on merged feeds (e.g. the display id on a business feed). */
  detail?: string
}

export interface FeedEventRow {
  type: string
  created_at: string
}

const EVENT_LABEL: Record<string, string> = {
  'verification.created': 'Submitted',
  'verification.updated': 'Report updated',
  'verification.published': 'Report published',
  'verification.reopened': 'Report reopened for review',
  'verification.failed': 'Marked could not complete',
}

const closeInTime = (a: string, b: string, ms = 5000) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= ms

/** Build one verification's feed, newest first. Unknown event types are skipped. */
export function feedEntries(
  v: { created_at: string; display_id?: string | null },
  events: FeedEventRow[],
  detail?: string,
): FeedEntry[] {
  const published = events.filter(e => e.type === 'verification.published')
  const out: FeedEntry[] = []
  for (const e of events) {
    const label = EVENT_LABEL[e.type]
    if (!label) continue
    // The synthetic "Submitted" below already covers the creation event.
    if (e.type === 'verification.created' && closeInTime(e.created_at, v.created_at)) continue
    // Publishing emits verification.updated (the webhook type) and
    // verification.published (the feed type) together; show one entry.
    if (e.type === 'verification.updated' && published.some(p => closeInTime(p.created_at, e.created_at))) continue
    out.push({ at: e.created_at, label, ...(detail ? { detail } : {}) })
  }
  out.push({ at: v.created_at, label: 'Submitted', ...(detail ? { detail } : {}) })
  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

/** Merge several verifications' feeds (a business's activity), newest first. */
export function mergeFeeds(feeds: FeedEntry[][]): FeedEntry[] {
  return feeds.flat().sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}
