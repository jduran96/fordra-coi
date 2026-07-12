/** The Fordra mark (same art as app/icon.svg), for pairing with the wordmark. */
export default function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <rect width="120" height="120" rx="24" fill="#141413" />
      <rect x="28" y="22" width="22" height="76" fill="#faf9f5" />
      <rect x="54" y="22" width="40" height="22" fill="#faf9f5" />
      <rect x="54" y="50" width="26" height="20" fill="#d4fd8e" />
    </svg>
  )
}
