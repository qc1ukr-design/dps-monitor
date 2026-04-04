/**
 * GET /api/clients/[id]/documents
 *
 * Returns the cached list of incoming DPS documents for a client.
 * Data comes from dps_cache (data_type = 'documents'), which is populated
 * by the daily cron. Full document details (name, text) require a live DPS
 * fetch via KEP — that is handled by the sync flow.
 *
 * Used by the mobile app. Auth via Authorization: Bearer header.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mobileAuth } from '@/lib/supabase/mobile'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const { supabase, user } = await mobileAuth(request)
  if (!supabase || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify client belongs to this user
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Return cached document IDs from dps_cache
  const { data: cacheRow, error } = await supabase
    .from('dps_cache')
    .select('data, fetched_at')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .eq('data_type', 'documents')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const cached = cacheRow?.data as { ids?: string[] } | null
  const ids = cached?.ids ?? []

  // Return lightweight document stubs from cached IDs
  const documents = ids.map((docId: string) => ({
    id:       docId,
    cdoc:     '',
    name:     `Документ ${docId}`,
    date:     cacheRow?.fetched_at ?? new Date().toISOString(),
  }))

  return NextResponse.json(documents)
}
