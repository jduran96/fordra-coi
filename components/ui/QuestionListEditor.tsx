'use client';

import { C } from './tokens';

// Editable list of questions for the insurer — numbered textareas with
// per-row remove and an add button. Pattern lifted from the demo's
// contact step (app/demo/AppClient.tsx).
export function QuestionListEditor({ questions, onChange }: {
  questions: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 12 }}>
        {questions.map((q, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, paddingTop: 10, minWidth: 20, textAlign: 'right' as const }}>
              {i + 1}.
            </span>
            <textarea
              value={q}
              onChange={e => {
                const next = [...questions];
                next[i] = e.target.value;
                onChange(next);
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
              onClick={() => onChange(questions.filter((_, j) => j !== i))}
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
        onClick={() => onChange([...questions, ''])}
        style={{
          width: '100%', fontSize: 13, color: C.txt2, fontFamily: C.sans,
          cursor: 'pointer', background: 'transparent',
          border: `1px dashed ${C.border}`, borderRadius: 6,
          padding: '8px 16px',
        }}
      >
        + Add question
      </button>
    </div>
  );
}
