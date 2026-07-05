/**
 * Retry a Supabase single-row read a few times before giving up.
 *
 * This machine has intermittent TLS/network flakiness (see HANDOFF), so an
 * occasional read returns `{ data: null, error }` even though the row exists.
 * Callers must use `.maybeSingle()` so a genuine "no rows" comes back as
 * `{ data: null, error: null }` (not retried) and is distinguishable from a
 * transient error (retried, then surfaced so the page can throw instead of
 * rendering a misleading 404).
 */
export async function withRetry<R extends { data: unknown; error: unknown }>(
  fn: () => PromiseLike<R>,
  tries = 3,
): Promise<R> {
  let last: R | undefined
  for (let i = 0; i < tries; i++) {
    const res = await fn()
    last = res
    if (res.data) return res          // success
    if (!res.error) return res        // genuine empty result — do not retry
    if (i < tries - 1) await new Promise(r => setTimeout(r, 150 * (i + 1)))
  }
  return last as R
}
