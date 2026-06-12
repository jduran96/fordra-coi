'use client';

import { useEffect, useRef, useState } from 'react';
import type { FinalReport, GapItem } from '@/lib/types';
import { C } from '@/components/ui/tokens';
import { Card, FieldLabel, SectionLabel, PrimaryBtn, SecondaryBtn, ScanningDoc, RequirementTag } from '@/components/ui/primitives';
import { DropZone } from '@/components/ui/DropZone';
import { QuestionListEditor } from '@/components/ui/QuestionListEditor';
import { COIDetailsSection, shortTitle } from '@/components/ui/report';
import { DocsLog } from '@/components/ui/DocsLog';
import { type MockVerification } from '@/lib/mock';

type FlowStep = 'review' | 'upload' | 'processing' | 'draft';

const STATUS_OPTIONS: { value: GapItem['status']; label: string }[] = [
  { value: 'met',       label: 'Satisfied' },
  { value: 'not_met',   label: 'Discrepancy' },
  { value: 'uncertain', label: 'Missing' },
];

export function CompletionFlow({ verification, onComplete }: {
  verification: MockVerification;
  onComplete: (report: FinalReport) => void;
}) {
  const [step, setStep] = useState<FlowStep>('review');
  const [questions, setQuestions] = useState<string[]>(verification.agent_questions ?? []);
  const [insightsFile, setInsightsFile] = useState<File | null>(null);
  const [callLogFile, setCallLogFile] = useState<File | null>(null);
  const [callNotes, setCallNotes] = useState('');
  const [draftItems, setDraftItems] = useState<GapItem[]>([]);
  const [narrative, setNarrative] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const contact = verification.insurance_contact;

  function processUploads() {
    setStep('processing');
    // Mock second OCR pass over the call log — real pipeline lands with the backend.
    timer.current = setTimeout(() => {
      const g = verification.gap_analysis;
      const items: GapItem[] = g
        ? [
            ...g.met,
            ...g.not_met,
            // Uncertain items come back resolved by the call — admin can flip them back.
            ...g.uncertain.map(item => ({
              ...item,
              status: 'met' as const,
              evidence: 'Confirmed by the insurance agent during the verification call.',
            })),
          ]
        : [];
      setDraftItems(items);
      setNarrative(
        `${verification.carrier_name} meets all coverage requirements. The insurer confirmed active policies with no lapses or pending cancellations.`,
      );
      setStep('draft');
    }, 4000);
  }

  function submitReport() {
    onComplete({
      met: draftItems.filter(i => i.status === 'met'),
      not_met: draftItems.filter(i => i.status === 'not_met'),
      uncertain: draftItems.filter(i => i.status === 'uncertain'),
      narrative_summary: narrative.trim(),
    });
  }

  function updateItem(i: number, patch: Partial<GapItem>) {
    setDraftItems(items => items.map((item, idx) => idx === i ? { ...item, ...patch } : item));
  }

  // ── Step: review submitted materials ──
  if (step === 'review') {
    return (
      <div>
        <SectionLabel>Submitted Documents</SectionLabel>
        <DocsLog docs={verification.docs} />

        {verification.coi_extracted && (
          <>
            <SectionLabel>OCR Insights</SectionLabel>
            <COIDetailsSection coi={verification.coi_extracted} />
          </>
        )}

        {contact && (
          <>
            <SectionLabel>Insurance Contact</SectionLabel>
            <Card style={{ padding: '20px 28px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.2fr', gap: 20 }}>
                <div>
                  <FieldLabel>Company</FieldLabel>
                  <p style={{ fontSize: 14, fontWeight: 600, color: C.txt, fontFamily: C.sans, margin: 0 }}>{contact.name}</p>
                  <p style={{ fontSize: 12.5, color: C.txt2, fontFamily: C.sans, margin: '4px 0 0' }}>{contact.address}</p>
                </div>
                <div>
                  <FieldLabel>Phone</FieldLabel>
                  <p style={{ fontSize: 14, color: C.txt, fontFamily: C.sans, margin: 0 }}>{contact.phone}</p>
                </div>
                <div>
                  <FieldLabel>Email</FieldLabel>
                  <p style={{ fontSize: 14, color: C.txt, fontFamily: C.sans, margin: 0 }}>{contact.email}</p>
                </div>
              </div>
            </Card>
          </>
        )}

        <SectionLabel>Questions for the Insurer</SectionLabel>
        <Card>
          <p style={{ fontSize: 13, color: C.txt2, marginBottom: 20, lineHeight: 1.65, fontFamily: C.sans }}>
            Confirm these with the insurance company, then upload your call log and insights.
          </p>
          <QuestionListEditor questions={questions} onChange={setQuestions} />
        </Card>

        <PrimaryBtn onClick={() => setStep('upload')} style={{ width: '100%', padding: 15, marginTop: 16 }}>
          Continue to call upload →
        </PrimaryBtn>
      </div>
    );
  }

  // ── Step: upload call artifacts ──
  if (step === 'upload') {
    return (
      <div>
        <SectionLabel>Upload Call Results</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 20, marginBottom: 24 }}>
          <DropZone
            boxTitle="Call log or recording"
            hint="Transcript, notes, or audio from the call with the insurance company"
            file={callLogFile}
            accept="audio/*,text/plain,application/pdf,image/jpeg,image/png"
            onChange={setCallLogFile}
          />
          <DropZone
            boxTitle="Insurer insights (optional)"
            hint="Any supporting documents the insurer provided"
            file={insightsFile}
            accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
            onChange={setInsightsFile}
          />
          <div>
            <FieldLabel style={{ marginBottom: 6 }}>Call notes (optional)</FieldLabel>
            <textarea
              value={callNotes}
              onChange={e => setCallNotes(e.target.value)}
              placeholder="Key answers from the agent, anything that affects the report…"
              rows={4}
              style={{
                width: '100%', boxSizing: 'border-box' as const,
                padding: '10px 12px', fontSize: 13, fontFamily: C.sans,
                borderRadius: 6, border: `1.5px solid ${C.border}`,
                background: C.surface, color: C.txt, outline: 'none',
                resize: 'vertical' as const, lineHeight: 1.6, minHeight: 88,
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <SecondaryBtn onClick={() => setStep('review')} style={{ padding: '13px 24px' }}>
            ← Back
          </SecondaryBtn>
          <PrimaryBtn
            onClick={processUploads}
            disabled={!callLogFile && !callNotes.trim()}
            style={{ flex: 1, padding: 15 }}
          >
            Process →
          </PrimaryBtn>
        </div>
      </div>
    );
  }

  // ── Step: mock OCR pass ──
  if (step === 'processing') {
    return (
      <div style={{ textAlign: 'center' as const, paddingTop: 60 }}>
        <h2 style={{
          fontFamily: C.serif, fontSize: 28, fontWeight: 400,
          letterSpacing: '-0.02em', color: C.txt, marginBottom: 10,
        }}>
          Processing call results
        </h2>
        <p style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, marginBottom: 40 }}>
          Extracting answers and drafting the final report.
        </p>
        <div style={{ display: 'inline-flex', flexDirection: 'column' as const, alignItems: 'center', gap: 12 }}>
          <ScanningDoc />
          <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans }}>(a few seconds)</p>
        </div>
      </div>
    );
  }

  // ── Step: editable draft report ──
  return (
    <div>
      <SectionLabel>Draft Final Report</SectionLabel>
      <Card>
        <FieldLabel>Narrative summary</FieldLabel>
        <textarea
          value={narrative}
          onChange={e => setNarrative(e.target.value)}
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box' as const,
            padding: '10px 12px', fontSize: 14, fontFamily: C.sans,
            borderRadius: 6, border: `1.5px solid ${C.border}`,
            background: C.surface, color: C.txt, outline: 'none',
            resize: 'vertical' as const, lineHeight: 1.6,
          }}
        />
      </Card>

      <Card>
        <FieldLabel>Requirement check</FieldLabel>
        {draftItems.map((item, i) => (
          <div key={i} style={{
            padding: '16px 0',
            borderBottom: i < draftItems.length - 1 ? `1px solid ${C.border}` : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: C.txt, fontFamily: C.sans, flex: 1, margin: 0 }}>
                {shortTitle(item.requirement.coverage_type)}
              </p>
              <RequirementTag status={item.status} />
              <select
                value={item.status}
                onChange={e => updateItem(i, { status: e.target.value as GapItem['status'] })}
                style={{
                  fontSize: 12, fontWeight: 600, fontFamily: C.sans,
                  padding: '5px 8px', borderRadius: 6,
                  border: `1px solid ${C.border}`, background: C.surface,
                  color: C.txt2, cursor: 'pointer', outline: 'none',
                }}
              >
                {STATUS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <textarea
              value={item.evidence}
              onChange={e => updateItem(i, { evidence: e.target.value })}
              rows={2}
              style={{
                width: '100%', boxSizing: 'border-box' as const,
                padding: '8px 12px', fontSize: 13, fontFamily: C.sans,
                borderRadius: 6, border: `1.5px solid ${C.border}`,
                background: C.surface, color: C.txt2, outline: 'none',
                resize: 'vertical' as const, lineHeight: 1.55,
              }}
            />
          </div>
        ))}
      </Card>

      <PrimaryBtn
        onClick={submitReport}
        disabled={!narrative.trim() || draftItems.length === 0}
        style={{ width: '100%', padding: 15, marginTop: 16 }}
      >
        Submit final report
      </PrimaryBtn>
    </div>
  );
}
