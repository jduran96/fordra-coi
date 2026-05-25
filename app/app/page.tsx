'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Requirement, COIExtracted, COICoverage, GapAnalysis, GapItem, FinalReport } from '@/lib/types';

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  paper:        'oklch(98.5% 0.004 80)',
  surface:      'oklch(100% 0 0)',
  surfaceHover: 'oklch(96.5% 0.005 80)',
  border:       'oklch(88% 0.008 80)',
  borderStrong: 'oklch(76% 0.010 80)',
  txt:          'oklch(13% 0.008 265)',
  txt2:         'oklch(46% 0.012 265)',
  txt3:         'oklch(68% 0.008 265)',
  circle:       'oklch(52% 0.17 38)',
  success:      'oklch(46% 0.14 155)',
  error:        'oklch(52% 0.20 25)',
  serif:        "'DM Serif Display', Georgia, 'Times New Roman', serif",
  sans:         "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
};

// ─── Types ─────────────────────────────────────────────────────────────────────
interface VerifyResult {
  requirements: Requirement[];
  coi_extracted: COIExtracted;
  gap_analysis: GapAnalysis;
  agent_questions: string[];
}

type Step = 'upload' | 'analyze' | 'draft' | 'contact' | 'report';
type CallPhase = 'idle' | 'calling' | 'connected' | 'ended' | 'loading' | 'complete';

interface InsuranceOption {
  name: string;
  address: string;
  email: string;
  phone: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const NAV_LABELS = ['Upload', 'Analyze', 'Draft', 'Contact', 'Report'];
const STEP_KEYS: Step[] = ['upload', 'analyze', 'draft', 'contact', 'report'];

const PROCESSING_MSGS = [
  'Reading documents...',
  'Extracting insights...',
  'Finding gaps...',
  'Preparing questions...',
];

const CITY_PAIRS: Record<string, [string, string]> = {
  AL: ['Birmingham', 'Huntsville'],   AZ: ['Phoenix', 'Tucson'],
  CA: ['Los Angeles', 'Fresno'],      CO: ['Denver', 'Colorado Springs'],
  FL: ['Miami', 'Tampa'],             GA: ['Atlanta', 'Savannah'],
  IL: ['Chicago', 'Rockford'],        IN: ['Indianapolis', 'Fort Wayne'],
  KY: ['Louisville', 'Lexington'],    MI: ['Detroit', 'Grand Rapids'],
  MN: ['Minneapolis', 'Rochester'],   MO: ['Kansas City', 'St. Louis'],
  NC: ['Charlotte', 'Raleigh'],       NJ: ['Newark', 'Trenton'],
  NY: ['New York', 'Buffalo'],        OH: ['Columbus', 'Cleveland'],
  PA: ['Philadelphia', 'Pittsburgh'], TN: ['Nashville', 'Memphis'],
  TX: ['Houston', 'Dallas'],          VA: ['Richmond', 'Norfolk'],
  WA: ['Seattle', 'Spokane'],         WI: ['Milwaukee', 'Madison'],
};

const CONTACT_EMAIL = 'jullian@fordra.com';
const CONTACT_PHONE = '(727) 729-9594';
const DEMO_PHONE    = '7277299594';

// ─── Utility functions ─────────────────────────────────────────────────────────

function getPrimaryInsurer(coverages: COICoverage[]): string {
  const counts: Record<string, number> = {};
  coverages.forEach(cv => { if (cv.insurer) counts[cv.insurer] = (counts[cv.insurer] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function getCoverageDateRange(coverages: COICoverage[]): string {
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

function shortTitle(coverageType: string): string {
  const words = coverageType.trim().split(/\s+/);
  return words.slice(0, 3).join(' ');
}

function getDraftSubtitle(g: GapAnalysis): string {
  const disc = g.not_met.length;
  const miss = g.uncertain.length;
  if (disc > 0 && miss > 0)
    return `We found ${disc} discrepanc${disc === 1 ? 'y' : 'ies'} and ${miss} missing detail${miss === 1 ? '' : 's'}`;
  if (disc > 0) return `We found ${disc} discrepanc${disc === 1 ? 'y' : 'ies'}`;
  if (miss > 0) return `We found ${miss} missing detail${miss === 1 ? '' : 's'}`;
  return 'This COI aligns with your requirements!';
}

function buildInsuranceOptions(coi: COIExtracted): InsuranceOption[] {
  const state = coi.named_insured_state?.toUpperCase().trim() || 'TX';
  const [city1, city2] = CITY_PAIRS[state] ?? ['Houston', 'Dallas'];
  const base = getPrimaryInsurer(coi.coverages) || 'Insurance Company';
  const e = CONTACT_EMAIL;
  const p = CONTACT_PHONE;
  return [
    { name: base,                       address: `1847 Commerce Blvd, ${city1}, ${state}`,       email: e, phone: p },
    { name: `${base} Claims`,           address: `2291 Industrial Pkwy, ${city2}, ${state}`,     email: e, phone: p },
    { name: `${base} Agency`,           address: `503 Enterprise Dr, ${city1}, ${state}`,        email: e, phone: p },
    { name: `${base} Underwriting`,     address: `1120 Business Park Blvd, ${city2}, ${state}`, email: e, phone: p },
    { name: `${base} Regional Office`,  address: `7845 Commerce Way, ${city1}, ${state}`,        email: e, phone: p },
  ];
}

// ─── Sand Timer ────────────────────────────────────────────────────────────────
function SandTimer() {
  const color = C.circle;
  return (
    <svg viewBox="0 0 44 66" width="76" height="114" style={{ overflow: 'visible', display: 'block' }}>
      <style>{`
        @keyframes fdr-sand-t {
          0%,5%    { }
          42%,58%  { }
          95%,100% { }
        }
      `}</style>

      {/* Top sand — shrinks from full triangle to sliver */}
      <polygon fill={color} opacity="0.62">
        <animate
          attributeName="points"
          values="4,4 40,4 22,31 22,31; 21,30 23,30 22,31 22,31; 21,30 23,30 22,31 22,31; 4,4 40,4 22,31 22,31"
          keyTimes="0; 0.42; 0.58; 1"
          dur="5s" repeatCount="indefinite"
          calcMode="spline"
          keySplines="0.42 0 0.58 1; 0 0 1 1; 0.42 0 0.58 1"
        />
      </polygon>

      {/* Bottom sand — grows from sliver to full triangle */}
      <polygon fill={color} opacity="0.62">
        <animate
          attributeName="points"
          values="22,35 22,35 22,35; 4,62 40,62 22,35; 4,62 40,62 22,35; 22,35 22,35 22,35"
          keyTimes="0; 0.42; 0.58; 1"
          dur="5s" repeatCount="indefinite"
          calcMode="spline"
          keySplines="0.42 0 0.58 1; 0 0 1 1; 0.42 0 0.58 1"
        />
      </polygon>

      {/* Falling grain */}
      <circle cx="22" r="2" fill={color} opacity="0.85">
        <animate attributeName="cy"
          values="29;37;29" dur="0.7s" repeatCount="indefinite" />
        <animate attributeName="opacity"
          values="0.85;0.85;0;0;0.85"
          keyTimes="0;0.38;0.44;0.56;0.62"
          dur="5s" repeatCount="indefinite" />
      </circle>

      {/* Glass outline (rendered on top of sand) */}
      <polygon
        points="2,2 42,2 22,31 42,64 2,64 22,35"
        fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round"
      />
      <line x1="2" y1="2"  x2="42" y2="2"  stroke={color} strokeWidth="4" strokeLinecap="round" />
      <line x1="2" y1="64" x2="42" y2="64" stroke={color} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

// ─── DropZone ─────────────────────────────────────────────────────────────────
function DropZone({ boxTitle, hint, file, accept, onChange }: {
  boxTitle: string; hint: string; file: File | null; accept: string; onChange: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div>
      <span style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase' as const, color: C.txt3,
        marginBottom: 8, display: 'block', fontFamily: C.sans,
      }}>
        {boxTitle}
      </span>

      {file ? (
        <div style={{
          border: `1.5px solid ${C.success}`, borderRadius: 12,
          padding: '20px 24px',
          background: `color-mix(in oklch, ${C.success} 6%, ${C.surface})`,
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
            border: `1.5px dashed ${over ? C.circle : C.border}`,
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

// ─── RequirementTag ────────────────────────────────────────────────────────────
function RequirementTag({ status }: { status: 'met' | 'not_met' | 'uncertain' }) {
  const config = {
    met:       { label: 'Satisfied',   color: C.success },
    not_met:   { label: 'Discrepancy', color: C.error   },
    uncertain: { label: 'Missing',     color: C.circle  },
  };
  const { label, color } = config[status];
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999,
      background: `color-mix(in oklch, ${color} 14%, transparent)`,
      color, whiteSpace: 'nowrap' as const, fontFamily: C.sans, flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

// ─── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
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

// ─── Card ──────────────────────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
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
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase' as const, color: C.txt3,
      display: 'block', marginBottom: 10, fontFamily: C.sans,
    }}>
      {children}
    </span>
  );
}

// ─── Primary button ────────────────────────────────────────────────────────────
function PrimaryBtn({ children, onClick, disabled, style }: {
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
        background: disabled ? C.border : hov ? C.circle : C.txt,
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

// ─── Secondary button ──────────────────────────────────────────────────────────
function SecondaryBtn({ children, onClick, style }: {
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

// ─── COI Details section ───────────────────────────────────────────────────────
function COIDetailsSection({ coi }: { coi: COIExtracted }) {
  const insurer      = getPrimaryInsurer(coi.coverages);
  const dateRange    = getCoverageDateRange(coi.coverages);
  const extraTerms   = getExtraCoverageTerms(coi.coverages);

  return (
    <Card>
      <FieldLabel>Carrier name</FieldLabel>
      <p style={{ fontFamily: C.serif, fontSize: 22, color: C.txt, marginBottom: 20 }}>
        {coi.named_insured || '—'}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div>
          <FieldLabel>Insurance company</FieldLabel>
          <p style={{ fontSize: 14, color: C.txt, fontFamily: C.sans }}>{insurer || '—'}</p>
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

// ─── Requirement check section ─────────────────────────────────────────────────
function RequirementCheckSection({ items }: { items: GapItem[] }) {
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
              {item.requirement.minimum_limit
                ? `Requires ${item.requirement.minimum_limit} in ${item.requirement.coverage_type} coverage. `
                : `${item.requirement.coverage_type} coverage is required. `}
              {item.evidence}
            </p>
          </div>
          <RequirementTag status={item.status} />
        </div>
      ))}
    </Card>
  );
}

// ─── Questions section ─────────────────────────────────────────────────────────
function QuestionsSection({ questions, onContact }: { questions: string[]; onContact: () => void }) {
  if (!questions.length) return null;
  return (
    <>
      <SectionLabel>Questions for Insurance Company</SectionLabel>
      <Card>
        <p style={{ fontSize: 13, color: C.txt2, marginBottom: 20, lineHeight: 1.65, fontFamily: C.sans }}>
          The following items need to be confirmed with an agent.
        </p>
        <ol style={{ paddingLeft: 18, margin: '0 0 24px', display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          {questions.map((q, i) => (
            <li key={i} style={{ fontSize: 14, color: C.txt, lineHeight: 1.6, fontFamily: C.sans }}>{q}</li>
          ))}
        </ol>
        <PrimaryBtn onClick={onContact}>Use AI to Contact Insurer</PrimaryBtn>
      </Card>
    </>
  );
}

// ─── Summary stat cards ────────────────────────────────────────────────────────
function SummaryStats({ total, discrepancies, missing }: {
  total: number; discrepancies: number; missing: number;
}) {
  const stats = [
    { n: total,         label: 'Requirements', color: C.txt    },
    { n: discrepancies, label: 'Discrepancies', color: C.error  },
    { n: missing,       label: 'Missing',       color: C.circle },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 32 }}>
      {stats.map(s => (
        <div key={s.label} style={{
          padding: '20px 16px', textAlign: 'center' as const,
          background: `color-mix(in oklch, ${s.color} 9%, ${C.surface})`,
          border: `1px solid color-mix(in oklch, ${s.color} 25%, transparent)`,
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

// ─── Report content (shared between Draft and Final) ───────────────────────────
function ReportContent({
  result,
  reportItems,
  isFinal,
  onContact,
}: {
  result: VerifyResult;
  reportItems: GapItem[];
  isFinal: boolean;
  onContact?: () => void;
}) {
  const { requirements: reqs, coi_extracted: coi, agent_questions: qs } = result;
  const disc = reportItems.filter(i => i.status === 'not_met').length;
  const miss = reportItems.filter(i => i.status === 'uncertain').length;

  const subtitle = isFinal
    ? (() => {
        if (disc > 0 && miss > 0) return `${disc} discrepanc${disc === 1 ? 'y' : 'ies'} and ${miss} unresolved item${miss === 1 ? '' : 's'} remain`;
        if (disc > 0) return `${disc} discrepanc${disc === 1 ? 'y' : 'ies'} confirmed`;
        if (miss > 0) return `${miss} item${miss === 1 ? '' : 's'} could not be confirmed`;
        return 'All requirements satisfied';
      })()
    : getDraftSubtitle({ met: reportItems.filter(i => i.status === 'met'), not_met: reportItems.filter(i => i.status === 'not_met'), uncertain: reportItems.filter(i => i.status === 'uncertain') });

  return (
    <div>
      <h1 style={{
        fontFamily: C.serif, fontSize: 38, fontWeight: 400,
        letterSpacing: '-0.02em', color: C.txt, marginBottom: 6,
      }}>
        {isFinal ? 'Final Report' : 'Preliminary Report'}
      </h1>
      <p style={{ fontSize: 15, color: C.txt2, fontFamily: C.sans, marginBottom: 32 }}>
        {subtitle}
      </p>

      <SummaryStats total={reqs.length} discrepancies={disc} missing={miss} />

      <SectionLabel>Carrier COI Details</SectionLabel>
      <COIDetailsSection coi={coi} />

      <SectionLabel>Requirement Check</SectionLabel>
      <RequirementCheckSection items={reportItems} />

      {!isFinal && onContact && qs.length > 0 && (
        <QuestionsSection questions={qs} onContact={onContact} />
      )}
    </div>
  );
}

// ─── Carrier option card ───────────────────────────────────────────────────────
function CarrierCard({
  option, selected, onSelect,
}: {
  option: InsuranceOption; selected: boolean; onSelect: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div style={{
      border: `1.5px solid ${selected ? C.circle : hov ? C.borderStrong : C.border}`,
      borderRadius: 10, padding: '20px 22px',
      background: selected ? 'oklch(52% 0.17 38 / 0.06)' : hov ? C.surfaceHover : C.surface,
      transition: 'all 110ms cubic-bezier(0.16, 1, 0.3, 1)',
      flex: '1 1 0', minWidth: 0,
    }}
    onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <p style={{ fontSize: 14, fontWeight: 700, color: selected ? C.circle : C.txt, fontFamily: C.sans, marginBottom: 4 }}>
        {option.name}
      </p>
      <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, marginBottom: 4 }}>{option.address}</p>
      <p style={{ fontSize: 12, fontFamily: C.sans, marginBottom: 2 }}>
        <span style={{ color: C.txt3, textDecoration: 'underline', cursor: 'text' }}>{option.email}</span>
      </p>
      <p style={{ fontSize: 12, fontFamily: C.sans, marginBottom: 14 }}>
        <span style={{ color: C.txt3, textDecoration: 'underline', cursor: 'text' }}>{option.phone}</span>
      </p>
      <button
        onClick={onSelect}
        style={{
          fontSize: 11, fontWeight: 600, fontFamily: C.sans, letterSpacing: '0.01em',
          padding: '5px 14px', borderRadius: 4, cursor: 'pointer',
          border: `1px solid ${selected ? C.circle : C.border}`,
          background: selected ? 'oklch(52% 0.17 38 / 0.12)' : 'transparent',
          color: selected ? C.circle : C.txt2,
          transition: 'all 110ms',
        }}
      >
        {selected ? 'Selected' : 'Select'}
      </button>
    </div>
  );
}

// ─── Call progress section ─────────────────────────────────────────────────────
function CallProgressSection({
  callPhase, callId, transcript, callAnswers, questions,
  onTryAnother, onGenerateReport, generatingReport,
}: {
  callPhase: CallPhase;
  callId: string | null;
  transcript: string | null;
  callAnswers: Record<string, string> | null;
  questions: string[];
  onTryAnother: () => void;
  onGenerateReport: () => void;
  generatingReport: boolean;
}) {
  const dots = useAnimatedDots(callPhase === 'calling' || callPhase === 'connected');

  return (
    <div>
      <p style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase' as const, color: C.txt3,
        marginBottom: 20, fontFamily: C.sans,
      }}>
        Call Progress
      </p>

      {/* Status row */}
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12, marginBottom: 24 }}>
        <CallStatusRow
          label={`Calling ${CONTACT_PHONE}`}
          done={callPhase !== 'idle'}
          active={callPhase === 'calling'}
          icon="📞"
        />
        <CallStatusRow
          label="Connected"
          done={['connected', 'ended', 'loading', 'complete'].includes(callPhase)}
          active={callPhase === 'connected'}
          icon="🔗"
        />
        <CallStatusRow
          label="Call ended"
          done={['ended', 'loading', 'complete'].includes(callPhase)}
          active={callPhase === 'ended'}
          icon="✓"
        />
        <CallStatusRow
          label={callPhase === 'loading' ? `Loading transcript${dots}` : 'Transcript ready'}
          done={callPhase === 'complete'}
          active={callPhase === 'loading'}
          icon="📄"
        />
      </div>

      {/* Transcript + answers */}
      {callPhase === 'complete' && transcript && (
        <>
          {callAnswers && Object.keys(callAnswers).length > 0 && (
            <Card style={{ marginBottom: 16, borderColor: `color-mix(in oklch, ${C.success} 30%, ${C.border})` }}>
              <FieldLabel>Answers from agent</FieldLabel>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
                {questions.map((q, i) => (
                  <div key={i}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: C.txt, fontFamily: C.sans, marginBottom: 3 }}>
                      {i + 1}. {q}
                    </p>
                    <p style={{ fontSize: 13, color: C.txt2, fontFamily: C.sans, lineHeight: 1.55 }}>
                      {callAnswers[q] || 'Not addressed in call.'}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <FieldLabel>Call transcript</FieldLabel>
            <pre style={{
              fontSize: 12, color: C.txt2, fontFamily: C.sans,
              whiteSpace: 'pre-wrap' as const, lineHeight: 1.7, margin: 0,
            }}>
              {transcript}
            </pre>
          </Card>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
            <PrimaryBtn onClick={onGenerateReport} disabled={generatingReport}>
              {generatingReport ? 'Generating...' : 'Generate full report'}
            </PrimaryBtn>
            <SecondaryBtn onClick={onTryAnother}>Try another Insurance company</SecondaryBtn>
          </div>
        </>
      )}
    </div>
  );
}

function CallStatusRow({ label, done, active, icon }: {
  label: string; done: boolean; active: boolean; icon: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      opacity: done || active ? 1 : 0.35,
      transition: 'opacity 200ms',
    }}>
      <span style={{
        width: 28, height: 28, borderRadius: '50%', display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 13,
        background: done
          ? `color-mix(in oklch, ${C.success} 14%, transparent)`
          : active
            ? `color-mix(in oklch, ${C.circle} 14%, transparent)`
            : C.border,
        border: done
          ? `1px solid color-mix(in oklch, ${C.success} 35%, transparent)`
          : active
            ? `1px solid color-mix(in oklch, ${C.circle} 35%, transparent)`
            : `1px solid ${C.border}`,
        flexShrink: 0,
        transition: 'all 200ms',
      }}>
        {icon}
      </span>
      <span style={{
        fontSize: 13, fontFamily: C.sans,
        color: done ? C.success : active ? C.circle : C.txt3,
        fontWeight: done || active ? 600 : 400,
        transition: 'color 200ms',
      }}>
        {label}
      </span>
      {active && (
        <style>{`@keyframes fdr-spin{to{transform:rotate(360deg)}}`}</style>
      )}
      {active && (
        <span style={{
          width: 14, height: 14, borderRadius: '50%',
          border: `2px solid ${C.circle}`,
          borderTopColor: 'transparent',
          display: 'inline-block',
          animation: 'fdr-spin 0.7s linear infinite',
        }} />
      )}
    </div>
  );
}

function useAnimatedDots(active: boolean) {
  const [dots, setDots] = useState('');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(t);
  }, [active]);
  return dots;
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function AppPage() {
  const [step, setStep]           = useState<Step>('upload');
  const [reqFile, setReqFile]     = useState<File | null>(null);
  const [coiFile, setCoiFile]     = useState<File | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [finalReport, setFinalReport]   = useState<FinalReport | null>(null);
  const [msgIdx, setMsgIdx]       = useState(0);
  const [error, setError]         = useState('');
  const [runHover, setRunHover]   = useState(false);

  // Contact page state
  const [selectedOption, setSelectedOption]   = useState<number | null>(null);
  const [carouselStart, setCarouselStart]     = useState(0);
  const [showCarrierSelect, setShowCarrierSelect] = useState(true);
  const [callPhase, setCallPhase]             = useState<CallPhase>('idle');
  const [callId, setCallId]                   = useState<string | null>(null);
  const [transcript, setTranscript]           = useState<string | null>(null);
  const [callAnswers, setCallAnswers]         = useState<Record<string, string> | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);

  const stepIdx = STEP_KEYS.indexOf(step);

  // ── Verify ──
  async function runVerification() {
    if (!reqFile || !coiFile) { setError('Please upload both files.'); return; }
    setError('');
    setStep('analyze');
    setMsgIdx(0);
    const interval = setInterval(
      () => setMsgIdx(i => Math.min(i + 1, PROCESSING_MSGS.length - 1)),
      4500,
    );
    try {
      const fd = new FormData();
      fd.append('requirements_file', reqFile);
      fd.append('coi_file', coiFile);
      const res  = await fetch('/api/verify', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); setStep('upload'); return; }
      setVerifyResult(data);
      setStep('draft');
    } catch {
      setError('Network error. Please try again.');
      setStep('upload');
    } finally {
      clearInterval(interval);
    }
  }

  // ── Initiate call ──
  async function startCall() {
    if (!verifyResult || selectedOption === null) return;
    setShowCarrierSelect(false);
    setCallPhase('calling');

    try {
      const res  = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone:        DEMO_PHONE,
          agent_name:   buildInsuranceOptions(verifyResult.coi_extracted)[selectedOption].name,
          carrier_name: verifyResult.coi_extracted.named_insured || 'the carrier',
          questions:    verifyResult.agent_questions,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCallPhase('idle'); setShowCarrierSelect(true); setError(data.error ?? 'Call failed.'); return; }
      setCallId(data.call_id);
      // Simulate call progress
      setTimeout(() => setCallPhase('connected'), 3500);
      setTimeout(() => setCallPhase('ended'), 12000);
      setTimeout(() => setCallPhase('loading'), 12500);
    } catch {
      setCallPhase('idle');
      setShowCarrierSelect(true);
      setError('Network error starting call.');
    }
  }

  // Poll for transcript when loading
  useEffect(() => {
    if (callPhase !== 'loading' || !callId) return;
    let done = false;

    async function poll() {
      try {
        const res = await fetch(`/api/call-status?callId=${callId}`);
        const data = await res.json();
        if (data.transcript && !done) {
          done = true;
          setTranscript(data.transcript);
          // Parse transcript for answers
          if (verifyResult?.agent_questions.length) {
            const pRes = await fetch('/api/parse-transcript', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transcript: data.transcript, questions: verifyResult.agent_questions }),
            });
            const pData = await pRes.json();
            setCallAnswers(pData.answers ?? {});
          }
          setCallPhase('complete');
        }
      } catch { /* keep polling */ }
    }

    // Poll every 8s, fallback to mock after 40s
    const interval = setInterval(poll, 8000);
    poll();

    const fallback = setTimeout(() => {
      if (!done) {
        done = true;
        setTranscript('[Transcript not yet available. The call may still be processing. Please check back shortly or generate your report with the current analysis.]');
        setCallAnswers({});
        setCallPhase('complete');
      }
    }, 40000);

    return () => { clearInterval(interval); clearTimeout(fallback); };
  }, [callPhase, callId, verifyResult]);

  // ── Generate final report ──
  async function generateFinalReport() {
    if (!verifyResult) return;
    setGeneratingReport(true);
    try {
      const res = await fetch('/api/final-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gap_analysis: verifyResult.gap_analysis,
          call_answers: callAnswers ?? {},
        }),
      });
      const data = await res.json();
      if (res.ok) setFinalReport(data);
      else {
        // Fallback: use original gap analysis as final report
        const g = verifyResult.gap_analysis;
        setFinalReport({ met: g.met, not_met: g.not_met, uncertain: g.uncertain, narrative_summary: '' });
      }
      setStep('report');
    } catch {
      const g = verifyResult.gap_analysis;
      setFinalReport({ met: g.met, not_met: g.not_met, uncertain: g.uncertain, narrative_summary: '' });
      setStep('report');
    } finally {
      setGeneratingReport(false);
    }
  }

  // Skip contact, go straight to report
  async function generateReportDirect() {
    if (!verifyResult) return;
    setGeneratingReport(true);
    try {
      const res = await fetch('/api/final-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gap_analysis: verifyResult.gap_analysis, call_answers: {} }),
      });
      const data = await res.json();
      if (res.ok) setFinalReport(data);
      else {
        const g = verifyResult.gap_analysis;
        setFinalReport({ met: g.met, not_met: g.not_met, uncertain: g.uncertain, narrative_summary: '' });
      }
      setStep('report');
    } catch {
      if (verifyResult) {
        const g = verifyResult.gap_analysis;
        setFinalReport({ met: g.met, not_met: g.not_met, uncertain: g.uncertain, narrative_summary: '' });
      }
      setStep('report');
    } finally {
      setGeneratingReport(false);
    }
  }

  function reset() {
    setStep('upload');
    setReqFile(null); setCoiFile(null);
    setVerifyResult(null); setFinalReport(null);
    setMsgIdx(0); setError('');
    setSelectedOption(null); setCarouselStart(0);
    setShowCarrierSelect(true);
    setCallPhase('idle'); setCallId(null);
    setTranscript(null); setCallAnswers(null);
    setGeneratingReport(false);
  }

  function tryAnother() {
    setShowCarrierSelect(true);
    setCallPhase('idle');
    setSelectedOption(null);
    setCallId(null);
    setTranscript(null);
    setCallAnswers(null);
  }

  const canRun = !!reqFile && !!coiFile;
  const insuranceOptions = verifyResult ? buildInsuranceOptions(verifyResult.coi_extracted) : [];
  const visibleOptions = insuranceOptions.slice(carouselStart, carouselStart + 2);

  // Flatten gap items for report views
  const draftItems = verifyResult
    ? [...verifyResult.gap_analysis.met, ...verifyResult.gap_analysis.not_met, ...verifyResult.gap_analysis.uncertain]
    : [];
  const finalItems = finalReport
    ? [...finalReport.met, ...finalReport.not_met, ...finalReport.uncertain]
    : draftItems;

  return (
    <div style={{ minHeight: '100vh', background: C.paper, color: C.txt, fontFamily: C.sans }}>
      <style>{`
        @keyframes fdr-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fdr-spin   { to{transform:rotate(360deg)} }
      `}</style>

      {/* ── Nav ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        height: 60, padding: '0 48px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: C.paper, borderBottom: `1px solid ${C.border}`,
      }}>
        <span style={{ fontFamily: C.sans, fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em', color: C.txt }}>
          Fordra
        </span>

        <div style={{ display: 'flex', gap: 4 }}>
          {NAV_LABELS.map((label, i) => {
            const active = i === stepIdx;
            const done   = i < stepIdx;
            return (
              <span
                key={label}
                onClick={() => done ? setStep(STEP_KEYS[i]) : undefined}
                style={{
                  fontSize: 12, fontWeight: 600, fontFamily: C.sans,
                  padding: '5px 14px', borderRadius: 9999,
                  background: active ? C.txt : done ? `color-mix(in oklch, ${C.txt} 10%, transparent)` : 'transparent',
                  color: active ? C.surface : done ? C.txt2 : C.txt3,
                  border: active ? 'none' : `1px solid ${C.border}`,
                  cursor: done ? 'pointer' : 'default',
                  transition: 'all 150ms',
                }}
              >
                {done ? '✓ ' : ''}{label}
              </span>
            );
          })}
        </div>

        <div style={{ width: 120, display: 'flex', justifyContent: 'flex-end' }}>
          {step === 'report' && (
            <SecondaryBtn onClick={reset}>Start over</SecondaryBtn>
          )}
        </div>
      </nav>

      {/* ── Content ── */}
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '100px 24px 80px' }}>

        {/* ── Page 1: Upload ── */}
        {step === 'upload' && (
          <div>
            <h1 style={{
              fontFamily: C.serif, fontSize: 36, fontWeight: 400,
              letterSpacing: '-0.02em', color: C.txt, marginBottom: 32, lineHeight: 1.2,
            }}>
              Upload your requirements<br />and a carrier&apos;s COI
            </h1>

            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 20, marginBottom: 32 }}>
              <DropZone
                boxTitle="Your requirements"
                hint="PDF, JPG, PNG, or TXT — list of required coverages and limits"
                file={reqFile}
                accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
                onChange={setReqFile}
              />
              <DropZone
                boxTitle="Carrier's Certificate of Insurance"
                hint="PDF, JPG, or PNG scan of the COI (ACORD 25)"
                file={coiFile}
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={setCoiFile}
              />
            </div>

            {error && (
              <p style={{ fontSize: 13, color: C.error, marginBottom: 16, fontFamily: C.sans }}>{error}</p>
            )}

            <button
              onClick={runVerification}
              disabled={!canRun}
              onMouseEnter={() => setRunHover(true)}
              onMouseLeave={() => setRunHover(false)}
              style={{
                width: '100%', padding: '15px',
                background: !canRun ? C.border : runHover ? C.circle : C.txt,
                color: !canRun ? C.txt3 : C.surface,
                fontSize: 15, fontWeight: 600, fontFamily: C.sans,
                borderRadius: 6, border: 'none',
                cursor: canRun ? 'pointer' : 'not-allowed',
                transition: 'background 110ms cubic-bezier(0.16, 1, 0.3, 1)',
                opacity: !canRun ? 0.5 : 1,
              }}
            >
              Run verification →
            </button>
          </div>
        )}

        {/* ── Page 2: Analyze ── */}
        {step === 'analyze' && (
          <div style={{ textAlign: 'center' as const, paddingTop: 80 }}>
            <p style={{
              fontFamily: C.serif, fontSize: 48, fontStyle: 'italic',
              fontWeight: 400, color: C.circle, marginBottom: 48, lineHeight: 1,
            }}>
              Verifying&hellip;
            </p>

            <div style={{ display: 'inline-flex', flexDirection: 'column' as const, alignItems: 'center', gap: 12 }}>
              <SandTimer />
              <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, letterSpacing: '0.01em' }}>
                (&lt;1 minute)
              </p>
            </div>

            <p style={{
              fontSize: 15, color: C.txt2, fontFamily: C.sans,
              marginTop: 36, transition: 'opacity 0.3s',
            }}>
              {PROCESSING_MSGS[msgIdx]}
            </p>
          </div>
        )}

        {/* ── Page 3: Draft ── */}
        {step === 'draft' && verifyResult && (
          <div>
            {error && (
              <p style={{ fontSize: 13, color: C.error, marginBottom: 16, fontFamily: C.sans }}>{error}</p>
            )}

            <ReportContent
              result={verifyResult}
              reportItems={draftItems}
              isFinal={false}
              onContact={() => setStep('contact')}
            />

            <div style={{ marginTop: 24 }}>
              <SecondaryBtn
                onClick={generateReportDirect}
                style={{ opacity: generatingReport ? 0.6 : 1 }}
              >
                {generatingReport ? 'Generating...' : 'Skip to full report →'}
              </SecondaryBtn>
            </div>
          </div>
        )}

        {/* ── Page 4: Contact ── */}
        {step === 'contact' && verifyResult && (
          <div>
            <h1 style={{
              fontFamily: C.serif, fontSize: 38, fontWeight: 400,
              letterSpacing: '-0.02em', color: C.txt, marginBottom: 32,
            }}>
              Resolve Questions
            </h1>

            {/* Carrier selection */}
            {showCarrierSelect && (
              <Card>
                <FieldLabel>Confirm insurance company details</FieldLabel>
                <p style={{ fontSize: 13, color: C.txt2, marginBottom: 20, lineHeight: 1.65, fontFamily: C.sans }}>
                  Select which office Fordra should contact to resolve outstanding items.
                </p>

                {/* Carousel */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'stretch' }}>
                  {visibleOptions.map((opt, vi) => {
                    const globalIdx = carouselStart + vi;
                    return (
                      <CarrierCard
                        key={globalIdx}
                        option={opt}
                        selected={selectedOption === globalIdx}
                        onSelect={() => setSelectedOption(globalIdx)}
                      />
                    );
                  })}
                </div>

                {/* Carousel navigation */}
                {insuranceOptions.length > 2 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
                    <button
                      onClick={() => setCarouselStart(s => Math.max(0, s - 1))}
                      disabled={carouselStart === 0}
                      style={{
                        width: 32, height: 32, borderRadius: 6,
                        border: `1px solid ${C.border}`, background: 'transparent',
                        color: carouselStart === 0 ? C.txt3 : C.txt2,
                        cursor: carouselStart === 0 ? 'not-allowed' : 'pointer',
                        fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      ‹
                    </button>
                    <button
                      onClick={() => setCarouselStart(s => Math.min(insuranceOptions.length - 2, s + 1))}
                      disabled={carouselStart >= insuranceOptions.length - 2}
                      style={{
                        width: 32, height: 32, borderRadius: 6,
                        border: `1px solid ${C.border}`, background: 'transparent',
                        color: carouselStart >= insuranceOptions.length - 2 ? C.txt3 : C.txt2,
                        cursor: carouselStart >= insuranceOptions.length - 2 ? 'not-allowed' : 'pointer',
                        fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      ›
                    </button>
                    <span style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, alignSelf: 'center', paddingLeft: 4 }}>
                      {carouselStart + 1}–{Math.min(carouselStart + 2, insuranceOptions.length)} of {insuranceOptions.length}
                    </span>
                  </div>
                )}

                <PrimaryBtn
                  onClick={startCall}
                  disabled={selectedOption === null}
                >
                  Start AI Call
                </PrimaryBtn>

                {error && (
                  <p style={{ fontSize: 12, color: C.error, marginTop: 10, fontFamily: C.sans }}>{error}</p>
                )}
              </Card>
            )}

            {/* Call progress */}
            {callPhase !== 'idle' && (
              <Card style={{ marginTop: showCarrierSelect ? 0 : 0 }}>
                <CallProgressSection
                  callPhase={callPhase}
                  callId={callId}
                  transcript={transcript}
                  callAnswers={callAnswers}
                  questions={verifyResult.agent_questions}
                  onTryAnother={tryAnother}
                  onGenerateReport={generateFinalReport}
                  generatingReport={generatingReport}
                />
              </Card>
            )}
          </div>
        )}

        {/* ── Page 5: Report ── */}
        {step === 'report' && verifyResult && finalReport && (
          <div>
            <ReportContent
              result={verifyResult}
              reportItems={finalItems}
              isFinal={true}
            />

            {finalReport.narrative_summary && (
              <Card style={{ marginTop: 8 }}>
                <FieldLabel>Summary</FieldLabel>
                <p style={{ fontSize: 14, color: C.txt2, lineHeight: 1.7, fontFamily: C.sans }}>
                  {finalReport.narrative_summary}
                </p>
              </Card>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
