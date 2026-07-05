'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Requirement } from '@/lib/types'
import { C } from '@/lib/theme'
import { DropZone, ManualRequirementsForm, parseCurrencyAmount } from '@/components/UploadCards'
import { submitVerification } from '../actions'

export default function NewVerificationForm() {
  const router = useRouter()
  const [carrier, setCarrier] = useState('')
  const [coiFile, setCoiFile] = useState<File | null>(null)
  const [rcsFile, setRcsFile] = useState<File | null>(null)
  const [reqMode, setReqMode] = useState<'upload' | 'manual'>('upload')
  const [reqFile, setReqFile] = useState<File | null>(null)
  const [manualReqs, setManualReqs] = useState<Requirement[]>([{ coverage_type: '', minimum_limit: '', notes: '' }])
  const [manualNotes, setManualNotes] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [hover, setHover] = useState(false)

  const cleanReqs = manualReqs.filter(r => r.coverage_type.trim() && parseCurrencyAmount(r.minimum_limit))
  const reqReady = reqMode === 'upload' ? !!reqFile : cleanReqs.length > 0
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
    if (reqMode === 'upload' && !reqFile) return setError('Upload your insurance standards, or switch to manual entry.')
    if (reqMode === 'manual' && cleanReqs.length === 0) return setError('Add at least one coverage with a minimum limit.')

    setPending(true)
    const fd = new FormData()
    fd.append('carrier_name', carrier.trim())
    fd.append('coi_file', coiFile)
    if (rcsFile) fd.append('rcs_file', rcsFile)
    if (reqMode === 'upload' && reqFile) fd.append('requirements_file', reqFile)
    else fd.append('requirements_text', serializeStandards())

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
        </div>
        {reqMode === 'upload' ? (
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
