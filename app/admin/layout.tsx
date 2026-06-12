import type { Metadata } from 'next';
import { Sidebar } from '@/components/ui/Sidebar';

export const metadata: Metadata = {
  title: 'Fordra — Admin',
};

const NAV = [
  { label: 'Dashboard',     href: '/admin/dashboard' },
  { label: 'Verifications', href: '/admin/verifications' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Sidebar items={NAV} tag="Admin" />
      <main style={{ marginLeft: 232, padding: '48px 48px 80px' }}>
        {children}
      </main>
    </div>
  );
}
