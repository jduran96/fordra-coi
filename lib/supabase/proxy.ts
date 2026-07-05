import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Refreshes the Supabase auth session inside the proxy (Next 16 middleware) and
 * returns the authenticated user. The returned `response` carries any refreshed
 * auth cookies and MUST be returned from the proxy when continuing the request.
 *
 * Pattern per @supabase/ssr; adapted to Next 16's proxy.ts convention.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getUser() revalidates the JWT with Supabase — do not trust getSession() in the proxy.
  const { data: { user } } = await supabase.auth.getUser()

  return { response, user }
}
