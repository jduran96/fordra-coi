import { NextResponse } from 'next/server'

// Auth is disabled for the UI-scaffold iteration. Re-enable per-path auth here
// (e.g. gate /app and /admin with separate session checks) when backend wiring
// lands. The old single-password HMAC gate lives in git history and lib/auth.ts.
export async function proxy() {
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
