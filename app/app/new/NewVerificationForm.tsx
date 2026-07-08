'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Requirement } from '@/lib/types'
import type { RequirementTemplate } from '@/lib/templates'
import { C } from '@/lib/theme'
import { DropZone, ManualRequirementsForm, formatCurrencyInput, parseCurrencyAmount } from '@/components/UploadCards'
import { submitVerification } from '../actions'

export default function NewVerificationForm({ templates }: { templates: RequirementTemplate[] }) {
  const router = useRouter()
  const defaultTemplate = templates.find(t => t.is_default) ?? templates[0] ?? null

  const [carrier, setCarrier] = useState('')
  const [coiFile, setCoiFile] = useState<File | null>(null)
  const [rcsFile, setRcsFile] = useState<File | null>(null)
  // Saved standards are the default entry point when the org has any.
  const [useTemplate, setUseTemplate] = useState(!!defaultTemplate)
  const [templateId, setTemplateId] = useState<string>(defaultTemplate?.id ?? '')
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  const [reqMode, setReqMode] = useState<'upload' | 'manual'>('upload')
  const [reqFile, setReqFile] = useState<File | null>(null)
  const [manualReqs, setManualReqs] = useState<Requirement[]>([{ coverage_type: '', minimum_limit: '', notes: '' }])
  const [manualNotes, setManualNotes] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [hover, setHover] = useState(false)

  const template = templates.find(t => t.id === templateId) ?? null
  const varsReady = !template || (template.variables ?? []).every(v => !v.required || !!varValues[v.key]?.trim())

  const cleanReqs = manualReqs.filter(r => r.coverage_type.trim() && parseCurrencyAmount(r.minimum_limit))
  const reqReady = useTemplate
    ? !!template && varsReady
    : reqMode === 'upload' ? !!reqFile : cleanReqs.length > 0
  const canSubmit = !!carrier.trim() && !!coiFile && reqReady && !pending

  function serializeStandards(): string {
    const lines = cleanReqs.map(r => {
      const note = (r.notes ?? '').trim()
      return `${r.coverage_type.trim()}: ${r.minimum_limit.trim()}${note ? ` (${note})` : ''}`
    })
    if (manualNotes.trim()) lines.push(`Additional details: ${manualNotes.trim()}`)
    return lines.join('\n')
  }

  async function handleSubmit() {
    setError('')
    if (!carrier.trim()) return setError('Carrier name is required.')
    if (!coiFile) return setError('Upload the carrier COI.')
    if (useTemplate) {
      if (!template) return setError('Pick a saved standard, or switch to entering standards for this deal.')
      if (!varsReady) return setError('Fill in the deal details for the selected standard.')
    } else {
      if (reqMode === 'upload' && !reqFile) return setError('Upload your insurance standards, or switch to manual entry.')
      if (reqMode === 'manual' && cleanReqs.length === 0) return setError('Add at least one coverage with a minimum limit.')
    }

    setPending(true)
    const fd = new FormData()
    fd.append('carrier_name', carrier.trim())
    fd.append('coi_file', coiFile)
    if (rcsFile) fd.append('rcs_file', rcsFile)
    if (useTemplate && template) {
      fd.append('template_id', template.id)
      for (const v of template.variables ?? []) fd.append(`template_var_${v.key}`, varValues[v.key] ?? '')
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
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>
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
          {!useTemplate && (
            <div style={{ display: 'inline-flex', background: C.paper, borderRadius: 8, padding: 2, border: `1px solid ${C.border}` }}>
              {([['upload', 'Upload file'], ['manual', 'Enter manually']] as const).map(([m, label]) => (
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
          )}
        </div>

        {templates.length > 0 && (
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            fontSize: 13.5, color: C.txt2, fontFamily: C.sans, cursor: 'pointer',
          }}>
            <input type="checkbox" checked={useTemplate} onChange={e => setUseTemplate(e.target.checked)} />
            Use a saved standard
          </label>
        )}

        {useTemplate && template ? (
          <div style={{
            border: `1.5px solid ${C.border}`, borderRadius: 12, padding: 16,
            background: C.surface, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <select
                value={templateId}
                onChange={e => { setTemplateId(e.target.value); setVarValues({}) }}
                style={{
                  flex: 1, padding: '9px 12px', fontSize: 14, fontFamily: C.sans,
                  border: `1.5px solid ${C.border}`, borderRadius: 8, background: C.surface, color: C.txt,
                }}
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>
                ))}
              </select>
              <Link href="/app/settings" style={{ fontSize: 12.5, color: C.txt3, fontFamily: C.sans, whiteSpace: 'nowrap' }}>
                Manage
              </Link>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {template.requirements.map((r, i) => (
                <p key={i} style={{ fontSize: 12.5, color: C.txt2, fontFamily: C.sans, margin: 0 }}>
                  <span style={{ fontWeight: 600, color: C.txt }}>{r.coverage_type}</span>
                  {r.minimum_limit ? `: ${r.minimum_limit}` : ''}
                  {r.notes ? <span style={{ color: C.txt3 }}> — {r.notes}</span> : null}
                </p>
              ))}
            </div>

            {(template.variables ?? []).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                {(template.variables ?? []).map(v => (
                  <div key={v.key}>
                    <Label>{v.label}</Label>
                    <input
                      value={varValues[v.key] ?? ''}
                      inputMode={v.type === 'currency' ? 'numeric' : undefined}
                      onChange={e => setVarValues({
                        ...varValues,
                        [v.key]: v.type === 'currency' ? formatCurrencyInput(e.target.value) : e.target.value,
                      })}
                      placeholder={v.type === 'currency' ? 'e.g. $85,000' : ''}
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
          <ManualRequirementsForm rows={manualReqs} onChange={setManualReqs} notes={manualNotes} onNotesChange={setManualNotes} />
        )}
      </div>

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
