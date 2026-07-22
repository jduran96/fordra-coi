import PDFDocument from 'pdfkit'
import { pacificDate, pacificDateAtTime, pacificDateTime } from '@/lib/dates'
import { parseStandardLine } from '@/lib/templates'
import { orderBySubmitted, orderFromText } from '@/lib/gap-order'
import { contactValue } from '@/lib/contact-notes'
import type { ContactNote, OnlineListingStatus } from '@/lib/types'

/**
 * Renders a published verification report as a downloadable PDF. Mirrors the
 * customer results page's content set (owner decision 2026-07-14): summary,
 * requirement verdicts (submitted order, matching the results page), insurer
 * contact notes, and the "what you submitted" record (file names only plus
 * the written insurance standards; documents are not re-rendered). Every
 * note field renders in full here — the transcript expander is a webapp-only
 * UI element (owner decision 2026-07-16). Built with pdfkit standard fonts
 * (Helvetica), ink on white, no remote assets.
 */

interface ReportItem {
  requirement?: { coverage_type?: string; minimum_limit?: string; notes?: string | null }
  status?: 'met' | 'not_met' | 'uncertain'
  evidence?: string
  insurer_confirmation?: 'call' | 'email'
}
interface Report { met?: ReportItem[]; not_met?: ReportItem[]; uncertain?: ReportItem[]; narrative_summary?: string }

export interface ReportPdfInput {
  display_id: string
  carrier_name: string
  created_at: string
  published_at: string
  final_report: Report | null
  gap_analysis: Report | null
  call_notes: ContactNote[] | null
  documents: { kind: string; file_name: string }[]
  requirements_text: string
  template_name: string
}

const INK = '#141413'
const GREY = '#6f6e69'
const LINE = '#dedcd3'
const STATUS_LABEL: Record<string, string> = { met: 'Passed', not_met: 'Discrepancy', uncertain: 'Needs attention' }
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
    const rows = orderBySubmitted(items(report), orderFromText(v.requirements_text))

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
        `${rows.length} checks   ·   ${disc} ${disc === 1 ? 'discrepancy' : 'discrepancies'}   ·   ${unc} ${unc === 1 ? 'needs' : 'need'} attention`,
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
        if (it.insurer_confirmation === 'call' || it.insurer_confirmation === 'email') {
          doc.moveDown(0.15)
          // Helvetica (WinAnsi) has no ✓ glyph: draw the check as strokes.
          const cy = doc.y
          doc.save().strokeColor(STATUS_COLOR.met).lineWidth(1.4).lineCap('round').lineJoin('round')
            .moveTo(56, cy + 4).lineTo(58.4, cy + 6.4).lineTo(63, cy + 1.4).stroke().restore()
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
            .text(`VERIFIED WITH INSURER VIA ${it.insurer_confirmation === 'call' ? 'CALL' : 'EMAIL'}`, 56 + 12, cy, { width: width - 102, characterSpacing: 0.8 })
          doc.x = 56
        }
        doc.moveDown(0.55)
      }
    }

    // Same reading order as the web report: gap analysis, then the insurer
    // contacts that resolved it, then the submitted record. A note renders if
    // it has ANY body (summary, legacy text, or transcript) — keying on the
    // legacy `text` alone would drop every new-shape note from the PDF.
    const notes = (v.call_notes ?? []).filter(n =>
      (n.summary_text ?? '').trim() || (n.text ?? '').trim() || (n.transcript ?? '').trim())
    const chipLabel = (s?: OnlineListingStatus) =>
      s === 'verified' ? 'Verified online'
      : s === 'differs' ? 'Differs from online'
      : s === 'not_found' ? 'Not found online'
      : 'Not checked online'
    const chipColor = (s?: OnlineListingStatus) =>
      s === 'verified' ? '#3f7d47' : s === 'differs' ? '#9a6b1f' : GREY
    if (notes.length > 0) {
      rule()
      heading('Insurer Contact Log')
      for (const n of notes.slice().reverse()) {
        const method = n.contact_method?.trim()
        // Bold "Contacted via email", regular " on: <timestamp>" (owner spec).
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
          .text(method ? `Contacted via ${method}` : 'Contacted', { continued: true })
        doc.font('Helvetica').text(` on: ${n.at ? pacificDateAtTime(n.at) : ''}`)
        const name = contactValue(n.contact?.name)
        if (name) {
          doc.font('Helvetica').fontSize(9).fillColor(GREY).text('Contact Name: ', { continued: true })
          doc.font('Helvetica-Bold').fillColor(INK).text(name)
        }
        doc.moveDown(0.2)
        // Contact verification: THIS log's cited phone/email web-checked
        // against the issuing producer. A field with no check yet reads
        // "Not checked online"; a blank field gets no row at all.
        const check = n.contact_check
        const verifiedBits: [string, string, OnlineListingStatus | undefined][] = []
        const phone = contactValue(n.contact?.phone)
        const email = contactValue(n.contact?.email)
        if (phone) verifiedBits.push(['Phone', phone, check?.phone_status])
        if (email) verifiedBits.push(['Email', email, check?.email_status])
        if (verifiedBits.length) {
          doc.font('Helvetica-Bold').fontSize(8).fillColor(GREY).text('CONTACT VERIFICATION', { characterSpacing: 0.8 })
          // A pdfkit continued chain must END on a segment with
          // continued: false — an empty text('') does not flush the line and
          // the next heading overprints it.
          verifiedBits.forEach(([label, val, status], i) => {
            const last = i === verifiedBits.length - 1
            doc.font('Helvetica').fontSize(9).fillColor(GREY)
              .text(`${i > 0 ? '   |   ' : ''}${label}: ${val}`, { continued: true })
            doc.font('Helvetica-Bold').fillColor(chipColor(status)).text(`  (${chipLabel(status)})`, { continued: !last })
          })
          if (check) {
            // Overall verdict of the two-pronged check (website alignment +
            // outside confirmation); absent on checks from before 2026-07-22.
            // Same customer strings as the web report.
            if (check.legitimacy) {
              const verdict = check.legitimacy === 'legit' ? 'Insurer verified online'
                : check.legitimacy === 'mismatch' ? 'Discrepancies found in online search'
                : 'Not able to find online'
              const verdictColor = check.legitimacy === 'legit' ? '#3f7d47'
                : check.legitimacy === 'mismatch' ? '#9a6b1f' : GREY
              doc.font('Helvetica-Bold').fontSize(9).fillColor(verdictColor).text(verdict.toUpperCase(), { characterSpacing: 0.5 })
            }
            if (check.blurb.trim()) {
              doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(check.blurb.trim(), { width, lineGap: 2 })
            }
            const hosts = check.sources.map(hostOf).filter(Boolean).join(', ')
            doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(
              `${hosts ? `Sources: ${hosts}   ·   ` : ''}Checked ${pacificDateTime(check.checked_at)}`,
            )
          }
          doc.moveDown(0.25)
        }
        // Strip carriage returns: form textareas submit \r\n and Helvetica
        // renders the bare \r as a visible glyph.
        const summary = ((n.summary_text ?? '').trim() || (n.text ?? '').trim()).replace(/\r/g, '')
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GREY).text('CONVERSATION SUMMARY', { characterSpacing: 0.8 })
        doc.font('Helvetica').fontSize(9.5).fillColor(summary ? INK : GREY)
          .text(summary || 'Not available', { width, lineGap: 2 })
        doc.moveDown(0.25)
        const transcript = (n.transcript ?? '').trim().replace(/\r/g, '')
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GREY).text('RAW TRANSCRIPT', { characterSpacing: 0.8 })
        doc.font('Helvetica').fontSize(9.5).fillColor(transcript ? INK : GREY)
          .text(transcript || 'Not available', { width, lineGap: 2 })
        doc.moveDown(0.55)
      }
    }


    // What the customer submitted: file names only (documents are not
    // re-rendered here), plus the written insurance standards.
    rule()
    heading('What you submitted')
    const byKind = (kind: string) =>
      v.documents.filter(d => d.kind === kind).map(d => d.file_name).join(', ')
    const standardsFallback = v.template_name
      ? `Used template: ${v.template_name}`
      : v.requirements_text.trim() ? 'Entered manually' : 'Not submitted'
    const submittedRows: [string, string][] = [
      ['COI document', byKind('coi') || 'Not submitted'],
      ['Other documents', byKind('rcs') || 'N/A'],
      ['Insurance standards', byKind('requirements') || standardsFallback],
    ]
    for (const [label, val] of submittedRows) {
      doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(`${label}:  `, { continued: true })
      doc.fillColor(INK).text(val)
      doc.moveDown(0.15)
    }
    if (v.requirements_text.trim()) {
      doc.moveDown(0.4)
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(GREY).text('Insurance standards')
      doc.moveDown(0.2)
      const lines = v.requirements_text.split('\n').map(l => l.trim()).filter(Boolean)
      lines.forEach((line, i) => {
        const r = parseStandardLine(line)
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
          .text(`${i + 1}.  ${r.title}${r.limit ? `: ${r.limit}` : ''}`, { width, lineGap: 2 })
        if (r.notes) {
          doc.font('Helvetica').fontSize(9).fillColor(GREY).text(r.notes, 56 + 14, doc.y, { width: width - 14, lineGap: 2 })
          doc.x = 56
        }
        doc.moveDown(0.3)
      })
    }

    doc.moveDown(1)
    doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text('Fordra  ·  app.fordra.com')

    doc.end()
  })
}

/** Bare hostname for compact source attribution; falls back to the raw string. */
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}
