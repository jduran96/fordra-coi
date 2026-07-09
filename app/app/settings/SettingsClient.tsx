'use client'

import { useState, useTransition } from 'react'
import type { Requirement } from '@/lib/types'
import type { RequirementTemplate } from '@/lib/templates'
import { editableRows } from '@/lib/templates'
import { C } from '@/lib/theme'
import RequirementsEditor, { BLANK_REQUIREMENT } from '@/components/RequirementsEditor'
import EditorModal from '@/components/EditorModal'
import { createClient } from '@/lib/supabase/client'
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
  const [details, setDetails] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function openNew() {
    setEditing('new')
    setName('')
    setRows([...starterRows.map(r => ({ ...r })), { ...BLANK_REQUIREMENT }])
    setDetails('')
    setIsDefault(templates.length === 0)
    setError('')
  }
  function openEdit(t: RequirementTemplate) {
    setEditing(t.id)
    setName(t.name)
    const rows = editableRows(t)
    setRows(rows.length ? rows : [{ ...BLANK_REQUIREMENT }])
    setDetails(t.details ?? '')
    setIsDefault(t.is_default)
    setError('')
  }

  function submit() {
    setError('')
    const fd = new FormData()
    if (editing && editing !== 'new') fd.append('id', editing)
    fd.append('name', name)
    fd.append('rows', JSON.stringify(rows))
    fd.append('details', details)
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
          Save your insurance standards once and reuse them on every verification. When a dollar
          amount changes deal to deal, set the row&apos;s type to Variable and name the amount
          (like Asset Sale Price); the number is asked for on each new verification.
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
          <EditorModal title={editing === 'new' ? 'New template' : 'Edit template'} onClose={() => setEditing(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <span style={labelS}>Template name</span>
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
          </EditorModal>
        )}
      </section>

      <PasswordSection />
      <TeamSection members={members} selfId={selfId} />
    </div>
  )
}

function PasswordSection() {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({})
  const [pending, setPending] = useState(false)

  async function save() {
    setMsg({})
    if (pw.length < 8) return setMsg({ error: 'Use at least 8 characters.' })
    if (pw !== confirm) return setMsg({ error: 'The passwords do not match.' })
    setPending(true)
    try {
      const { error } = await createClient().auth.updateUser({ password: pw })
      if (error) setMsg({ error: error.message })
      else { setMsg({ ok: 'Password saved. You can now sign in with it.' }); setPw(''); setConfirm('') }
    } catch {
      setMsg({ error: 'Something went wrong. Try again.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <section>
      <span style={labelS}>Password</span>
      <div style={{ ...cardS, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 13, color: C.txt2, fontFamily: C.sans, margin: 0, lineHeight: 1.6 }}>
          Set a password to sign in without waiting for an email link. If you ever forget it,
          sign in with an email link and set a new one here.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="password" value={pw} onChange={e => setPw(e.target.value)}
            placeholder="New password" autoComplete="new-password"
            style={{ ...inputS, maxWidth: 220 }}
          />
          <input
            type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="Confirm password" autoComplete="new-password"
            style={{ ...inputS, maxWidth: 220 }}
          />
          <button type="button" onClick={save} disabled={!pw || !confirm || pending}
            style={pillS(true, !pw || !confirm || pending)}>
            {pending ? 'Saving…' : 'Save password'}
          </button>
        </div>
        {msg.error && <p style={{ fontSize: 13, color: C.error, fontFamily: C.sans, margin: 0 }}>{msg.error}</p>}
        {msg.ok && <p style={{ fontSize: 13, color: C.success, fontFamily: C.sans, margin: 0 }}>{msg.ok}</p>}
      </div>
    </section>
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
