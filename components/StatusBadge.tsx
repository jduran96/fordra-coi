import type { CaseStatus } from '@/lib/types';

const CONFIG: Record<CaseStatus, { label: string; color: string }> = {
  pending_docs:     { label: 'Pending docs',   color: '#6b7280' },
  ocr_complete:     { label: 'OCR complete',   color: '#2563eb' },
  ready_for_call:   { label: 'Ready for call', color: '#d97706' },
  call_in_progress: { label: 'Calling…',       color: '#ea580c' },
  call_complete:    { label: 'Call complete',  color: '#7c3aed' },
  report_ready:     { label: 'Report ready',   color: '#16a34a' },
  failed:           { label: 'Could not complete', color: '#dc2626' },
};

export default function StatusBadge({ status }: { status: CaseStatus }) {
  const { label, color } = CONFIG[status] ?? { label: status, color: '#6b7280' };
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 12,
      fontWeight: 600,
      padding: '5px 14px',
      borderRadius: 100,
      background: `${color}22`,
      color,
      letterSpacing: 0.3,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
