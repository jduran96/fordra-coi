import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { createHash } from 'crypto'
import { withRetry } from '@/lib/db'
import { signedUrl } from '@/lib/storage'
import { C } from '@/lib/theme'
import { deriveAdminStatus, adminStatusColor } from '@/lib/admin-status'
import { pacificDateTime } from '@/lib/dates'
import { humanizeToken, parseStandardLine } from '@/lib/templates'
import type { ContactCheckEntry, ContactNote, OnlineListingStatus } from '@/lib/types'
import { contactValue } from '@/lib/contact-notes'
import PendingButton from '@/components/PendingButton'
import AdminTabs from '@/components/AdminTabs'
import AssessmentForm from '@/components/AssessmentForm'
import CallNoteForm from '@/components/CallNoteForm'
import NoteCheckControls from '@/components/NoteCheckControls'
import ContactCheckTask from '@/components/ContactCheckTask'
import { runExtraction, runOnlineContactCheck, saveContactCheckEdit, saveCallNote, saveAssessment, saveNoteCheck, deleteCallNote, updateCallNote, logAdminActivity, deleteAdminActivity } from '../actions'
import { normalizeActivity } from '@/lib/admin-activity'
import DeleteNoteButton from './DeleteNoteButton'
import EditNoteButton from './EditNoteButton'
import ActivityLog from './ActivityLog'

export const dynamic = 'force-dynamic'
// Run-extraction (a server action on this page) makes 2-3 Claude calls incl.
// vision OCR; on Vercel the default function limit cuts it off mid-run.
export const maxDuration = 300

interface Requirement { coverage_type?: string; minimum_limit?: string; notes?: string | null }
interface GapItem { requirement: Requirement; status: 'met' | 'not_met' | 'uncertain'; evidence?: string }
interface Gap { met?: GapItem[]; not_met?: GapItem[]; uncertain?: GapItem[] }
interface COI {
  named_insured?: string
  named_insured_address?: string
  named_insured_phone?: string
  named_insured_email?: string
  usdot_number?: string
  mc_number?: string
  producer?: string
  insurance_company?: string
  insurance_company_address?: string
  insurance_company_phone?: string
  insurance_company_email?: string
  insurance_company_contact?: string
  certificate_holder?: string
  additional_insured?: string
  loss_payee?: string
  other_named_parties?: string
}

function gapItems(g: Gap | null | undefined): GapItem[] {
  if (!g) return []
  return [...(g.not_met ?? []), ...(g.uncertain ?? []), ...(g.met ?? [])]
}

export default async function AdminDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireAdmin()
  // Service client: the session client can't `select *` on verifications because
  // customer publish-gating is enforced with column-level grants on `authenticated`,
  // which also apply to the admin's session. Row access is safe: requireAdmin above.
  const supabase = createServiceClient()
  const { data: v, error } = await withRetry(() => supabase
    .from('verifications')
    .select('*, orgs(name)')
    .eq('id', id)
    .maybeSingle())
  if (!v) {
    if (error) throw new Error('Could not load this verification. Please retry.')
    notFound()
  }

  // created_by is null for API/Slack submissions; web submissions record the
  // portal user's profile id.
  const { data: uploader } = v.created_by
    ? await withRetry(() => supabase.from('profiles').select('email').eq('id', v.created_by).maybeSingle())
    : { data: null }

  const { data: docs, error: docsErr } = await supabase
    .from('documents')
    .select('id, kind, file_name, mime_type, storage_path, extracted, extraction_status')
    .eq('verification_id', id)
  // "No documents uploaded" on a failed read could get a valid case rejected.
  if (docsErr) throw new Error(`Could not load documents: ${docsErr.message}`)

  const docsWithUrls = await Promise.all(
    (docs ?? []).map(async d => ({ ...d, url: await signedUrl(d.storage_path).catch(() => null) })),
  )

  // Manually entered standards come in two shapes: web submissions store
  // { text }, API submissions store [{ type: 'text', value }].
  const requirementsText = (() => {
    const r = v.requirements as { text?: string } | { type?: string; value?: string }[] | null
    if (Array.isArray(r)) return r.filter(x => x?.type === 'text' && x.value).map(x => x.value).join('\n').trim()
    return (r?.text ?? '').trim()
  })()
  // Template provenance rides in the same JSONB: web keeps template_name on
  // the object, API/Slack add a { type: 'template' } entry to the array.
  const templateName = (() => {
    const r = v.requirements as { template_name?: string } | { type?: string; template_name?: string }[] | null
    if (Array.isArray(r)) return r.find(x => x?.type === 'template')?.template_name ?? ''
    return r?.template_name ?? ''
  })()

  // Per-deal template variable values ride in the same provenance (web keeps
  // them on the object, API on the { type: 'template' } entry). carrier_name is
  // auto-filled from the carrier field, not a submitter input, so it is skipped.
  const templateVariables = (() => {
    const r = v.requirements as { variables?: Record<string, string> } | { type?: string; variables?: Record<string, string> }[] | null
    const vars = Array.isArray(r) ? r.find(x => x?.type === 'template')?.variables : r?.variables
    return Object.entries(vars ?? {}).filter(([k]) => k !== 'carrier_name')
  })()

  const adminStatus = deriveAdminStatus(v)
  const statusCol = adminStatusColor(adminStatus)
  // Closed (published or failed) cases are read-only, call notes included,
  // until reopened via Edit Status. Mirrored server-side in the actions.
  const caseIsClosed = !!v.published_at || v.case_status === 'failed'
  const notes = (Array.isArray(v.call_notes) ? v.call_notes : []) as ContactNote[]
  // Online-check history, append-only: stored oldest-first, newest run last.
  const checks = (Array.isArray(v.contact_checks) ? v.contact_checks : []) as ContactCheckEntry[]
  const coi = (v.coi_extracted ?? null) as COI | null

  // The review rows: prefer the admin's saved assessment, then the automated
  // analysis, then the org's parsed requirements so a fully manual review is
  // possible (the form lets the admin add rows freely when nothing is parsed yet).
  const reviewItems: GapItem[] = (() => {
    const parsed = (Array.isArray(v.requirements_normalized) ? v.requirements_normalized : []) as Requirement[]
    const fromFinal = gapItems(v.final_report as Gap | null)
    const fromGap = gapItems(v.gap_analysis as Gap | null)
    const base = fromFinal.length ? fromFinal : fromGap
    if (!base.length) return parsed.map(r => ({ requirement: r, status: 'uncertain' as const, evidence: '' }))
    // Standards added AFTER this assessment was drafted (e.g. the submitter
    // amended their requirements and extraction was re-run) must still surface
    // as review rows, or they silently never reach the published report. Match
    // leniently by label then by notes wording; anything unmatched is appended
    // as an unassessed row the admin can judge or remove.
    const label = (r?: Requirement) => (r?.coverage_type ?? '').trim().toLowerCase()
    const note = (r?: Requirement) => (r?.notes ?? '').trim().toLowerCase()
    const haveLabels = new Set(base.map(i => label(i.requirement)))
    const haveNotes = new Set(base.map(i => note(i.requirement)).filter(Boolean))
    const missing = parsed.filter(r => !haveLabels.has(label(r)) && !(note(r) && haveNotes.has(note(r))))
    return [...base, ...missing.map(r => ({ requirement: r, status: 'uncertain' as const, evidence: '' }))]
  })()
  const summaryDefault = (v.final_report as { narrative_summary?: string } | null)?.narrative_summary ?? ''

  return (
    <div style={{ fontFamily: C.sans, color: C.txt, maxWidth: 860 }}>
      <Link href="/admin" style={{ color: C.txt2, fontSize: 14, textDecoration: 'none' }}>← Queue</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '14px 0 4px' }}>
        <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: 0, fontWeight: 400 }}>{v.carrier_name}</h1>
        <span style={{ fontSize: 12, fontWeight: 600, color: statusCol, background: `color-mix(in oklch, ${statusCol} 12%, transparent)`, padding: '3px 10px', borderRadius: 20 }}>{adminStatus}</span>
        <span style={{ marginLeft: 'auto' }}>
          <ActivityLog
            entries={normalizeActivity(v.admin_activity)}
            logAction={logAdminActivity.bind(null, id)}
            deleteAction={deleteAdminActivity.bind(null, id)}
          />
        </span>
      </div>
      <p style={{ color: C.txt3, fontSize: 13, margin: '0 0 22px' }}>
        {v.display_id} · {(v.orgs as { name?: string } | null)?.name ?? '—'} · {v.source} · {pacificDateTime(v.created_at)}
      </p>

      {/* Tabbed layout: panels stay mounted (hidden) so form state survives
          switching; the assessment form renders below the panels so its
          Save draft / Reject / Publish footer is visible under every tab. */}
      <AdminTabs tabs={[
        { label: 'Submissions', content: (
        <section>
          <SectionTitle>Uploads</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            <div style={card()}>
              <SectionTitle small>Submission</SectionTitle>
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 18, rowGap: 7 }}>
                <FactRow label="Carrier name (as submitted)" value={v.carrier_name || '—'} />
                <FactRow label="Uploaded by" value={uploader?.email ?? (v.source === 'web' ? '—' : `via ${v.source}`)} />
                <FactRow label="Organization" value={(v.orgs as { name?: string } | null)?.name ?? '—'} />
              </dl>
            </div>
            {docsWithUrls.length === 0 && <Muted>No documents uploaded.</Muted>}
            {docsWithUrls.map(d => (
              <div key={d.id} style={card()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px', color: C.txt2 }}>{d.kind === 'rcs' ? 'Other' : d.kind}</span>
                  {d.url && <a href={d.url} target="_blank" rel="noreferrer" style={{ color: C.txt, fontWeight: 600, fontSize: 13, textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3 }}>View {d.file_name} ↗</a>}
                </div>
              </div>
            ))}
            {/* Uploaded-doc standards get no card: it would be empty until OCR
                runs, and after OCR the admin reads the normalized JSON below. */}
            {(templateName || requirementsText) && (
              <div style={card()}>
                <SectionTitle small>Insurance standards</SectionTitle>
                <p style={{ fontSize: 12.5, color: C.txt3, margin: '4px 0 12px' }}>
                  {templateName ? `Template: ${templateName}` : 'Entered as text'}
                </p>
                {/* Read-only render of the submitted standards, one numbered item
                    per line. The submitter's text is never editable here. */}
                <ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {requirementsText.split('\n').map(l => l.trim()).filter(Boolean).map((line, i) => {
                    const r = parseStandardLine(line)
                    return (
                      <li key={i} style={{ fontSize: 14, lineHeight: 1.55, color: C.txt }}>
                        <span style={{ fontWeight: 700 }}>{r.title}</span>
                        {r.limit ? <span style={{ fontWeight: 600 }}>{`: ${r.limit}`}</span> : null}
                        {r.notes ? <div style={{ fontSize: 13, color: C.txt2, marginTop: 3, lineHeight: 1.6 }}>{r.notes}</div> : null}
                      </li>
                    )
                  })}
                </ol>
              </div>
            )}
            {templateVariables.length > 0 && (
              <div style={card()}>
                <SectionTitle small>Variable inputs (entered by submitter)</SectionTitle>
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 18, rowGap: 7 }}>
                  {templateVariables.map(([key, val]) => (
                    <FactRow key={key} label={humanizeToken(key)} value={val?.trim() || '—'} />
                  ))}
                </dl>
              </div>
            )}
          </div>
        </section>
        ) },

        { label: 'OCR', content: (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SectionTitle>OCR Analysis</SectionTitle>
            <form action={runExtraction.bind(null, id)} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
              {/* Checked: re-extract the documents (incl. field locations for the
                  customer report) without touching the current requirement checks
                  or summary. Unchecked: regenerate them and drop the manual copy. */}
              {v.coi_extracted && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.txt2, cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" name="keep_assessment" defaultChecked style={{ accentColor: C.txt }} />
                  Keep requirement checks &amp; summary
                </label>
              )}
              <PendingButton pendingLabel="Extracting… (can take a minute)" style={smallBtn()}>
                {v.coi_extracted ? 'Re-run extraction' : 'Run extraction'}
              </PendingButton>
            </form>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {!v.coi_extracted && <Muted>Not extracted yet. Run extraction to parse the COI & requirements.</Muted>}
            <JsonCard title="Requirements (normalized)" data={v.requirements_normalized} />
            <JsonCard title="Coverage gap analysis" data={v.gap_analysis} />
            <JsonCard title="COI extracted" data={coi ? groupCoiExtracted(coi as unknown as Record<string, unknown>) : v.coi_extracted} />
          </div>
        </section>
        ) },

        { label: 'Calls', content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {/* Who to call (from the COI) and what to ask them */}
        <section>
          <SectionTitle>Call prep</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {coi
              ? <InsurerCard coi={coi} />
              : <Muted>Run extraction (OCR tab) to pull the insurer contact off the COI.</Muted>}
            <QuestionsCard questions={(Array.isArray(v.agent_questions) ? v.agent_questions : []) as string[]} extracted={!!v.coi_extracted} />
          </div>
        </section>

        {/* Agent contact check: the ONE place a contact web search runs
            (manually triggered, never part of extraction — each run spends
            web searches). Prefilled from the COI, values editable. Every run
            is kept as history; contact logs below inherit their tags by
            citing a checked value. */}
        <section>
          <SectionTitle>Agent contact check</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {!v.coi_extracted ? (
              <div style={card()}>
                <Muted>Run extraction first; the check searches the producer named on the COI.</Muted>
              </div>
            ) : (
              <>
                {!caseIsClosed && (
                  <div style={card()}>
                    <ContactCheckTask
                      defaultPhone={contactValue(coi?.insurance_company_phone)}
                      defaultEmail={contactValue(coi?.insurance_company_email)}
                      runAction={runOnlineContactCheck.bind(null, id)}
                    />
                  </div>
                )}
                {checks.length === 0 ? (
                  <Muted>No online checks yet. A checked phone/email tags every contact log that cites it.</Muted>
                ) : (
                  <>
                    <CheckEntryCard entry={checks[checks.length - 1]}
                      controls={!caseIsClosed && (
                        /* Keyed by content: remount on fresh data after a save
                           (React 19 stale-defaultValue workaround). */
                        <NoteCheckControls
                          key={JSON.stringify(checks[checks.length - 1])}
                          check={checks[checks.length - 1]}
                          saveAction={saveContactCheckEdit.bind(null, id, checks[checks.length - 1].checked_at)}
                        />
                      )} />
                    {checks.length > 1 && (
                      <details>
                        <summary style={{ fontSize: 12.5, fontWeight: 600, color: C.txt2, cursor: 'pointer' }}>
                          Previous checks ({checks.length - 1})
                        </summary>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                          {checks.slice(0, -1).reverse().map(e => (
                            <CheckEntryCard key={e.checked_at} entry={e}
                              controls={!caseIsClosed && (
                                <NoteCheckControls
                                  key={JSON.stringify(e)}
                                  check={e}
                                  saveAction={saveContactCheckEdit.bind(null, id, e.checked_at)}
                                />
                              )} />
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </section>

        {/* Insurer contact log (calls, emails, texts) */}
        <section>
          <SectionTitle>Insurer Contact Log</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {notes.length === 0 && <Muted>No contact logs yet.</Muted>}
            {/* One card per contact: who/when/how header on top, the summary
                and transcript spread across the full width beneath — long
                write-ups stay readable instead of being squeezed into a column. */}
            {notes.slice().reverse().map((n, i) => {
              const phone = contactValue(n.contact?.phone)
              const email = contactValue(n.contact?.email)
              return (
              <div key={i} style={card()}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', paddingBottom: 10, marginBottom: 12, borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.txt }}>{n.contact?.name?.trim() || 'Unnamed contact'}</span>
                  {n.contact_method?.trim() && (
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.txt2, background: C.paper, border: `1px solid ${C.border}`, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                      {n.contact_method.trim()}
                    </span>
                  )}
                  <span style={{ fontSize: 13, color: C.txt3, whiteSpace: 'nowrap' }}>{pacificDateTime(n.at)}</span>
                  {!caseIsClosed && (
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                      {/* Keyed by content: the dialog's prefill state must
                          remount on fresh data after a save (repeat-bugs #15). */}
                      <EditNoteButton key={JSON.stringify(n)} note={n} action={updateCallNote.bind(null, id, n.at)} />
                      <DeleteNoteButton action={deleteCallNote.bind(null, id, n.at)} />
                    </span>
                  )}
                </div>
                {/* This log's cited phone/email + their web verification.
                    Rendered above the summary, same order the customer sees. */}
                {(phone || email) && (
                  <div style={{ paddingBottom: 10, marginBottom: 12, borderBottom: `1px solid ${C.border}` }}>
                    <SectionTitle small>Contact verification</SectionTitle>
                    <p style={{ fontSize: 13, color: C.txt3, margin: 0 }}>
                      {phone && (
                        <span>Phone: <span style={{ color: C.txt }}>{phone}</span><NoteStatusChip status={n.contact_check?.phone_status} /></span>
                      )}
                      {phone && email && <span style={{ margin: '0 8px' }}>|</span>}
                      {email && (
                        <span>Email: <span style={{ color: C.txt }}>{email}</span><NoteStatusChip status={n.contact_check?.email_status} /></span>
                      )}
                    </p>
                    {n.contact_check?.blurb && (
                      <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, margin: '8px 0 0' }}>{n.contact_check.blurb}</p>
                    )}
                    {n.contact_check && (
                      <p style={{ fontSize: 12, color: C.txt3, margin: '6px 0 0', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                        {n.contact_check.sources.length > 0 && (
                          <>Sources: {n.contact_check.sources.map(hostOf).join(' · ')} · </>
                        )}
                        checked {pacificDateTime(n.contact_check.checked_at)}
                      </p>
                    )}
                    {!caseIsClosed && (
                      /* Edit-only: tags come from the online check above by
                         value match; no per-log web search. Keyed by content:
                         React 19 resets uncontrolled fields to the STALE
                         render's defaultValue after a form action; remounting
                         on fresh data shows what saved. */
                      <NoteCheckControls
                        key={JSON.stringify(n.contact_check ?? null)}
                        check={n.contact_check ?? null}
                        saveAction={saveNoteCheck.bind(null, id, n.at)}
                      />
                    )}
                  </div>
                )}
                {/* Summary: sanitized rich text for new notes, plain text for
                    legacy { text } entries. */}
                {n.summary_html ? (
                  <div style={{ fontSize: 13.5, color: C.txt, lineHeight: 1.6, overflowWrap: 'anywhere' }}
                    dangerouslySetInnerHTML={{ __html: n.summary_html }} />
                ) : (n.summary_text || n.text) ? (
                  <div style={{ fontSize: 13.5, color: C.txt, whiteSpace: 'pre-wrap', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{n.summary_text || n.text}</div>
                ) : null}
                {n.transcript?.trim() && (
                  <details style={{ marginTop: (n.summary_html || n.summary_text || n.text) ? 10 : 0 }}>
                    <summary style={{ fontSize: 12.5, fontWeight: 600, color: C.txt2, cursor: 'pointer' }}>View transcript</summary>
                    <div style={{ fontSize: 13, color: C.txt2, whiteSpace: 'pre-wrap', lineHeight: 1.6, overflowWrap: 'anywhere', marginTop: 8, paddingLeft: 14, borderLeft: `2px solid ${C.border}` }}>{n.transcript.trim()}</div>
                  </details>
                )}
              </div>
            )})}
            {caseIsClosed ? (
              <Muted>This case is closed. Click Edit Status below to reopen it before adding contact logs.</Muted>
            ) : (
              <CallNoteForm action={saveCallNote.bind(null, id)} />
            )}
          </div>
        </section>
        </div>
        ) },

        { label: 'Analysis', content: (
        <div>
          <SectionTitle>Assessment</SectionTitle>
          <p style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.6, margin: '8px 0 0' }}>
            Set a verdict and evidence for each requirement, write the summary, then save a draft
            or publish. Publishing releases exactly this assessment to the customer.
          </p>
        </div>
        ) },
      ]}
      analysisForm={
        /* Keyed by the analysis content: when extraction or a saved draft
           changes the verdict data, the form remounts with fresh rows;
           unrelated updates (e.g. call notes) leave in-progress edits alone.
           Rendered below the tab panels: the rows + summary show on the
           Analysis tab, the Save draft / Reject / Publish footer everywhere. */
        <AssessmentForm
          key={createHash('md5').update(JSON.stringify([v.final_report, v.gap_analysis])).digest('hex')}
          action={saveAssessment.bind(null, id)}
          items={reviewItems}
          summaryDefault={summaryDefault}
          published={!!v.published_at}
          failed={v.case_status === 'failed'}
          submitterEmail={uploader?.email ?? null}
        />
      }
      />
    </div>
  )
}

function InsurerCard({ coi }: { coi: COI }) {
  const facts: [string, string | undefined][] = [
    ['Policyholder', coi.named_insured],
    ['Policyholder address', coi.named_insured_address],
    ['Policyholder phone', coi.named_insured_phone],
    ['Policyholder email', coi.named_insured_email],
    ['USDOT number', coi.usdot_number],
    ['MC number', coi.mc_number],
    ['Insurance company(s)', coi.insurance_company],
    ['Insurer contact name(s)', coi.insurance_company_contact],
    ['Producer (agency)', coi.producer],
    ['Address', coi.insurance_company_address],
    ['Phone', coi.insurance_company_phone],
    ['Email', coi.insurance_company_email],
    ['Certificate holder', coi.certificate_holder],
    ['Additional insured(s)', coi.additional_insured],
    ['Loss payee(s)', coi.loss_payee],
    ['Other named parties', coi.other_named_parties],
  ]
  const shown = facts.filter(([, val]) => !!val?.trim())
  if (!shown.length) return null
  return (
    <div style={card()}>
      <SectionTitle small>Insurer contact</SectionTitle>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 18, rowGap: 7 }}>
        {shown.map(([label, val]) => (
          <FactRow key={label} label={label} value={val!} />
        ))}
      </dl>
    </div>
  )
}

/**
 * One run from the online-check history: the values that were checked, their
 * web verdicts, the customer-facing blurb, and sources. The values render as
 * plain selectable text so the admin can copy-paste them straight into the
 * contact log dialog — a pasted value inherits this run's tag automatically.
 */
function CheckEntryCard({ entry, controls }: { entry: ContactCheckEntry; controls?: React.ReactNode }) {
  const phone = contactValue(entry.phone)
  const email = contactValue(entry.email)
  return (
    <div style={card()}>
      <p style={{ fontSize: 13, color: C.txt3, margin: 0 }}>
        {phone && (
          <span>Phone: <span style={{ color: C.txt, userSelect: 'all' as const }}>{phone}</span><NoteStatusChip status={entry.phone_status} /></span>
        )}
        {phone && email && <span style={{ margin: '0 8px' }}>|</span>}
        {email && (
          <span>Email: <span style={{ color: C.txt, userSelect: 'all' as const, overflowWrap: 'anywhere' }}>{email}</span><NoteStatusChip status={entry.email_status} /></span>
        )}
      </p>
      {entry.blurb && (
        <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, margin: '8px 0 0' }}>{entry.blurb}</p>
      )}
      <p style={{ fontSize: 12, color: C.txt3, margin: '6px 0 0', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
        {entry.sources.length > 0 && (
          <>Sources:{' '}
            {entry.sources.map((s, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                <a href={s} target="_blank" rel="noreferrer" style={{ color: C.txt2, textDecorationColor: C.border, textUnderlineOffset: 3 }}>{hostOf(s)}</a>
              </span>
            ))}
            {' · '}
          </>
        )}
        checked {pacificDateTime(entry.checked_at)}
        {entry.edited_at && <> · edited {pacificDateTime(entry.edited_at)}</>}
      </p>
      {controls}
    </div>
  )
}

/** Bare hostname for compact source links; falls back to the raw string. */
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

/**
 * Status tag on a contact log's phone/email. No status = the field exists but
 * no online check has covered it yet ("Not checked online"); blank fields
 * never reach this component at all.
 */
function NoteStatusChip({ status }: { status?: OnlineListingStatus }) {
  const s = status === 'verified' ? { label: 'Verified online', color: C.ok as string }
    : status === 'differs' ? { label: 'Differs from online', color: C.warn as string }
    : status === 'not_found' ? { label: 'Not found online', color: C.txt3 as string }
    : { label: 'Not checked online', color: C.txt3 as string }
  return (
    <span style={{
      marginLeft: 7, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const,
      color: s.color, background: status ? `color-mix(in oklch, ${s.color} 11%, transparent)` : 'transparent',
      border: status ? 'none' : `1px dashed ${C.border}`,
      padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' as const, verticalAlign: 'middle',
    }}>
      {s.label}
    </span>
  )
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ fontSize: 13, color: C.txt3 }}>{label}</dt>
      <dd style={{ fontSize: 13.5, color: C.txt, margin: 0, fontWeight: 500 }}>{value}</dd>
    </>
  )
}

/**
 * Display-only grouping of the flat COIExtracted shape: the raw field list is
 * hard to scan, so bucket it by who/what each field describes. Unknown keys
 * (prompt evolves) land in `other` so nothing silently disappears. The STORED
 * shape stays flat — the pipeline and customer views depend on it.
 */
function groupCoiExtracted(coi: Record<string, unknown>) {
  const groups: Record<string, string[]> = {
    insured_party: [
      'named_insured', 'named_insured_address', 'named_insured_state',
      'named_insured_phone', 'named_insured_email', 'usdot_number', 'mc_number',
    ],
    insurer_and_producer: [
      'insurance_company', 'insurance_company_contact', 'producer',
      'insurance_company_phone', 'insurance_company_email', 'insurance_company_address',
    ],
    parties_on_certificate: [
      'certificate_holder', 'additional_insured', 'loss_payee', 'other_named_parties',
    ],
    coverages: ['coverages'],
    terms_and_notes: ['additional_terms', 'raw_notes'],
  }
  const placed = new Set(Object.values(groups).flat())
  const out: Record<string, unknown> = {}
  for (const [group, keys] of Object.entries(groups)) {
    const section: Record<string, unknown> = {}
    for (const k of keys) if (k in coi) section[k] = coi[k]
    if (Object.keys(section).length) out[group] = group === 'coverages' ? section.coverages : section
  }
  const other: Record<string, unknown> = {}
  for (const k of Object.keys(coi)) if (!placed.has(k)) other[k] = coi[k]
  if (Object.keys(other).length) out.other = other
  return out
}

/** Call prep produced by extraction: what to ask the insurer to resolve the gaps. */
function QuestionsCard({ questions, extracted }: { questions: string[]; extracted: boolean }) {
  return (
    <div style={card()}>
      <SectionTitle small>Questions for the insurer</SectionTitle>
      {questions.length === 0 ? (
        <Muted>{extracted
          ? 'None generated. Re-run extraction to generate call questions from the gap analysis.'
          : 'Run extraction first; questions are generated from the gap analysis.'}</Muted>
      ) : (
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {questions.map((q, i) => (
            <li key={i} style={{ fontSize: 13.5, color: C.txt, lineHeight: 1.55 }}>{q}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

function JsonCard({ title, data }: { title: string; data: unknown }) {
  return (
    <div style={card()}>
      <SectionTitle small>{title}</SectionTitle>
      {data ? (
        <pre style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: C.txt2, background: C.paper, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, overflowX: 'auto', margin: 0, maxHeight: 280 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : <Muted>—</Muted>}
    </div>
  )
}
function SectionTitle({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <h2 style={{ fontSize: small ? 12 : 13, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: small ? '0 0 8px' : 0 }}>{children}</h2>
}
function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ color: C.txt3, fontSize: 13.5, margin: 0 }}>{children}</p>
}
const card = () => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 })
const smallBtn = () => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' })
const primaryBtn = () => ({ padding: '8px 20px', background: C.earthy, color: C.onDark, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer' })
