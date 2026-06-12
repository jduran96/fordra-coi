'use client';

import Link from 'next/link';
import { C } from '@/components/ui/tokens';
import { Card, PageTitle, FieldLabel, Pill } from '@/components/ui/primitives';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { MY_VERIFICATIONS, MOCK_ACTIVITY, deriveAppStats, formatTimestamp, STATUS_LABELS, type MockStatus } from '@/lib/mock';

const STATUS_COLORS: Record<MockStatus, string> = {
  completed: C.success,
  pending: C.accent,
  error: C.error,
};

export default function AppHomePage() {
  const stats = deriveAppStats(MY_VERIFICATIONS);

  return (
    <div style={{ maxWidth: 760 }}>
      <PageTitle subtitle="Your verification activity at a glance.">
        Overview
      </PageTitle>

      <StatGrid columns={3}>
        <StatCard value={stats.total} label="Requests" sub="All time" />
        <StatCard value={stats.inProgress} label="In progress" color={stats.inProgress > 0 ? C.accent : undefined} />
        <StatCard value={stats.completed} label="Completed" color={C.success} />
      </StatGrid>
      <StatGrid columns={2}>
        <StatCard value={stats.spend} label="Est. spend" sub="This billing period" />
        <StatCard value={`${stats.avgTurnaroundHrs}h`} label="Avg turnaround" sub="Submission to final report" />
      </StatGrid>

      <Card style={{ marginTop: 32 }}>
        <FieldLabel>Recent activity</FieldLabel>
        <div>
          {MOCK_ACTIVITY.map((a, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '13px 0',
              borderBottom: i < MOCK_ACTIVITY.length - 1 ? `1px solid ${C.border}` : 'none',
            }}>
              <span style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, minWidth: 96, flexShrink: 0 }}>
                {formatTimestamp(a.ts)}
              </span>
              <span style={{ fontSize: 13, color: C.txt, fontFamily: C.sans, flex: 1, lineHeight: 1.5 }}>
                {a.text}
              </span>
              <Pill label={STATUS_LABELS[a.status]} color={STATUS_COLORS[a.status]} />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <Link href="/app/status" style={{
            fontSize: 13, fontWeight: 600, fontFamily: C.sans,
            color: C.txt2, textDecoration: 'none',
          }}>
            View all verifications →
          </Link>
        </div>
      </Card>
    </div>
  );
}
