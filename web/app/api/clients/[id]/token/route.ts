/**
 * POST /api/clients/[id]/token   — save UUID token from DPS "Відкриті дані"
 * GET  /api/clients/[id]/token   — check if token is configured (no value returned)
 * DELETE /api/clients/[id]/token — remove token
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('api_tokens')
    .select('token_encrypted')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({ configured: !!data?.token_encrypted })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const body = await request.json() as { token: string }
  const rawToken = body.token?.trim()
  if (!rawToken) return NextResponse.json({ error: 'token is required' }, { status: 400 })

  // Basic UUID-like format check (DPS tokens are UUID v4)
  if (!/^[0-9a-f-]{20,}$/i.test(rawToken)) {
    return NextResponse.json({ error: 'Невірний формат токена. Скопіюйте токен з розділу «Відкриті дані» кабінету ДПС.' }, { status: 400 })
  }

  const tokenEncrypted = encrypt(rawToken)

  const { data: existing } = await supabase
    .from('api_tokens')
    .select('id')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .single()

  const tokenFields = {
    token_encrypted: tokenEncrypted,
    updated_at: new Date().toISOString(),
  }

  const { error } = existing
    ? await supabase.from('api_tokens').update(tokenFields).eq('client_id', id).eq('user_id', user.id)
    : await supabase.from('api_tokens').insert({ client_id: id, user_id: user.id, ...tokenFields })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('api_tokens')
    .update({ token_encrypted: null, updated_at: new Date().toISOString() })
    .eq('client_id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
