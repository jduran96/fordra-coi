'use client';

import type { COIExtracted, COICoverage, GapItem } from '@/lib/types';
import { C } from './tokens';
import { Card, FieldLabel, SectionLabel, RequirementTag } from './primitives';

// ─── Helpers ───────────────────────────────────────────────────────────────────
export function getPrimaryInsurer(coverages: COICoverage[]): string {
  const counts: Record<string, number> = {};
  coverages.forEach(cv => { if (cv.insurer) counts[cv.insurer] = (counts[cv.insurer] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

export function getCoverageDateRange(coverages: COICoverage[]): string {
  const effDates = coverages.map(c => c.effective_date).filter(Boolean).sort();
  const expDates = coverages.map(c => c.expiration_date).filter(Boolean).sort();
  const earliest = effDates[0];
  const latest = expDates[expDates.length - 1];
  if (!earliest && !latest) return '—';
  if (earliest && latest) return `${earliest} – ${latest}`;
  return earliest || latest;
}

function getExtraCoverageTerms(coverages: COICoverage[]): string {
  return coverages.map(c => c.raw_notes).filter(Boolean).join(' ').trim();
}

export function shortTitle(coverageType: string): string {
  return coverageType.split(/\s*\/\s*/)[0].trim().replace(/[,;:&|]+$/, '').trim();
}

// ─── Transcript ────────────────────────────────────────────────────────────────
export function TranscriptView({ raw }: { raw: string }) {
  const lines = raw
    .replace(/^agent:/gim, 'AI:')
    .replace(/^user:/gim, 'Insurance Rep:')
    .split('\n');
  return (
    <div style={{ fontSize: 12, color: C.txt2, fontFamily: C.sans, lineHeight: 1.8 }}>
      {lines.map((line, i) => {
        const m = line.match(/^(AI|Insurance Rep):(.*)/);
        if (m) return (
          <div key={i}>
            <span style={{ fontWeight: 700, textDecoration: 'underline', color: C.txt }}>{m[1]}:</span>
            {m[2]}
          </div>
        );
        return <div key={i}>{line || ' '}</div>;
      })}
    </div>
  );
}

// ─── Summary stat row ──────────────────────────────────────────────────────────
export function SummaryStats({ total, discrepancies, missing }: {
  total: number; discrepancies: number; missing: number;
}) {
  const neutralBg = `color-mix(in oklch, ${C.txt} 6%, ${C.surface})`;
  function statColors(n: number, activeColor: string) {
    const color = n === 0 ? C.success : activeColor;
    return {
      color,
      bg: neutralBg,
      border: `color-mix(in oklch, ${color} 28%, transparent)`,
    };
  }
  const req  = { color: C.txt, bg: neutralBg, border: `color-mix(in oklch, ${C.txt} 15%, transparent)` };
  const disc = statColors(discrepancies, C.error);
  const miss = statColors(missing, C.accent);
  const stats = [
    { n: total,         label: 'Requirements',  ...req  },
    { n: discrepancies, label: 'Discrepancies', ...disc },
    { n: missing,       label: 'Missing',       ...miss },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 32 }}>
      {stats.map(s => (
        <div key={s.label} style={{
          padding: '20px 16px', textAlign: 'center' as const,
          background: s.bg,
          border: `1px solid ${s.border}`,
          borderRadius: 12,
        }}>
          <p style={{
            fontFamily: C.serif, fontSize: 44, fontWeight: 400,
            color: s.color, lineHeight: 1,
          }}>
            {s.n}
          </p>
          <p style={{
            fontSize: 11, fontWeight: 700, color: s.color,
            textTransform: 'uppercase' as const, letterSpacing: '0.07em',
            marginTop: 6, fontFamily: C.sans,
          }}>
            {s.label}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── COI details ───────────────────────────────────────────────────────────────
export function COIDetailsSection({ coi }: { coi: COIExtracted }) {
  const insurer    = getPrimaryInsurer(coi.coverages);
  const dateRange  = getCoverageDateRange(coi.coverages);
  const extraTerms = getExtraCoverageTerms(coi.coverages);

  return (
    <Card>
      <FieldLabel>Carrier name</FieldLabel>
      <p style={{ fontFamily: C.serif, fontSize: 22, color: C.txt, marginBottom: 20 }}>
        {coi.named_insured || '—'}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div>
          <FieldLabel>Insurance company</FieldLabel>
          <p style={{ fontSize: 14, color: C.txt, fontFamily: C.sans }}>{coi.producer || coi.insurance_company || insurer || '—'}</p>
        </div>
        <div>
          <FieldLabel>Coverage dates</FieldLabel>
          <p style={{ fontSize: 14, color: C.txt, fontFamily: C.sans }}>{dateRange}</p>
        </div>
      </div>

      <FieldLabel>Coverages</FieldLabel>
      <ul style={{ paddingLeft: 18, margin: '0 0 16px', display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
        {coi.coverages.map((cv, i) => (
          <li key={i} style={{ fontSize: 13, color: C.txt2, lineHeight: 1.5, fontFamily: C.sans }}>
            <strong style={{ color: C.txt }}>{cv.type}</strong>
            {cv.insurer && ` · ${cv.insurer}`}
            {cv.each_occurrence_limit && ` · Occ: ${cv.each_occurrence_limit}`}
            {cv.aggregate_limit && ` · Agg: ${cv.aggregate_limit}`}
          </li>
        ))}
      </ul>

      {extraTerms && (
        <>
          <FieldLabel>Additional terms</FieldLabel>
          <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.65, fontFamily: C.sans }}>{extraTerms}</p>
        </>
      )}
    </Card>
  );
}

// ─── Requirement check ─────────────────────────────────────────────────────────
export function RequirementCheckSection({ items }: { items: GapItem[] }) {
  return (
    <Card>
      <FieldLabel>Requirement Check</FieldLabel>
      {items.map((item, i) => (
        <div key={i} style={{
          padding: '16px 0',
          borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : 'none',
          display: 'flex', gap: 16, alignItems: 'flex-start',
        }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 6, fontFamily: C.sans }}>
              {shortTitle(item.requirement.coverage_type)}
            </p>
            <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.65, fontFamily: C.sans }}>
              {item.evidence}
            </p>
          </div>
          <RequirementTag status={item.status} />
        </div>
      ))}
    </Card>
  );
}

// ─── Full report ───────────────────────────────────────────────────────────────
export function ReportView({
  items,
  coi,
  isFinal,
  narrativeSummary,
  callAnswers,
  transcript,
}: {
  items: GapItem[];
  coi: COIExtracted;
  isFinal: boolean;
  narrativeSummary?: string;
  callAnswers?: Record<string, string> | null;
  transcript?: string | null;
}) {
  const disc = items.filter(i => i.status === 'not_met').length;
  const miss = items.filter(i => i.status === 'uncertain').length;

  const subtitle = (() => {
    if (isFinal) {
      if (disc > 0 && miss > 0) return `${disc} discrepanc${disc === 1 ? 'y' : 'ies'} and ${miss} unresolved item${miss === 1 ? '' : 's'} remain`;
      if (disc > 0) return `${disc} discrepanc${disc === 1 ? 'y' : 'ies'} confirmed`;
      if (miss > 0) return `${miss} item${miss === 1 ? '' : 's'} could not be confirmed`;
      return 'All requirements satisfied';
    }
    if (disc > 0 && miss > 0) return `We found ${disc} discrepanc${disc === 1 ? 'y' : 'ies'} and ${miss} missing detail${miss === 1 ? '' : 's'}`;
    if (disc > 0) return `We found ${disc} discrepanc${disc === 1 ? 'y' : 'ies'}`;
    if (miss > 0) return `We found ${miss} missing detail${miss === 1 ? '' : 's'}`;
    return 'This COI aligns with your requirements!';
  })();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{
          fontFamily: C.serif, fontSize: 38, fontWeight: 400,
          letterSpacing: '-0.02em', color: C.txt, margin: 0,
        }}>
          {isFinal ? 'Final Report' : 'Preliminary Report'}
        </h1>
        {isFinal && (
          <button
            onClick={() => window.print()}
            className="no-print"
            style={{
              marginTop: 8,
              fontSize: 13, fontWeight: 600, fontFamily: C.sans,
              padding: '7px 16px', borderRadius: 6,
              border: `1.5px solid ${C.border}`,
              background: C.surface, color: C.txt2,
              cursor: 'pointer',
            }}
          >
            Export PDF
          </button>
        )}
      </div>
      <p style={{ fontSize: 15, color: C.txt2, fontFamily: C.sans, marginBottom: 32 }}>
        {subtitle}
      </p>

      <SummaryStats total={items.length} discrepancies={disc} missing={miss} />

      {narrativeSummary && (
        <Card style={{ marginTop: 8 }}>
          <FieldLabel>Summary</FieldLabel>
          <p style={{ fontSize: 14, color: C.txt2, lineHeight: 1.7, fontFamily: C.sans }}>
            {narrativeSummary}
          </p>
        </Card>
      )}

      <SectionLabel>Carrier COI Details</SectionLabel>
      <COIDetailsSection coi={coi} />

      <SectionLabel>Requirement Check</SectionLabel>
      <RequirementCheckSection items={items} />

      {isFinal && (callAnswers || transcript) && (
        <>
          <SectionLabel>Call Transcript</SectionLabel>
          <Card>
            {callAnswers && Object.keys(callAnswers).length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <FieldLabel>Q&amp;A Summary</FieldLabel>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
                  {Object.entries(callAnswers).map(([q, a], i) => (
                    <div key={i}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: C.txt, fontFamily: C.sans, marginBottom: 3 }}>
                        {i + 1}. {q}
                      </p>
                      <p style={{ fontSize: 13, color: C.txt2, fontFamily: C.sans, lineHeight: 1.55 }}>
                        {a || 'Not addressed in call.'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {transcript && (
              <>
                <FieldLabel>Full transcript</FieldLabel>
                <TranscriptView raw={transcript} />
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
