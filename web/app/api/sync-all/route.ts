/**
 * GET /api/sync-all
 *
 * Returns the list of client IDs that have KEP configured and can be synced.
 * The client-side SyncAllButton calls each /api/clients/[id]/sync in parallel.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get all clients for this user
  const { data: clients } = await supabase
    .from('clients')
    .select('id')
    .eq('user_id', user.id)

  if (!clients?.length) return NextResponse.json({ clientIds: [] })

  // Find which clients have KEP configured
  const { data: tokens } = await supabase
    .from('api_tokens')
    .select('client_id')
    .eq('user_id', user.id)
    .not('kep_encrypted', 'is', null)

  const kepClientIds = new Set(tokens?.map(t => t.client_id) ?? [])
  const clientIds = clients
    .filter(c => kepClientIds.has(c.id))
    .map(c => c.id)

  return NextResponse.json({ clientIds })
}
