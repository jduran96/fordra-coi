import { C } from './theme'

/**
 * How overdue a submission is.
 *
 * The operating rule (owner, 2026-07-28): a COI should be finished the same
 * day it lands, there is a little wiggle room, and 3+ days is a no-go.
 *
 * Sharpened 2026-08-04 (owner): a day-granular pill is useless for triage
 * inside the target window, because "Today" covers both a case that landed
 * 20 minutes ago and one that landed nine hours ago and is about to blow the
 * business-day turnaround. So anything under two days now reads in HOURS on
 * both the phone and the desktop queue, and only past 48 hours does it fall
 * back to a red day count.
 *
 * The hour phase is wall-clock elapsed time (that is what "3 hours ago"
 * means to a reader). The day phase still reports BUSINESS days in its
 * tooltip, because a Friday submission picked up Monday is one working day
 * old, not three — the weekend is not lateness.
 *
 * Everything renders in Pacific time, the same clock the rest of the console
 * uses.
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

/** Hours after which the pill stops counting hours and starts counting days. */
const DAYS_AFTER_HOURS = 48
/** Hours of grace before an open case turns amber (half the business-day target). */
const AMBER_AFTER_HOURS = 12

export interface CaseAge {
  /** Wall-clock hours since submission, floored. */
  hours: number
  /** Working days since submission: 0 = landed today. */
  businessDays: number
  /** Calendar days, for the tooltip (a 1-business-day case can be 3 days old). */
  calendarDays: number
  level: SlaLevel
  /** True while the pill counts hours (under 2 days). */
  inHours: boolean
  /** Pill text: "Just now", "7 hours ago", "3 days ago". */
  label: string
  color: string
}

/** Age of an open case against the same-day target. */
export function caseAge(createdAt: string, now: Date = new Date()): CaseAge {
  const from = pacificDayNumber(createdAt)
  const to = pacificDayNumber(now)
  const businessDays = businessDaysBetween(from, to)
  const calendarDays = Math.max(0, to - from)
  // Clamped at 0: a clock skew between the DB and the renderer must not print
  // a negative age.
  const hours = Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 3_600_000))
  const inHours = hours < DAYS_AFTER_HOURS
  const level: SlaLevel = !inHours ? 'overdue' : hours >= AMBER_AFTER_HOURS ? 'aging' : 'today'
  return {
    hours,
    businessDays,
    calendarDays,
    level,
    inHours,
    // Past the cutoff the day count comes from the same elapsed hours the
    // pill was just counting, so it can never disagree with itself (a Pacific
    // calendar-day count can read 3 for a 50-hour-old case).
    label: inHours ? hoursAgo(hours) : `${Math.floor(hours / 24)} days ago`,
    color: level === 'overdue' ? C.error : level === 'aging' ? C.warn : C.ok,
  }
}

/** "Just now" / "1 hour ago" / "9 hours ago". */
function hoursAgo(hours: number): string {
  if (hours < 1) return 'Just now'
  return `${hours} hour${hours === 1 ? '' : 's'} ago`
}

/** Longer form for tooltips: "Open 4 working days (6 calendar days)". */
export function ageTitle(age: CaseAge): string {
  if (age.inHours) {
    const elapsed = age.hours < 1 ? 'under an hour' : hoursAgo(age.hours).replace(' ago', '')
    return `Submitted ${elapsed} ago${age.level === 'today' ? ', still inside the business-day target' : ''}`
  }
  const wd = `${age.businessDays} working day${age.businessDays === 1 ? '' : 's'}`
  return age.calendarDays === age.businessDays
    ? `Open ${wd}, past the business-day target`
    : `Open ${wd} (${age.calendarDays} calendar days), past the business-day target`
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
