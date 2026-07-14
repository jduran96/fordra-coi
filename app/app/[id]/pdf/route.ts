import { createClient } from '@/lib/supabase/server'
import { buildReportPdf, type ReportPdfInput } from '@/lib/report-pdf'

export const dynamic = 'force-dynamic'

/**
 * Downloads the published report as a PDF file. Same access path as the
 * results page: the session client reads through my_verifications, so RLS
 * scopes it to the caller's org and unpublished analysis fields are null.
 * Only published, non-rejected verifications have a report to download.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: v } = await supabase
    .from('my_verifications')
    .select('display_id, carrier_name, created_at, published_at, case_status, final_report, gap_analysis, call_notes, requirements')
    .eq('id', id)
    .maybeSingle()
  if (!v || !v.published_at || v.case_status === 'rejected') {
    return new Response('Not found', { status: 404 })
  }

  // File names for the "what you submitted" section; RLS scopes to the org.
  const { data: docs } = await supabase
    .from('documents')
    .select('kind, file_name')
    .eq('verification_id', id)

  // Manually entered standards come in two shapes: web submissions store
  // { text } (+ template provenance), API submissions [{ type: 'text', value }].
  const req = v.requirements as ({ text?: string; template_name?: string } | { type?: string; value?: string; template_name?: string }[] | null)
  const requirementsText = (Array.isArray(req)
    ? req.filter(x => x?.type === 'text' && x.value).map(x => x.value).join('\n')
    : req?.text ?? ''
  ).trim()
  const templateName = (Array.isArray(req)
    ? (req.find(x => x?.type === 'template') as { template_name?: string } | undefined)?.template_name
    : req?.template_name
  )?.trim() ?? ''

  const input: ReportPdfInput = {
    ...(v as unknown as Omit<ReportPdfInput, 'documents' | 'requirements_text' | 'template_name'>),
    documents: docs ?? [],
    requirements_text: requirementsText,
    template_name: templateName,
  }
  const pdf = await buildReportPdf(input)
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Fordra-${String(v.display_id).replace(/[^\w.-]/g, '_')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
