/**
 * ADMIN_EMAIL holds one or more comma-separated admin emails.
 * Dependency-free so proxy.ts (middleware runtime) can import it too.
 * An unset/empty value means nobody is admin, never everybody.
 */
export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAIL ?? '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isAdminEmail(email: string | undefined | null): boolean {
  return !!email && adminEmails().has(email.toLowerCase())
}
