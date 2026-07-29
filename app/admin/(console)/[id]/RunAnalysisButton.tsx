'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { C } from '@/lib/theme'
import { runAnalysis } from '../actions'

/**
 * Generates the assessment (verdicts + draft summary) from the extraction
 * output and the contact log. Deliberately separate from Run extraction:
 * the admin runs it once the context (OCR, checks, calls) is in, and can
 * rerun it after new calls land. Each run replaces the current draft.
 */
export default function RunAnalysisButton({ verificationId }: {
  verificationId: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button type="button" disabled={pending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const res = await runAnalysis(verificationId)
            if (res && 'error' in res && res.error) setError(res.error)
            else router.refresh()
          })
        }}
        style={{
          padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600,
          fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`,
          cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1,
        }}>
        {pending ? 'Analyzing… (can take a minute)' : 'Run Analysis'}
      </button>
      {error && <span style={{ fontSize: 12.5, color: C.error, fontFamily: C.sans }}>{error}</span>}
    </span>
  )
}
