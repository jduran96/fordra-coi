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

/** '7/10/2026' — the calendar date in Pacific time, no marker. */
export function pacificDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: PACIFIC })
}
