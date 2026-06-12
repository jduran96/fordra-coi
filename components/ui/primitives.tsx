'use client';

import { useState, useEffect } from 'react';
import { C } from './tokens';

// ─── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '28px 32px', background: C.surface, marginBottom: 16, ...style,
    }}>
      {children}
    </div>
  );
}

// ─── Field label ───────────────────────────────────────────────────────────────
export function FieldLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase' as const, color: C.txt3,
      display: 'block', marginBottom: 10, fontFamily: C.sans, ...style,
    }}>
      {children}
    </span>
  );
}

// ─── Section label ─────────────────────────────────────────────────────────────
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '32px 0 24px' }}>
      <div style={{ flex: 1, height: 1, background: C.border }} />
      <span style={{
        fontFamily: C.serif, fontSize: 18, fontStyle: 'italic',
        fontWeight: 400, color: C.txt2, whiteSpace: 'nowrap' as const,
      }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

// ─── Page title ────────────────────────────────────────────────────────────────
export function PageTitle({ children, subtitle }: { children: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h1 style={{
        fontFamily: C.serif, fontSize: 32, fontWeight: 400,
        letterSpacing: '-0.02em', color: C.txt, margin: 0, lineHeight: 1.15,
      }}>
        {children}
      </h1>
      {subtitle && (
        <p style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, lineHeight: 1.6, margin: '10px 0 0' }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ─── Buttons ───────────────────────────────────────────────────────────────────
export function PrimaryBtn({ children, onClick, disabled, style }: {
  children: React.ReactNode; onClick?: () => void;
  disabled?: boolean; style?: React.CSSProperties;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding: '13px 28px', fontSize: 14, fontWeight: 600, fontFamily: C.sans,
        borderRadius: 6, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? C.border : hov ? C.accent : C.txt,
        color: disabled ? C.txt3 : C.surface,
        transition: 'background 110ms cubic-bezier(0.16, 1, 0.3, 1)',
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function SecondaryBtn({ children, onClick, style }: {
  children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding: '8px 16px', fontSize: 12, fontWeight: 600, fontFamily: C.sans,
        borderRadius: 6, border: `1px solid ${C.border}`,
        background: hov ? C.surfaceHover : 'transparent',
        color: C.txt2, cursor: 'pointer',
        transition: 'all 110ms cubic-bezier(0.16, 1, 0.3, 1)',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// ─── Pill (status badge) ───────────────────────────────────────────────────────
export function Pill({ label, color, style }: { label: string; color: string; style?: React.CSSProperties }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999,
      background: `color-mix(in oklch, ${color} 14%, transparent)`,
      color, whiteSpace: 'nowrap' as const, fontFamily: C.sans, flexShrink: 0, ...style,
    }}>
      {label}
    </span>
  );
}

export function RequirementTag({ status }: { status: 'met' | 'not_met' | 'uncertain' }) {
  const config = {
    met:       { label: 'Satisfied',   color: C.success },
    not_met:   { label: 'Discrepancy', color: C.error   },
    uncertain: { label: 'Missing',     color: C.accent  },
  };
  const { label, color } = config[status];
  return <Pill label={label} color={color} />;
}

// ─── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 14, color = C.accent }: { size?: number; color?: string }) {
  return (
    <>
      <style>{`@keyframes fdr-spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{
        width: size, height: size, borderRadius: '50%',
        border: `2px solid ${color}`,
        borderTopColor: 'transparent',
        display: 'inline-block',
        animation: 'fdr-spin 0.7s linear infinite',
      }} />
    </>
  );
}

// ─── Scanning document animation ───────────────────────────────────────────────
export function ScanningDoc() {
  const color = C.accent;
  return (
    <svg viewBox="0 0 48 60" width="64" height="80" style={{ display: 'block', overflow: 'visible' }}>
      <rect x="3" y="3" width="42" height="54" rx="3" fill="none" stroke={color} strokeWidth="1.8" opacity="0.25" />
      <polyline points="33,3 41,11 33,11 33,3" fill="none" stroke={color} strokeWidth="1.5" opacity="0.25" />
      <line x1="9" y1="20" x2="39" y2="20" stroke={color} strokeWidth="1.5" opacity="0.13" strokeLinecap="round" />
      <line x1="9" y1="28" x2="39" y2="28" stroke={color} strokeWidth="1.5" opacity="0.13" strokeLinecap="round" />
      <line x1="9" y1="36" x2="29" y2="36" stroke={color} strokeWidth="1.5" opacity="0.13" strokeLinecap="round" />
      <line x1="9" y1="44" x2="34" y2="44" stroke={color} strokeWidth="1.5" opacity="0.13" strokeLinecap="round" />
      <rect x="3" width="42" height="2" rx="1" fill={color}>
        <animate attributeName="y" values="3;57;3" dur="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1; 0.4 0 0.6 1" />
        <animate attributeName="opacity" values="0;0.75;0.75;0.75;0" keyTimes="0;0.06;0.5;0.92;1" dur="2s" repeatCount="indefinite" />
      </rect>
      <rect x="3" width="42" height="6" rx="2" fill={color} opacity="0">
        <animate attributeName="y" values="3;55;3" dur="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1; 0.4 0 0.6 1" />
        <animate attributeName="opacity" values="0;0.12;0.12;0.12;0" keyTimes="0;0.06;0.5;0.92;1" dur="2s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

// ─── Animated dots ─────────────────────────────────────────────────────────────
export function useAnimatedDots(active: boolean) {
  const [dots, setDots] = useState('');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(t);
  }, [active]);
  return dots;
}
