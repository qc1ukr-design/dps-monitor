/**
 * GET /api/alerts
 *
 * Returns all alerts for the authenticated user, newest first,
 * enriched with client name from the clients table.
 *
 * Used by the mobile app. Auth via Authorization: Bearer header.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mobileAuth } from '@/lib/supabase/mobile'

export async function GET(request: NextRequest) {
  const { supabase, user } = await mobileAuth(request)
  if (!supabase || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [{ data: alerts, error }, { data: clients }] = await Promise.all([
    supabase
      .from('alerts')
      .select('id, client_id, type, message, is_read, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('clients')
      .select('id, name')
      .eq('user_id', user.id),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const clientMap = new Map((clients ?? []).map(c => [c.id, c.name]))

  const result = (alerts ?? []).map(alert => ({
    id:          alert.id,
    client_id:   alert.client_id,
    client_name: clientMap.get(alert.client_id) ?? null,
    type:        alert.type,
    message:     alert.message,
    is_read:     alert.is_read,
    created_at:  alert.created_at,
  }))

  return NextResponse.json(result)
}
