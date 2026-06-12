'use client';

import { useState } from 'react';
import { C } from './tokens';

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'oklch(20% 0.010 265)',
        borderRadius: '10px 10px 0 0',
        padding: '8px 14px',
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase' as const, fontFamily: C.sans,
          color: 'oklch(70% 0.008 265)',
        }}>
          {label ?? 'Code'}
        </span>
        <button
          onClick={copy}
          style={{
            fontSize: 11, fontWeight: 600, fontFamily: C.sans,
            color: copied ? 'oklch(75% 0.12 155)' : 'oklch(70% 0.008 265)',
            background: 'transparent',
            border: '1px solid oklch(35% 0.010 265)',
            borderRadius: 4, padding: '3px 10px', cursor: 'pointer',
            transition: 'color 120ms',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre style={{
        margin: 0,
        background: 'oklch(15% 0.008 265)',
        borderRadius: '0 0 10px 10px',
        padding: '16px 18px',
        overflowX: 'auto',
        fontSize: 12.5,
        lineHeight: 1.65,
        color: 'oklch(90% 0.005 80)',
        fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace",
      }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
