import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'

async function tryFetch(url: string, authHeader: string) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    const text = await res.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = text.substring(0, 200) }
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
  const year = new Date().getFullYear()
  const base = 'https://cabinet.tax.gov.ua/ws/a'

  const [profile, budget, profileOld] = await Promise.all([
    tryFetch(`${base}/payer/payer_card`, `Bearer ${token}`),
    tryFetch(`${base}/ta/splatp/sti?year=${year}`, `Bearer ${token}`),
    tryFetch(`https://cabinet.tax.gov.ua/ws/public_api/payer_card`, `Bearer ${token}`),
  ])

  return NextResponse.json({
    tokenPreview,
    tokenLength: token.length,
    tests: {
      'ws/a/payer/payer_card (Bearer)': profile,
      'ws/a/ta/splatp/sti (Bearer)': budget,
      'ws/public_api/payer_card (Bearer, old)': profileOld,
    }
  })
}
