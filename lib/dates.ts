/**
 * All verification timestamps display in US Pacific time, explicitly marked.
 * These pages render on the server (UTC on Vercel), so an unpinned
 * toLocaleString silently shows UTC in production; always format through
 * these helpers.
 */

const PACIFIC = 'America/Los_Angeles'

/** '7/10/2026, 6:00 PM (Pacific US)' */
export function pacificDateTime(iso: string): string {
  return `${new Date(iso).toLocaleString('en-US', {
    timeZone: PACIFIC,
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })} (Pacific US)`
}

/** { dateTime: '7/10/2026, 6:00 PM', tz: 'Pacific US' } — for two-line table cells. */
export function pacificDateTimeParts(iso: string): { dateTime: string; tz: string } {
  return {
    dateTime: new Date(iso).toLocaleString('en-US', {
      timeZone: PACIFIC,
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }),
    tz: 'Pacific US',
  }
}

/** '7/10/2026 at 6:00 PM (Pacific US)' — the contact-note "Contacted on" line. */
export function pacificDateAtTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { timeZone: PACIFIC })
  const time = d.toLocaleTimeString('en-US', { timeZone: PACIFIC, hour: 'numeric', minute: '2-digit' })
  return `${date} at ${time} (Pacific US)`
}

/** '7/10/2026' — the calendar date in Pacific time, no marker. */
export function pacificDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: PACIFIC })
}

/**
 * 'just now' / '3 hours ago' / '2 days ago' — how fresh something is, for
 * admin bylines where the exact timestamp belongs in the tooltip rather than
 * on screen. Timezone-free by construction: it measures elapsed time, so it
 * needs no Pacific pinning.
 */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return `${Math.floor(hours / 24)} days ago`
}
