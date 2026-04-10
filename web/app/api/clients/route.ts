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

  const [{ data: clients, error }, { data: budgets }, { data: syncTimes }] = await Promise.all([
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
    supabase
      .from('dps_cache')
      .select('fetched_at')
      .eq('user_id', user.id)
      .eq('data_type', 'budget')
      .order('fetched_at', { ascending: false })
      .limit(1),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Map budget data by client_id for O(1) lookup
  type BudgetRow = { debt?: number; overpayment?: number }
  type BudgetData = { calculations?: BudgetRow[] }
  const budgetMap = new Map(
    (budgets ?? []).map(row => [row.client_id, row.data as BudgetData | null])
  )

  const result = (clients ?? []).map(client => {
    const budget = budgetMap.get(client.id)
    const calculations = budget?.calculations ?? []
    const totalDebt = calculations.reduce((s, r) => s + (r.debt ?? 0), 0)
    const totalOverpayment = calculations.reduce((s, r) => s + (r.overpayment ?? 0), 0)
    return {
      id:           client.id,
      name:         client.name,
      edrpou:       client.edrpou,
      debt:         totalDebt,
      overpayment:  totalOverpayment,
      status:       null,
    }
  })

  const lastSyncAt = syncTimes?.[0]?.fetched_at ?? null
  return NextResponse.json({ clients: result, lastSyncAt })
}
