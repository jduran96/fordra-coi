'use client'

import { useState, useTransition } from 'react'
import { renameOrg, deleteOrg } from '../actions'
import { C } from '@/lib/theme'

export interface OrgRow {
  id: string
  name: string
  members: number
  verifications: number
}

/**
 * Org management table on /admin/users: rename inline, delete with a
 * two-click confirm. Deleting an org also deletes its members (their
 * sign-in accounts included; admins are only unassigned) and its
 * verifications with their stored documents — the confirm spells out
 * the counts.
 */
export default function OrgsTable({ orgs }: { orgs: OrgRow[] }) {
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({})
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function rename(orgId: string, name: string) {
    setMsg({})
    const fd = new FormData()
    fd.append('org_id', orgId)
    fd.append('name', name)
    startTransition(async () => {
      const res = await renameOrg({}, fd)
      setMsg(res.error ? { error: res.error } : { ok: 'Org renamed.' })
    })
  }

  function remove(orgId: string) {
    if (confirmId !== orgId) { setMsg({}); setConfirmId(orgId); return }
    setConfirmId(null)
    setMsg({})
    const fd = new FormData()
    fd.append('org_id', orgId)
    startTransition(async () => {
      const res = await deleteOrg({}, fd)
      setMsg(res.error ? { error: res.error } : { ok: 'Org deleted.' })
    })
  }

  return (
    <div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <th style={th}>Org name</th><th style={th}>Members</th><th style={th}>Verifications</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 && (
              <tr><td style={{ ...td, color: C.txt3 }} colSpan={4}>No orgs yet.</td></tr>
            )}
            {orgs.map(o => (
              <OrgTableRow
                key={o.id} org={o} pending={pending}
                confirming={confirmId === o.id}
                onRename={rename} onDelete={remove}
              />
            ))}
          </tbody>
        </table>
      </div>
      {msg.error && <p style={{ fontSize: 13, color: C.error, fontFamily: C.sans, margin: '10px 0 0' }}>{msg.error}</p>}
      {msg.ok && <p style={{ fontSize: 13, color: C.success, fontFamily: C.sans, margin: '10px 0 0' }}>{msg.ok}</p>}
    </div>
  )
}

function OrgTableRow({ org, pending, confirming, onRename, onDelete }: {
  org: OrgRow
  pending: boolean
  confirming: boolean
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  const [name, setName] = useState(org.name)
  const dirty = name.trim() !== org.name && name.trim().length > 0
  const cascade = [
    org.members ? `${org.members} user${org.members === 1 ? '' : 's'}` : '',
    org.verifications ? `${org.verifications} verification${org.verifications === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' + ')

  return (
    <tr style={{ borderTop: `1px solid ${C.border}` }}>
      <td style={td}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && dirty && !pending) onRename(org.id, name.trim()) }}
            style={{
              fontFamily: C.sans, fontSize: 13, padding: '6px 8px', border: `1px solid ${C.border}`,
              borderRadius: 8, width: 200, background: C.paper, color: C.txt,
            }}
          />
          {dirty && (
            <button type="button" disabled={pending} onClick={() => onRename(org.id, name.trim())} style={smallBtn}>
              Save
            </button>
          )}
        </div>
      </td>
      <td style={{ ...td, color: org.members ? C.txt : C.txt3 }}>{org.members}</td>
      <td style={{ ...td, color: org.verifications ? C.txt : C.txt3 }}>{org.verifications}</td>
      <td style={{ ...td, textAlign: 'right' as const }}>
        <button
          type="button" disabled={pending}
          onClick={() => onDelete(org.id)}
          title={cascade ? `Also deletes the org's ${cascade}` : undefined}
          style={{
            ...smallBtn,
            color: '#b3261e',
            ...(confirming ? { background: '#b3261e', color: '#fff', borderColor: '#b3261e' } : {}),
          }}
        >
          {confirming ? (cascade ? `Delete org + ${cascade}?` : 'Confirm delete?') : 'Delete'}
        </button>
      </td>
    </tr>
  )
}

const th = { padding: '12px 16px', fontWeight: 600 as const }
const td = { padding: '10px 16px', color: C.txt }
const smallBtn = {
  fontFamily: C.sans, fontSize: 12, padding: '6px 12px', borderRadius: 999,
  border: `1px solid ${C.border}`, background: C.surface, color: C.txt, cursor: 'pointer' as const,
}
