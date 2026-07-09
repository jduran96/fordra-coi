'use client'

import { useState, useTransition } from 'react'
import type { Requirement } from '@/lib/types'
import type { RequirementTemplate } from '@/lib/templates'
import { C } from '@/lib/theme'
import RequirementsEditor, { BLANK_REQUIREMENT } from '@/components/RequirementsEditor'
import { saveTemplate, deleteTemplate, inviteTeammate } from './actions'

interface Member { id: string; email: string; full_name: string | null }

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

export default function SettingsClient({ templates, starterRows, members, selfId }: {
  templates: RequirementTemplate[]
  starterRows: Requirement[]
  members: Member[]
  selfId: string
}) {
  // null = no editor open; 'new' = creating; otherwise the template id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<Requirement[]>([])
  const [isDefault, setIsDefault] = useState(false)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function openNew() {
    setEditing('new')
    setName('')
    setRows([...starterRows.map(r => ({ ...r })), { ...BLANK_REQUIREMENT }])
    setIsDefault(templates.length === 0)
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
    fd.append('name', name)
    fd.append('rows', JSON.stringify(rows))
    fd.append('is_default', String(isDefault))
    startTransition(async () => {
      const res = await saveTemplate({}, fd)
      if (res.error) setError(res.error)
      else setEditing(null)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ ...labelS, marginBottom: 0 }}>Insurance standards</span>
          <button type="button" onClick={openNew} style={pillS(true)}>+ New template</button>
        </div>
        <p style={{ color: C.txt2, fontFamily: C.sans, fontSize: 13.5, lineHeight: 1.6, margin: '6px 0 12px' }}>
          Save your insurance standards once and reuse them on every verification. Use
          a <span style={{ fontFamily: C.mono, fontSize: 12.5 }}>{'{placeholder}'}</span> in a limit for
          deal-specific values, like <span style={{ fontFamily: C.mono, fontSize: 12.5 }}>{'{asset_sale_price}'}</span>.
        </p>

        {templates.length === 0 && editing === null && (
          <div style={cardS}>
            <p style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, margin: 0 }}>
              No saved standards yet. Create one and it will be pre-selected on every new verification.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {templates.map(t => (
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
                onClick={() => startTransition(async () => { await deleteTemplate(t.id); if (editing === t.id) setEditing(null) })}
                style={{ ...pillS(false), color: C.error, borderColor: C.border }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        {editing !== null && (
          <div style={{ ...cardS, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <span style={labelS}>Template name</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Trucking standard" style={inputS} />
            </div>

            <div>
              <span style={labelS}>Requirements</span>
              <RequirementsEditor rows={rows} onChange={setRows} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: C.txt2, fontFamily: C.sans, cursor: 'pointer' }}>
              <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
              Pre-select this template on new verifications
            </label>

            {error && <p style={{ fontSize: 13, color: C.error, fontFamily: C.sans, margin: 0 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={submit} disabled={pending} style={pillS(true, pending)}>
                {pending ? 'Saving…' : 'Save template'}
              </button>
              <button type="button" onClick={() => setEditing(null)} style={pillS(false)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <TeamSection members={members} selfId={selfId} />
    </div>
  )
}

function TeamSection({ members, selfId }: { members: Member[]; selfId: string }) {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({})
  const [pending, startTransition] = useTransition()

  function invite() {
    setMsg({})
    const fd = new FormData()
    fd.append('email', email)
    startTransition(async () => {
      const res = await inviteTeammate({}, fd)
      if (res.error) setMsg({ error: res.error })
      else { setMsg({ ok: `Invitation sent to ${email}.` }); setEmail('') }
    })
  }

  return (
    <section>
      <span style={labelS}>Team</span>
      <div style={{ ...cardS, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {members.map(m => (
            <p key={m.id} style={{ fontSize: 14, color: C.txt, fontFamily: C.sans, margin: 0 }}>
              {m.full_name ? `${m.full_name} · ` : ''}{m.email}
              {m.id === selfId && <span style={{ color: C.txt3 }}> (you)</span>}
            </p>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="teammate@company.com" style={{ ...inputS, maxWidth: 320 }}
          />
          <button type="button" onClick={invite} disabled={!email || pending} style={pillS(true, !email || pending)}>
            {pending ? 'Inviting…' : 'Invite teammate'}
          </button>
        </div>
        {msg.error && <p style={{ fontSize: 13, color: C.error, fontFamily: C.sans, margin: 0 }}>{msg.error}</p>}
        {msg.ok && <p style={{ fontSize: 13, color: C.success, fontFamily: C.sans, margin: 0 }}>{msg.ok}</p>}
        <p style={{ fontSize: 12.5, color: C.txt3, fontFamily: C.sans, margin: 0 }}>
          Invited teammates get an email link and see the same verifications as everyone in your organization.
        </p>
      </div>
    </section>
  )
}
