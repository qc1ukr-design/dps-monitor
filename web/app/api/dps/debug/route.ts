import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'

async function tryFetch(url: string, opts: RequestInit) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000), cache: 'no-store' })
    let body: unknown
    try { body = await res.json() } catch { body = await res.text() }
    return { status: res.status, ok: res.ok, body }
  } catch (e) {
    return { error: String(e) }
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('token_encrypted')
    .eq('client_id', clientId)
    .eq('user_id', user.id)
    .single()

  if (!tokenRow?.token_encrypted) return NextResponse.json({ error: 'Token not found' })

  let token: string
  try { token = decrypt(tokenRow.token_encrypted).trim() }
  catch (e) { return NextResponse.json({ error: 'Decrypt failed', detail: String(e) }) }

  const tokenPreview = token.substring(0, 8) + '...' + token.substring(token.length - 4)
  const headers = { Authorization: token, Accept: 'application/json', 'Content-Type': 'application/json' }
  const year = new Date().getFullYear()

  const results = await Promise.all([
    // 1. Стандартний ws/public_api
    tryFetch(`https://cabinet.tax.gov.ua/ws/public_api/payer_card`, { method: 'GET', headers }),
    // 2. Токен як query parameter
    tryFetch(`https://cabinet.tax.gov.ua/ws/public_api/payer_card?token=${token}`, { method: 'GET', headers: { Accept: 'application/json' } }),
    // 3. POST з токеном у body (auth exchange)
    tryFetch(`https://cabinet.tax.gov.ua/ws/public_api/auth`, { method: 'POST', headers, body: JSON.stringify({ token }) }),
    // 4. Альтернативний /api/ шлях
    tryFetch(`https://cabinet.tax.gov.ua/api/0/pub/payer_card`, { method: 'GET', headers }),
    // 5. Budget з trimmed токеном
    tryFetch(`https://cabinet.tax.gov.ua/ws/public_api/ta/splatp?year=${year}`, { method: 'GET', headers }),
  ])

  return NextResponse.json({
    tokenPreview,
    tokenLength: token.length,
    tests: {
      'ws/public_api/payer_card (Authorization header)': results[0],
      'ws/public_api/payer_card?token=... (query param)': results[1],
      'ws/public_api/auth POST (token exchange)': results[2],
      'api/0/pub/payer_card': results[3],
      'ws/public_api/ta/splatp (budget)': results[4],
    }
  })
}
