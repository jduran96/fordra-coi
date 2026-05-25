import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fordra — COI Verification',
  description: 'Insurance verification, handled.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body style={{
        background: 'oklch(98.5% 0.004 80)',
        color: 'oklch(13% 0.008 265)',
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        margin: 0,
      }}>
        {children}
      </body>
    </html>
  );
}
