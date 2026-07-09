import { authenticateRequest, unauthorized } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/server'
import { listTemplates } from '@/lib/templates'

/**
 * GET /v1/templates — list the org's saved insurance-standards templates,
 * so integrators can pass template_id / template_name to POST /v1/verifications.
 * Templates are managed in the portal at /app/settings.
 */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return unauthorized()

  const svc = createServiceClient()
  const templates = await listTemplates(svc, auth.orgId)

  return Response.json({
    object: 'list',
    data: templates.map(t => ({
      object: 'template',
      id: t.id,
      name: t.name,
      is_default: t.is_default,
      requirements: t.requirements,
      variables: t.variables,
      details: t.details ?? null,
    })),
  })
}
