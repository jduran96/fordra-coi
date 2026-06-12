'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { C } from './tokens';

export interface NavItem {
  label: string;
  href: string;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <Link
      href={item.href}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'block',
        position: 'relative',
        padding: '10px 14px',
        borderRadius: 8,
        fontSize: 13.5,
        fontWeight: 500,
        fontFamily: C.sans,
        color: active ? C.txt : C.txt2,
        background: active
          ? `color-mix(in oklch, ${C.txt} 8%, transparent)`
          : hov ? C.surfaceHover : 'transparent',
        textDecoration: 'none',
        transition: 'background 120ms, color 120ms',
      }}
    >
      {active && (
        <span style={{
          position: 'absolute', left: 0, top: 8, bottom: 8,
          width: 2, borderRadius: 2, background: C.accent,
        }} />
      )}
      {item.label}
    </Link>
  );
}

export function Sidebar({ items, tag, identity }: {
  items: NavItem[];
  tag: string;
  identity?: { name: string; company: string };
}) {
  const pathname = usePathname();
  const [backHov, setBackHov] = useState(false);

  return (
    <aside style={{
      position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
      width: 232, boxSizing: 'border-box' as const,
      background: C.paper,
      borderRight: `1px solid ${C.border}`,
      padding: '28px 20px',
      display: 'flex', flexDirection: 'column' as const,
    }}>
      <div style={{ padding: '0 8px', marginBottom: 32 }}>
        <p style={{
          fontFamily: C.serif, fontSize: 26, fontWeight: 400,
          letterSpacing: '-0.5px', color: C.txt, margin: 0, lineHeight: 1,
        }}>
          Fordra
        </p>
        <p style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase' as const, color: C.accent,
          fontFamily: C.sans, margin: '7px 0 0',
        }}>
          {tag}
        </p>
      </div>

      <p style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase' as const, color: C.txt3,
        fontFamily: C.sans, margin: '0 0 8px', padding: '0 8px',
      }}>
        Menu
      </p>
      <nav style={{ display: 'flex', flexDirection: 'column' as const, gap: 2 }}>
        {items.map(item => (
          <NavLink
            key={item.href}
            item={item}
            active={pathname === item.href || pathname.startsWith(item.href + '/')}
          />
        ))}
      </nav>

      <div style={{ marginTop: 'auto', padding: '0 8px' }}>
        {identity && (
          <div style={{
            paddingBottom: 16, marginBottom: 16,
            borderBottom: `1px solid ${C.border}`,
          }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, fontFamily: C.sans, margin: 0 }}>
              {identity.name}
            </p>
            <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, margin: '2px 0 0' }}>
              {identity.company}
            </p>
          </div>
        )}
        <Link
          href="/"
          onMouseEnter={() => setBackHov(true)}
          onMouseLeave={() => setBackHov(false)}
          style={{
            fontSize: 12, fontFamily: C.sans,
            color: backHov ? C.txt2 : C.txt3,
            textDecoration: 'none', transition: 'color 120ms',
          }}
        >
          ← Back to paths
        </Link>
      </div>
    </aside>
  );
}
