'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import type { RequirementTemplate } from '@/lib/templates'
import { coverageMatches, type ConfiguredQuestion } from '@/lib/question-config'
import { saveQuestionsConfig } from './actions'

/**
 * Per-org, per-template AI call question lists: pick an org, pick one of its
 * insurance standards, and write the standard question for each requirement
 * row. Saved lists prefill the verification's question list (Call tab) on every
 * deal submitted against that template, in the order saved here and with the
 * blocker flags set here; AI drafting only runs for rows the list does not
 * cover (special instructions, rows added after saving). Question text may
 * embed {tokens}: ones matching the template's per-deal variables fill
 * automatically; any other {token} stays in the question for the admin to
 * fill before dialing.
 */
export default function QuestionsListCard({ orgs, templates, byKey }: {
  orgs: { id: string; name: string }[]
  templates: RequirementTemplate[]
  byKey: Record<string, ConfiguredQuestion[]>
}) {
  const [orgId, setOrgId] = useState('')
  const [templateId, setTemplateId] = useState('')

  const orgTemplates = templates.filter(t => t.org_id === orgId)
  const template = orgTemplates.find(t => t.id === templateId) ?? null
  const stored = template ? (byKey[`${orgId}:${template.id}`] ?? []) : []

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
           with the right rows (React 19 stale-state rule). */
        <QuestionsEditor
          key={`${orgId}:${templateId}:${JSON.stringify(stored)}`}
          orgId={orgId}
          template={template}
          stored={stored}
        />
      )}
    </div>
  )
}

interface EditorRow extends ConfiguredQuestion { blocker?: boolean }

function QuestionsEditor({ orgId, template, stored }: {
  orgId: string
  template: RequirementTemplate
  stored: ConfiguredQuestion[]
}) {
  // One row per template requirement, plus the free-text details line when the
  // template has one (it rides into each deal as its own standards line).
  const templateRows = [
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
  ]
  // Saved order wins: stored entries first (custom ones pass straight
  // through; template entries matched to a current row), then any template
  // row without a saved question, in template order.
  const initialRows: EditorRow[] = [
    ...stored
      .map((q): EditorRow | null => {
        if (q.custom) return { ...q }
        const row = templateRows.find(r => coverageMatches(q.coverage_type, r.coverage_type))
        return row ? { ...row, question: q.question, ...(q.blocker ? { blocker: true } : {}), ...(q.followUp ? { followUp: q.followUp } : {}) } : null
      })
      .filter((r): r is EditorRow => !!r),
    ...templateRows
      .filter(r => !stored.some(q => !q.custom && coverageMatches(q.coverage_type, r.coverage_type)))
      .map(r => ({ ...r, question: '' })),
  ]
  // Saved questions whose row no longer exists on the template (row renamed or
  // deleted since): they are dropped on the next save, so say so. Custom
  // questions have no row to match and never count here.
  const orphaned = stored.filter(q =>
    q.question && !q.custom && !templateRows.some(r => coverageMatches(q.coverage_type, r.coverage_type)))

  const [rows, setRows] = useState<EditorRow[]>(initialRows)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const setRow = (i: number, patch: Partial<EditorRow>) => {
    setMessage(null)
    setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  const move = (i: number, dir: -1 | 1) => {
    setMessage(null)
    setRows(prev => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const save = () => {
    // The action drops a follow-up missing either field; block instead so a
    // half-filled one is never silently lost.
    if (rows.some(r => r.followUp && (!r.followUp.condition.trim() || !r.followUp.text.trim()))) {
      setMessage({ kind: 'error', text: 'A follow-up needs both its condition and its question text. Fill them in or uncheck Follow-up.' })
      return
    }
    setMessage(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('org_id', orgId)
      fd.set('template_id', template.id)
      fd.set('questions', JSON.stringify(rows))
      const res = await saveQuestionsConfig(fd)
      if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
      else setMessage({ kind: 'ok', text: 'Saved.' })
    })
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {(template.variables ?? []).length > 0 && (
        <p style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6, margin: 0 }}>
          Variables:{' '}
          {(template.variables ?? []).map((v, i) => (
            <span key={v.key}>{i > 0 && ', '}<code style={codeStyle}>{`{${v.key}}`}</code> ({v.label})</span>
          ))}.
        </p>
      )}
      {rows.map((row, i) => (
        <div key={row.coverage_type + i} style={{ border: `1px solid ${C.border}`, borderRadius: 9, padding: 12, background: C.paper }}>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: row.custom ? C.txt3 : C.txt2, margin: '0 0 6px', lineHeight: 1.5, ...(row.custom ? { textTransform: 'uppercase' as const, letterSpacing: '0.05em', fontSize: 10.5 } : {}) }}>
            {row.custom ? 'Custom question (not tied to a requirement)' : row.requirement}
          </p>
          <div className="fx-q-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <textarea
              value={row.question}
              rows={2}
              placeholder={row.custom ? 'Question asked on every deal for this standard' : 'Leave blank to keep this row AI-drafted per deal'}
              onChange={e => setRow(i, { question: e.target.value })}
              style={{ ...inputStyle, resize: 'vertical', flex: 1, lineHeight: 1.45 }}
            />
            <div className="fx-q-tools" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={tinyBtn(i === 0)} aria-label="Move up">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} style={tinyBtn(i === rows.length - 1)} aria-label="Move down">↓</button>
            </div>
            {row.custom && (
              <button type="button" onClick={() => { setMessage(null); setRows(prev => prev.filter((_, j) => j !== i)) }}
                style={{ ...tinyBtn(false), color: C.error }} aria-label="Remove question">✕</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: row.blocker ? C.error : C.txt2, cursor: 'pointer', userSelect: 'none', fontWeight: row.blocker ? 600 : 400 }}>
              <input type="checkbox" checked={!!row.blocker}
                onChange={e => setRow(i, { blocker: e.target.checked || undefined })}
                style={{ accentColor: C.error }} />
              Default blocker: a negative answer ends the call
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.txt2, cursor: 'pointer', userSelect: 'none', fontWeight: row.followUp ? 600 : 400 }}>
              <input type="checkbox" checked={!!row.followUp}
                onChange={e => setRow(i, { followUp: e.target.checked ? { condition: '', text: '' } : undefined })}
                style={{ accentColor: C.txt2 }} />
              Follow-up: ask a second question only when the answer matches a condition
            </label>
          </div>
          {row.followUp && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              <label style={{ fontSize: 12, color: C.txt3 }}>
                Ask the follow-up only if...
                <input type="text" value={row.followUp.condition}
                  placeholder="e.g. they say yes"
                  onChange={e => setRow(i, { followUp: { condition: e.target.value, text: row.followUp?.text ?? '' } })}
                  style={{ ...inputStyle, marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12, color: C.txt3 }}>
                Follow-up question
                <textarea value={row.followUp.text} rows={2}
                  onChange={e => setRow(i, { followUp: { condition: row.followUp?.condition ?? '', text: e.target.value } })}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.45, marginTop: 4 }} />
              </label>
            </div>
          )}
        </div>
      ))}
      {orphaned.length > 0 && (
        <p style={{ fontSize: 12.5, color: C.warn, margin: 0 }}>
          {orphaned.length} saved question{orphaned.length > 1 ? 's' : ''} no longer match a row on this
          standard (edited since) and will be dropped on save: {orphaned.map(q => `"${q.question}"`).join(', ')}
        </p>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" disabled={pending}
          onClick={() => { setMessage(null); setRows(prev => [...prev, { coverage_type: '', requirement: '', question: '', custom: true }]) }}
          style={btnStyle(pending)}>
          Add question
        </button>
        <button type="button" onClick={save} disabled={pending} style={btnStyle(pending)}>
          {pending ? 'Saving...' : 'Save questions list'}
        </button>
        {message && (
          <span style={{ fontSize: 13, fontWeight: 600, color: message.kind === 'error' ? C.error : C.ok }}>{message.text}</span>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.txt2, display: 'block', marginBottom: 4 }
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: C.sans, color: C.txt, background: C.surface, borderRadius: 7, border: `1px solid ${C.border}` }
const codeStyle: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 12, background: C.paper, padding: '1px 5px', borderRadius: 4, border: `1px solid ${C.border}` }
const btnStyle = (pending: boolean): React.CSSProperties => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1 })
const tinyBtn = (disabled: boolean): React.CSSProperties => ({ padding: '2px 8px', background: C.surface, color: C.txt2, fontSize: 12, borderRadius: 6, border: `1px solid ${C.border}`, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1 })
