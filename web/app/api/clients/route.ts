/**
 * GET /api/clients
 *
 * Returns all clients for the authenticated user, enriched with
 * the latest budget data (debt, overpayment, status) from dps_cache.
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

  const [{ data: clients, error }, { data: budgets }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name, edrpou')
      .eq('user_id', user.id)
      .order('name'),
    supabase
      .from('dps_cache')
      .select('client_id, data')
      .eq('user_id', user.id)
      .eq('data_type', 'budget'),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Map budget data by client_id for O(1) lookup
  const budgetMap = new Map(
    (budgets ?? []).map(row => [row.client_id, row.data as Record<string, unknown>])
  )

  const result = (clients ?? []).map(client => {
    const budget = budgetMap.get(client.id)
    return {
      id:           client.id,
      name:         client.name,
      edrpou:       client.edrpou,
      debt:         (budget?.totalDebt as number | undefined) ?? 0,
      overpayment:  (budget?.totalOverpayment as number | undefined) ?? 0,
      status:       (budget?.status as string | undefined) ?? null,
    }
  })

  return NextResponse.json(result)
}
