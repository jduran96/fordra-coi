'use client'

import { createContext, useContext, useState } from 'react'
import { C } from '@/lib/theme'

/**
 * Tabbed layout for the admin verification detail page. All panels stay
 * mounted (hidden with CSS) so in-progress form state — assessment edits,
 * pending extraction runs, a half-typed call note — survives tab switches.
 *
 * The assessment form is special: its Save draft / Reject / Publish buttons
 * are the page's global actions and must stay visible under every tab, while
 * its body (requirement rows + summary) belongs to the Analysis tab. The
 * buttons cannot leave the <form> element (they submit its fields and use its
 * pending state), so the whole form renders below the panels and
 * AssessmentForm gates its body on this context.
 */
const AnalysisBodyContext = createContext(true)
export function useAnalysisBodyVisible() {
  return useContext(AnalysisBodyContext)
}

export default function AdminTabs({ tabs, analysisForm }: {
  /** The LAST tab is Analysis: its content renders above the assessment form body. */
  tabs: { label: string; content: React.ReactNode }[]
  /** The AssessmentForm element: body shown only on the Analysis tab, action footer always. */
  analysisForm: React.ReactNode
}) {
  const [active, setActive] = useState(0)
  const analysisIdx = tabs.length - 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div role="tablist" style={{ display: 'flex', gap: 2, borderBottom: `1.5px solid ${C.border}` }}>
        {tabs.map((t, i) => (
          <button
            key={t.label} type="button" role="tab" aria-selected={active === i}
            onClick={() => setActive(i)}
            style={{
              padding: '10px 16px', fontSize: 13, fontWeight: 600, fontFamily: C.sans,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: active === i ? C.txt : C.txt3,
              borderBottom: active === i ? `2px solid ${C.limeDeep}` : '2px solid transparent',
              marginBottom: -1.5,
            }}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.label} role="tabpanel" style={{ display: active === i ? 'block' : 'none' }}>
          {t.content}
        </div>
      ))}
      <AnalysisBodyContext.Provider value={active === analysisIdx}>
        {analysisForm}
      </AnalysisBodyContext.Provider>
    </div>
  )
}
