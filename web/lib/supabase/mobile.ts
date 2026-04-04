/**
 * Supabase client factory for mobile API routes.
 *
 * Mobile clients send JWT via Authorization: Bearer header (not cookies).
 * This helper creates a client that authenticates via the Bearer token so
 * RLS policies are enforced correctly for the requesting user.
 */
import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'

export function createMobileClient(accessToken: string) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      cookies: { getAll: () => [], setAll: () => {} },
    }
  )
}

/** Extract Bearer token from request and return authenticated Supabase client + user. */
export async function mobileAuth(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return { supabase: null, user: null }

  const supabase = createMobileClient(token)
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { supabase: null, user: null }

  return { supabase, user }
}
