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
interface Discrepancy {
  kind: 'carrier_name_mismatch';
  user_value: string;
  ocr_value: string;
}

interface VerifyResult {
  requirements: Requirement[];
  coi_extracted: COIExtracted;
  gap_analysis: GapAnalysis;
  discrepancies: Discrepancy[];
  agent_questions: string[];
}

type Step = 'upload' | 'analyze' | 'draft' | 'contact' | 'finalize' | 'report';
type CallPhase = 'idle' | 'calling' | 'connected' | 'ended' | 'loading' | 'complete';

interface InsuranceOption {
  name: string;
  address: string;
  email: string;
  phone: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const NAV_LABELS = ['Upload', 'Analyze', 'Draft', 'Contact', 'Update', 'Report'];
const STEP_KEYS: Step[] = ['upload', 'analyze', 'draft', 'contact', 'finalize', 'report'];

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

function TranscriptView({ raw }: { raw: string }) {
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
        return <div key={i}>{line || '\u00A0'}</div>;
      })}
    </div>
  );
}

function shortTitle(coverageType: string): string {
  return coverageType.split(/\s*\/\s*/)[0].trim().replace(/[,;:&|]+$/, '').trim();
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
  const base = coi.producer || coi.insurance_company || getPrimaryInsurer(coi.coverages) || 'Insurance Company';
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

// ─── Scanning Doc ──────────────────────────────────────────────────────────────
function ScanningDoc() {
  const color = C.circle;
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

// ─── DropZone ─────────────────────────────────────────────────────────────────
function DropZone({ boxTitle, hint, file, accept, onChange }: {
  boxTitle: string; hint: string; file: File | null; accept: string; onChange: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div>
      {boxTitle && (
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase' as const, color: C.txt3,
          marginBottom: 8, display: 'block', fontFamily: C.sans,
        }}>
          {boxTitle}
        </span>
      )}

      {file ? (
        <div style={{
          border: `1.5px solid ${C.success}`, borderRadius: 12,
          padding: '20px 24px',
          background: C.surfaceHover,
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

// ─── Currency helpers (manual requirements) ──────────────────────────────────
function formatCurrencyInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return `$${Number(trimmed).toLocaleString('en-US')}`;
}
function parseCurrencyAmount(formatted: string): number | null {
  const digits = formatted.replace(/\D/g, '');
  if (!digits) return null;
  return Number(digits);
}

// ─── ManualRequirementsForm ───────────────────────────────────────────────────
function ManualRequirementsForm({ rows, onChange, notes, onNotesChange }: {
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

// ─── Requirement check section ─────────────────────────────────────────────────
function RequirementCheckSection({ items }: { items: GapItem[] }) {
  const allItems = items;
  return (
    <Card>
      <FieldLabel>Requirement Check</FieldLabel>
      {allItems.map((item, i) => (
        <div key={i} style={{
          padding: '16px 0',
          borderBottom: i < allItems.length - 1 ? `1px solid ${C.border}` : 'none',
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
        <ol style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          {questions.map((q, i) => (
            <li key={i} style={{ fontSize: 14, color: C.txt, lineHeight: 1.6, fontFamily: C.sans }}>{q}</li>
          ))}
        </ol>
      </Card>
    </>
  );
}

// ─── Summary stat cards ────────────────────────────────────────────────────────
function SummaryStats({ total, discrepancies, missing }: {
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
  const miss = statColors(missing, C.circle);
  const stats = [
    { n: total,         label: 'Requirements', ...req  },
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

// ─── Report content (shared between Draft and Final) ───────────────────────────
function ReportContent({
  result,
  items,
  isFinal,
  onContact,
  narrativeSummary,
  callAnswers,
  transcript,
}: {
  result: VerifyResult;
  items: GapItem[];
  isFinal: boolean;
  onContact?: () => void;
  narrativeSummary?: string;
  callAnswers?: Record<string, string> | null;
  transcript?: string | null;
}) {
  const { coi_extracted: coi, agent_questions: qs } = result;
  const disc = items.filter(i => i.status === 'not_met').length;
  const miss = items.filter(i => i.status === 'uncertain').length;

  const subtitle = isFinal
    ? (() => {
        if (disc > 0 && miss > 0) return `${disc} discrepanc${disc === 1 ? 'y' : 'ies'} and ${miss} unresolved item${miss === 1 ? '' : 's'} remain`;
        if (disc > 0) return `${disc} discrepanc${disc === 1 ? 'y' : 'ies'} confirmed`;
        if (miss > 0) return `${miss} item${miss === 1 ? '' : 's'} could not be confirmed`;
        return 'All requirements satisfied';
      })()
    : getDraftSubtitle({ met: items.filter(i => i.status === 'met'), not_met: items.filter(i => i.status === 'not_met'), uncertain: items.filter(i => i.status === 'uncertain') });

  return (
    <div>
      {/* Header row — title left, export right (final only) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{
          fontFamily: C.serif, fontSize: 38, fontWeight: 400,
          letterSpacing: '-0.02em', color: C.txt,
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
      border: `1.5px solid ${selected ? C.success : hov ? C.borderStrong : C.border}`,
      borderRadius: 10, padding: '20px 22px',
      background: selected ? C.surfaceHover : hov ? C.surfaceHover : C.surface,
      transition: 'all 110ms cubic-bezier(0.16, 1, 0.3, 1)',
      flex: '1 1 0', minWidth: 0, cursor: 'pointer',
    }}
    onClick={onSelect}
    onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <p style={{ fontSize: 14, fontWeight: 700, color: selected ? C.success : C.txt, fontFamily: C.sans, marginBottom: 4 }}>
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
        onClick={e => { e.stopPropagation(); onSelect(); }}
        style={{
          fontSize: 11, fontWeight: 600, fontFamily: C.sans, letterSpacing: '0.01em',
          padding: '5px 14px', borderRadius: 4, cursor: 'pointer',
          border: `1px solid ${selected ? C.success : C.border}`,
          background: selected ? `color-mix(in oklch, ${C.success} 15%, ${C.surface})` : 'transparent',
          color: selected ? C.success : C.txt2,
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
  callPhase, callId, transcript, callAnswers, questions, phone,
  onTryAnother, onGenerateReport, generatingReport,
}: {
  callPhase: CallPhase;
  callId: string | null;
  transcript: string | null;
  callAnswers: Record<string, string> | null;
  questions: string[];
  phone: string;
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
          label={`Calling ${phone}`}
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
              <FieldLabel>Q&amp;A Summary</FieldLabel>
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
            <TranscriptView raw={transcript} />
          </Card>

          <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', marginTop: 8 }}>
            <PrimaryBtn onClick={onGenerateReport} disabled={generatingReport}>
              {generatingReport ? 'Generating...' : 'Generate Final Report'}
            </PrimaryBtn>
            <SecondaryBtn
              onClick={onTryAnother}
              style={{ padding: '13px 28px', fontSize: 14 }}
            >
              Try Another Call
            </SecondaryBtn>
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Single source of truth for discrepancies between user-typed inputs and COI OCR.
// Add new kinds here, then teach questionsFromDiscrepancies and the report row
// to render them. Order of agent_questions is defined in enrichVerifyResult.
type DiscrepancyInputs = { verifierCompany: string; carrierCompany: string };

function detectDiscrepancies(coi: COIExtracted, inputs: DiscrepancyInputs): Discrepancy[] {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const out: Discrepancy[] = [];

  const userCarrier = inputs.carrierCompany.trim();
  const ocrCarrier = (coi.named_insured ?? '').trim();
  if (userCarrier && ocrCarrier && normalize(userCarrier) !== normalize(ocrCarrier)) {
    out.push({ kind: 'carrier_name_mismatch', user_value: userCarrier, ocr_value: ocrCarrier });
  }

  return out;
}

function questionsFromDiscrepancies(discrepancies: Discrepancy[]): string[] {
  return discrepancies.map(d => {
    switch (d.kind) {
      case 'carrier_name_mismatch':
        return `Does this policy also cover a business called ${d.user_value}?`;
    }
  });
}

// Takes the raw /api/verify response and merges discrepancy data into it.
// Discrepancy questions come first, then gap-analysis questions.
function enrichVerifyResult(
  raw: Omit<VerifyResult, 'discrepancies'>,
  inputs: DiscrepancyInputs,
): VerifyResult {
  const discrepancies = detectDiscrepancies(raw.coi_extracted, inputs);
  return {
    ...raw,
    discrepancies,
    agent_questions: [...questionsFromDiscrepancies(discrepancies), ...raw.agent_questions],
  };
}

// Classify a free-text agent answer about name coverage into a check status.
// Prototype heuristic — replace with a Claude call when a real backend exists.
function classifyNameAnswer(answer: string): 'met' | 'not_met' | 'uncertain' {
  const a = answer.toLowerCase().trim();
  // Sentence-leading affirmation/negation wins over signals later in the answer.
  if (/^(yes|yeah|yep|correct|that'?s\s+right)\b/.test(a)) return 'met';
  if (/^(no|nope|negative)\b/.test(a)) return 'not_met';
  // Otherwise look for explicit coverage phrasing.
  if (/\b(not\s+covered|not\s+included|does\s+not\s+cover|doesn'?t\s+cover|excluded|is\s+not\s+covered|only\s+covers?)\b/.test(a)) return 'not_met';
  if (/\b(also\s+covers?|extends?\s+to|both\s+(names?|entities|businesses)|covers?\s+both)\b/.test(a)) return 'met';
  return 'uncertain';
}

// Build the synthetic "Matching Policyholder Name" check used in the requirement
// check list. Returns undefined only when comparison isn't possible (one of
// the two names is missing). Status flows through: COI mismatch → not_met,
// then a confirming/denying agent answer can flip to met/uncertain.
function buildNameCheckItem(
  carrierCompany: string,
  coi: COIExtracted,
  discrepancies: Discrepancy[],
  callAnswers: Record<string, string> | null | undefined,
): GapItem | undefined {
  const userCarrier = carrierCompany.trim();
  const ocrCarrier = (coi.named_insured ?? '').trim();
  if (!userCarrier || !ocrCarrier) return undefined;

  const mismatch = discrepancies.find(d => d.kind === 'carrier_name_mismatch');
  const requirement = { coverage_type: 'Matching Policyholder Name', minimum_limit: '', notes: null };

  if (!mismatch) {
    return { requirement, status: 'met', evidence: 'Carrier name matches the named insured on the COI.' };
  }

  const question = questionsFromDiscrepancies([mismatch])[0];
  const answer = callAnswers?.[question]?.trim();
  if (answer) {
    const resolution = classifyNameAnswer(answer);
    if (resolution === 'met') return {
      requirement, status: 'met',
      evidence: `Agent confirmed the policy also covers "${userCarrier}". COI lists "${ocrCarrier}".`,
    };
    if (resolution === 'uncertain') return {
      requirement, status: 'uncertain',
      evidence: `Agent's answer about coverage for "${userCarrier}" was ambiguous. COI lists "${ocrCarrier}".`,
    };
    return {
      requirement, status: 'not_met',
      evidence: `Agent confirmed the policy does not cover "${userCarrier}". COI lists "${ocrCarrier}".`,
    };
  }

  return {
    requirement, status: 'not_met',
    evidence: `You entered "${userCarrier}" but the COI lists "${ocrCarrier}" as the policyholder.`,
  };
}

function buildPolicyContext(coi: COIExtracted): string {
  const lines: string[] = [];
  if (coi.named_insured)     lines.push(`Policyholder: ${coi.named_insured}`);
  if (coi.insurance_company) lines.push(`Insurance company: ${coi.insurance_company}`);
  if (coi.insurance_company_address) lines.push(`Insurer address: ${coi.insurance_company_address}`);
  if (coi.insurance_company_phone)   lines.push(`Insurer phone: ${coi.insurance_company_phone}`);
  if (coi.insurance_company_email)   lines.push(`Insurer email: ${coi.insurance_company_email}`);
  if (coi.certificate_holder) lines.push(`Certificate holder: ${coi.certificate_holder}`);
  if (coi.additional_insured) lines.push(`Additional insured: ${coi.additional_insured}`);
  coi.coverages.forEach(cv => {
    const parts = [cv.type];
    if (cv.policy_number) parts.push(`policy #${cv.policy_number}`);
    if (cv.insurer) parts.push(`insured by ${cv.insurer}`);
    if (cv.effective_date && cv.expiration_date) parts.push(`${cv.effective_date}–${cv.expiration_date}`);
    if (cv.each_occurrence_limit) parts.push(`occ: ${cv.each_occurrence_limit}`);
    if (cv.aggregate_limit) parts.push(`agg: ${cv.aggregate_limit}`);
    if (cv.conditions_and_exceptions) parts.push(`conditions: ${cv.conditions_and_exceptions}`);
    lines.push(parts.join(', '));
  });
  return lines.join('\n');
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function AppClient() {
  const [step, setStep]           = useState<Step>('upload');
  const [reqFile, setReqFile]     = useState<File | null>(null);
  const [coiFile, setCoiFile]     = useState<File | null>(null);
  const [rcsFile, setRcsFile]     = useState<File | null>(null);
  const [reqMode, setReqMode]     = useState<'upload' | 'manual'>('upload');
  const [manualReqs, setManualReqs] = useState<Requirement[]>([
    { coverage_type: '', minimum_limit: '', notes: '' },
  ]);
  const [manualNotes, setManualNotes] = useState('');
  const [verifierCompany, setVerifierCompany] = useState('');
  const [carrierCompany, setCarrierCompany]   = useState('');
  const [verifyResult, setVerifyResult]           = useState<VerifyResult | null>(null);
  const [finalReport, setFinalReport]             = useState<FinalReport | null>(null);
  const [msgIdx, setMsgIdx]       = useState(0);
  const [error, setError]         = useState('');
  const [runHover, setRunHover]   = useState(false);

  // Contact page state
  const [selectedOption, setSelectedOption]   = useState<number | null>(null);
  const [carouselStart, setCarouselStart]     = useState(0);
  const [editableQuestions, setEditableQuestions] = useState<string[]>([]);
  const [callPhone, setCallPhone]               = useState(CONTACT_PHONE);
  const [callPhase, setCallPhase]             = useState<CallPhase>('idle');
  const [callId, setCallId]                   = useState<string | null>(null);
  const [transcript, setTranscript]           = useState<string | null>(null);
  const [callAnswers, setCallAnswers]         = useState<Record<string, string> | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);

  const stepIdx = STEP_KEYS.indexOf(step);

  // Sync editable questions when verification result arrives.
  useEffect(() => {
    if (verifyResult) setEditableQuestions(verifyResult.agent_questions);
  }, [verifyResult]);

  // ── Verify ──
  async function runVerification() {
    if (!coiFile) { setError('Please upload the COI.'); return; }
    if (!rcsFile) { setError('Please upload the rate confirmation sheet.'); return; }
    if (reqMode === 'upload' && !reqFile) { setError('Please upload a requirements file.'); return; }
    const cleanReqs = manualReqs
      .map(r => ({
        coverage_type: r.coverage_type.trim(),
        minimum_limit_amount: parseCurrencyAmount(r.minimum_limit),
        notes: (r.notes ?? '').trim(),
      }))
      .filter(r => r.coverage_type && r.minimum_limit_amount !== null && r.minimum_limit_amount > 0);
    const trimmedNotes = manualNotes.trim();
    if (reqMode === 'manual' && cleanReqs.length === 0) {
      setError('Please add at least one coverage with both a type and a minimum limit.');
      return;
    }
    setError('');
    setStep('analyze');
    setMsgIdx(0);
    const interval = setInterval(
      () => setMsgIdx(i => Math.min(i + 1, PROCESSING_MSGS.length - 1)),
      4500,
    );
    try {
      const fd = new FormData();
      fd.append('coi_file', coiFile);
      if (reqMode === 'upload') {
        fd.append('requirements_file', reqFile!);
      } else {
        fd.append('requirements_json', JSON.stringify({
          requirements: cleanReqs.map(r => ({
            coverage_type: r.coverage_type,
            minimum_limit: r.minimum_limit_amount,
            notes: r.notes || null,
          })),
          additional_notes: trimmedNotes || null,
        }));
      }
      const res = await fetch('/api/verify', { method: 'POST', body: fd });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error ?? `Server error ${res.status}. Please try again.`);
        setStep('upload');
        return;
      }
      const data = await res.json();
      const enriched = enrichVerifyResult(data, { verifierCompany, carrierCompany });
      setVerifyResult(enriched);
      setStep('draft');
    } catch (err) {
      console.error('[runVerification]', err);
      setError(err instanceof Error ? err.message : 'Unexpected error. Check the browser console.');
      setStep('upload');
    } finally {
      clearInterval(interval);
    }
  }

  // ── Initiate call ──
  async function startCall() {
    if (!verifyResult || selectedOption === null) return;
    setCallPhase('calling');

    try {
      const coi = verifyResult.coi_extracted;
      const res  = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone:             callPhone.replace(/\D/g, ''),
          verifier_company:  verifierCompany.trim(),
          carrier_company:   coi.named_insured?.trim() || carrierCompany.trim(),
          insurance_company: coi.producer || coi.insurance_company || getPrimaryInsurer(coi.coverages),
          policy_holder:     coi.named_insured,
          questions:         editableQuestions.filter(q => q.trim()),
          policy_context:    buildPolicyContext(coi),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCallPhase('idle'); setError(data.error ?? 'Call failed.'); return; }
      setCallId(data.call_id);
      // Simulate visual progress
      setTimeout(() => setCallPhase('connected'), 3500);
      setTimeout(() => setCallPhase('ended'), 12000);
      setTimeout(() => setCallPhase('loading'), 12500);
    } catch {
      setCallPhase('idle');
      setError('Network error starting call.');
    }
  }

  // Poll for transcript as soon as call is initiated
  useEffect(() => {
    if (!callId || callPhase === 'idle' || callPhase === 'complete') return;
    let done = false;

    async function poll() {
      try {
        const res = await fetch(`/api/call-status?callId=${callId}`);
        const data = await res.json();
        if (data.transcript && !done) {
          done = true;
          setTranscript(data.transcript);
          if (editableQuestions.length) {
            const pRes = await fetch('/api/parse-transcript', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transcript: data.transcript, questions: editableQuestions }),
            });
            const pData = await pRes.json();
            setCallAnswers(pData.answers ?? {});
          }
          setCallPhase('complete');
        }
      } catch { /* keep polling */ }
    }

    // Poll every 8s; fallback after 3 minutes
    const interval = setInterval(poll, 8000);
    poll();

    const fallback = setTimeout(() => {
      if (!done) {
        done = true;
        setTranscript('[Transcript not yet available. The call may still be processing — try generating your report with the current analysis.]');
        setCallAnswers({});
        setCallPhase('complete');
      }
    }, 180000);

    return () => { clearInterval(interval); clearTimeout(fallback); };
  }, [callId, callPhase, editableQuestions]);

  // ── Generate final report ──
  async function generateFinalReport() {
    if (!verifyResult) return;
    setStep('finalize');
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
    setReqFile(null); setCoiFile(null); setRcsFile(null);
    setReqMode('upload');
    setManualReqs([{ coverage_type: '', minimum_limit: '', notes: '' }]);
    setManualNotes('');
    setVerifyResult(null); setFinalReport(null);
    setVerifierCompany(''); setCarrierCompany('');
    setMsgIdx(0); setError('');
    setSelectedOption(null); setCarouselStart(0);
    setEditableQuestions([]); setCallPhone(CONTACT_PHONE);
    setCallPhase('idle'); setCallId(null);
    setTranscript(null); setCallAnswers(null);
    setGeneratingReport(false);
  }

  function tryAnother() {
    setCallPhase('idle');
    setSelectedOption(null);
    setCallId(null);
    setTranscript(null);
    setCallAnswers(null);
  }

  const hasValidManualRow = manualReqs.some(r => {
    if (!r.coverage_type.trim()) return false;
    const amt = parseCurrencyAmount(r.minimum_limit);
    return amt !== null && amt > 0;
  });
  const reqReady = reqMode === 'upload' ? !!reqFile : hasValidManualRow;
  const canRun = reqReady && !!coiFile && !!rcsFile && verifierCompany.trim().length > 0 && carrierCompany.trim().length > 0;
  const insuranceOptions = verifyResult ? buildInsuranceOptions(verifyResult.coi_extracted) : [];
  const visibleOptions = insuranceOptions.slice(carouselStart, carouselStart + 2);

  // Single source of truth for the requirement check list shown in both the
  // draft and final reports. Name check (if applicable) is always item #0;
  // its status reflects call answers once they're available.
  const displayedItems: GapItem[] = (() => {
    if (!verifyResult) return [];
    const base = finalReport
      ? [...finalReport.met, ...finalReport.not_met, ...finalReport.uncertain]
      : [...verifyResult.gap_analysis.met, ...verifyResult.gap_analysis.not_met, ...verifyResult.gap_analysis.uncertain];
    const nameCheck = buildNameCheckItem(
      carrierCompany,
      verifyResult.coi_extracted,
      verifyResult.discrepancies,
      callAnswers,
    );
    return nameCheck ? [nameCheck, ...base] : base;
  })();

  return (
    <div style={{ minHeight: '100vh', background: C.paper, color: C.txt, fontFamily: C.sans }}>
      <style>{`
        @keyframes fdr-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fdr-spin   { to{transform:rotate(360deg)} }
        @media print {
          nav, .no-print { display: none !important; }
          body { background: white !important; }
          #fordra-report { padding: 24px; }
        }
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
              fontFamily: C.serif, fontSize: 32, fontWeight: 400,
              letterSpacing: '-0.02em', color: C.txt, marginBottom: 10, lineHeight: 1, whiteSpace: 'nowrap' as const,
            }}>
              Upload documents to verify
            </h1>
            <p style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, lineHeight: 1.6, marginBottom: 32 }}>
              We need legal entity details, your insurance requirements, the carrier&apos;s COI, and the rate confirmation sheet.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              {[
                { label: 'Your company name', value: verifierCompany, onChange: setVerifierCompany, placeholder: 'e.g. Fordra Financial' },
                { label: 'Carrier company name', value: carrierCompany, onChange: setCarrierCompany, placeholder: 'e.g. Sunrise Trucking LLC' },
              ].map(({ label, value, onChange, placeholder }) => (
                <div key={label}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const, color: C.txt3,
                    marginBottom: 8, display: 'block', fontFamily: C.sans,
                  }}>
                    {label}
                  </span>
                  <input
                    type="text"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    style={{
                      width: '100%', boxSizing: 'border-box' as const,
                      padding: '11px 14px', fontSize: 14, fontFamily: C.sans,
                      borderRadius: 8, border: `1.5px solid ${value.trim() ? C.success : C.border}`,
                      background: value.trim() ? C.surfaceHover : C.surface,
                      color: C.txt, outline: 'none',
                      transition: 'border-color 150ms, background 150ms',
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 20, marginBottom: 32 }}>
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 8,
                }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const, color: C.txt3, fontFamily: C.sans,
                  }}>
                    Your requirements
                  </span>
                  <div style={{
                    display: 'inline-flex', background: C.paper, borderRadius: 8, padding: 2,
                    border: `1px solid ${C.border}`,
                  }}>
                    {([
                      ['upload', 'Upload file'],
                      ['manual', 'Enter manually'],
                    ] as const).map(([m, label]) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setReqMode(m)}
                        style={{
                          fontSize: 11, fontWeight: 600, fontFamily: C.sans, letterSpacing: '0.02em',
                          padding: '4px 10px', borderRadius: 6, border: 'none',
                          background: reqMode === m ? C.txt : 'transparent',
                          color: reqMode === m ? C.surface : C.txt3,
                          cursor: 'pointer', transition: 'all 120ms',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {reqMode === 'upload' ? (
                  <DropZone
                    boxTitle=""
                    hint="PDF, DOCX, JPG, PNG, or TXT — list of required coverages and limits"
                    file={reqFile}
                    accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={setReqFile}
                  />
                ) : (
                  <ManualRequirementsForm
                    rows={manualReqs}
                    onChange={setManualReqs}
                    notes={manualNotes}
                    onNotesChange={setManualNotes}
                  />
                )}
              </div>

              <DropZone
                boxTitle="Carrier's Certificate of Insurance"
                hint="PDF, JPG, or PNG scan of the COI (ACORD 25)"
                file={coiFile}
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={setCoiFile}
              />

              <DropZone
                boxTitle="Rate Confirmation Sheet"
                hint="PDF, JPG, or PNG of the signed rate confirmation"
                file={rcsFile}
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={setRcsFile}
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
              <ScanningDoc />
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
          <div style={{ paddingBottom: 80 }}>
            {error && (
              <p style={{ fontSize: 13, color: C.error, marginBottom: 16, fontFamily: C.sans }}>{error}</p>
            )}

            <ReportContent
              result={verifyResult}
              items={displayedItems}
              isFinal={false}
              onContact={() => setStep('contact')}
            />
          </div>
        )}

        {/* ── Page 4: Contact ── */}
        {step === 'contact' && verifyResult && (
          <div>
            <h1 style={{
              fontFamily: C.serif, fontSize: 38, fontWeight: 400,
              letterSpacing: '-0.02em', color: C.txt, marginBottom: 32,
            }}>
              Contact Insurer
            </h1>

            {/* Phase 1: Insurer selection (full) */}
            {selectedOption === null && callPhase === 'idle' && (
              <Card>
                <FieldLabel>Select Insurance Company to Contact</FieldLabel>

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

                {insuranceOptions.length > 2 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
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
                    >‹</button>
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
                    >›</button>
                    <span style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, alignSelf: 'center', paddingLeft: 4 }}>
                      {carouselStart + 1}–{Math.min(carouselStart + 2, insuranceOptions.length)} of {insuranceOptions.length}
                    </span>
                  </div>
                )}
              </Card>
            )}

            {/* Phase 2: Selected insurer (compact) + editable questions */}
            {selectedOption !== null && callPhase === 'idle' && (
              <>
                {/* Compact insurer row */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 20px', borderRadius: 10, marginBottom: 16,
                  border: `1.5px solid ${C.success}`,
                  background: C.surfaceHover,
                }}>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: C.success, marginBottom: 3, fontFamily: C.sans }}>
                      Selected
                    </p>
                    <p style={{ fontSize: 15, fontWeight: 600, color: C.txt, fontFamily: C.sans, marginBottom: 2 }}>
                      {insuranceOptions[selectedOption]?.name}
                    </p>
                    <p style={{ fontSize: 13, color: C.txt2, fontFamily: C.sans }}>
                      {insuranceOptions[selectedOption]?.phone}
                    </p>
                  </div>
                  <SecondaryBtn onClick={() => setSelectedOption(null)}>Change</SecondaryBtn>
                </div>

                {/* Editable questions */}
                <Card>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 24 }}>
                    <div>
                      <FieldLabel>Questions to ask</FieldLabel>
                      <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.55, fontFamily: C.sans }}>
                        Review and edit before the call starts.
                      </p>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <FieldLabel>Phone number</FieldLabel>
                      <input
                        type="tel"
                        value={callPhone}
                        onChange={e => setCallPhone(e.target.value)}
                        style={{
                          padding: '7px 12px', fontSize: 13, fontFamily: C.sans,
                          borderRadius: 6, border: `1.5px solid ${C.border}`,
                          background: C.surface, color: C.txt, outline: 'none', width: 160,
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 12 }}>
                    {editableQuestions.map((q, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, paddingTop: 10, minWidth: 20, textAlign: 'right' as const }}>
                          {i + 1}.
                        </span>
                        <textarea
                          value={q}
                          onChange={e => {
                            const next = [...editableQuestions];
                            next[i] = e.target.value;
                            setEditableQuestions(next);
                          }}
                          rows={2}
                          style={{
                            flex: 1, padding: '8px 12px', fontSize: 13, fontFamily: C.sans,
                            borderRadius: 6, border: `1.5px solid ${C.border}`,
                            background: C.surface, color: C.txt, outline: 'none',
                            resize: 'vertical' as const, lineHeight: 1.5,
                          }}
                        />
                        <button
                          onClick={() => setEditableQuestions(qs => qs.filter((_, j) => j !== i))}
                          style={{
                            padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
                            background: 'transparent', color: C.txt3, cursor: 'pointer',
                            fontSize: 16, lineHeight: 1, alignSelf: 'flex-start', marginTop: 2,
                          }}
                        >×</button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setEditableQuestions(qs => [...qs, ''])}
                    style={{
                      width: '100%', fontSize: 13, color: C.txt2, fontFamily: C.sans,
                      cursor: 'pointer', background: 'transparent',
                      border: `1px dashed ${C.border}`, borderRadius: 6,
                      padding: '8px 16px', marginBottom: 24,
                    }}
                  >
                    + Add question
                  </button>

                  {error && <p style={{ fontSize: 12, color: C.error, marginBottom: 12, fontFamily: C.sans }}>{error}</p>}
                  <PrimaryBtn onClick={startCall}>Start AI Call</PrimaryBtn>
                </Card>
              </>
            )}

            {/* Phase 3: Call in progress / complete */}
            {callPhase !== 'idle' && (
              <Card>
                <CallProgressSection
                  callPhase={callPhase}
                  callId={callId}
                  transcript={transcript}
                  callAnswers={callAnswers}
                  questions={editableQuestions}
                  phone={callPhone}
                  onTryAnother={tryAnother}
                  onGenerateReport={generateFinalReport}
                  generatingReport={generatingReport}
                />
              </Card>
            )}
          </div>
        )}

        {/* ── Page 5: Finalize ── */}
        {step === 'finalize' && (
          <div style={{ textAlign: 'center' as const, paddingTop: 80 }}>
            <p style={{
              fontFamily: C.serif, fontSize: 48, fontStyle: 'italic',
              fontWeight: 400, color: C.circle, marginBottom: 48, lineHeight: 1,
            }}>
              Finalizing&hellip;
            </p>
            <div style={{ display: 'inline-flex', flexDirection: 'column' as const, alignItems: 'center', gap: 12 }}>
              <ScanningDoc />
              <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, letterSpacing: '0.01em' }}>
                (&lt;30 seconds)
              </p>
            </div>
            <p style={{ fontSize: 15, color: C.txt2, fontFamily: C.sans, marginTop: 36 }}>
              Updating analysis with call findings&hellip;
            </p>
          </div>
        )}

        {/* ── Page 6: Report ── */}
        {step === 'report' && verifyResult && finalReport && (
          <div id="fordra-report">
            <ReportContent
              result={verifyResult}
              items={displayedItems}
              isFinal={true}
              narrativeSummary={finalReport.narrative_summary || undefined}
              callAnswers={callAnswers}
              transcript={transcript}
            />
          </div>
        )}

      </div>

      {/* ── Sticky contact bar (draft step) ── */}
      {step === 'draft' && verifyResult && verifyResult.agent_questions.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
          padding: '16px 24px',
          background: `color-mix(in oklch, ${C.paper} 85%, transparent)`,
          backdropFilter: 'blur(12px)',
          borderTop: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'center',
        }}>
          <PrimaryBtn onClick={() => setStep('contact')}>
            Use AI to Contact Insurer
          </PrimaryBtn>
        </div>
      )}
    </div>
  );
}
