'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import type { RequirementTemplate } from '@/lib/templates'
import type { EmailDraftConfig } from '@/lib/email-draft-config'
import { ORG_NAME_TOKEN, POLICY_NUMBERS_TOKEN } from '@/lib/email-shared'
import EditorModal from '@/components/EditorModal'
import RichTextInput from '@/components/RichTextInput'
import { saveEmailDraftConfig } from './actions'

/**
 * Per-org, per-template email draft templates (settings → Emails → Drafts):
 * pick an org, pick one of its insurance standards, and write the subject,
 * rich-text body, and cc list that prefill the verification's Emails-tab
 * draft on every deal submitted against that standard. Same selection UX as
 * the Questions List card; {tokens} substitute per deal exactly like call
 * questions, and the Variables chips list what this standard provides.
 */
export default function EmailDraftsCard({ orgs, templates, byKey }: {
  orgs: { id: string; name: string }[]
  templates: RequirementTemplate[]
  byKey: Record<string, EmailDraftConfig>
}) {
  const [orgId, setOrgId] = useState('')
  const [templateId, setTemplateId] = useState('')

  const orgTemplates = templates.filter(t => t.org_id === orgId)
  const template = orgTemplates.find(t => t.id === templateId) ?? null
  const stored = template ? (byKey[`${orgId}:${template.id}`] ?? null) : null

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div className="fx-stack" style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Org</label>
          <select
            value={orgId}
            onChange={e => { setOrgId(e.target.value); setTemplateId('') }}
            style={inputStyle}
          >
            <option value="">Pick an org</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Insurance standard</label>
          <select
            value={templateId}
            onChange={e => setTemplateId(e.target.value)}
            disabled={!orgId}
            style={inputStyle}
          >
            <option value="">{orgId ? 'Pick a standard' : 'Pick an org first'}</option>
            {orgTemplates.map(t => (
              <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>
            ))}
          </select>
        </div>
      </div>
      {orgId && !orgTemplates.length && (
        <p style={{ fontSize: 13, color: C.txt3, margin: '12px 0 0' }}>
          This org has no insurance standards yet. Create one on the Standards tab first.
        </p>
      )}
      {template && (
        /* Keyed by selection + stored data so switching remounts the editor
           with the right values (React 19 stale-state rule). */
        <DraftEditor
          key={`${orgId}:${templateId}:${JSON.stringify(stored)}`}
          orgId={orgId}
          template={template}
          stored={stored}
        />
      )}
    </div>
  )
}

/** The {token} chips shown above the subject line on both draft editors. */
export function VariableChips({ tokens }: { tokens: string[] }) {
  if (!tokens.length) return null
  return (
    <div>
      <p style={{ ...labelStyle, marginBottom: 6 }}>Variables</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tokens.map(t => (
          <code key={t} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, background: C.paper, padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.border}`, color: C.txt }}>
            {`{${t}}`}
          </code>
        ))}
      </div>
    </div>
  )
}

function DraftEditor({ orgId, template, stored }: {
  orgId: string
  template: RequirementTemplate
  stored: EmailDraftConfig | null
}) {
  const [subject, setSubject] = useState(stored?.subject ?? '')
  const [body, setBody] = useState(stored?.body ?? '')
  const [cc, setCc] = useState((stored?.cc ?? []).join(', '))
  const [includeCarrier, setIncludeCarrier] = useState(!!stored?.include_carrier_email)
  const [showStandard, setShowStandard] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const tokens = [...(template.variables ?? []).map(v => v.key), ORG_NAME_TOKEN, POLICY_NUMBERS_TOKEN]

  const save = () => {
    setMessage(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('org_id', orgId)
      fd.set('template_id', template.id)
      fd.set('subject', subject)
      fd.set('body', body)
      fd.set('cc', cc)
      fd.set('include_carrier_email', includeCarrier ? 'true' : '')
      const res = await saveEmailDraftConfig(fd)
      if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
      else setMessage({ kind: 'ok', text: 'Saved.' })
    })
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <VariableChips tokens={tokens} />
        </div>
        <button type="button" onClick={() => setShowStandard(true)} style={btnStyle(false)}>
          View standard
        </button>
      </div>
      <label style={labelStyle}>
        Subject line
        <input
          type="text"
          value={subject}
          onChange={e => { setMessage(null); setSubject(e.target.value) }}
          style={{ ...inputStyle, marginTop: 4 }}
        />
      </label>
      <div>
        <p style={{ ...labelStyle, marginBottom: 4 }}>Email body</p>
        <RichTextInput name="body" value={body} onChange={html => { setMessage(null); setBody(html) }} />
      </div>
      <label style={labelStyle}>
        Always cc (comma-separated)
        <input
          type="text"
          value={cc}
          onChange={e => { setMessage(null); setCc(e.target.value) }}
          style={{ ...inputStyle, marginTop: 4 }}
        />
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.txt2, cursor: 'pointer', userSelect: 'none', fontWeight: includeCarrier ? 600 : 400 }}>
        <input
          type="checkbox"
          checked={includeCarrier}
          onChange={e => { setMessage(null); setIncludeCarrier(e.target.checked) }}
          style={{ accentColor: C.txt2 }}
        />
        Also cc the carrier email from the COI when the extraction found one
      </label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" onClick={save} disabled={pending} style={btnStyle(pending)}>
          {pending ? 'Saving...' : 'Save draft template'}
        </button>
        {message && (
          <span style={{ fontSize: 13, fontWeight: 600, color: message.kind === 'error' ? C.error : C.ok }}>{message.text}</span>
        )}
      </div>

      {showStandard && (
        <EditorModal title={template.name} onClose={() => setShowStandard(false)} maxWidth={640}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: C.sans }}>
            {(template.requirements ?? []).map((r, i) => {
              const limit = (r.minimum_limit ?? '').trim()
              const notes = (r.notes ?? '').trim()
              return (
                <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', background: C.paper }}>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: C.txt, margin: 0 }}>
                    {r.coverage_type}{limit ? `: ${limit}` : ''}
                  </p>
                  {notes && <p style={{ fontSize: 12.5, color: C.txt2, margin: '4px 0 0', lineHeight: 1.5 }}>{notes}</p>}
                </div>
              )
            })}
            {template.details?.trim() && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', background: C.paper }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.txt3, margin: '0 0 4px' }}>Additional details</p>
                <p style={{ fontSize: 12.5, color: C.txt2, margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{template.details.trim()}</p>
              </div>
            )}
            {!(template.requirements ?? []).length && !template.details?.trim() && (
              <p style={{ fontSize: 13, color: C.txt3, margin: 0 }}>This standard has no requirement rows.</p>
            )}
          </div>
        </EditorModal>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.txt2, display: 'block', marginBottom: 4 }
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: C.sans, color: C.txt, background: C.surface, borderRadius: 7, border: `1px solid ${C.border}` }
const btnStyle = (pending: boolean): React.CSSProperties => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1 })
