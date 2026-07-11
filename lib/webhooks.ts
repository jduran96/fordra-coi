import { createServiceClient } from '@/lib/supabase/server'
import { randomBytes, createHmac } from 'crypto'

/**
 * Endpoint URL guard: https only in production, and never private/internal
 * hosts (endpoints POST from Vercel egress with a signed secret — an
 * attacker-inserted internal URL would be an SSRF primitive). Local dev may
 * point at a localhost receiver for testing.
 */
function allowedWebhookUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  const host = u.hostname.toLowerCase()
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  if (!process.env.VERCEL) {
    return u.protocol === 'https:' || (u.protocol === 'http:' && isLoopback)
  }
  if (u.protocol !== 'https:') return false
  if (isLoopback
    || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
    || host.endsWith('.internal') || host.endsWith('.local')) {
    return false
  }
  return true
}

/**
 * Record an event and deliver it to the org's active webhook endpoints.
 * The delivered payload is identical to what `GET /v1/<resource>/:id` returns,
 * so customers can choose push (webhook) or pull (poll) — same data.
 *
 * Signature: `Fordra-Signature: t=<unix seconds>,v1=<hex hmac-sha256 of
 * "<t>.<body>" keyed by the endpoint secret>`. The timestamp is signed so a
 * captured delivery cannot be replayed later (receivers should reject stale
 * `t`). Delivery outcome is recorded on the events row (attempts,
 * delivered_at) — there are no retries yet, but failures are visible.
 */
export async function emitEvent(orgId: string, type: string, object: unknown) {
  const svc = createServiceClient()
  const payload = {
    object: 'event',
    id: `evt_${randomBytes(12).toString('hex')}`,
    type,
    created_at: new Date().toISOString(),
    data: { object },
  }

  const { data: ev, error: evErr } = await svc.from('events')
    .insert({ org_id: orgId, type, data: payload })
    .select('id')
    .single()
  if (evErr) console.error('emitEvent: could not record event', evErr)

  const { data: hooks, error: hooksErr } = await svc
    .from('webhook_endpoints')
    .select('id, url, secret, events, active')
    .eq('org_id', orgId)
    .eq('active', true)
  if (hooksErr) {
    console.error('emitEvent: could not load endpoints', hooksErr)
    return
  }

  const body = JSON.stringify(payload)
  let attempts = 0
  let delivered = false
  for (const h of hooks ?? []) {
    if (Array.isArray(h.events) && h.events.length > 0 && !h.events.includes(type)) continue
    if (!allowedWebhookUrl(h.url)) {
      console.error(`emitEvent: endpoint ${h.id} has a disallowed url, skipping`)
      continue
    }
    attempts++
    try {
      const t = Math.floor(Date.now() / 1000)
      const v1 = createHmac('sha256', h.secret).update(`${t}.${body}`).digest('hex')
      const res = await fetch(h.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Fordra-Signature': `t=${t},v1=${v1}` },
        body,
        // A slow customer endpoint must not pin the triggering request open.
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) delivered = true
      else console.error(`emitEvent: endpoint ${h.id} responded ${res.status}`)
    } catch (e) {
      console.error(`emitEvent: delivery to endpoint ${h.id} failed`, e)
    }
  }

  if (ev && attempts > 0) {
    await svc.from('events')
      .update({ attempts, ...(delivered ? { delivered_at: new Date().toISOString() } : {}) })
      .eq('id', ev.id)
      .then(() => {}, () => {})
  }
}
