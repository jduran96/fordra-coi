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
import { caseAge, ageTitle } from '@/lib/sla'
import { humanizeToken, parseStandardLine } from '@/lib/templates'
import { orderBySubmitted, orderFromRequirements } from '@/lib/gap-order'
import type { ContactCheckEntry, ContactNote, OnlineListingStatus } from '@/lib/types'
import { contactValue } from '@/lib/contact-notes'
import PendingButton from '@/components/PendingButton'
import AdminTabs from '@/components/AdminTabs'
import AssessmentForm from '@/components/AssessmentForm'
import CallNoteForm from '@/components/CallNoteForm'
import NoteCheckControls from '@/components/NoteCheckControls'
import ContactCheckTask from '@/components/ContactCheckTask'
import { runExtraction, runOnlineContactCheck, saveContactCheckEdit, saveCallNote, saveAssessment, saveNoteCheck, deleteCallNote, updateCallNote, updateInsuredName, logAdminActivity, deleteAdminActivity } from '../actions'
import { normalizeActivity } from '@/lib/admin-activity'
import DeleteNoteButton from './DeleteNoteButton'
import EditNoteButton from './EditNoteButton'
import ActivityLog from './ActivityLog'
import ActivityFeed from '@/components/ActivityFeed'
import { feedEntries } from '@/lib/activity-feed'
import AiCallLauncher from './AiCallLauncher'
import AgentQuestionsEditor from './AgentQuestionsEditor'
import RunAnalysisButton from './RunAnalysisButton'
import { type AiCall } from '@/lib/ai-calls'
import { getCallConfig, getReferenceDetails } from '@/lib/config'
import { draftFromVerification, CONTEXT_FIELD_NAMES, type CallContextFields } from '@/lib/call-config'
import type { COIExtracted, Requirement as RequirementRow } from '@/lib/types'

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

  // Status history (submissions, publishes, reopens) for the Activity popup —
  // the same customer-visible feed the /app report shows, distinct from the
  // admin-only ActivityLog bookkeeping beside it.
  const { data: eventRows } = await supabase
    .from('events')
    .select('type, created_at')
    .eq('verification_id', id)
    .order('created_at', { ascending: false })
  const statusFeed = feedEntries({ created_at: String(v.created_at), display_id: v.display_id }, eventRows ?? [])

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
  // them on the object, API on the { type: 'template' } entry).
  const templateVariables = (() => {
    const r = v.requirements as { variables?: Record<string, string> } | { type?: string; variables?: Record<string, string> }[] | null
    const vars = Array.isArray(r) ? r.find(x => x?.type === 'template')?.variables : r?.variables
    return Object.entries(vars ?? {})
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

  // AI voice-agent calls for this verification (ai_calls, migration 0032):
  // the launcher's modal covers the whole lifecycle (draft prefill, live
  // panel, finished call), the table lists dispatched calls.
  const { data: aiCallRows, error: aiCallsErr } = await supabase
    .from('ai_calls')
    .select('*')
    .eq('verification_id', id)
    .order('created_at', { ascending: false })
  if (aiCallsErr) throw new Error(`Could not load AI calls: ${aiCallsErr.message}`)
  const allAiRows = (aiCallRows ?? []) as AiCall[]
  const aiCalls = allAiRows.filter(c => c.status !== 'draft')
  const aiDraft = allAiRows.find(c => c.status === 'draft') ?? null

  // Pre-dial prefill for the launcher modal: COI extraction + org call config,
  // overridden by the saved draft's own edits (same merge the old /call page did).
  const callConfig = await getCallConfig(v.org_id as string | null)
  const orgDetails = await getReferenceDetails(v.org_id as string | null)
  const callPrefill = draftFromVerification({
    displayId: String(v.display_id ?? ''),
    agentQuestions: v.agent_questions,
    coi: coi as COIExtracted | null,
    requirements: (Array.isArray(v.requirements_normalized) ? v.requirements_normalized : []) as RequirementRow[],
    contactChecks: checks,
    insuranceContact: (v.insurance_contact ?? null) as { name?: string; phone?: string; email?: string } | null,
    config: callConfig,
    orgDetails,
  })
  const draftInput = (aiDraft?.draft_input ?? null) as (Partial<CallContextFields> & { details_json?: string }) | null
  // Only known fields survive the merge: drafts saved before a schema change
  // may carry retired keys that must not leak back into the payload.
  const draftContext: Partial<CallContextFields> = {}
  if (draftInput) {
    for (const name of CONTEXT_FIELD_NAMES) {
      const val = (draftInput as Record<string, unknown>)[name]
      if (typeof val === 'string') (draftContext as Record<string, string>)[name] = val
    }
  }
  const callContext: CallContextFields = draftInput ? { ...callPrefill.context, ...draftContext } : callPrefill.context
  // Questions always come from the master list (the AI tab editor), never the
  // draft: the modal no longer edits them and dispatch re-reads the master.
  const callQuestions = callPrefill.questions
  const callDetails = (() => {
    if (!draftInput?.details_json) return callPrefill.details
    try {
      const parsed = JSON.parse(draftInput.details_json)
      return Array.isArray(parsed) ? parsed : callPrefill.details
    } catch {
      return callPrefill.details
    }
  })()

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
    const rows = [...base, ...missing.map(r => ({ requirement: r, status: 'uncertain' as const, evidence: '' }))]
    // Rows display in submitted order, not grouped by verdict.
    return orderBySubmitted(rows, orderFromRequirements(parsed))
  })()
  const summaryDefault = (v.final_report as { narrative_summary?: string } | null)?.narrative_summary ?? ''

  return (
    <div style={{ fontFamily: C.sans, color: C.txt, maxWidth: 860 }}>
      <Link href="/admin" style={{ color: C.txt2, fontSize: 14, textDecoration: 'none' }}>← Queue</Link>
      <div className="fx-wrap" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 4px' }}>
        <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: 0, fontWeight: 400, lineHeight: 1.2 }}>{v.insured_name || v.display_id}</h1>
        <span style={{ fontSize: 12, fontWeight: 600, color: statusCol, background: `color-mix(in oklch, ${statusCol} 12%, transparent)`, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{adminStatus}</span>
        {/* Working-day age against the same-day target, red from 3 days.
            Only open cases: a closed one is no longer against the clock. */}
        {!caseIsClosed && <AgeChip iso={String(v.created_at)} />}
        <span className="fx-unpin" style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <ActivityFeed entries={statusFeed} />
          <ActivityLog
            entries={normalizeActivity(v.admin_activity)}
            logAction={logAdminActivity.bind(null, id)}
            deleteAction={deleteAdminActivity.bind(null, id)}
          />
        </span>
      </div>
      <p style={{ color: C.txt3, fontSize: 13, margin: '0 0 12px' }}>
        {v.display_id} · {(v.orgs as { name?: string } | null)?.name ?? '—'} · {v.source} · {pacificDateTime(v.created_at)}
      </p>

      {/* Every uploaded document, one tap from anywhere on the page. The
          review flow is "read the standards, open the COI in another tab",
          so these must not be buried under a tab. */}
      {docsWithUrls.some(d => d.url) && (
        <div className="fx-scroll-x" style={{ display: 'flex', gap: 8, margin: '0 0 20px', paddingBottom: 2 }}>
          {docsWithUrls.filter(d => d.url).map(d => (
            <a key={d.id} href={d.url!} target="_blank" rel="noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
              fontSize: 12.5, fontWeight: 600, color: C.txt, textDecoration: 'none',
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9999,
              padding: '7px 14px', whiteSpace: 'nowrap',
            }}>
              {docChipLabel(d.kind)} ↗
            </a>
          ))}
        </div>
      )}

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
              <dl className="fx-facts" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 18, rowGap: 7 }}>
                <dt style={{ fontSize: 13, color: C.txt3, alignSelf: 'center' }}>Insured name</dt>
                <dd style={{ margin: 0 }}>
                  {caseIsClosed ? (
                    <span style={{ fontSize: 13.5, color: C.txt, fontWeight: 500 }}>{v.insured_name || '—'}</span>
                  ) : (
                    /* Extraction stamps this from the COI's named insured;
                       editable here in case it misread. Keyed by the value so
                       a revalidated save remounts with fresh defaults (React
                       otherwise restores the stale defaultValue after a form
                       action). Re-running extraction re-stamps it. */
                    <form key={String(v.insured_name ?? '')} action={updateInsuredName.bind(null, id)} style={{ display: 'flex', gap: 8 }}>
                      <input
                        name="insured_name"
                        defaultValue={String(v.insured_name ?? '')}
                        placeholder="Filled from the COI by extraction"
                        style={{
                          flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '5px 10px',
                          fontSize: 13.5, fontWeight: 500, fontFamily: C.sans, color: C.txt,
                          border: `1.5px solid ${C.border}`, borderRadius: 6, background: C.surface, outline: 'none',
                        }}
                      />
                      <PendingButton pendingLabel="Saving…" style={{
                        padding: '5px 14px', fontSize: 12, fontWeight: 600, fontFamily: C.sans,
                        borderRadius: 9999, border: `1px solid ${C.border}`, background: 'transparent',
                        color: C.txt2, cursor: 'pointer',
                      }}>
                        Save
                      </PendingButton>
                    </form>
                  )}
                </dd>
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
                <dl className="fx-facts" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 18, rowGap: 7 }}>
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
          <div className="fx-wrap" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SectionTitle>OCR Analysis</SectionTitle>
            <form action={runExtraction.bind(null, id)} className="fx-unpin" style={{ marginLeft: 'auto' }}>
              <PendingButton pendingLabel="Extracting… (can take a minute)" style={smallBtn()}>
                {v.coi_extracted ? 'Rerun extraction' : 'Run extraction'}
              </PendingButton>
            </form>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {!v.coi_extracted && <Muted>Not extracted yet. Run extraction to parse the COI & requirements.</Muted>}
            <JsonCard title="Requirements (normalized)" data={v.requirements_normalized} />
            <JsonCard title="COI extracted" data={coi ? groupCoiExtracted(coi as unknown as Record<string, unknown>) : v.coi_extracted} />
          </div>
        </section>
        ) },

        { label: 'Outreach', content: (
        <section>
          {/* Who to call (from the COI) + the contact web check, one section.
              The check is the ONE place a contact web search runs (manually
              triggered, never part of extraction — each run spends web
              searches). Prefilled from the COI, values editable; every run is
              kept as history and contact logs inherit tags by citing a
              checked value. */}
          <SectionTitle>Call prep</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {coi
              ? <InsurerCard coi={coi} />
              : <Muted>Run extraction (OCR tab) to pull the insurer contact off the COI.</Muted>}
            {!!v.coi_extracted && (
              <div style={card()}>
                <SectionTitle small>Contact check</SectionTitle>
                {!caseIsClosed && (
                  <ContactCheckTask
                    defaultPhone={contactValue(coi?.insurance_company_phone)}
                    defaultEmail={contactValue(coi?.insurance_company_email)}
                    hasChecks={checks.length > 0}
                    runAction={runOnlineContactCheck.bind(null, id)}
                  />
                )}
                {checks.length > 0 && (
                  <div className="fx-scroll-x" style={{ marginTop: 12, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                    <table style={{ width: '100%', minWidth: 380, borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          <th style={checkTh}>Checked</th><th style={checkTh}>Phone</th><th style={checkTh}>Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checks.slice().reverse().map(e => (
                          <tr key={e.checked_at} style={{ borderTop: `1px solid ${C.border}` }}>
                            <td style={{ ...checkTd, color: C.txt3, whiteSpace: 'nowrap' }}>{pacificDateTime(e.checked_at)}</td>
                            {/* Value on its own line, tag centered beneath it —
                                inline chips widowed onto a second line at
                                narrow widths (owner call 2026-07-29). */}
                            <td style={checkTd}>{contactValue(e.phone) ? (
                              <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                <span>{contactValue(e.phone)}</span>
                                <NoteStatusChip status={e.phone_status} stacked />
                              </span>
                            ) : '—'}</td>
                            <td style={{ ...checkTd, overflowWrap: 'anywhere' }}>{contactValue(e.email) ? (
                              <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
                                <span style={{ overflowWrap: 'anywhere' }}>{contactValue(e.email)}</span>
                                <NoteStatusChip status={e.email_status} stacked />
                              </span>
                            ) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {/* The latest run's write-up + sources, editable in place
                    (statuses/blurb edits propagate to logs citing the value).
                    Keyed by content: remount on fresh data after a save
                    (React 19 stale-defaultValue workaround). */}
                {checks.length > 0 && (() => {
                  const latest = checks[checks.length - 1]
                  return (
                    <div style={{ marginTop: 12 }}>
                      {latest.blurb && (
                        <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, margin: 0 }}>{latest.blurb}</p>
                      )}
                      <p style={{ fontSize: 12, color: C.txt3, margin: '6px 0 0', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                        {latest.sources.length > 0 && (
                          <>Sources: {latest.sources.map((s, i) => (
                            <span key={i}>{i > 0 && ' · '}<a href={s} target="_blank" rel="noreferrer" style={{ color: C.txt2, textDecorationColor: C.border, textUnderlineOffset: 3 }}>{hostOf(s)}</a></span>
                          ))} · </>
                        )}
                        latest check {pacificDateTime(latest.checked_at)}
                        {latest.edited_at && <> · edited {pacificDateTime(latest.edited_at)}</>}
                        {latest.usage && <> · {usageLine(latest.usage)}</>}
                      </p>
                      {!caseIsClosed && (
                        <NoteCheckControls
                          key={JSON.stringify(latest)}
                          check={latest}
                          saveAction={saveContactCheckEdit.bind(null, id, latest.checked_at)}
                        />
                      )}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        </section>
        ) },

        { label: 'AI', content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {/* Master question list: edits persist on the verification and prefill
            every new call. Keyed by the data so a revalidated save remounts
            with fresh state (same React 19 staleness fix as AssessmentForm). */}
        <section>
          <SectionTitle>Questions</SectionTitle>
          <div style={{ marginTop: 10 }}>
            <AgentQuestionsEditor
              key={JSON.stringify(callPrefill.questions)}
              verificationId={id}
              questions={callPrefill.questions}
              caseIsClosed={caseIsClosed}
            />
          </div>
        </section>

        {/* AI verification calls: the launcher modal is the whole lifecycle
            (pre-dial review gate → live call + kill switch → summary/
            transcript + add-to-contact-log); the table is the audit history. */}
        <section>
          <SectionTitle>AI Calls</SectionTitle>
          <div style={{ marginTop: 10 }}>
            <AiCallLauncher
              verificationId={id}
              context={callContext}
              questions={callQuestions}
              details={callDetails}
              numbers={callPrefill.numbers}
              coiPhone={coi?.insurance_company_phone ?? ''}
              draftId={aiDraft?.id ?? null}
              caseIsClosed={caseIsClosed}
              calls={aiCalls}
            />
          </div>
        </section>

        {/* Insurer contact log (calls, emails, texts): input first, entries below. */}
        <section>
          <SectionTitle>Insurer Contact Log</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {caseIsClosed ? (
              <Muted>This case is closed. Click Edit Status below to reopen it before adding contact logs.</Muted>
            ) : (
              <CallNoteForm action={saveCallNote.bind(null, id)} />
            )}
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
          </div>
        </section>
        </div>
        ) },

        { label: 'Analysis', content: (
        <div className="fx-wrap" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SectionTitle>Assessment</SectionTitle>
          {/* Generates verdicts + draft summary from the OCR extraction AND
              the contact log — deliberately its own step, never part of Run
              extraction. Each run replaces the draft below. */}
          {!caseIsClosed && (
            <span className="fx-unpin" style={{ marginLeft: 'auto' }}>
              <RunAnalysisButton verificationId={id} />
            </span>
          )}
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
          slackNotifiable={v.source === 'slack' && !!v.slack_context}
        />
      }
      />
    </div>
  )
}

/** Short label for the document quick-link chips. `rcs` is the legacy
 *  storage kind for "any other document the submitter attached". */
function docChipLabel(kind: string): string {
  if (kind === 'coi') return 'COI'
  if (kind === 'requirements') return 'Standards'
  if (kind === 'rcs') return 'Other'
  return kind
}

/** Working-day age of an open case: green today, amber at 1-2, red from 3. */
function AgeChip({ iso }: { iso: string }) {
  const age = caseAge(iso)
  return (
    <span title={ageTitle(age)} style={{
      fontSize: 12, fontWeight: 700, color: age.color,
      background: `color-mix(in oklch, ${age.color} 13%, transparent)`,
      padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap',
    }}>
      {age.label}
    </span>
  )
}

/** Who to call: the producer (agency) named on the COI. Everything else the
 *  COI says lives on the OCR tab; this card is only the outreach target. */
function InsurerCard({ coi }: { coi: COI }) {
  const facts: [string, string | undefined][] = [
    ['Producer', coi.producer],
    ['Producer address', coi.insurance_company_address],
    ['Producer phone', coi.insurance_company_phone],
    ['Producer email', coi.insurance_company_email],
    ['Contact name', coi.insurance_company_contact],
    ['Insurance company(s)', coi.insurance_company],
  ]
  const shown = facts.filter(([, val]) => !!val?.trim())
  if (!shown.length) return null
  return (
    <div style={card()}>
      <SectionTitle small>Insurer contact</SectionTitle>
      <dl className="fx-facts" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 18, rowGap: 7 }}>
        {shown.map(([label, val]) => (
          <FactRow key={label} label={label} value={val!} />
        ))}
      </dl>
    </div>
  )
}

/**
 * Compact run telemetry: what the check actually spent. cost_usd is computed
 * at run time with the model's own rates (lib/claude.ts), so historical
 * entries stay correct across model changes.
 */
function usageLine(u: NonNullable<ContactCheckEntry['usage']>): string {
  const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  const base = `${u.searches} search${u.searches === 1 ? '' : 'es'} · ${k(u.input_tokens)} in / ${k(u.output_tokens)} out`
  return u.cost_usd != null ? `${base} · $${u.cost_usd.toFixed(2)}` : base
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
function NoteStatusChip({ status, stacked }: { status?: OnlineListingStatus; stacked?: boolean }) {
  const s = status === 'verified' ? { label: 'Found', color: C.ok as string }
    : status === 'differs' ? { label: 'Warning', color: C.error as string }
    : status === 'not_found' ? { label: 'Not Found', color: C.warn as string }
    : { label: 'Not checked online', color: C.txt3 as string }
  return (
    <span style={{
      marginLeft: stacked ? 0 : 7, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const,
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

/**
 * Extraction output, rendered as readable label/value rows rather than a raw
 * JSON dump. The dump forced horizontal scrolling on every long value (and was
 * unusable on a phone); this wraps instead, so nothing ever scrolls sideways.
 * The raw JSON stays one tap away for when the exact stored shape matters.
 */
function JsonCard({ title, data }: { title: string; data: unknown }) {
  return (
    <div style={card()}>
      <SectionTitle small>{title}</SectionTitle>
      {data ? (
        <>
          <DataView value={data} />
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 12, fontWeight: 600, color: C.txt3, cursor: 'pointer' }}>Raw JSON</summary>
            <pre style={{ fontFamily: C.mono, fontSize: 11.5, color: C.txt2, background: C.paper, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, margin: '8px 0 0', maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </>
      ) : <Muted>—</Muted>}
    </div>
  )
}

/** True for values that should render as a dash rather than an empty row. */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && !v.trim())
}

/**
 * Recursive renderer for extraction JSON. Objects become labelled rows, arrays
 * of objects become numbered blocks (the coverages list), and every value
 * wraps. Keys are humanized (`named_insured` -> "Named insured") but nothing
 * is dropped: unknown keys render just like known ones.
 */
function DataView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isBlank(value)) return <span style={{ fontSize: 13, color: C.txt3 }}>—</span>

  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ fontSize: 13, color: C.txt3 }}>None</span>
    // Arrays of primitives (VIN lists, notes) read best as plain lines.
    if (value.every(v => typeof v !== 'object' || v === null)) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {value.map((v, i) => (
            <span key={i} style={{ fontSize: 13.5, color: C.txt, overflowWrap: 'anywhere' }}>{String(v)}</span>
          ))}
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {value.map((v, i) => (
          <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: C.paper }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: C.txt3, marginBottom: 6 }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <DataView value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span style={{ fontSize: 13, color: C.txt3 }}>—</span>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: depth === 0 ? 10 : 7 }}>
        {entries.map(([k, v]) => {
          const nested = !isBlank(v) && typeof v === 'object'
          return (
            <div key={k} style={nested
              ? { borderTop: depth === 0 ? `1px solid ${C.border}` : 'none', paddingTop: depth === 0 ? 10 : 0 }
              : undefined}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.txt3 }}>
                {humanizeToken(k)}
              </div>
              <div style={{ marginTop: nested ? 8 : 2 }}>
                <DataView value={v} depth={depth + 1} />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <span style={{ fontSize: 13.5, color: C.txt, fontWeight: 500, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
      {String(value)}
    </span>
  )
}
function SectionTitle({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <h2 style={{ fontSize: small ? 12 : 13, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: small ? '0 0 8px' : 0 }}>{children}</h2>
}
function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ color: C.txt3, fontSize: 13.5, margin: 0 }}>{children}</p>
}
const card = () => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 })
const checkTh: React.CSSProperties = { padding: '8px 12px', fontWeight: 600 }
const checkTd: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' }
const smallBtn = () => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' })
