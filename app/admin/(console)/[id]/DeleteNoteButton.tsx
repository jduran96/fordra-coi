'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'

/**
 * Per-note delete with a two-click confirm (first click arms it, second
 * deletes; moving focus away disarms). Admin only via the bound server action.
 */
export default function DeleteNoteButton({ action }: {
  action: () => Promise<{ error?: string } | void>
}) {
  const [arming, setArming] = useState(false)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function onClick() {
    if (!arming) {
      setArming(true)
      return
    }
    setError('')
    startTransition(async () => {
      const res = await action()
      if (res?.error) setError(res.error)
      setArming(false)
    })
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        onBlur={() => setArming(false)}
        disabled={pending}
        title={arming ? 'Click again to delete this note' : 'Delete this note'}
        style={{
          padding: '4px 10px', fontSize: 12, fontWeight: 600, fontFamily: C.sans,
          borderRadius: 6, border: `1px solid ${arming ? C.error : C.border}`,
          background: arming ? C.error : 'transparent',
          color: arming ? C.onDark : C.txt3,
          cursor: pending ? 'default' : 'pointer', whiteSpace: 'nowrap',
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? 'Deleting…' : arming ? 'Confirm' : 'Delete'}
      </button>
      {error && <span style={{ fontSize: 11.5, color: C.error, fontFamily: C.sans }}>{error}</span>}
    </span>
  )
}
