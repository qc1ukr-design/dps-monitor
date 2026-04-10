import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mobileAuth } from '@/lib/supabase/mobile'
import { createServiceClient } from '@/lib/supabase/service'

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

  const serviceSupabase = createServiceClient()

  const [{ data: client, error }, { data: cacheRows }, { data: kepRow }, { data: tokenRow }] = await Promise.all([
    supabase.from('clients').select('id, name, edrpou').eq('id', id).eq('user_id', userId).single(),
    supabase.from('dps_cache')
      .select('data_type, data, fetched_at')
      .eq('client_id', id)
      .eq('user_id', userId)
      .in('data_type', ['budget', 'archive_flag', 'profile']),
    // Use service client — kep_credentials RLS may block anon-key mobile clients
    // (ownership already verified by clients query above)
    serviceSupabase.from('kep_credentials')
      .select('valid_to, owner_name, client_name')
      .eq('client_id', id)
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
    supabase.from('api_tokens')
      .select('kep_owner_name, kep_valid_to')
      .eq('client_id', id)
      .eq('user_id', userId)
      .not('kep_encrypted', 'is', null)
      .maybeSingle(),
  ])

  if (error || !client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const archiveRow = cacheRows?.find(r => r.data_type === 'archive_flag')
  const budgetRow  = cacheRows?.find(r => r.data_type === 'budget')
  const profileRow = cacheRows?.find(r => r.data_type === 'profile')

  const is_archived = (archiveRow?.data as { archived?: boolean } | null)?.archived ?? false

  // Compute debt/overpayment from budget calculations
  type BudgetRow = { debt?: number; overpayment?: number }
  type BudgetData = { calculations?: BudgetRow[] }
  const calculations = (budgetRow?.data as BudgetData | null)?.calculations ?? []
  const totalDebt = calculations.reduce((s, r) => s + (r.debt ?? 0), 0)
  const totalOverpayment = calculations.reduce((s, r) => s + (r.overpayment ?? 0), 0)

  type ProfileData = {
    name?: string; rnokpp?: string; status?: string
    registrationDate?: string; taxAuthority?: string
    accountingType?: string; address?: string
    kvedList?: Array<{ code: string; name: string; isPrimary?: boolean }>
  }
  const profile = profileRow?.data as ProfileData | null

  return NextResponse.json({
    ...client,
    is_archived,
    debt:             totalDebt,
    overpayment:      totalOverpayment,
    lastSyncAt:       budgetRow?.fetched_at ?? null,
    kepValidTo:       kepRow?.valid_to ?? tokenRow?.kep_valid_to ?? null,
    director:         kepRow?.owner_name ?? (kepRow as { client_name?: string } | null)?.client_name ?? tokenRow?.kep_owner_name ?? null,
    rnokpp:           profile?.rnokpp ?? null,
    taxStatus:        profile?.status ?? null,
    registrationDate: profile?.registrationDate ?? null,
    taxAuthority:     profile?.taxAuthority ?? null,
    accountingType:   profile?.accountingType ?? null,
    address:          profile?.address ?? null,
    kvedList:         profile?.kvedList ?? null,
    vatNumber:        profile?.vatNumber ?? null,
  })
}

// PATCH /api/clients/[id] — archive / unarchive, or update tax_system
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as Record<string, unknown>

  const hasArchived  = 'is_archived'  in body
  const hasTaxSystem = 'tax_system'   in body

  if (!hasArchived && !hasTaxSystem) {
    return NextResponse.json({ error: 'is_archived or tax_system required' }, { status: 400 })
  }

  if (hasArchived && typeof body.is_archived !== 'boolean') {
    return NextResponse.json({ error: 'is_archived must be boolean' }, { status: 400 })
  }

  if (hasTaxSystem && body.tax_system !== 'simplified' && body.tax_system !== 'general') {
    return NextResponse.json({ error: 'tax_system must be "simplified" or "general"' }, { status: 400 })
  }

  // Verify client belongs to user
  const { data: client } = await supabase
    .from('clients').select('id').eq('id', id).eq('user_id', user.id).single()
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (hasTaxSystem) {
    const { error } = await supabase
      .from('clients')
      .update({ tax_system: body.tax_system as 'simplified' | 'general' })
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (hasArchived) {
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
