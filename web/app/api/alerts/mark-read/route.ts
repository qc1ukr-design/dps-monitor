/**
 * POST /api/alerts/mark-read
 * Marks alerts as read for the current user.
 * Optional query param: ?client_id=<uuid> — marks only that client's alerts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mobileAuth } from '@/lib/supabase/mobile'

export async function POST(request: NextRequest) {
  const { supabase, user } = await mobileAuth(request)
  if (!supabase || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let clientId: string | null = request.nextUrl.searchParams.get('client_id')
  if (!clientId) {
    try {
      const body = await request.json()
      clientId = body?.client_id ?? null
    } catch {
      // no body — mark all
    }
  }

  let query = supabase
    .from('alerts')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false)

  if (clientId) {
    query = query.eq('client_id', clientId)
  }

  const { error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
