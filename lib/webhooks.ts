import { createServiceClient } from '@/lib/supabase/server'
import { randomBytes, createHmac } from 'crypto'

/**
 * Record an event and deliver it to the org's active webhook endpoints.
 * The delivered payload is identical to what `GET /v1/<resource>/:id` returns,
 * so customers can choose push (webhook) or pull (poll) — same data.
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

  await svc.from('events').insert({ org_id: orgId, type, data: payload })

  const { data: hooks } = await svc
    .from('webhook_endpoints')
    .select('id, url, secret, events, active')
    .eq('org_id', orgId)
    .eq('active', true)

  const body = JSON.stringify(payload)
  for (const h of hooks ?? []) {
    if (Array.isArray(h.events) && h.events.length > 0 && !h.events.includes(type)) continue
    try {
      const signature = createHmac('sha256', h.secret).update(body).digest('hex')
      await fetch(h.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Fordra-Signature': signature },
        body,
      })
    } catch {
      // best-effort delivery for the pilot; retry/backoff is a later hardening
    }
  }
}
