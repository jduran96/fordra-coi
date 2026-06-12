'use client';

import { C } from '@/components/ui/tokens';
import { Card, FieldLabel, PageTitle } from '@/components/ui/primitives';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MOCK_VERIFICATIONS, MOCK_USERS, deriveAdminStats, formatTimestamp, type MockUser } from '@/lib/mock';

export default function AdminDashboardPage() {
  const stats = deriveAdminStats(MOCK_VERIFICATIONS);

  const userColumns: Column<MockUser>[] = [
    {
      key: 'name', header: 'Name',
      render: u => <span style={{ fontWeight: 600 }}>{u.name}</span>,
    },
    {
      key: 'company', header: 'Company',
      render: u => <span style={{ color: C.txt2 }}>{u.company}</span>,
    },
    {
      key: 'email', header: 'Email',
      render: u => <span style={{ color: C.txt2 }}>{u.email}</span>,
    },
    {
      key: 'last_sign_in', header: 'Last sign-in', width: '150px',
      render: u => <span style={{ color: C.txt2 }}>{formatTimestamp(u.last_sign_in)}</span>,
    },
    {
      key: 'count', header: 'Verifications', width: '110px',
      render: u => <span style={{ fontWeight: 600 }}>{u.verification_count}</span>,
    },
  ];

  return (
    <div style={{ maxWidth: 920 }}>
      <PageTitle subtitle="Pilot health across all design partners.">
        Dashboard
      </PageTitle>

      <StatGrid columns={3}>
        <StatCard value={stats.pending} label="Pending verifications" sub="Awaiting admin completion" color={stats.pending > 0 ? C.accent : undefined} />
        <StatCard value={stats.lastWeek} label="Requests last 7 days" />
        <StatCard value={`${stats.completionRate}%`} label="Completion rate" sub="All time" color={C.success} />
      </StatGrid>
      <StatGrid columns={3}>
        <StatCard value={`${stats.avgTurnaroundHrs}h`} label="Avg turnaround" sub="Submission to final report" />
        <StatCard value={stats.errors} label="Errors" sub="Last 30 days" color={stats.errors > 0 ? C.error : undefined} />
        <StatCard value={`${stats.apiCount} / ${stats.webCount}`} label="API / Web split" sub="By request source" />
      </StatGrid>

      <Card style={{ marginTop: 32, padding: '24px 28px' }}>
        <FieldLabel>Users</FieldLabel>
        <DataTable
          columns={userColumns}
          rows={MOCK_USERS}
          rowKey={u => u.id}
        />
      </Card>
    </div>
  );
}
