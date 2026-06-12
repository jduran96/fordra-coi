'use client';

import { useState, useRef } from 'react';
import { C } from './tokens';

export function DropZone({ boxTitle, hint, file, accept, onChange }: {
  boxTitle: string; hint: string; file: File | null; accept: string; onChange: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div>
      {boxTitle && (
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase' as const, color: C.txt3,
          marginBottom: 8, display: 'block', fontFamily: C.sans,
        }}>
          {boxTitle}
        </span>
      )}

      {file ? (
        <div style={{
          border: `1.5px solid ${C.success}`, borderRadius: 12,
          padding: '20px 24px',
          background: C.surfaceHover,
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <span style={{ fontSize: 22, color: C.success, lineHeight: 1, fontWeight: 700 }}>✓</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: 14, fontWeight: 600, color: C.txt, fontFamily: C.sans,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, marginBottom: 2,
            }}>
              {file.name}
            </p>
            <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans }}>{(file.size / 1024).toFixed(0)} KB</p>
          </div>
          <button
            onClick={() => ref.current?.click()}
            style={{
              fontSize: 11, fontWeight: 600, fontFamily: C.sans, letterSpacing: '0.01em',
              color: C.txt3, background: 'transparent',
              border: `1px solid ${C.border}`, borderRadius: 4,
              padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' as const,
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <div
          onClick={() => ref.current?.click()}
          onDragOver={e => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onChange(f); }}
          style={{
            border: `1.5px dashed ${over ? C.accent : C.border}`,
            borderRadius: 12, padding: '28px 20px',
            textAlign: 'center' as const, cursor: 'pointer',
            background: over ? 'oklch(52% 0.17 38 / 0.04)' : C.paper,
            transition: 'all 150ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <p style={{ fontSize: 22, marginBottom: 8 }}>↑</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.txt, marginBottom: 4, fontFamily: C.sans }}>
            Drop file or click to browse
          </p>
          <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans }}>{hint}</p>
        </div>
      )}

      <input
        ref={ref} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f); e.target.value = ''; }}
      />
    </div>
  );
}
