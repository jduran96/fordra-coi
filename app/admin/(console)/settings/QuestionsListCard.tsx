'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import type { RequirementTemplate } from '@/lib/templates'
import { coverageMatches, type ConfiguredQuestion } from '@/lib/question-config'
import { saveQuestionsConfig } from './actions'

/**
 * Per-org, per-template AI call question lists: pick an org, pick one of its
 * insurance standards, and write the standard question for each requirement
 * row. Saved lists prefill the verification's question list (AI tab) on every
 * deal submitted against that template, so AI drafting only runs for rows the
 * list does not cover (special instructions, rows added after saving).
 * Question text may embed {tokens}: ones matching the template's per-deal
 * variables fill automatically; any other {token} stays in the question for
 * the admin to fill before dialing.
 */
export default function QuestionsListCard({ orgs, templates, byKey }: {
  orgs: { id: string; name: string }[]
  templates: RequirementTemplate[]
  byKey: Record<string, ConfiguredQuestion[]>
}) {
  const [orgId, setOrgId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const orgTemplates = templates.filter(t => t.org_id === orgId)
  const template = orgTemplates.find(t => t.id === templateId) ?? null
  const stored = template ? (byKey[`${orgId}:${template.id}`] ?? []) : []

  // One row per template requirement, plus the free-text details line when the
  // template has one (it rides into each deal as its own standards line).
  const rows = template ? [
    ...(template.requirements ?? []).map(r => {
      const limit = (r.minimum_limit ?? '').trim()
      const notes = (r.notes ?? '').trim()
      return {
        coverage_type: r.coverage_type,
        requirement: `${r.coverage_type.trim()}${limit ? `: ${limit}` : ''}${notes ? ` (${notes})` : ''}`,
      }
    }),
    ...(template.details?.trim()
      ? [{ coverage_type: 'Additional details', requirement: `Additional details: ${template.details.trim()}` }]
      : []),
  ] : []
  const prefill = rows.map(row =>
    stored.find(q => coverageMatches(q.coverage_type, row.coverage_type))?.question ?? '')
  // Saved questions whose row no longer exists on the template (row renamed or
  // deleted since): they are dropped on the next save, so say so.
  const orphaned = stored.filter(q =>
    q.question && !rows.some(row => coverageMatches(q.coverage_type, row.coverage_type)))

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div className="fx-stack" style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Org</label>
          <select
            value={orgId}
            onChange={e => { setOrgId(e.target.value); setTemplateId(''); setMessage(null) }}
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
            onChange={e => { setTemplateId(e.target.value); setMessage(null) }}
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
        <p style={{ fontSize: 13, color: C.txt3, margin: 0 }}>
          This org has no insurance standards yet. Create one on the Standards tab first.
        </p>
      )}
      {template && (
        <>
          {(template.variables ?? []).length > 0 && (
            <p style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6, margin: '0 0 12px' }}>
              Per-deal tokens on this standard, filled automatically on each verification:{' '}
              {(template.variables ?? []).map((v, i) => (
                <span key={v.key}>{i > 0 && ', '}<code style={codeStyle}>{`{${v.key}}`}</code> ({v.label})</span>
              ))}.
              Any other <code style={codeStyle}>{'{token}'}</code> you type stays in the question for the admin to fill before dialing.
            </p>
          )}
          {/* Keyed by selection + stored data so switching remounts the fields
              with the right defaults (React 19 stale-defaultValue rule). */}
          <form
            key={`${orgId}:${templateId}:${JSON.stringify(stored)}`}
            onSubmit={e => {
              e.preventDefault()
              const raw = new FormData(e.currentTarget)
              const fd = new FormData()
              fd.set('org_id', orgId)
              fd.set('template_id', templateId)
              fd.set('questions', JSON.stringify(rows.map((row, i) => ({
                ...row, question: String(raw.get(`q_${i}`) ?? '').trim(),
              }))))
              setMessage(null)
              startTransition(async () => {
                const res = await saveQuestionsConfig(fd)
                if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
                else setMessage({ kind: 'ok', text: 'Saved.' })
              })
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {rows.map((row, i) => (
              <div key={i} style={{ borderTop: i > 0 ? `1px solid ${C.border}` : 'none', paddingTop: i > 0 ? 12 : 0 }}>
                <p style={{ fontSize: 12.5, fontWeight: 600, color: C.txt2, margin: '0 0 6px', lineHeight: 1.5 }}>
                  {row.requirement}
                </p>
                <textarea
                  name={`q_${i}`}
                  defaultValue={prefill[i]}
                  rows={2}
                  placeholder="Leave blank to keep this row AI-drafted per deal"
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>
            ))}
            {orphaned.length > 0 && (
              <p style={{ fontSize: 12.5, color: C.warn, margin: 0 }}>
                {orphaned.length} saved question{orphaned.length > 1 ? 's' : ''} no longer match a row on this
                standard (edited since) and will be dropped on save: {orphaned.map(q => `"${q.question}"`).join(', ')}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button type="submit" disabled={pending} style={btnStyle(pending)}>
                {pending ? 'Saving...' : 'Save questions list'}
              </button>
              {message && (
                <span style={{ fontSize: 13, fontWeight: 600, color: message.kind === 'error' ? C.error : C.ok }}>{message.text}</span>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.txt2, display: 'block', marginBottom: 4 }
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: C.sans, color: C.txt, background: C.surface, borderRadius: 7, border: `1px solid ${C.border}` }
const codeStyle: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 12, background: C.paper, padding: '1px 5px', borderRadius: 4, border: `1px solid ${C.border}` }
const btnStyle = (pending: boolean): React.CSSProperties => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1 })
