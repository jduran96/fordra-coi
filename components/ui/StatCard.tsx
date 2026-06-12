'use client';

import { C } from './tokens';

// Big-number stat card (serif numeral + uppercase label), pattern from
// the demo report's SummaryStats.
export function StatCard({ value, label, sub, color }: {
  value: string | number;
  label: string;
  sub?: string;
  color?: string;
}) {
  const c = color ?? C.txt;
  return (
    <div style={{
      padding: '22px 20px',
      background: `color-mix(in oklch, ${C.txt} 6%, ${C.surface})`,
      border: `1px solid color-mix(in oklch, ${c} ${color ? 28 : 15}%, transparent)`,
      borderRadius: 12,
    }}>
      <p style={{
        fontFamily: C.serif, fontSize: 38, fontWeight: 400,
        color: c, lineHeight: 1, margin: 0,
      }}>
        {value}
      </p>
      <p style={{
        fontSize: 11, fontWeight: 700, color: C.txt2,
        textTransform: 'uppercase' as const, letterSpacing: '0.07em',
        margin: '8px 0 0', fontFamily: C.sans,
      }}>
        {label}
      </p>
      {sub && (
        <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, margin: '4px 0 0' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

export function StatGrid({ children, columns = 3 }: { children: React.ReactNode; columns?: number }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, 1fr)`,
      gap: 12,
      marginBottom: 16,
    }}>
      {children}
    </div>
  );
}
