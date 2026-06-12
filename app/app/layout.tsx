import type { Metadata } from 'next';
import { TopNav } from '@/components/ui/TopNav';

export const metadata: Metadata = {
  title: 'Fordra — App',
};

const NAV = [
  { label: 'Home',   href: '/app/home' },
  { label: 'Upload', href: '/app/upload' },
  { label: 'Logs', href: '/app/status' },
  { label: 'Docs',   href: '/app/docs' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <TopNav
        items={NAV}
        identity={{ name: 'Maya Chen', email: 'maya@atlasfreight.com', company: 'Atlas Freight Brokerage' }}
      />
      <main style={{ padding: '100px 24px 80px' }}>
        {children}
      </main>
    </div>
  );
}
