'use client'

import { useState, useTransition } from 'react'
import type { Requirement } from '@/lib/types'
import type { RequirementTemplate } from '@/lib/templates'
import { editableRows } from '@/lib/templates'
import { C } from '@/lib/theme'
import RequirementsEditor, { BLANK_REQUIREMENT } from '@/components/RequirementsEditor'
import EditorModal from '@/components/EditorModal'
import { saveOrgTemplate, deleteOrgTemplate } from './actions'

/**
 * Admin-side authoring of an org's insurance-standards templates. Saved rows
 * land in the same requirement_templates table the org edits on /app/settings,
 * so a standard created here shows up there immediately. Mirrors the card
 * styling of app/app/settings/SettingsClient.tsx.
 */

const inputS = {
  width: '100%', boxSizing: 'border-box' as const, padding: '10px 12px', fontSize: 13,
  fontFamily: C.sans, borderRadius: 6, border: `1.5px solid ${C.border}`,
  background: C.surface, color: C.txt, outline: 'none',
}
const labelS = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
  color: C.txt3, fontFamily: C.sans, display: 'block', marginBottom: 8,
}
const cardS = {
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20,
}
const pillS = (primary: boolean, disabled = false) => ({
  padding: '9px 18px', fontSize: 13, fontWeight: 600, fontFamily: C.sans,
  borderRadius: 9999, border: primary ? 'none' : `1px solid ${C.border}`,
  background: disabled ? C.border : primary ? C.txt : 'transparent',
  color: disabled ? C.txt3 : primary ? C.onDark : C.txt2,
  cursor: disabled ? 'not-allowed' : 'pointer',
})

export default function OrgStandards({ orgs, templates, starterRows }: {
  orgs: { id: string; name: string }[]
  templates: RequirementTemplate[]
  starterRows: Requirement[]
}) {
  const [orgId, setOrgId] = useState<string>(orgs[0]?.id ?? '')
  // null = closed; 'new' = creating; otherwise the template id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<Requirement[]>([])
  const [details, setDetails] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  const orgTemplates = templates.filter(t => t.org_id === orgId)

  function openNew() {
    setEditing('new')
    setName('')
    setRows([...starterRows.map(r => ({ ...r })), { ...BLANK_REQUIREMENT }])
    setDetails('')
    setIsDefault(orgTemplates.length === 0)
    setError('')
  }
  function openEdit(t: RequirementTemplate) {
    setEditing(t.id)
    setName(t.name)
    const editRows = editableRows(t)
    setRows(editRows.length ? editRows : [{ ...BLANK_REQUIREMENT }])
    setDetails(t.details ?? '')
    setIsDefault(t.is_default)
    setError('')
  }

  function submit() {
    setError('')
    const fd = new FormData()
    if (editing && editing !== 'new') fd.append('id', editing)
    fd.append('org_id', orgId)
    fd.append('name', name)
    fd.append('rows', JSON.stringify(rows))
    fd.append('details', details)
    fd.append('is_default', String(isDefault))
    startTransition(async () => {
      const res = await saveOrgTemplate({}, fd)
      if (res.error) setError(res.error)
      else setEditing(null)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, maxWidth: 340 }}>
          <span style={labelS}>Organization</span>
          <select value={orgId} onChange={e => { setOrgId(e.target.value); setEditing(null) }} style={inputS}>
            {orgs.length === 0 && <option value="">No orgs yet</option>}
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <button type="button" onClick={openNew} disabled={!orgId} style={pillS(true, !orgId)}>+ New standard</button>
      </div>
      <p style={{ color: C.txt2, fontFamily: C.sans, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
        When a dollar amount changes deal to deal, set the row&apos;s type to Variable and name the
        amount (like Asset Sale Price); the org is asked for the number on each new verification.
      </p>

      {orgId && orgTemplates.length === 0 && editing === null && (
        <div style={cardS}>
          <p style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, margin: 0 }}>
            This org has no saved standards yet.
          </p>
        </div>
      )}

      {orgTemplates.map(t => (
        <div key={t.id} style={{ ...cardS, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: C.txt, fontFamily: C.sans, margin: 0 }}>
              {t.name}
              {t.is_default && (
                <span style={{
                  marginLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                  textTransform: 'uppercase', fontFamily: C.mono, color: C.txt,
                  background: C.lime, borderRadius: 4, padding: '2px 6px',
                }}>
                  Default
                </span>
              )}
            </p>
            <p style={{ fontSize: 12.5, color: C.txt3, fontFamily: C.sans, margin: '4px 0 0' }}>
              {t.requirements.length} requirement{t.requirements.length === 1 ? '' : 's'}
              {t.variables.length > 0 && ` · asks for ${t.variables.map(v => v.label.toLowerCase()).join(', ')} per deal`}
            </p>
          </div>
          <button type="button" onClick={() => openEdit(t)} style={pillS(false)}>Edit</button>
          <button
            type="button"
            onClick={() => startTransition(async () => { await deleteOrgTemplate(t.id); if (editing === t.id) setEditing(null) })}
            style={{ ...pillS(false), color: C.error, borderColor: C.border }}
          >
            Delete
          </button>
        </div>
      ))}

      {editing !== null && (
        <EditorModal title={editing === 'new' ? 'New standard' : 'Edit standard'} onClose={() => setEditing(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <span style={labelS}>Standard name</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Trucking standard" style={inputS} />
          </div>

          <div>
            <span style={labelS}>Requirements</span>
            <p style={{ fontSize: 12.5, color: C.txt3, fontFamily: C.sans, margin: '0 0 10px' }}>
              Variable amounts are asked for on each new verification.
            </p>
            <RequirementsEditor rows={rows} onChange={setRows} />
          </div>

          <div>
            <span style={labelS}>
              Other required coverage details <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </span>
            <textarea
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder="Anything the rows above didn't capture: extra coverages, conditions, endorsements, etc."
              rows={3}
              style={{ ...inputS, resize: 'vertical', minHeight: 64 }}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: C.txt2, fontFamily: C.sans, cursor: 'pointer' }}>
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
            Pre-select this standard on the org&apos;s new verifications
          </label>

          {error && <p style={{ fontSize: 13, color: C.error, fontFamily: C.sans, margin: 0 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={submit} disabled={pending} style={pillS(true, pending)}>
              {pending ? 'Saving…' : 'Save standard'}
            </button>
            <button type="button" onClick={() => setEditing(null)} style={pillS(false)}>Cancel</button>
          </div>
        </div>
        </EditorModal>
      )}
    </div>
  )
}
