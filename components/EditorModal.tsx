'use client'

import { useEffect } from 'react'
import { C } from '@/lib/theme'

/**
 * Centered overlay dialog for the standards editors (app + admin settings).
 * Matches the admin console modals (CreateOrgModal etc.): dimmed blurred
 * backdrop, Escape or backdrop click to close, wide enough for the
 * requirements grid.
 */
export default function EditorModal({ title, onClose, children }: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{
      position: 'fixed', inset: 0, background: 'rgba(20,20,19,0.45)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24,
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28,
        width: '100%', maxWidth: 880, maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(20,20,19,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontFamily: C.serif, fontSize: 22, fontWeight: 400, color: C.txt, margin: 0 }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: C.paper, border: 'none', color: C.txt3, fontSize: 20, cursor: 'pointer',
            borderRadius: 9999, lineHeight: 1,
          }}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
