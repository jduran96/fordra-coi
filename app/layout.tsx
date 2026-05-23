import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Fordra — COI Verification',
  description: 'Insurance verification, handled.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.className} h-full antialiased`}>
      <body className="min-h-screen" style={{ background: '#0a0a0a', color: '#fff' }}>
        {children}
      </body>
    </html>
  );
}
