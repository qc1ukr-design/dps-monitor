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

  // Try documents_full first (rich data), fall back to documents (IDs only)
  const { data: fullCache, error } = await supabase
    .from('dps_cache')
    .select('data, fetched_at')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .eq('data_type', 'documents_full')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type DocItem = { id?: string; cdoc?: string; name?: string; date?: string; csti?: string; text?: string }
  type DocsCache = { documents?: DocItem[]; total?: number }

  if (fullCache?.data) {
    const cached = fullCache.data as DocsCache
    const docs = (cached.documents ?? []).map((d, i) => ({
      id:   d.id   ?? String(i),
      cdoc: d.cdoc ?? '',
      name: d.name ?? d.cdoc ?? 'Документ',
      date: d.date ?? fullCache.fetched_at ?? new Date().toISOString(),
      csti: d.csti,
      text: d.text,
    }))
    return NextResponse.json(docs)
  }

  // Fallback: IDs-only cache
  const { data: idCache } = await supabase
    .from('dps_cache')
    .select('data, fetched_at')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .eq('data_type', 'documents')
    .maybeSingle()

  const ids = (idCache?.data as { ids?: string[] } | null)?.ids ?? []
  const documents = ids.map((docId: string) => ({
    id:   docId,
    cdoc: '',
    name: `Документ ${docId}`,
    date: idCache?.fetched_at ?? new Date().toISOString(),
  }))

  return NextResponse.json(documents)
}
