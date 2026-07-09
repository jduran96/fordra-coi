'use client'

import { useState, useTransition } from 'react'
import type { Requirement } from '@/lib/types'
import type { RequirementTemplate } from '@/lib/templates'
import { C } from '@/lib/theme'
import RequirementsEditor, { BLANK_REQUIREMENT } from '@/components/RequirementsEditor'
import { saveOrgTemplate, deleteOrgTemplate } from './actions'

/**
 * Admin-side authoring of an org's insurance-standards templates. Saved rows
 * land in the same requirement_templates table the org edits on /app/settings,
 * so a standard created here shows up there immediately.
 */
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
  const [isDefault, setIsDefault] = useState(false)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  const orgTemplates = templates.filter(t => t.org_id === orgId)

  function openNew() {
    setEditing('new')
    setName('')
    setRows([...starterRows.map(r => ({ ...r })), { ...BLANK_REQUIREMENT }])
    setIsDefault(orgTemplates.length === 0)
    setError('')
  }
  function openEdit(t: RequirementTemplate) {
    setEditing(t.id)
    setName(t.name)
    setRows(t.requirements.length ? t.requirements.map(r => ({ ...r })) : [{ ...BLANK_REQUIREMENT }])
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
    fd.append('is_default', String(isDefault))
    startTransition(async () => {
      const res = await saveOrgTemplate({}, fd)
      if (res.error) setError(res.error)
      else setEditing(null)
    })
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <select value={orgId} onChange={e => { setOrgId(e.target.value); setEditing(null) }} style={{ ...input, maxWidth: 320 }}>
          {orgs.length === 0 && <option value="">No orgs yet</option>}
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button type="button" onClick={openNew} disabled={!orgId} style={smallBtn}>+ New standard</button>
      </div>

      {orgId && orgTemplates.length === 0 && editing === null && (
        <p style={{ fontSize: 13, color: C.txt3, fontFamily: C.sans, margin: 0 }}>
          This org has no saved standards yet.
        </p>
      )}

      {orgTemplates.map(t => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.txt, fontFamily: C.sans, margin: 0 }}>
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
            <p style={{ fontSize: 12.5, color: C.txt3, fontFamily: C.sans, margin: '3px 0 0' }}>
              {t.requirements.length} requirement{t.requirements.length === 1 ? '' : 's'}
              {t.variables.length > 0 && ` · asks for ${t.variables.map(v => v.label.toLowerCase()).join(', ')} per deal`}
            </p>
          </div>
          <button type="button" onClick={() => openEdit(t)} style={smallBtn}>Edit</button>
          <button
            type="button"
            onClick={() => startTransition(async () => { await deleteOrgTemplate(t.id); if (editing === t.id) setEditing(null) })}
            style={{ ...smallBtn, color: C.error }}
          >
            Delete
          </button>
        </div>
      ))}

      {editing !== null && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={lbl}>Standard name
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Trucking standard" style={input} />
          </label>

          <RequirementsEditor rows={rows} onChange={setRows} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: C.txt2, fontFamily: C.sans, cursor: 'pointer' }}>
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
            Pre-select this standard on the org&apos;s new verifications
          </label>

          {error && <p style={{ fontSize: 13, color: C.error, fontFamily: C.sans, margin: 0 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={submit} disabled={pending} style={{ ...primaryBtn, opacity: pending ? 0.6 : 1 }}>
              {pending ? 'Saving…' : 'Save standard'}
            </button>
            <button type="button" onClick={() => setEditing(null)} style={smallBtn}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

const input = { padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const }
const smallBtn = { padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' }
const primaryBtn = { padding: '8px 20px', background: C.earthy, color: C.onDark, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer' }
const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 6, fontSize: 13, fontWeight: 600 as const, color: C.txt2, fontFamily: C.sans }
