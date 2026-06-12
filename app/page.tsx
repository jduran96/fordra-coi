'use client';

import { useState } from 'react';
import Link from 'next/link';

const C = {
  paper:  'oklch(98.5% 0.004 80)',
  surface:'oklch(100% 0 0)',
  border: 'oklch(88% 0.008 80)',
  borderStrong: 'oklch(76% 0.010 80)',
  txt:    'oklch(13% 0.008 265)',
  txt2:   'oklch(46% 0.012 265)',
  txt3:   'oklch(68% 0.008 265)',
  earthy: 'oklch(52% 0.17 38)',
  serif:  "'DM Serif Display', Georgia, serif",
  sans:   "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
};

function PathCard({
  href, title, description,
}: {
  href: string; title: string; description: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'block',
        flex: 1,
        background: C.surface,
        border: `1px solid ${hover ? C.borderStrong : C.border}`,
        borderRadius: 12,
        padding: '32px 28px',
        textDecoration: 'none',
        transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
        transform: hover ? 'translateY(-2px)' : 'none',
        boxShadow: hover ? '0 6px 24px oklch(0% 0 0 / 0.06)' : 'none',
      }}
    >
      <p style={{
        fontFamily: C.serif,
        fontSize: 24,
        fontWeight: 400,
        letterSpacing: '-0.3px',
        color: C.txt,
        margin: '0 0 8px',
      }}>
        {title}
      </p>
      <p style={{
        fontFamily: C.sans,
        fontSize: 13.5,
        lineHeight: 1.5,
        color: C.txt2,
        margin: 0,
      }}>
        {description}
      </p>
      <p style={{
        fontFamily: C.sans,
        fontSize: 13,
        fontWeight: 600,
        color: hover ? C.earthy : C.txt3,
        margin: '18px 0 0',
        transition: 'color 0.15s',
      }}>
        Enter →
      </p>
    </Link>
  );
}

export default function PathSelectorPage() {
  const [adminHover, setAdminHover] = useState(false);
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: C.paper,
      padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 640 }}>
        <h1 style={{
          fontFamily: C.serif,
          fontSize: 44,
          fontWeight: 400,
          letterSpacing: '-1px',
          color: C.txt,
          margin: '0 0 8px',
          textAlign: 'center',
        }}>
          Fordra
        </h1>
        <p style={{
          fontFamily: C.sans,
          fontSize: 15,
          color: C.txt2,
          margin: '0 0 40px',
          textAlign: 'center',
        }}>
          Insurance verification, handled.
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <PathCard
            href="/demo"
            title="Demo"
            description="Walk through a live certificate of insurance verification end to end."
          />
          <PathCard
            href="/app"
            title="App"
            description="Control center for submitting and tracking verifications."
          />
        </div>

        <div style={{ textAlign: 'center', marginTop: 28 }}>
          <Link
            href="/admin"
            onMouseEnter={() => setAdminHover(true)}
            onMouseLeave={() => setAdminHover(false)}
            style={{
              fontFamily: C.sans,
              fontSize: 12,
              color: adminHover ? C.txt2 : C.txt3,
              textDecoration: adminHover ? 'underline' : 'none',
              transition: 'color 0.15s',
            }}
          >
            Admin →
          </Link>
        </div>
      </div>
    </div>
  );
}
