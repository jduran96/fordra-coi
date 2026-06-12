'use client';

import type { Requirement } from '@/lib/types';
import type { MockDoc } from '@/lib/mock';
import { C } from './tokens';
import { Card, FieldLabel } from './primitives';
import { formatTimestamp } from '@/lib/mock';

const DOC_LABELS: Record<string, string> = {
  requirements: 'Requirements',
  coi: 'Certificate of Insurance',
  rcs: 'Rate Confirmation Sheet',
};

export function DocsLog({ docs, requirements }: {
  docs: MockDoc[];
  // When provided, the manually entered / parsed requirements are listed
  // below the uploaded files.
  requirements?: Requirement[];
}) {
  return (
    <Card style={{ padding: '20px 28px' }}>
      <FieldLabel>Submitted documents</FieldLabel>
      {docs.map((d, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '11px 0',
          borderBottom: i < docs.length - 1 || requirements?.length ? `1px solid ${C.border}` : 'none',
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase' as const, color: C.txt3, fontFamily: C.sans,
            minWidth: 170, flexShrink: 0,
          }}>
            {DOC_LABELS[d.kind] ?? d.kind}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.txt, fontFamily: C.sans, flex: 1 }}>
            {d.filename}
          </span>
          <span style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans }}>
            {d.size_kb} KB · {formatTimestamp(d.uploaded_at)}
          </span>
        </div>
      ))}

      {requirements && requirements.length > 0 && (
        <div style={{ paddingTop: 14 }}>
          <FieldLabel>Submitted requirements</FieldLabel>
          {requirements.map((r, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'baseline', gap: 14,
              padding: '8px 0',
              borderBottom: i < requirements.length - 1 ? `1px solid ${C.border}` : 'none',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.txt, fontFamily: C.sans, flex: 1 }}>
                {r.coverage_type}
              </span>
              <span style={{ fontSize: 13, color: C.txt2, fontFamily: C.sans }}>
                {r.minimum_limit}
              </span>
              {r.notes && (
                <span style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, maxWidth: 220 }}>
                  {r.notes}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
