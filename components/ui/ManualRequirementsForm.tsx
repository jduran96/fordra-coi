'use client';

import type { Requirement } from '@/lib/types';
import { C } from './tokens';

// ─── Currency helpers ─────────────────────────────────────────────────────────
export function formatCurrencyInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return `$${Number(trimmed).toLocaleString('en-US')}`;
}
export function parseCurrencyAmount(formatted: string): number | null {
  const digits = formatted.replace(/\D/g, '');
  if (!digits) return null;
  return Number(digits);
}

// ─── ManualRequirementsForm ───────────────────────────────────────────────────
export function ManualRequirementsForm({ rows, onChange, notes, onNotesChange }: {
  rows: Requirement[];
  onChange: (next: Requirement[]) => void;
  notes: string;
  onNotesChange: (next: string) => void;
}) {
  const inputStyle = {
    width: '100%', boxSizing: 'border-box' as const,
    padding: '10px 12px', fontSize: 13, fontFamily: C.sans,
    borderRadius: 6, border: `1.5px solid ${C.border}`,
    background: C.surface, color: C.txt, outline: 'none',
    transition: 'border-color 150ms, background 150ms',
  };

  function updateRow(i: number, patch: Partial<Requirement>) {
    onChange(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function removeRow(i: number) {
    if (rows.length <= 1) return;
    onChange(rows.filter((_, idx) => idx !== i));
  }
  function addRow() {
    onChange([...rows, { coverage_type: '', minimum_limit: '', notes: '' }]);
  }

  return (
    <div style={{
      border: `1.5px solid ${C.border}`, borderRadius: 12,
      padding: 16, background: C.surface,
      display: 'flex', flexDirection: 'column' as const, gap: 12,
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.4fr 1.2fr 1.6fr 28px',
        gap: 8,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase' as const, color: C.txt3, fontFamily: C.sans,
      }}>
        <span>Coverage type</span>
        <span>Minimum limit</span>
        <span>Notes</span>
        <span />
      </div>

      {rows.map((row, i) => (
        <div key={i} style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1.2fr 1.6fr 28px',
          gap: 8, alignItems: 'center',
        }}>
          <input
            type="text"
            value={row.coverage_type}
            onChange={e => updateRow(i, { coverage_type: e.target.value })}
            placeholder="e.g. Auto Liability"
            style={inputStyle}
          />
          <input
            type="text"
            inputMode="numeric"
            value={row.minimum_limit}
            onChange={e => updateRow(i, { minimum_limit: formatCurrencyInput(e.target.value) })}
            placeholder="e.g. $1,000,000"
            style={inputStyle}
          />
          <input
            type="text"
            value={row.notes ?? ''}
            onChange={e => updateRow(i, { notes: e.target.value })}
            placeholder="Optional"
            style={inputStyle}
          />
          {rows.length > 1 ? (
            <button
              type="button"
              onClick={() => removeRow(i)}
              title="Remove row"
              style={{
                width: 28, height: 28, padding: 0,
                borderRadius: 6, border: `1px solid ${C.border}`,
                background: 'transparent', color: C.txt3,
                cursor: 'pointer', fontSize: 14, lineHeight: 1,
                transition: 'all 120ms',
              }}
            >
              ×
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        style={{
          alignSelf: 'flex-start',
          fontSize: 12, fontWeight: 600, fontFamily: C.sans,
          padding: '6px 12px', borderRadius: 6,
          border: `1px dashed ${C.border}`, background: 'transparent',
          color: C.txt2, cursor: 'pointer',
          transition: 'all 120ms',
        }}
      >
        + Add requirement
      </button>

      <div style={{ marginTop: 4 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase' as const, color: C.txt3,
          fontFamily: C.sans, display: 'block', marginBottom: 6,
        }}>
          Additional details (optional)
        </span>
        <textarea
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          placeholder="Anything the fields above didn't capture — extra coverages, conditions, endorsements, etc."
          rows={3}
          style={{
            ...inputStyle,
            resize: 'vertical' as const,
            fontFamily: C.sans,
            minHeight: 64,
          }}
        />
      </div>
    </div>
  );
}
