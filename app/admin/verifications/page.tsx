'use client';

import { useState } from 'react';
import type { FinalReport } from '@/lib/types';
import { C } from '@/components/ui/tokens';
import { Card, FieldLabel, PageTitle, Pill, SecondaryBtn, SectionLabel } from '@/components/ui/primitives';
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable';
import { ReportView, TranscriptView } from '@/components/ui/report';
import { DocsLog } from '@/components/ui/DocsLog';
import { CompletionFlow } from './CompletionFlow';
import {
  MOCK_VERIFICATIONS, formatTimestamp, STATUS_LABELS,
  type MockStatus, type MockVerification,
} from '@/lib/mock';

const PAGE_SIZE = 10;

const STATUS_COLORS: Record<MockStatus, string> = {
  completed: C.success,
  pending: C.accent,
  error: C.error,
};

export default function AdminVerificationsPage() {
  // Rows live in state so the pending → completed flip survives view changes.
  const [rows, setRows] = useState<MockVerification[]>(MOCK_VERIFICATIONS);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  const detail = detailId ? rows.find(v => v.id === detailId) : null;

  function completeVerification(id: string, report: FinalReport) {
    setRows(prev => prev.map(v => v.id === id
      ? {
          ...v,
          status: 'completed' as const,
          case_status: 'report_ready' as const,
          final_report: report,
          eta: null,
        }
      : v,
    ));
    setDetailId(null);
    setBanner(`${id} completed — final report sent to the requester.`);
  }

  // ── Detail views ──
  if (detail) {
    return (
      <div style={{ maxWidth: 760 }}>
        <button
          onClick={() => setDetailId(null)}
          style={{
            fontSize: 13, fontWeight: 600, fontFamily: C.sans,
            color: C.txt2, background: 'transparent', border: 'none',
            cursor: 'pointer', padding: 0, marginBottom: 28,
          }}
        >
          ← All verifications
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' as const }}>
          <h1 style={{
            fontFamily: C.serif, fontSize: 30, fontWeight: 400,
            letterSpacing: '-0.02em', color: C.txt, margin: 0,
          }}>
            {detail.carrier_name}
          </h1>
          <Pill label={STATUS_LABELS[detail.status]} color={STATUS_COLORS[detail.status]} />
        </div>
        <p style={{ fontSize: 13, color: C.txt3, fontFamily: C.sans, margin: '0 0 8px' }}>
          {detail.id} · Submitted {formatTimestamp(detail.created_at)} by {detail.requester.name} ({detail.requester.company}) via {detail.source.toUpperCase()}
        </p>

        {detail.status === 'pending' && (
          <CompletionFlow
            verification={detail}
            onComplete={report => completeVerification(detail.id, report)}
          />
        )}

        {detail.status === 'completed' && detail.final_report && detail.coi_extracted && (
          <div>
            <SectionLabel>Submitted Documents</SectionLabel>
            <DocsLog docs={detail.docs} />

            {detail.call_transcript && (
              <>
                <SectionLabel>Call with Insurer</SectionLabel>
                <Card>
                  <FieldLabel>Transcript</FieldLabel>
                  <TranscriptView raw={detail.call_transcript} />
                </Card>
              </>
            )}

            <SectionLabel>Report Sent to Requester</SectionLabel>
            <ReportView
              items={[
                ...detail.final_report.met,
                ...detail.final_report.not_met,
                ...detail.final_report.uncertain,
              ]}
              coi={detail.coi_extracted}
              isFinal
              narrativeSummary={detail.final_report.narrative_summary}
              callAnswers={detail.call_extracted_answers}
            />
          </div>
        )}

        {detail.status === 'error' && (
          <div style={{ marginTop: 24 }}>
            <Card style={{ borderColor: `color-mix(in oklch, ${C.error} 28%, transparent)` }}>
              <FieldLabel style={{ color: C.error }}>Error detail</FieldLabel>
              <p style={{ fontSize: 14, color: C.txt, fontFamily: C.sans, lineHeight: 1.65, margin: 0 }}>
                {detail.error_detail ?? 'Unknown error — check the processing logs.'}
              </p>
            </Card>
            <SectionLabel>Submitted Documents</SectionLabel>
            <DocsLog docs={detail.docs} />
          </div>
        )}
      </div>
    );
  }

  // ── List view ──
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const columns: Column<MockVerification>[] = [
    {
      key: 'id', header: 'ID', width: '90px',
      render: v => <span style={{ color: C.txt3, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>{v.id}</span>,
    },
    {
      key: 'submitted', header: 'Submitted', width: '150px',
      render: v => <span style={{ color: C.txt2 }}>{formatTimestamp(v.created_at)}</span>,
    },
    {
      key: 'carrier', header: 'Carrier',
      render: v => <span style={{ fontWeight: 600 }}>{v.carrier_name}</span>,
    },
    {
      key: 'requester', header: 'Requester', width: '140px',
      render: v => <span style={{ color: C.txt2 }}>{v.requester.name}</span>,
    },
    {
      key: 'source', header: 'Source', width: '70px',
      render: v => <span style={{ color: C.txt3, textTransform: 'uppercase' as const, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>{v.source}</span>,
    },
    {
      key: 'status', header: 'Status', width: '115px',
      render: v => <Pill label={STATUS_LABELS[v.status]} color={STATUS_COLORS[v.status]} />,
    },
    {
      key: 'action', header: '', width: '110px',
      render: v => (
        <SecondaryBtn onClick={() => setDetailId(v.id)}>
          {v.status === 'pending' ? 'Complete' : v.status === 'error' ? 'Details' : 'View'}
        </SecondaryBtn>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 960 }}>
      <PageTitle subtitle="Every verification request across all users. Pending requests need an admin to complete them.">
        Verifications
      </PageTitle>

      {banner && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: `color-mix(in oklch, ${C.success} 10%, transparent)`,
          border: `1px solid color-mix(in oklch, ${C.success} 30%, transparent)`,
          borderRadius: 10, padding: '12px 18px', marginBottom: 20,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.success, fontFamily: C.sans }}>
            ✓ {banner}
          </span>
          <button
            onClick={() => setBanner(null)}
            style={{
              background: 'transparent', border: 'none', color: C.success,
              fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      <Card style={{ padding: '12px 20px 20px' }}>
        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={v => v.id}
          onRowClick={v => setDetailId(v.id)}
        />
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={rows.length}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
}
