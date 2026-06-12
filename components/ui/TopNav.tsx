'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { C } from './tokens';
import type { NavItem } from './Sidebar';

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <Link
      href={item.href}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontSize: 13, fontWeight: 600, fontFamily: C.sans,
        padding: '6px 14px', borderRadius: 9999,
        background: active ? C.txt : hov ? `color-mix(in oklch, ${C.txt} 7%, transparent)` : 'transparent',
        color: active ? C.surface : hov ? C.txt : C.txt2,
        textDecoration: 'none',
        transition: 'all 120ms',
      }}
    >
      {item.label}
    </Link>
  );
}

export function TopNav({ items, tag, identity }: {
  items: NavItem[];
  tag: string;
  identity: { name: string; email: string; company: string };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [iconHov, setIconHov] = useState(false);
  const [logoutHov, setLogoutHov] = useState(false);

  const initials = identity.name
    .split(/\s+/)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <>
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60,
        height: 60, padding: '0 32px',
        display: 'flex', alignItems: 'center', gap: 28,
        background: C.paper, borderBottom: `1px solid ${C.border}`,
        boxSizing: 'border-box' as const,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexShrink: 0 }}>
          <span style={{
            fontFamily: C.serif, fontSize: 22, fontWeight: 400,
            letterSpacing: '-0.5px', color: C.txt, lineHeight: 1,
          }}>
            Fordra
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase' as const, color: C.accent, fontFamily: C.sans,
          }}>
            {tag}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {items.map(item => (
            <NavLink
              key={item.href}
              item={item}
              active={pathname === item.href || pathname.startsWith(item.href + '/')}
            />
          ))}
        </div>

        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            onMouseEnter={() => setIconHov(true)}
            onMouseLeave={() => setIconHov(false)}
            aria-label="Profile menu"
            style={{
              width: 34, height: 34, borderRadius: '50%',
              border: `1.5px solid ${menuOpen || iconHov ? C.accent : C.border}`,
              background: menuOpen ? `color-mix(in oklch, ${C.accent} 12%, transparent)` : C.surface,
              color: menuOpen || iconHov ? C.accent : C.txt2,
              fontSize: 12, fontWeight: 700, fontFamily: C.sans,
              cursor: 'pointer', lineHeight: 1,
              transition: 'all 120ms',
            }}
          >
            {initials}
          </button>

          {menuOpen && (
            <div style={{
              position: 'absolute', top: 44, right: 0,
              width: 240,
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              boxShadow: '0 12px 40px oklch(0% 0 0 / 0.10)',
              padding: '18px 20px 16px',
            }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: C.txt, fontFamily: C.sans, margin: 0 }}>
                {identity.name}
              </p>
              <p style={{ fontSize: 12.5, color: C.txt2, fontFamily: C.sans, margin: '3px 0 0' }}>
                {identity.email}
              </p>
              <p style={{ fontSize: 12, color: C.txt3, fontFamily: C.sans, margin: '2px 0 14px' }}>
                {identity.company}
              </p>
              <button
                onClick={() => router.push('/')}
                onMouseEnter={() => setLogoutHov(true)}
                onMouseLeave={() => setLogoutHov(false)}
                style={{
                  width: '100%', padding: '9px 14px',
                  fontSize: 13, fontWeight: 600, fontFamily: C.sans,
                  borderRadius: 6, border: `1px solid ${C.border}`,
                  background: logoutHov ? C.surfaceHover : 'transparent',
                  color: C.txt2, cursor: 'pointer',
                  transition: 'background 110ms',
                }}
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </nav>

      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 55 }}
        />
      )}
    </>
  );
}
