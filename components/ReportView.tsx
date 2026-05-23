import type { FinalReport, GapItem } from '@/lib/types';

const SECTIONS: Array<{ key: keyof Omit<FinalReport, 'narrative_summary'>; label: string; color: string; icon: string }> = [
  { key: 'met',       label: 'Requirements met',      color: '#16a34a', icon: '✅' },
  { key: 'not_met',   label: 'Requirements not met',  color: '#dc2626', icon: '❌' },
  { key: 'uncertain', label: 'Still uncertain',        color: '#d97706', icon: '⚠️' },
];

function ReportSection({ label, items, color, icon }: { label: string; items: GapItem[]; color: string; icon: string }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon} {label} ({items.length})
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, i) => (
          <div key={i} style={{ padding: '12px 16px', background: `${color}0d`, border: `1px solid ${color}33`, borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{item.requirement.coverage_type}</span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginLeft: 12 }}>{item.requirement.minimum_limit}</span>
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>{item.evidence}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReportView({ report }: { report: FinalReport }) {
  return (
    <div>
      {/* Narrative summary */}
      <div style={{ padding: '20px 24px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, marginBottom: 28, border: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 10 }}>Summary</p>
        <p style={{ fontSize: 15, lineHeight: 1.7, color: 'rgba(255,255,255,0.85)' }}>{report.narrative_summary}</p>
      </div>

      {/* Summary counts */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        {SECTIONS.map(s => (
          <div key={s.key} style={{ flex: 1, padding: '16px', background: `${s.color}11`, border: `1px solid ${s.color}33`, borderRadius: 12, textAlign: 'center' }}>
            <p style={{ fontSize: 26, fontWeight: 900, color: s.color, marginBottom: 4 }}>{report[s.key].length}</p>
            <p style={{ fontSize: 11, fontWeight: 600, color: s.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Detailed sections */}
      {SECTIONS.map(s => (
        <ReportSection
          key={s.key}
          label={s.label}
          items={report[s.key] as GapItem[]}
          color={s.color}
          icon={s.icon}
        />
      ))}

      {/* Print button */}
      <button
        onClick={() => window.print()}
        style={{ marginTop: 8, padding: '10px 20px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer' }}
      >
        🖨 Download / Print report
      </button>
    </div>
  );
}
