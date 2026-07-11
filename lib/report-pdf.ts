import PDFDocument from 'pdfkit'
import { pacificDate, pacificDateTime } from '@/lib/dates'

/**
 * Renders a published verification report as a downloadable PDF. Mirrors the
 * customer results page: summary, requirement verdicts (not met, uncertain,
 * met, same ordering), COI details, call notes. Built with pdfkit standard
 * fonts (Helvetica), ink on white, no remote assets.
 */

interface ReportItem {
  requirement?: { coverage_type?: string; minimum_limit?: string; notes?: string | null }
  status?: 'met' | 'not_met' | 'uncertain'
  evidence?: string
}
interface Report { met?: ReportItem[]; not_met?: ReportItem[]; uncertain?: ReportItem[]; narrative_summary?: string }
interface Coverage {
  type?: string
  policy_number?: string
  effective_date?: string
  expiration_date?: string
  each_occurrence_limit?: string
  aggregate_limit?: string
}
interface COI {
  named_insured?: string
  named_insured_address?: string
  usdot_number?: string
  mc_number?: string
  producer?: string
  insurance_company?: string
  certificate_holder?: string
  additional_insured?: string
  additional_terms?: string
  coverages?: Coverage[]
}
interface CallNote { at?: string; text?: string; contact?: { name?: string; phone?: string; email?: string } }

export interface ReportPdfInput {
  display_id: string
  carrier_name: string
  created_at: string
  published_at: string
  final_report: Report | null
  gap_analysis: Report | null
  coi_extracted: COI | null
  call_notes: CallNote[] | null
}

const INK = '#141413'
const GREY = '#6f6e69'
const LINE = '#dedcd3'
const STATUS_LABEL: Record<string, string> = { met: 'Satisfied', not_met: 'Discrepancy', uncertain: 'Unconfirmed' }
const STATUS_COLOR: Record<string, string> = { met: '#3f7d47', not_met: '#b3403a', uncertain: '#9a6b1f' }

function items(r: Report | null | undefined): ReportItem[] {
  if (!r) return []
  return [...(r.not_met ?? []), ...(r.uncertain ?? []), ...(r.met ?? [])]
}

export function buildReportPdf(v: ReportPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 56, bottom: 64, left: 56, right: 56 } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const width = doc.page.width - 112
    const rule = () => {
      doc.moveDown(0.8)
      doc.moveTo(56, doc.y).lineTo(doc.page.width - 56, doc.y).strokeColor(LINE).lineWidth(1).stroke()
      doc.moveDown(0.8)
    }
    const heading = (t: string) => {
      doc.moveDown(0.4)
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY).text(t.toUpperCase(), { characterSpacing: 0.8 })
      doc.moveDown(0.5)
    }

    // Header
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY).text('FORDRA', { characterSpacing: 1.2 })
    doc.moveDown(0.3)
    doc.font('Helvetica-Bold').fontSize(21).fillColor(INK).text('Verification Report')
    doc.moveDown(0.2)
    doc.font('Helvetica').fontSize(13).fillColor(INK).text(v.carrier_name)
    doc.moveDown(0.3)
    doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(
      `${v.display_id}   ·   Submitted ${pacificDate(v.created_at)}   ·   Published ${pacificDate(v.published_at)}`,
    )
    rule()

    // The customer page prefers the admin's final_report over the automated
    // gap analysis; the PDF must match it exactly.
    const report = (v.final_report && items(v.final_report).length ? v.final_report : v.gap_analysis) ?? null
    const summary = (v.final_report?.narrative_summary ?? '').trim()
    const rows = items(report)

    if (summary) {
      heading('Summary')
      doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(summary, { width, lineGap: 2.5 })
      doc.moveDown(0.6)
    }

    if (rows.length > 0) {
      const disc = rows.filter(i => i.status === 'not_met').length
      const unc = rows.filter(i => i.status === 'uncertain').length
      heading('Result')
      doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(
        `${rows.length} checks   ·   ${disc} ${disc === 1 ? 'discrepancy' : 'discrepancies'}   ·   ${unc} unconfirmed`,
      )
      doc.moveDown(0.4)

      heading('Requirement check')
      for (const it of rows) {
        const name = it.requirement?.coverage_type || 'Requirement'
        const limit = (it.requirement?.minimum_limit ?? '').trim()
        const status = it.status ?? 'uncertain'
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(name + (limit ? `  ·  ${limit}` : ''), { width: width - 90, continued: false })
        const yBefore = doc.y
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(STATUS_COLOR[status] ?? GREY)
          .text(STATUS_LABEL[status] ?? status, doc.page.width - 56 - 90, doc.heightOfString(name) > 14 ? yBefore - 26 : yBefore - 13, { width: 90, align: 'right' })
        doc.x = 56
        doc.y = yBefore
        if ((it.evidence ?? '').trim()) {
          doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(it.evidence!.trim(), { width: width - 90, lineGap: 2 })
        }
        doc.moveDown(0.55)
      }
    }

    const coi = v.coi_extracted
    if (coi) {
      rule()
      heading('COI details')
      const facts: [string, string | undefined][] = [
        ['Policyholder', coi.named_insured],
        ['Address', coi.named_insured_address],
        ['USDOT number', coi.usdot_number],
        ['MC number', coi.mc_number],
        ['Insurance company', coi.insurance_company],
        ['Producer', coi.producer],
        ['Certificate holder', coi.certificate_holder],
        ['Additional insured', coi.additional_insured],
      ]
      for (const [label, val] of facts) {
        doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(`${label}:  `, { continued: true })
        doc.fillColor(INK).text(val?.trim() || '-')
        doc.moveDown(0.15)
      }
      const coverages = (coi.coverages ?? []).filter(c => c.type)
      if (coverages.length > 0) {
        doc.moveDown(0.4)
        for (const c of coverages) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(c.type!)
          const parts = [
            c.policy_number ? `Policy ${c.policy_number}` : null,
            c.effective_date || c.expiration_date ? `${c.effective_date || '?'} to ${c.expiration_date || '?'}` : null,
            c.each_occurrence_limit ? `${c.each_occurrence_limit} per occurrence` : null,
            c.aggregate_limit ? `${c.aggregate_limit} aggregate` : null,
          ].filter(Boolean)
          if (parts.length) doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(parts.join('   ·   '), { lineGap: 2 })
          doc.moveDown(0.35)
        }
      }
      if (coi.additional_terms?.trim()) {
        doc.moveDown(0.3)
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(GREY).text('Additional terms')
        doc.moveDown(0.15)
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(coi.additional_terms.trim(), { width, lineGap: 2 })
      }
    }

    const notes = (v.call_notes ?? []).filter(n => (n.text ?? '').trim())
    if (notes.length > 0) {
      rule()
      heading('Insurer call notes')
      for (const n of notes.slice().reverse()) {
        const who = [n.contact?.name, n.contact?.phone, n.contact?.email].map(s => s?.trim()).filter(Boolean).join('  ·  ')
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
          .text(`${n.at ? pacificDateTime(n.at) : ''}${who ? `   ·   ${who}` : ''}`)
        doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text((n.text ?? '').trim(), { width, lineGap: 2 })
        doc.moveDown(0.45)
      }
    }

    doc.moveDown(1)
    doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text('Fordra  ·  app.fordra.com')

    doc.end()
  })
}
