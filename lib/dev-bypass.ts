/**
 * LOCAL-ONLY admin auth bypass, for working on the console UI without a
 * Supabase session (magic links redirect to the production domain from
 * localhost, see repeat-bugs #1/#10).
 *
 * Deliberately NOT a commented-out `requireAdmin()`: that shape gets committed
 * and shipped by accident, and the admin console reads through the service
 * client, so an open /admin on a real deploy exposes every org's data. This
 * needs THREE things to be true at once, and two of them are impossible on
 * Vercel:
 *
 *   1. `DEV_ADMIN_BYPASS=1` in .env.local  (gitignored, so it cannot travel)
 *   2. NODE_ENV !== 'production'           (Vercel builds are always production)
 *   3. not running on Vercel at all
 *
 * So this file is inert everywhere except a developer machine that has opted
 * in, and it stays inert even if it is committed and deployed.
 *
 * To use: add `DEV_ADMIN_BYPASS=1` to .env.local, restart `npm run dev`.
 * To stop: delete the line (or set it to 0) and restart. No code edits.
 */
export const DEV_ADMIN_BYPASS =
  process.env.DEV_ADMIN_BYPASS === '1' &&
  process.env.NODE_ENV !== 'production' &&
  !process.env.VERCEL

/**
 * The identity the console runs as while bypassing. Uses the first
 * ADMIN_EMAIL entry so anything deriving from the session email (activity-log
 * initials, the NavBar) behaves exactly as it does when signed in properly.
 */
export function devBypassEmail(): string {
  return (process.env.ADMIN_EMAIL ?? '').split(',')[0].trim() || 'dev@localhost'
}
