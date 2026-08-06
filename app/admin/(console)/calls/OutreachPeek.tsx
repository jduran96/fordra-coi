'use client'

import { useState } from 'react'
import { C } from '@/lib/theme'
import EditorModal from '@/components/EditorModal'

/**
 * The global AI page's per-row View button: a pop-up with just the contact
 * exchange — call summary + transcript for calls, the message thread for
 * emails — so an admin can read what was said without opening the full
 * verification report. Content is prepared server-side (transcript formatted,
 * quoted reply history stripped) and passed down serialized.
 */

export interface CallPeekData {
  kind: 'call'
  when: string
  toNumber: string
  summary: string
  transcript: string
}

export interface EmailPeekMessage {
  id: string
  direction: 'outbound' | 'inbound'
  from: string
  when: string
  body: string
  attachments: string[]
}

export interface EmailPeekData {
  kind: 'email'
  when: string
  subject: string
  /** Newest first, quoted history already stripped. */
  messages: EmailPeekMessage[]
}

export default function OutreachPeek({ data }: { data: CallPeekData | EmailPeekData }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`, background: 'transparent', color: C.txt2, cursor: 'pointer' }}>
        View
      </button>
      {open && (
        <EditorModal title={data.kind === 'call' ? 'AI call' : 'Email thread'} onClose={() => setOpen(false)} maxWidth={720}>
          {data.kind === 'call' ? <CallPeek data={data} /> : <EmailPeek data={data} />}
        </EditorModal>
      )}
    </>
  )
}

function CallPeek({ data }: { data: CallPeekData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: C.sans }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        {data.toNumber && <span style={{ fontFamily: C.mono, fontSize: 13, color: C.txt }}>{data.toNumber}</span>}
        <span style={{ fontSize: 13, color: C.txt3 }}>{data.when}</span>
      </div>
      {data.summary ? (
        <div>
          <h3 style={sub}>Summary</h3>
          <p style={{ fontSize: 13.5, color: C.txt, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{data.summary}</p>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: C.txt3, margin: 0 }}>No summary for this call.</p>
      )}
      {data.transcript && (
        <div>
          <h3 style={sub}>Transcript</h3>
          <div style={{ fontSize: 13, color: C.txt2, whiteSpace: 'pre-wrap', lineHeight: 1.6, overflowWrap: 'anywhere', maxHeight: 320, overflowY: 'auto', paddingLeft: 14, borderLeft: `2px solid ${C.border}` }}>
            {data.transcript}
          </div>
        </div>
      )}
    </div>
  )
}

function EmailPeek({ data }: { data: EmailPeekData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: C.sans }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.txt, overflowWrap: 'anywhere' }}>{data.subject || '(no subject)'}</span>
        <span style={{ fontSize: 12.5, color: C.txt3 }}>{data.when}</span>
      </div>
      {data.messages.length === 0 ? (
        <p style={{ fontSize: 13, color: C.txt3, margin: 0 }}>No messages synced yet. Open the verification and refresh the thread.</p>
      ) : (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 9, overflow: 'hidden' }}>
          {data.messages.map((m, i) => (
            <div key={m.id} style={{
              padding: 12,
              borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
              background: m.direction === 'inbound' ? `color-mix(in oklch, ${C.lime} 7%, ${C.paper})` : C.paper,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, overflowWrap: 'anywhere' }}>{m.from}</span>
                <span style={{ fontSize: 12, color: C.txt3, whiteSpace: 'nowrap' }}>{m.when}</span>
              </div>
              <div style={{ fontSize: 13, color: C.txt, whiteSpace: 'pre-wrap', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                {m.body || '(no text)'}
              </div>
              {m.attachments.length > 0 && (
                <p style={{ fontSize: 12, color: C.txt3, margin: '8px 0 0' }}>Attachments: {m.attachments.join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const sub: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 6px' }
