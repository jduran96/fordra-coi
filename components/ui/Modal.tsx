'use client';

import { C } from './tokens';

export function Modal({ open, onClose, children, maxWidth = 420 }: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'oklch(13% 0.008 265 / 0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '28px 32px',
          boxShadow: '0 12px 48px oklch(0% 0 0 / 0.12)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
