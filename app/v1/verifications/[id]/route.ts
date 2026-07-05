import { authenticateRequest, unauthorized, apiError, serializeVerification } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/server'

/** GET /v1/verifications/:id — fetch one verification (org-scoped). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if (!auth) return unauthorized()

  const { id } = await params
  const svc = createServiceClient()
  const { data } = await svc.from('verifications')
    .select('*')
    .eq('id', id)
    .eq('org_id', auth.orgId)
    .single()

  if (!data) return apiError('No such verification.', 404, 'not_found')

  const { data: docs } = await svc.from('documents')
    .select('id, kind, file_name')
    .eq('verification_id', id)

  return Response.json(serializeVerification(data, docs ?? []))
}
