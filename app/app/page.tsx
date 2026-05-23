'use client';

import { useState, useRef } from 'react';
import type { Requirement, COIExtracted, GapAnalysis } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VerifyResult {
  requirements: Requirement[];
  coi_extracted: COIExtracted;
  gap_analysis: GapAnalysis;
  agent_questions: string[];
}

type Step = 'upload' | 'processing' | 'done';

// ─── Styles ───────────────────────────────────────────────────────────────────

const T: Record<string, React.CSSProperties> = {
  page:    { minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'Inter, -apple-system, sans-serif', padding: '0 0 80px' },
  nav:     { padding: '20px 40px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  logo:    { fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px' },
  wrap:    { maxWidth: 720, margin: '0 auto', padding: '48px 24px 0' },
  card:    { border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 32, background: 'rgba(255,255,255,0.02)', marginBottom: 20 },
  label:   { fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.35)', marginBottom: 10, display: 'block' },
  btn:     { padding: '13px 28px', background: '#fff', color: '#0a0a0a', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer' },
  btnGhost:{ padding: '10px 20px', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer' },
};

// ─── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({ label, hint, file, accept, onChange }: {
  label: string; hint: string; file: File | null;
  accept: string; onChange: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div>
      <span style={T.label}>{label}</span>
      <div
        onClick={() => ref.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onChange(f); }}
        style={{
          border: `2px dashed ${over ? 'rgba(255,255,255,0.4)' : file ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 12, padding: '28px 20px', textAlign: 'center', cursor: 'pointer',
          background: file ? 'rgba(255,255,255,0.03)' : 'transparent', transition: 'all 0.15s',
        }}
      >
        {file ? (
          <>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>{file.name}</p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{(file.size / 1024).toFixed(0)} KB · click to change</p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 28, marginBottom: 8 }}>⬆️</p>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>Drop file or click to browse</p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{hint}</p>
          </>
        )}
      </div>
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f); }} />
    </div>
  );
}

// ─── Gap pill ─────────────────────────────────────────────────────────────────

function Pill({ status }: { status: 'met' | 'not_met' | 'uncertain' }) {
  const map = { met: ['✅ Met', '#16a34a'], not_met: ['❌ Not met', '#dc2626'], uncertain: ['⚠️ Uncertain', '#d97706'] } as const;
  const [label, color] = map[status];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 100, background: `${color}22`, color, whiteSpace: 'nowrap' as const }}>
      {label}
    </span>
  );
}

// ─── Report ───────────────────────────────────────────────────────────────────

function Report({ result }: { result: VerifyResult }) {
  const { gap_analysis: g, coi_extracted: coi, requirements: reqs, agent_questions: qs } = result;
  const all = [...g.met, ...g.not_met, ...g.uncertain];
  const metCount = g.met.length;
  const failCount = g.not_met.length;
  const uncCount  = g.uncertain.length;

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        {[
          { n: metCount,  label: 'Met',      color: '#16a34a' },
          { n: failCount, label: 'Not met',  color: '#dc2626' },
          { n: uncCount,  label: 'Uncertain',color: '#d97706' },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, padding: '16px 12px', background: `${s.color}11`, border: `1px solid ${s.color}33`, borderRadius: 12, textAlign: 'center' }}>
            <p style={{ fontSize: 28, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.n}</p>
            <p style={{ fontSize: 11, fontWeight: 700, color: s.color, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Named insured + dates */}
      <div style={T.card}>
        <span style={T.label}>Identified carrier</span>
        <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{coi.named_insured || '—'}</p>
        <div style={{ display: 'flex', gap: 32, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
          <span>Certificate holder: <strong style={{ color: '#fff' }}>{coi.certificate_holder || '—'}</strong></span>
          <span>Additional insured: <strong style={{ color: '#fff' }}>{coi.additional_insured || '—'}</strong></span>
        </div>
      </div>

      {/* Requirement-by-requirement results */}
      <div style={T.card}>
        <span style={T.label}>Requirement check ({reqs.length} total)</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {all.map((item, i) => (
            <div key={i} style={{ padding: '14px 0', borderBottom: i < all.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{item.requirement.coverage_type}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{item.requirement.minimum_limit}</span>
                </div>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{item.evidence}</p>
              </div>
              <Pill status={item.status} />
            </div>
          ))}
        </div>
      </div>

      {/* Coverages found on COI */}
      <div style={T.card}>
        <span style={T.label}>Coverages found on COI ({coi.coverages.length})</span>
        {coi.coverages.map((c, i) => (
          <div key={i} style={{ padding: '10px 0', borderBottom: i < coi.coverages.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontWeight: 700 }}>{c.type}</span>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Exp: {c.expiration_date || '—'}</span>
            </div>
            <div style={{ display: 'flex', gap: 20, color: 'rgba(255,255,255,0.5)' }}>
              <span>Occ: <strong style={{ color: '#fff' }}>{c.each_occurrence_limit || '—'}</strong></span>
              <span>Agg: <strong style={{ color: '#fff' }}>{c.aggregate_limit || '—'}</strong></span>
              {c.policy_number && <span>Policy: <strong style={{ color: '#fff' }}>{c.policy_number}</strong></span>}
            </div>
          </div>
        ))}
      </div>

      {/* Questions for agent (if any gaps) */}
      {qs.length > 0 && (
        <div style={T.card}>
          <span style={T.label}>Follow-up questions for insurance agent ({qs.length})</span>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>
            These items couldn&apos;t be confirmed from the COI alone and would need to be verified with the agent.
          </p>
          <ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {qs.map((q, i) => (
              <li key={i} style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>{q}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ─── Call panel ───────────────────────────────────────────────────────────────

function CallPanel({ result }: { result: VerifyResult }) {
  const [phone, setPhone]         = useState('');
  const [agentName, setAgentName] = useState('');
  const [callState, setCallState] = useState<'idle' | 'calling' | 'called'>('idle');
  const [error, setError]         = useState('');

  const needsCall = result.gap_analysis.uncertain.length + result.gap_analysis.not_met.length > 0;
  if (!needsCall) return null;

  function formatPhone(val: string) {
    const d = val.replace(/\D/g, '').slice(0, 10);
    if (d.length >= 7) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
    if (d.length >= 4) return `(${d.slice(0,3)}) ${d.slice(3)}`;
    if (d.length >= 1) return `(${d}`;
    return '';
  }

  const phoneOk = phone.replace(/\D/g, '').length === 10;

  async function call() {
    if (!phoneOk) { setError('Enter a valid 10-digit US number.'); return; }
    setError('');
    setCallState('calling');
    try {
      const res = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          agent_name:   agentName,
          carrier_name: result.coi_extracted.named_insured || 'the carrier',
          questions:    result.agent_questions,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Call failed.'); setCallState('idle'); return; }
      setCallState('called');
    } catch {
      setError('Network error.'); setCallState('idle');
    }
  }

  const inp: React.CSSProperties = {
    padding: '12px 14px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    color: '#fff', fontSize: 14, fontFamily: 'inherit', outline: 'none',
  };

  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 28, background: 'rgba(255,255,255,0.02)', marginBottom: 20 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 10, display: 'block' }}>
        Call insurance agent to resolve {result.agent_questions.length} open item{result.agent_questions.length !== 1 ? 's' : ''}
      </span>

      {callState === 'called' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>📞</span>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700 }}>Call initiated</p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
              Fordra is calling {phone} with {result.agent_questions.length} targeted questions about {result.coi_extracted.named_insured || 'the carrier'}.
            </p>
          </div>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 20, lineHeight: 1.6 }}>
            Fordra will call the insurance agent and ask these {result.agent_questions.length} questions:
            {' '}<strong style={{ color: 'rgba(255,255,255,0.7)' }}>{result.agent_questions.slice(0, 2).join(' / ')}{result.agent_questions.length > 2 ? ` + ${result.agent_questions.length - 2} more` : ''}</strong>
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 6 }}>Agent name (optional)</label>
              <input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="e.g. Mike" style={{ ...inp, width: '100%' }} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 6 }}>Agent phone *</label>
              <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, overflow: 'hidden' }}>
                <span style={{ padding: '12px 10px 12px 14px', fontSize: 14, color: 'rgba(255,255,255,0.4)', borderRight: '1px solid rgba(255,255,255,0.1)' }}>+1</span>
                <input value={phone} onChange={e => setPhone(formatPhone(e.target.value))} placeholder="(555) 555-5555" maxLength={14}
                  style={{ ...inp, border: 'none', borderRadius: 0, paddingLeft: 10, background: 'transparent', flex: 1 }} />
              </div>
            </div>
            <button onClick={call} disabled={callState === 'calling' || !phoneOk}
              style={{ padding: '12px 22px', background: phoneOk && callState === 'idle' ? '#fff' : 'rgba(255,255,255,0.15)',
                color: phoneOk && callState === 'idle' ? '#0a0a0a' : 'rgba(0,0,0,0.4)',
                fontWeight: 600, fontSize: 14, borderRadius: 8, border: 'none',
                cursor: phoneOk && callState === 'idle' ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' as const }}>
              {callState === 'calling' ? 'Calling…' : '📞 Call agent'}
            </button>
          </div>
          {error && <p style={{ fontSize: 12, color: '#ff5f5f', marginTop: 10 }}>{error}</p>}
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const STEPS = ['Upload docs', 'Verifying', 'Report'];
const PROCESSING_MSGS = [
  'Reading requirements…',
  'Extracting COI fields via OCR…',
  'Running gap analysis…',
  'Generating questions for agent…',
];

export default function AppPage() {
  const [step, setStep] = useState<Step>('upload');
  const [reqFile, setReqFile]   = useState<File | null>(null);
  const [coiFile, setCoiFile]   = useState<File | null>(null);
  const [result, setResult]     = useState<VerifyResult | null>(null);
  const [error, setError]       = useState('');
  const [msgIdx, setMsgIdx]     = useState(0);

  async function runVerification() {
    if (!reqFile || !coiFile) { setError('Please upload both files.'); return; }
    setError('');
    setStep('processing');
    setMsgIdx(0);

    // Cycle through status messages while waiting
    const interval = setInterval(() => setMsgIdx(i => Math.min(i + 1, PROCESSING_MSGS.length - 1)), 4000);

    try {
      const fd = new FormData();
      fd.append('requirements_file', reqFile);
      fd.append('coi_file', coiFile);
      const res = await fetch('/api/verify', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); setStep('upload'); return; }
      setResult(data);
      setStep('done');
    } catch {
      setError('Network error. Please try again.');
      setStep('upload');
    } finally {
      clearInterval(interval);
    }
  }

  function reset() {
    setStep('upload'); setReqFile(null); setCoiFile(null);
    setResult(null); setError('');
  }

  return (
    <div style={T.page}>
      {/* Nav */}
      <nav style={T.nav}>
        <span style={T.logo}>Fordra</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {STEPS.map((s, i) => {
            const idx = step === 'upload' ? 0 : step === 'processing' ? 1 : 2;
            const active = i === idx;
            const done   = i < idx;
            return (
              <span key={s} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 100,
                background: active ? '#fff' : done ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: active ? '#0a0a0a' : done ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)',
                border: active ? 'none' : '1px solid rgba(255,255,255,0.08)',
              }}>
                {done ? '✓ ' : ''}{s}
              </span>
            );
          })}
        </div>
        {step === 'done' && (
          <button onClick={reset} style={T.btnGhost}>← New verification</button>
        )}
      </nav>

      <div style={T.wrap}>

        {/* ── Upload ── */}
        {step === 'upload' && (
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.8px', marginBottom: 8 }}>COI Verification</h1>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.4)', marginBottom: 40 }}>
              Upload the factoring company&apos;s requirements and the carrier&apos;s COI. We&apos;ll check one against the other.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 32 }}>
              <DropZone
                label="Factoring company requirements"
                hint="JPG, PNG, or TXT — list of required coverages and limits"
                file={reqFile}
                accept="image/jpeg,image/png,image/webp,text/plain"
                onChange={setReqFile}
              />
              <DropZone
                label="Carrier Certificate of Insurance (ACORD 25)"
                hint="JPG or PNG scan of the COI"
                file={coiFile}
                accept="image/jpeg,image/png,image/webp"
                onChange={setCoiFile}
              />
            </div>

            {error && <p style={{ fontSize: 13, color: '#ff5f5f', marginBottom: 16 }}>{error}</p>}

            <button
              onClick={runVerification}
              disabled={!reqFile || !coiFile}
              style={{
                ...T.btn,
                opacity: reqFile && coiFile ? 1 : 0.3,
                cursor: reqFile && coiFile ? 'pointer' : 'not-allowed',
                width: '100%',
                padding: '15px',
                fontSize: 15,
              }}
            >
              Run verification →
            </button>
          </div>
        )}

        {/* ── Processing ── */}
        {step === 'processing' && (
          <div style={{ textAlign: 'center', paddingTop: 80 }}>
            <div style={{ fontSize: 48, marginBottom: 24, animation: 'spin 1.2s linear infinite', display: 'inline-block' }}>⚙️</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 12 }}>Verifying…</h2>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', transition: 'all 0.3s' }}>
              {PROCESSING_MSGS[msgIdx]}
            </p>
            <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* ── Done ── */}
        {step === 'done' && result && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.6px', marginBottom: 6 }}>Verification report</h1>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                  {result.requirements.length} requirements checked against {result.coi_extracted.coverages.length} coverages found
                </p>
              </div>
              <button onClick={() => window.print()} style={T.btnGhost}>🖨 Print</button>
            </div>
            <Report result={result} />
            <CallPanel result={result} />
          </div>
        )}

      </div>
    </div>
  );
}
