import type { GapAnalysis, GapItem } from '@/lib/types';

const SECTIONS: Array<{ key: keyof GapAnalysis; label: string; color: string; dot: string }> = [
  { key: 'met',      label: 'Met',      color: '#16a34a', dot: '✅' },
  { key: 'not_met',  label: 'Not met',  color: '#dc2626', dot: '❌' },
  { key: 'uncertain',label: 'Uncertain',color: '#d97706', dot: '⚠️' },
];

function GapRow({ item, color }: { item: GapItem; color: string }) {
  return (
    <tr>
      <td style={{ padding: '10px 12px', fontSize: 14, fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#fff' }}>
        {item.requirement.coverage_type}
      </td>
      <td style={{ padding: '10px 12px', fontSize: 14, borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)' }}>
        {item.requirement.minimum_limit}
      </td>
      <td style={{ padding: '10px 12px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
        {item.evidence}
      </td>
      <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 100, background: `${color}22`, color }}>
          {item.status.replace('_', ' ')}
        </span>
      </td>
    </tr>
  );
}

export default function GapTable({ gapAnalysis }: { gapAnalysis: GapAnalysis }) {
  const allItems = [
    ...gapAnalysis.met.map(i => ({ ...i, _color: '#16a34a' })),
    ...gapAnalysis.not_met.map(i => ({ ...i, _color: '#dc2626' })),
    ...gapAnalysis.uncertain.map(i => ({ ...i, _color: '#d97706' })),
  ];

  return (
    <div>
      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {SECTIONS.map(s => (
          <span key={s.key} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 100, background: `${s.color}22`, color: s.color }}>
            {s.dot} {gapAnalysis[s.key].length} {s.label}
          </span>
        ))}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Coverage type', 'Required limit', 'Evidence', 'Status'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allItems.map((item, i) => (
              <GapRow key={i} item={item} color={item._color} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
