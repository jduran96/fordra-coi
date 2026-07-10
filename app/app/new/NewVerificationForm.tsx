'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Requirement } from '@/lib/types'
import { requirementKind } from '@/lib/types'
import type { RequirementTemplate } from '@/lib/templates'
import { editableRows, normalizeRequirementRows } from '@/lib/templates'
import { C } from '@/lib/theme'
import { DropZone, ManualRequirementsForm } from '@/components/UploadCards'
import RequirementsEditor, { BLANK_REQUIREMENT } from '@/components/RequirementsEditor'
import EditorModal from '@/components/EditorModal'
import { submitVerification } from '../actions'

/**
 * Opt-in condition checks offered in manual mode (pre-checked). These replace
 * the old always-on global baseline: the user decides per submission.
 */
const MANUAL_CHECKS = [
  {
    key: 'name_match',
    label: 'Check the policyholder name matches the carrier',
    line: (carrier: string) =>
      `Matching Policyholder Name: the named insured on the COI must be "${carrier}"; minor formatting differences or a DBA explicitly listing the carrier still count as a match`,
  },
  {
    key: 'policy_active',
    label: 'Check every policy is currently active',
    line: () =>
      'Policy Currently Active: every coverage on the COI must be in force today, with the effective date in the past and the expiration date in the future',
  },
] as const

export default function NewVerificationForm({ templates }: { templates: RequirementTemplate[] }) {
  const router = useRouter()
  const defaultTemplate = templates.find(t => t.is_default) ?? templates[0] ?? null

  const [carrier, setCarrier] = useState('')
  const [coiFile, setCoiFile] = useState<File | null>(null)
  const [rcsFile, setRcsFile] = useState<File | null>(null)
  const [templateId, setTemplateId] = useState<string>(defaultTemplate?.id ?? '')
  // The selected standard's rows, editable for this deal only (the saved
  // template is not changed). Variable rows show their human title here;
  // normalizeRequirementRows restores the {token} form at submit time.
  const [tplRows, setTplRows] = useState<Requirement[]>(
    defaultTemplate ? editableRows(defaultTemplate) : [],
  )
  const [tplDetails, setTplDetails] = useState(defaultTemplate?.details ?? '')
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  // Saved standards are the default entry point when the org has any.
  const [reqMode, setReqMode] = useState<'template' | 'manual' | 'upload'>(defaultTemplate ? 'template' : 'manual')
  const [reqFile, setReqFile] = useState<File | null>(null)
  const [manualReqs, setManualReqs] = useState<Requirement[]>([{ coverage_type: '', minimum_limit: '', notes: '', kind: 'limit' }])
  const [manualNotes, setManualNotes] = useState('')
  const [manualChecks, setManualChecks] = useState<Record<string, boolean>>({ name_match: true, policy_active: true })
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [hover, setHover] = useState(false)
  // Deal-only standards editing happens in a modal on DRAFT copies; Apply
  // validates via normalizeRequirementRows before committing to tplRows, so
  // the saved rows are always complete and every variable has its per-deal
  // prompt (an in-progress row can never half-derive into the page).
  const [stdEditorOpen, setStdEditorOpen] = useState(false)
  const [draftRows, setDraftRows] = useState<Requirement[]>([])
  const [draftDetails, setDraftDetails] = useState('')
  const [modalError, setModalError] = useState('')

  const template = templates.find(t => t.id === templateId) ?? null
  // Variables derive live from the (possibly edited) rows, so renaming or
  // adding a Variable row updates the per-deal inputs immediately.
  const normalizedTpl = normalizeRequirementRows(tplRows)
  const tplVars = normalizedTpl.variables
  const missingVar = tplVars.find(v => v.required && !varValues[v.key]?.trim())
  const cleanTplRows = normalizedTpl.requirements
  const listRows = tplRows.filter(r => r.coverage_type.trim())

  // A manual row counts when it has a name and either a limit or is a condition.
  const cleanReqs = manualReqs.filter(r =>
    r.coverage_type.trim() && (requirementKind(r) === 'condition' || r.minimum_limit.trim()))
  const checkedLines = MANUAL_CHECKS.filter(c => manualChecks[c.key])
  const reqReady = reqMode === 'template'
    ? !!template && !normalizedTpl.error && !missingVar && cleanTplRows.length > 0
    : reqMode === 'upload' ? !!reqFile : (cleanReqs.length > 0 || checkedLines.length > 0)
  const canSubmit = !!carrier.trim() && !!coiFile && reqReady && !pending

  function pickTemplate(id: string) {
    setTemplateId(id)
    setVarValues({})
    const t = templates.find(x => x.id === id)
    setTplRows(t ? editableRows(t) : [])
    setTplDetails(t?.details ?? '')
  }

  function openStdEditor() {
    setDraftRows(tplRows.length ? tplRows.map(r => ({ ...r })) : [{ ...BLANK_REQUIREMENT }])
    setDraftDetails(tplDetails)
    setModalError('')
    setStdEditorOpen(true)
  }

  function applyStdEdits() {
    const n = normalizeRequirementRows(draftRows)
    if (n.error) return setModalError(n.error)
    if (n.requirements.length === 0) return setModalError('Add at least one requirement row.')
    setTplRows(draftRows.filter(r => r.coverage_type.trim()))
    setTplDetails(draftDetails)
    // Drop values for variables that no longer exist so stale entries never
    // resolve into a submission.
    const keys = new Set(n.variables.map(v => v.key))
    setVarValues(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => keys.has(k))))
    setStdEditorOpen(false)
  }

  function serializeStandards(): string {
    const lines = cleanReqs.map(r => {
      const note = (r.notes ?? '').trim()
      const limit = r.minimum_limit.trim()
      return `${r.coverage_type.trim()}${limit ? `: ${limit}` : ''}${note ? ` (${note})` : ''}`
    })
    for (const c of checkedLines) lines.push(c.line(carrier.trim()))
    if (manualNotes.trim()) lines.push(`Additional details: ${manualNotes.trim()}`)
    return lines.join('\n')
  }

  async function handleSubmit() {
    setError('')
    if (!carrier.trim()) return setError('Carrier name is required.')
    if (!coiFile) return setError('Upload the carrier COI.')
    if (reqMode === 'template') {
      if (!template) return setError('Pick a saved standard, or switch to entering standards for this deal.')
      if (normalizedTpl.error) return setError(normalizedTpl.error)
      if (cleanTplRows.length === 0) return setError('The selected standard has no requirement rows left. Add at least one.')
      if (missingVar) return setError(`Enter ${missingVar.label.toLowerCase()} for the selected standard.`)
    } else {
      if (reqMode === 'upload' && !reqFile) return setError('Upload your insurance standards, or switch to manual entry.')
      if (reqMode === 'manual' && cleanReqs.length === 0 && checkedLines.length === 0) {
        return setError('Add at least one coverage or condition, or keep one of the standard checks selected.')
      }
    }

    setPending(true)
    const fd = new FormData()
    fd.append('carrier_name', carrier.trim())
    fd.append('coi_file', coiFile)
    if (rcsFile) fd.append('rcs_file', rcsFile)
    if (reqMode === 'template' && template) {
      fd.append('template_id', template.id)
      fd.append('template_rows', JSON.stringify(cleanTplRows))
      fd.append('template_details', tplDetails)
      for (const v of tplVars) fd.append(`template_var_${v.key}`, varValues[v.key] ?? '')
    } else if (reqMode === 'upload' && reqFile) {
      fd.append('requirements_file', reqFile)
    } else {
      fd.append('requirements_text', serializeStandards())
    }

    const res = await submitVerification(fd)
    if (res?.error) { setError(res.error); setPending(false); return }
    router.push('/app')
  }

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <Label>Carrier name</Label>
        <input
          value={carrier}
          onChange={e => setCarrier(e.target.value)}
          placeholder="e.g. ACME Trucking LLC"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '11px 14px', fontSize: 15,
            fontFamily: C.sans, border: `1.5px solid ${C.border}`, borderRadius: 8, outline: 'none',
            background: C.surface, color: C.txt,
          }}
        />
      </div>

      <DropZone
        boxTitle="Carrier's Certificate of Insurance"
        hint="PDF, JPG, or PNG scan of the COI (ACORD 25)"
        file={coiFile}
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={setCoiFile}
      />

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Label noMargin>Insurance Standards</Label>
          <div style={{ display: 'inline-flex', background: C.paper, borderRadius: 8, padding: 2, border: `1px solid ${C.border}` }}>
            {([
              ...(templates.length > 0 ? [['template', 'Saved template'] as const] : []),
              ['manual', 'Enter manually'] as const,
              ['upload', 'Upload doc'] as const,
            ]).map(([m, label]) => (
              <button key={m} type="button" onClick={() => setReqMode(m)}
                style={{
                  fontSize: 11, fontWeight: 600, fontFamily: C.sans, letterSpacing: '0.02em',
                  padding: '4px 10px', borderRadius: 6, border: 'none',
                  background: reqMode === m ? C.txt : 'transparent',
                  color: reqMode === m ? C.surface : C.txt3, cursor: 'pointer', transition: 'all 120ms',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {reqMode === 'template' && template ? (
          <div style={{
            border: `1.5px solid ${C.border}`, borderRadius: 12, padding: 16,
            background: C.surface, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div>
              <Label>Which saved standard to use</Label>
              <select
                value={templateId}
                onChange={e => pickTemplate(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 14, fontFamily: C.sans,
                  border: `1.5px solid ${C.border}`, borderRadius: 8, background: C.surface, color: C.txt,
                }}
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>
                ))}
              </select>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Label noMargin>Requirements checked on this deal</Label>
                <button type="button" onClick={openStdEditor} style={{
                  padding: '5px 14px', fontSize: 12, fontWeight: 600, fontFamily: C.sans,
                  borderRadius: 9999, border: `1px solid ${C.border}`, background: 'transparent',
                  color: C.txt2, cursor: 'pointer',
                }}>
                  Edit
                </button>
              </div>
              {listRows.length > 0 || tplDetails.trim() ? (
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {listRows.map((r, i) => {
                    const kind = requirementKind(r)
                    const note = (r.notes ?? '').trim()
                    return (
                      <li key={i} style={{ fontSize: 13.5, color: C.txt2, fontFamily: C.sans, lineHeight: 1.55 }}>
                        <strong style={{ color: C.txt, fontWeight: 600 }}>{r.coverage_type.trim()}</strong>
                        {kind === 'limit' && r.minimum_limit.trim() ? `: ${r.minimum_limit.trim()}` : ''}
                        {kind === 'variable' && (
                          <>: <em>{r.minimum_limit.trim()}</em> <span style={{ color: C.txt3 }}>(entered below)</span></>
                        )}
                        {note ? <span style={{ color: C.txt3 }}> ({note})</span> : null}
                      </li>
                    )
                  })}
                  {tplDetails.trim() && (
                    <li style={{ fontSize: 13.5, color: C.txt2, fontFamily: C.sans, lineHeight: 1.55 }}>
                      <strong style={{ color: C.txt, fontWeight: 600 }}>Additional details</strong>
                      <span style={{ color: C.txt3 }}>: {tplDetails.trim()}</span>
                    </li>
                  )}
                </ul>
              ) : (
                <p style={{ fontSize: 13, color: C.txt3, fontFamily: C.sans, margin: 0 }}>
                  This standard has no requirement rows yet. Click Edit to add them for this deal.
                </p>
              )}
            </div>
          </div>
        ) : reqMode === 'upload' ? (
          <DropZone
            boxTitle=""
            hint="PDF, DOCX, JPG, PNG, or TXT — list of required coverages and limits"
            file={reqFile}
            accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={setReqFile}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ManualRequirementsForm rows={manualReqs} onChange={setManualReqs} notes={manualNotes} onNotesChange={setManualNotes} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: C.txt3, fontFamily: C.sans,
              }}>
                Standard checks <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>(included when checked)</span>
              </span>
              {MANUAL_CHECKS.map(c => (
                <label key={c.key} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, color: C.txt2, fontFamily: C.sans, cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={!!manualChecks[c.key]}
                    onChange={e => setManualChecks({ ...manualChecks, [c.key]: e.target.checked })}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {reqMode === 'template' && template && tplVars.length > 0 && (
        <div style={{
          border: `1.5px solid ${C.border}`, borderRadius: 12, padding: 16,
          background: C.surface, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: C.txt, fontFamily: C.sans, margin: 0 }}>
            This standard needs the following for each deal:
          </p>
          {tplVars.map(v => (
            <div key={v.key}>
              <Label>
                {v.label}
                {v.required && <span style={{ color: C.error, marginLeft: 4 }} title="Required">*</span>}
              </Label>
              <input
                value={varValues[v.key] ?? ''}
                onChange={e => setVarValues({ ...varValues, [v.key]: e.target.value })}
                placeholder="e.g. $85,000 or 2021 Freightliner Cascadia"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14,
                  fontFamily: C.sans, border: `1.5px solid ${C.border}`, borderRadius: 8, outline: 'none',
                  background: C.surface, color: C.txt,
                }}
              />
            </div>
          ))}
        </div>
      )}

      <DropZone
        boxTitle="Rate Confirmation Sheet (optional)"
        hint="PDF, JPG, or PNG of the rate confirmation"
        file={rcsFile}
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={setRcsFile}
      />

      {error && <p style={{ fontSize: 13, color: C.error, fontFamily: C.sans, margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
          style={{
            padding: '13px 26px', fontSize: 15, fontWeight: 600, fontFamily: C.sans,
            borderRadius: 9999, border: 'none',
            background: !canSubmit ? C.border : hover ? C.lime : C.txt,
            color: !canSubmit ? C.txt3 : hover ? C.txt : C.onDark,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'background 120ms, color 120ms', opacity: pending ? 0.7 : 1,
          }}>
          {pending ? 'Submitting…' : 'Submit for review'}
        </button>
        <Link href="/app" style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, textDecoration: 'none' }}>Cancel</Link>
      </div>

      {stdEditorOpen && (
        <EditorModal title="Edit standards for this deal" onClose={() => setStdEditorOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: 12.5, color: C.txt3, fontFamily: C.sans, margin: 0 }}>
              You can edit the inputs below. The saved standard will not be changed.
            </p>
            <RequirementsEditor rows={draftRows} onChange={setDraftRows} reorderable={false} />
            <div>
              <Label>Other required coverage details <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></Label>
              <textarea
                value={draftDetails}
                onChange={e => setDraftDetails(e.target.value)}
                placeholder="Anything the rows above didn't capture: extra coverages, conditions, endorsements, etc."
                rows={2}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 13,
                  fontFamily: C.sans, borderRadius: 6, border: `1.5px solid ${C.border}`,
                  background: C.surface, color: C.txt, outline: 'none',
                  resize: 'vertical', minHeight: 48,
                }}
              />
            </div>
            {modalError && <p style={{ fontSize: 13, color: C.error, fontFamily: C.sans, margin: 0 }}>{modalError}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={applyStdEdits} style={{
                padding: '9px 18px', fontSize: 13, fontWeight: 600, fontFamily: C.sans,
                borderRadius: 9999, border: 'none', background: C.txt, color: C.onDark, cursor: 'pointer',
              }}>
                Apply changes
              </button>
              <button type="button" onClick={() => setStdEditorOpen(false)} style={{
                padding: '9px 18px', fontSize: 13, fontWeight: 600, fontFamily: C.sans,
                borderRadius: 9999, border: `1px solid ${C.border}`, background: 'transparent', color: C.txt2, cursor: 'pointer',
              }}>
                Cancel
              </button>
            </div>
          </div>
        </EditorModal>
      )}
    </div>
  )
}

function Label({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: C.txt3, fontFamily: C.sans, display: 'block', marginBottom: noMargin ? 0 : 8,
    }}>
      {children}
    </span>
  )
}
