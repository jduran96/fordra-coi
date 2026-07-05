'use client'

import { useFormStatus } from 'react-dom'

/**
 * Submit button for server-action forms with a built-in pending state.
 * While the action runs it disables itself and shows a spinner + pendingLabel;
 * when the action finishes, Next re-renders the page with fresh data, so the
 * new state appears without a manual refresh.
 */
export default function PendingButton({
  children,
  pendingLabel,
  style,
  name,
  value,
}: {
  children: React.ReactNode
  pendingLabel: string
  style?: React.CSSProperties
  name?: string
  value?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      style={{ ...style, opacity: pending ? 0.65 : 1, cursor: pending ? 'wait' : style?.cursor ?? 'pointer' }}
    >
      {pending ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span aria-hidden style={{
            width: 12, height: 12, borderRadius: '50%',
            border: '2px solid currentColor', borderTopColor: 'transparent',
            display: 'inline-block', animation: 'fordra-spin 0.7s linear infinite',
          }} />
          {pendingLabel}
        </span>
      ) : children}
    </button>
  )
}
