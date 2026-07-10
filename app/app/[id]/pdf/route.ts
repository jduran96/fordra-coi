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
    .select('display_id, carrier_name, created_at, published_at, case_status, final_report, gap_analysis, coi_extracted, call_notes')
    .eq('id', id)
    .maybeSingle()
  if (!v || !v.published_at || v.case_status === 'rejected') {
    return new Response('Not found', { status: 404 })
  }

  const pdf = await buildReportPdf(v as unknown as ReportPdfInput)
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Fordra-${String(v.display_id).replace(/[^\w.-]/g, '_')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
