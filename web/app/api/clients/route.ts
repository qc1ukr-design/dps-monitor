import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto'

// GET /api/clients — список контрагентів
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('clients')
    .select('id, name, edrpou, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/clients — додати контрагента
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, edrpou, dpsToken } = body as {
    name: string
    edrpou?: string
    dpsToken: string
  }

  if (!name || !dpsToken) {
    return NextResponse.json({ error: 'name and dpsToken are required' }, { status: 400 })
  }

  // Створюємо клієнта
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .insert({ user_id: user.id, name, edrpou: edrpou || null })
    .select('id')
    .single()

  if (clientError || !client) {
    return NextResponse.json({ error: clientError?.message || 'Failed to create client' }, { status: 500 })
  }

  // Шифруємо і зберігаємо токен ДПС
  const tokenEncrypted = encrypt(dpsToken)
  const { error: tokenError } = await supabase
    .from('api_tokens')
    .insert({ client_id: client.id, user_id: user.id, token_encrypted: tokenEncrypted })

  if (tokenError) {
    // Відкочуємо — видаляємо клієнта
    await supabase.from('clients').delete().eq('id', client.id)
    return NextResponse.json({ error: tokenError.message }, { status: 500 })
  }

  return NextResponse.json({ id: client.id }, { status: 201 })
}
