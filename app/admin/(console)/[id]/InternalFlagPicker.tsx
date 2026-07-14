'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { INTERNAL_FLAGS } from '@/lib/internal-flag'

/**
 * Top-right "who called this" selector on the admin detail page. Saves on
 * change (no separate submit button); internal bookkeeping only, so there is
 * nothing to confirm or undo beyond picking a different option.
 */
export default function InternalFlagPicker({ initialValue, action }: {
  initialValue: string | null
  action: (flag: string) => Promise<{ error?: string } | void>
}) {
  const [value, setValue] = useState(initialValue ?? '')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    const prev = value
    setValue(next)
    setError('')
    startTransition(async () => {
      const res = await action(next)
      if (res?.error) {
        setError(res.error)
        setValue(prev)
      }
    })
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
      <select
        value={value}
        onChange={onChange}
        disabled={pending}
        title="Internal admin note (not visible to the customer)"
        style={{
          fontSize: 12, fontWeight: 600, fontFamily: C.sans, color: C.txt2,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20,
          padding: '4px 10px', cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1,
        }}
      >
        <option value="">Admin note: none</option>
        {INTERNAL_FLAGS.map(f => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      {error && <span style={{ fontSize: 11, color: C.error }}>{error}</span>}
    </span>
  )
}
