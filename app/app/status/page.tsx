'use client';

import { useState } from 'react';
import { C } from '@/components/ui/tokens';
import { Card, FieldLabel, PageTitle, Pill, SecondaryBtn, SectionLabel } from '@/components/ui/primitives';
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { ReportView } from '@/components/ui/report';
import { DocsLog } from '@/components/ui/DocsLog';
import {
  MY_VERIFICATIONS, formatTimestamp, STATUS_LABELS,
  type MockStatus, type MockVerification,
} from '@/lib/mock';

const PAGE_SIZE = 10;

const STATUS_COLORS: Record<MockStatus, string> = {
  completed: C.success,
  pending: C.accent,
  error: C.error,
};

export default function AppStatusPage() {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [etaModal, setEtaModal] = useState<MockVerification | null>(null);
  const [page, setPage] = useState(0);

  const detail = detailId ? MY_VERIFICATIONS.find(v => v.id === detailId) : null;

  function open(v: MockVerification) {
    if (v.status === 'pending') setEtaModal(v);
    else setDetailId(v.id);
  }

  // ── Detail view ──
  if (detail) {
    return (
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <SecondaryBtn onClick={() => setDetailId(null)} style={{ marginBottom: 28 }}>
          ← Go back
        </SecondaryBtn>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <span style={{ fontSize: 13, color: C.txt3, fontFamily: C.sans }}>{detail.id}</span>
          <Pill label={STATUS_LABELS[detail.status]} color={STATUS_COLORS[detail.status]} />
          <span style={{ fontSize: 13, color: C.txt3, fontFamily: C.sans }}>
            Submitted {formatTimestamp(detail.created_at)}
          </span>
        </div>

        {detail.status === 'completed' && detail.final_report && detail.coi_extracted ? (
          <div>
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
              transcript={detail.call_transcript}
            />

            <SectionLabel>Submitted Documents</SectionLabel>
            <DocsLog docs={detail.docs} requirements={detail.requirements} />
          </div>
        ) : (
          <div>
            <Card style={{ borderColor: `color-mix(in oklch, ${C.error} 28%, transparent)` }}>
              <FieldLabel style={{ color: C.error }}>Verification error</FieldLabel>
              <p style={{ fontSize: 14, color: C.txt, fontFamily: C.sans, lineHeight: 1.65, margin: 0 }}>
                {detail.error_detail ?? 'This verification could not be completed. Our team has been notified.'}
              </p>
            </Card>

            <SectionLabel>Submitted Documents</SectionLabel>
            <DocsLog docs={detail.docs} requirements={detail.requirements} />
          </div>
        )}
      </div>
    );
  }

  // ── List view ──
  const pageRows = MY_VERIFICATIONS.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const columns: Column<MockVerification>[] = [
    {
      key: 'submitted', header: 'Submitted', width: '160px',
      render: v => <span style={{ color: C.txt2 }}>{formatTimestamp(v.created_at)}</span>,
    },
    {
      key: 'carrier', header: 'Carrier',
      render: v => <span style={{ fontWeight: 600 }}>{v.carrier_name}</span>,
    },
    {
      key: 'source', header: 'Source', width: '80px',
      render: v => <span style={{ color: C.txt3, textTransform: 'uppercase' as const, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>{v.source}</span>,
    },
    {
      key: 'status', header: 'Status', width: '120px',
      render: v => <Pill label={STATUS_LABELS[v.status]} color={STATUS_COLORS[v.status]} />,
    },
    {
      key: 'action', header: '', width: '100px',
      render: v => (
        <SecondaryBtn onClick={() => open(v)}>
          Details
        </SecondaryBtn>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <PageTitle subtitle="Every verification you've submitted, with live status.">
        Status
      </PageTitle>

      <Card style={{ padding: '12px 20px 20px' }}>
        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={v => v.id}
          onRowClick={open}
          emptyText="No verifications yet — submit one from the Upload page."
        />
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={MY_VERIFICATIONS.length}
          onPageChange={setPage}
        />
      </Card>

      <Modal open={!!etaModal} onClose={() => setEtaModal(null)}>
        {etaModal && (
          <div>
            <h3 style={{
              fontFamily: C.serif, fontSize: 22, fontWeight: 400,
              letterSpacing: '-0.02em', color: C.txt, margin: '0 0 20px',
            }}>
              Verification in progress
            </h3>
            <FieldLabel>Estimated availability</FieldLabel>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.txt, fontFamily: C.sans, margin: '0 0 24px' }}>
              {etaModal.eta ?? 'Within 1 business day'}
            </p>
            <SecondaryBtn onClick={() => setEtaModal(null)} style={{ width: '100%', padding: '10px 16px' }}>
              Close
            </SecondaryBtn>
          </div>
        )}
      </Modal>
    </div>
  );
}
