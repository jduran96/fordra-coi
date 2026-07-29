import { C } from './theme'

/**
 * How overdue a submission is.
 *
 * The operating rule (owner, 2026-07-28): a COI should be finished the same
 * day it lands, there is a little wiggle room, and 3+ days is a no-go. Age is
 * counted in BUSINESS days, not calendar days, because a Friday submission
 * picked up Monday is one working day old, not three — the weekend is not
 * lateness. Everything renders in Pacific time, the same clock the rest of
 * the console uses.
 */

const PACIFIC = 'America/Los_Angeles'

/** Days since the epoch for the Pacific calendar date of an instant. */
function pacificDayNumber(iso: string | Date): number {
  // en-CA formats as YYYY-MM-DD, which parses without locale guesswork.
  const [y, m, d] = new Date(iso)
    .toLocaleDateString('en-CA', { timeZone: PACIFIC })
    .split('-')
    .map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

/** Weekdays in [0, n], where day 0 (1970-01-01) was a Thursday. */
function weekdaysThrough(n: number): number {
  if (n < 0) return 0
  const weeks = Math.floor((n + 1) / 7)
  let count = weeks * 5
  for (let i = 0; i < (n + 1) % 7; i++) {
    const dow = (weeks * 7 + i + 4) % 7 // 0 = Sunday, 6 = Saturday
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

/** Weekdays strictly after `from` up to and including `to`. */
function businessDaysBetween(from: number, to: number): number {
  if (to <= from) return 0
  return weekdaysThrough(to) - weekdaysThrough(from)
}

export type SlaLevel = 'today' | 'aging' | 'overdue'

export interface CaseAge {
  /** Working days since submission: 0 = landed today. */
  businessDays: number
  /** Calendar days, for the tooltip (a 1-business-day case can be 3 days old). */
  calendarDays: number
  level: SlaLevel
  /** Pill text: "Today", "1 day", "4 days". */
  label: string
  color: string
}

/** Age of an open case against the same-day target. */
export function caseAge(createdAt: string, now: Date = new Date()): CaseAge {
  const from = pacificDayNumber(createdAt)
  const to = pacificDayNumber(now)
  const businessDays = businessDaysBetween(from, to)
  const calendarDays = Math.max(0, to - from)
  const level: SlaLevel = businessDays >= 3 ? 'overdue' : businessDays >= 1 ? 'aging' : 'today'
  return {
    businessDays,
    calendarDays,
    level,
    label: businessDays === 0 ? 'Today' : `${businessDays} day${businessDays === 1 ? '' : 's'}`,
    color: level === 'overdue' ? C.error : level === 'aging' ? C.warn : C.ok,
  }
}

/** Longer form for tooltips: "Open 4 working days (6 calendar days)". */
export function ageTitle(age: CaseAge): string {
  if (age.businessDays === 0) return 'Submitted today, still on the same-day target'
  const wd = `${age.businessDays} working day${age.businessDays === 1 ? '' : 's'}`
  return age.calendarDays === age.businessDays
    ? `Open ${wd}`
    : `Open ${wd} (${age.calendarDays} calendar days)`
}

/** How long a finished case took, for the Completed list: "closed same day". */
export function turnaroundLabel(createdAt: string, closedAt: string | null | undefined): string | null {
  if (!closedAt) return null
  const days = businessDaysBetween(pacificDayNumber(createdAt), pacificDayNumber(closedAt))
  if (days === 0) return 'Closed same day'
  return `Closed in ${days} day${days === 1 ? '' : 's'}`
}

/** True when the instant falls on today's Pacific calendar date. */
export function isPacificToday(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false
  return pacificDayNumber(iso) === pacificDayNumber(now)
}
