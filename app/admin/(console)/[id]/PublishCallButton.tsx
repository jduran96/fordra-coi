'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { C } from '@/lib/theme'
import { publishAiCallNote } from './call/actions'

/** One-click publish of an AI call's summary + transcript into the contact log. */
export default function PublishCallButton({ verificationId, aiCallId }: {
  verificationId: string
  aiCallId: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" disabled={pending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const res = await publishAiCallNote(verificationId, aiCallId)
            if (res && 'error' in res && res.error) setError(res.error)
            else router.refresh()
          })
        }}
        style={{ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1 }}>
        {pending ? 'Publishing...' : 'Publish to contact log'}
      </button>
      {error && <span style={{ fontSize: 12.5, color: C.error }}>{error}</span>}
    </span>
  )
}
