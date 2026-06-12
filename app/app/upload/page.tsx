'use client';

import { useEffect, useRef, useState } from 'react';
import type { GapItem, Requirement } from '@/lib/types';
import { C } from '@/components/ui/tokens';
import { Card, FieldLabel, SectionLabel, PrimaryBtn, ScanningDoc, PageTitle } from '@/components/ui/primitives';
import { DropZone } from '@/components/ui/DropZone';
import { ManualRequirementsForm, parseCurrencyAmount } from '@/components/ui/ManualRequirementsForm';
import { QuestionListEditor } from '@/components/ui/QuestionListEditor';
import { ReportView } from '@/components/ui/report';
import { MOCK_VERIFICATIONS } from '@/lib/mock';

type Step = 'upload' | 'analyze' | 'draft' | 'done';

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: 'upload',  label: 'Upload' },
  { key: 'analyze', label: 'Analyze' },
  { key: 'draft',   label: 'Draft' },
];

const PROCESSING_MSGS = [
  'Reading documents...',
  'Extracting insights...',
  'Finding gaps...',
  'Preparing questions...',
];

// Canned analysis result until the backend is wired up — a pending mock
// verification with full OCR output and a generated question list.
const SAMPLE = MOCK_VERIFICATIONS.find(v => v.status === 'pending' && v.coi_extracted)!;

// Same check the demo runs: the carrier name typed at upload must match the
// named insured OCR'd from the COI. Mismatch → discrepancy row + a question
// for the insurer.
function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

function buildNameCheckItem(carrierCompany: string, namedInsured: string): GapItem | null {
  const user = carrierCompany.trim();
  const ocr = namedInsured.trim();
  if (!user || !ocr) return null;
  const requirement = { coverage_type: 'Matching Policyholder Name', minimum_limit: '', notes: null };
  return namesMatch(user, ocr)
    ? { requirement, status: 'met', evidence: 'Carrier name matches the named insured on the COI.' }
    : { requirement, status: 'not_met', evidence: `You entered "${user}" but the COI lists "${ocr}" as the policyholder.` };
}

function nameCheckQuestion(carrierCompany: string): string {
  return `Does this policy also cover a business called ${carrierCompany.trim()}?`;
}

function StepPills({ step }: { step: Step }) {
  const idx = STEP_LABELS.findIndex(s => s.key === step);
  const effective = step === 'done' ? STEP_LABELS.length : idx;
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 36 }}>
      {STEP_LABELS.map((s, i) => {
        const active = i === effective;
        const done = i < effective;
        return (
          <span key={s.key} style={{
            fontSize: 12, fontWeight: 600, fontFamily: C.sans,
            padding: '5px 14px', borderRadius: 9999,
            background: active ? C.txt : done ? `color-mix(in oklch, ${C.txt} 10%, transparent)` : 'transparent',
            color: active ? C.surface : done ? C.txt2 : C.txt3,
            border: active ? 'none' : `1px solid ${C.border}`,
            transition: 'all 150ms',
          }}>
            {done ? '✓ ' : ''}{s.label}
          </span>
        );
      })}
    </div>
  );
}

export default function AppUploadPage() {
  const [step, setStep] = useState<Step>('upload');
  const [reqMode, setReqMode] = useState<'upload' | 'manual'>('upload');
  const [reqFile, setReqFile] = useState<File | null>(null);
  const [coiFile, setCoiFile] = useState<File | null>(null);
  const [rcsFile, setRcsFile] = useState<File | null>(null);
  const [manualReqs, setManualReqs] = useState<Requirement[]>([
    { coverage_type: '', minimum_limit: '', notes: '' },
  ]);
  const [manualNotes, setManualNotes] = useState('');
  const [verifierCompany, setVerifierCompany] = useState('');
  const [carrierCompany, setCarrierCompany] = useState('');
  const [msgIdx, setMsgIdx] = useState(0);
  const [questions, setQuestions] = useState<string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  function runAnalysis() {
    setStep('analyze');
    setMsgIdx(0);
    // Mock OCR pass — the real /api pipeline replaces this when wired up.
    PROCESSING_MSGS.forEach((_, i) => {
      if (i === 0) return;
      timers.current.push(setTimeout(() => setMsgIdx(i), i * 1700));
    });
    timers.current.push(setTimeout(() => {
      // Discrepancy questions lead, then the standard gap questions — same
      // ordering as the demo's enrichVerifyResult.
      const mismatch = SAMPLE.coi_extracted
        && !namesMatch(carrierCompany, SAMPLE.coi_extracted.named_insured);
      setQuestions([
        ...(mismatch ? [nameCheckQuestion(carrierCompany)] : []),
        ...(SAMPLE.agent_questions ?? []),
      ]);
      setStep('draft');
    }, PROCESSING_MSGS.length * 1700));
  }

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStep('upload');
    setReqMode('upload');
    setReqFile(null); setCoiFile(null); setRcsFile(null);
    setManualReqs([{ coverage_type: '', minimum_limit: '', notes: '' }]);
    setManualNotes('');
    setVerifierCompany(''); setCarrierCompany('');
    setMsgIdx(0);
    setQuestions([]);
  }

  const hasValidManualRow = manualReqs.some(r => {
    if (!r.coverage_type.trim()) return false;
    const amt = parseCurrencyAmount(r.minimum_limit);
    return amt !== null && amt > 0;
  });
  const reqReady = reqMode === 'upload' ? !!reqFile : hasValidManualRow;
  const canRun = reqReady && !!coiFile && !!rcsFile && verifierCompany.trim().length > 0 && carrierCompany.trim().length > 0;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <StepPills step={step} />

      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <div>
          <PageTitle subtitle="We need legal entity details, your insurance requirements, the carrier's COI, and the rate confirmation sheet.">
            Submit a verification
          </PageTitle>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            {[
              { label: 'Your company name', value: verifierCompany, onChange: setVerifierCompany, placeholder: 'e.g. Atlas Freight Brokerage' },
              { label: 'Carrier company name', value: carrierCompany, onChange: setCarrierCompany, placeholder: 'e.g. Sunrise Trucking LLC' },
            ].map(({ label, value, onChange, placeholder }) => (
              <div key={label}>
                <FieldLabel style={{ marginBottom: 8 }}>{label}</FieldLabel>
                <input
                  type="text"
                  value={value}
                  onChange={e => onChange(e.target.value)}
                  placeholder={placeholder}
                  style={{
                    width: '100%', boxSizing: 'border-box' as const,
                    padding: '12px 14px', fontSize: 14, fontFamily: C.sans,
                    borderRadius: 8,
                    border: `1.5px solid ${value.trim() ? C.success : C.border}`,
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
                <FieldLabel style={{ marginBottom: 0 }}>Your requirements</FieldLabel>
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

          <PrimaryBtn onClick={runAnalysis} disabled={!canRun} style={{ width: '100%', padding: 15 }}>
            Submit for analysis →
          </PrimaryBtn>
        </div>
      )}

      {/* ── Step 2: Analyze ── */}
      {step === 'analyze' && (
        <div style={{ textAlign: 'center' as const, paddingTop: 60 }}>
          <h1 style={{
            fontFamily: C.serif, fontSize: 32, fontWeight: 400,
            letterSpacing: '-0.02em', color: C.txt, marginBottom: 10,
          }}>
            Analyzing your documents
          </h1>
          <p style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, marginBottom: 40 }}>
            OCR is reading each document and checking it against your requirements.
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

      {/* ── Step 3: Draft ── */}
      {step === 'draft' && SAMPLE.coi_extracted && SAMPLE.gap_analysis && (
        <div style={{ paddingBottom: 80 }}>
          <ReportView
            items={[
              // Name check always leads the requirement list, like the demo.
              ...([buildNameCheckItem(carrierCompany, SAMPLE.coi_extracted.named_insured)].filter(Boolean) as GapItem[]),
              ...SAMPLE.gap_analysis.met,
              ...SAMPLE.gap_analysis.not_met,
              ...SAMPLE.gap_analysis.uncertain,
            ]}
            coi={SAMPLE.coi_extracted}
            isFinal={false}
          />

          <SectionLabel>Questions for Insurance Company</SectionLabel>
          <Card>
            <p style={{ fontSize: 13, color: C.txt2, marginBottom: 20, lineHeight: 1.65, fontFamily: C.sans }}>
              These items will be confirmed with the insurer. Review and edit before submitting.
            </p>
            <QuestionListEditor questions={questions} onChange={setQuestions} />
          </Card>

          <PrimaryBtn
            onClick={() => setStep('done')}
            disabled={questions.filter(q => q.trim()).length === 0}
            style={{ width: '100%', padding: 15, marginTop: 24 }}
          >
            Submit verification
          </PrimaryBtn>
        </div>
      )}

      {/* ── Step 4: Done ── */}
      {step === 'done' && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
          <Card style={{ maxWidth: 460, width: '100%', textAlign: 'center' as const, padding: '48px 40px' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: `color-mix(in oklch, ${C.success} 14%, transparent)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <span style={{ fontSize: 26, color: C.success, fontWeight: 700 }}>✓</span>
            </div>
            <h2 style={{
              fontFamily: C.serif, fontSize: 26, fontWeight: 400,
              letterSpacing: '-0.02em', color: C.txt, margin: '0 0 10px',
            }}>
              Verification submitted
            </h2>
            <p style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, lineHeight: 1.6, margin: '0 0 28px' }}>
              We will contact the insurer and post the final verification report in the Status page.
            </p>
            <PrimaryBtn onClick={reset} style={{ width: '100%' }}>
              Start a new upload
            </PrimaryBtn>
          </Card>
        </div>
      )}
    </div>
  );
}
