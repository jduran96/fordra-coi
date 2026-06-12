import type { Metadata } from 'next';
import { Sidebar } from '@/components/ui/Sidebar';

export const metadata: Metadata = {
  title: 'Fordra — App',
};

const NAV = [
  { label: 'Home',   href: '/app/home' },
  { label: 'Upload', href: '/app/upload' },
  { label: 'Status', href: '/app/status' },
  { label: 'Docs',   href: '/app/docs' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Sidebar
        items={NAV}
        tag="Control Center"
        identity={{ name: 'Maya Chen', company: 'Atlas Freight Brokerage' }}
      />
      <main style={{ marginLeft: 232, padding: '48px 48px 80px' }}>
        {children}
      </main>
    </div>
  );
}
