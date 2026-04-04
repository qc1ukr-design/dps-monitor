import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mobileAuth } from '@/lib/supabase/mobile'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/clients/[id] — client info + budget summary + KEP validity
// Supports both cookie auth (web) and Bearer token auth (mobile).
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  // Prefer Bearer token (mobile), fall back to cookie (web)
  let supabase: Awaited<ReturnType<typeof createClient>>
  let userId: string
  const authHeader = request.headers.get('authorization') ?? ''
  if (authHeader.startsWith('Bearer ')) {
    const { supabase: s, user } = await mobileAuth(request)
    if (!s || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    supabase = s
    userId = user.id
  } else {
    supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    userId = user.id
  }

  const [{ data: client, error }, { data: cacheRows }] = await Promise.all([
    supabase.from('clients').select('id, name, edrpou').eq('id', id).eq('user_id', userId).single(),
    supabase.from('dps_cache')
      .select('data_type, data, fetched_at')
      .eq('client_id', id)
      .eq('user_id', userId)
      .in('data_type', ['budget', 'archive_flag']),
  ])

  if (error || !client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const archiveRow = cacheRows?.find(r => r.data_type === 'archive_flag')
  const budgetRow  = cacheRows?.find(r => r.data_type === 'budget')

  const is_archived = (archiveRow?.data as { archived?: boolean } | null)?.archived ?? false

  // Compute debt/overpayment from budget calculations
  type BudgetRow = { debt?: number; overpayment?: number }
  type BudgetData = { calculations?: BudgetRow[] }
  const calculations = (budgetRow?.data as BudgetData | null)?.calculations ?? []
  const totalDebt = calculations.reduce((s, r) => s + (r.debt ?? 0), 0)
  const totalOverpayment = calculations.reduce((s, r) => s + (r.overpayment ?? 0), 0)

  return NextResponse.json({
    ...client,
    is_archived,
    debt:         totalDebt,
    overpayment:  totalOverpayment,
    lastSyncAt:   budgetRow?.fetched_at ?? null,
  })
}

// PATCH /api/clients/[id] — archive / unarchive (stored in dps_cache)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as Record<string, unknown>
  if (typeof body.is_archived !== 'boolean') {
    return NextResponse.json({ error: 'is_archived (boolean) required' }, { status: 400 })
  }

  // Verify client belongs to user
  const { data: client } = await supabase
    .from('clients').select('id').eq('id', id).eq('user_id', user.id).single()
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.is_archived) {
    // Archive: upsert flag in dps_cache
    const { error } = await supabase.from('dps_cache').upsert({
      client_id: id,
      user_id: user.id,
      data_type: 'archive_flag',
      data: { archived: true },
      fetched_at: new Date().toISOString(),
      is_mock: false,
    }, { onConflict: 'client_id,data_type' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Unarchive: remove the flag row
    const { error } = await supabase.from('dps_cache')
      .delete()
      .eq('client_id', id)
      .eq('user_id', user.id)
      .eq('data_type', 'archive_flag')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/clients/[id] — delete client and all related data
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
