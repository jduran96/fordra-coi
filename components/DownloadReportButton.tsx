'use client'

import { C } from '@/lib/theme'

/**
 * Opens the browser's print dialog with the report's print stylesheet applied
 * (nav and controls hidden), where "Save as PDF" produces the download. No
 * server round trip; the printed page is exactly what the customer sees.
 */
export default function DownloadReportButton() {
  return (
    <button
      type="button"
      className="no-print"
      onClick={() => window.print()}
      style={{
        marginLeft: 'auto', padding: '8px 18px', fontSize: 13, fontWeight: 600,
        fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`,
        background: 'transparent', color: C.txt2, cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      Download PDF
    </button>
  )
}
