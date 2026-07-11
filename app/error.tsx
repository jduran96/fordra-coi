'use client'

import { C } from '@/lib/theme'

/**
 * Catch-all error boundary for every surface. Server components throw on
 * failed queries (never render lying empty states); this is what those
 * throws land on. Next strips server error messages in production, so the
 * copy stays generic.
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.paper, fontFamily: C.sans, padding: 24,
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: '36px 40px', maxWidth: 460, textAlign: 'center',
      }}>
        <h1 style={{ fontFamily: C.serif, fontSize: 26, fontWeight: 400, color: C.txt, margin: '0 0 10px' }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: 14.5, color: C.txt2, lineHeight: 1.6, margin: '0 0 20px' }}>
          Nothing was lost. Please retry. If it keeps happening, contact a Fordra admin for help.
        </p>
        <button type="button" onClick={() => reset()} style={{
          padding: '10px 24px', background: C.txt, color: C.onDark, fontSize: 14,
          fontWeight: 600, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer',
        }}>
          Try again
        </button>
      </div>
    </div>
  )
}
