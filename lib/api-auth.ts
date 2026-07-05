import { createServiceClient } from '@/lib/supabase/server'
import { hashApiKey } from '@/lib/apikeys'

export interface ApiAuth {
  orgId: string
  mode: 'sandbox' | 'live'
  keyId: string
}

/** Resolve an API key from HTTP Basic (key as username) or Bearer. Null if invalid. */
export async function authenticateRequest(request: Request): Promise<ApiAuth | null> {
  const header = request.headers.get('authorization') ?? ''
  let secret = ''
  if (header.startsWith('Basic ')) {
    try {
      secret = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':')[0]
    } catch { return null }
  } else if (header.startsWith('Bearer ')) {
    secret = header.slice(7).trim()
  }
  if (!secret.startsWith('sk_')) return null

  const svc = createServiceClient()
  const { data } = await svc
    .from('api_keys')
    .select('id, org_id, mode, revoked_at')
    .eq('key_hash', hashApiKey(secret))
    .is('revoked_at', null)
    .single()
  if (!data) return null

  await svc.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id)
  return { orgId: data.org_id, mode: data.mode as 'sandbox' | 'live', keyId: data.id }
}

export function apiError(message: string, status = 400, type = 'invalid_request_error') {
  return Response.json({ error: { type, message } }, { status })
}

export function unauthorized() {
  return apiError('Invalid or missing API key. Authenticate with HTTP Basic, key as username.', 401, 'authentication_error')
}

/**
 * Serialize a verification row to the public API shape (analysis gated on publish).
 * Pass the submitted `documents` to include their references in the payload.
 */
export function serializeVerification(
  v: Record<string, unknown>,
  documents?: Array<Record<string, unknown>>,
) {
  const published = !!v.published_at
  const finalReport = (v.final_report ?? null) as { narrative_summary?: string } | null
  return {
    object: 'verification',
    id: v.id,
    display_id: v.display_id,
    status: v.status,
    carrier_name: v.carrier_name,
    source: v.source,
    documents: (documents ?? []).map(d => ({ kind: d.kind, file_name: d.file_name })),
    requirements: v.requirements ?? null,
    requirements_normalized: published ? v.requirements_normalized ?? null : null,
    coi_extracted: published ? v.coi_extracted ?? null : null,
    gap_analysis: published ? v.gap_analysis ?? null : null,
    summary: published ? finalReport?.narrative_summary ?? null : null,
    error_detail: v.error_detail ?? null,
    created_at: v.created_at,
    published_at: v.published_at ?? null,
  }
}
