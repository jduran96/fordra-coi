'use client';

import { useState } from 'react';
import { C } from './tokens';

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  render: (row: T) => React.ReactNode;
}

function Row<T>({ row, columns, onClick }: {
  row: T; columns: Column<T>[]; onClick?: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov && onClick ? C.surfaceHover : 'transparent',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 100ms',
      }}
    >
      {columns.map(col => (
        <td key={col.key} style={{
          padding: '14px 12px',
          fontSize: 13, fontFamily: C.sans, color: C.txt,
          borderBottom: `1px solid ${C.border}`,
          verticalAlign: 'middle',
        }}>
          {col.render(row)}
        </td>
      ))}
    </tr>
  );
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, emptyText }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyText?: string;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
      <thead>
        <tr>
          {columns.map(col => (
            <th key={col.key} style={{
              padding: '10px 12px', textAlign: 'left' as const,
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase' as const, color: C.txt3, fontFamily: C.sans,
              borderBottom: `1px solid ${C.border}`,
              width: col.width,
              whiteSpace: 'nowrap' as const,
            }}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} style={{
              padding: '32px 12px', textAlign: 'center' as const,
              fontSize: 13, color: C.txt3, fontFamily: C.sans,
            }}>
              {emptyText ?? 'Nothing here yet.'}
            </td>
          </tr>
        ) : rows.map(row => (
          <Row
            key={rowKey(row)}
            row={row}
            columns={columns}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          />
        ))}
      </tbody>
    </table>
  );
}

// ─── Pagination ────────────────────────────────────────────────────────────────
export function Pagination({ page, pageSize, total, onPageChange }: {
  page: number;          // 0-based
  pageSize: number;
  total: number;
  onPageChange: (next: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  const arrowStyle = (enabled: boolean): React.CSSProperties => ({
    width: 30, height: 30, borderRadius: 6,
    border: `1px solid ${C.border}`,
    background: 'transparent',
    color: enabled ? C.txt2 : C.txt3,
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontSize: 14, lineHeight: 1,
    opacity: enabled ? 1 : 0.4,
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 16,
    }}>
      <span style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans }}>
        {from}–{to} of {total}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => page > 0 && onPageChange(page - 1)}
          disabled={page === 0}
          style={arrowStyle(page > 0)}
        >
          ‹
        </button>
        <button
          onClick={() => page < pages - 1 && onPageChange(page + 1)}
          disabled={page >= pages - 1}
          style={arrowStyle(page < pages - 1)}
        >
          ›
        </button>
      </div>
    </div>
  );
}
