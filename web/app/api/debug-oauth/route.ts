/**
 * Temporary debug endpoint — tests DPS OAuth with a client's real KEP.
 * Uses the FIXED static DPS OAuth client_id found in the Angular bundle.
 * Protected by CRON_SECRET. DELETE after debugging is done.
 *
 * Usage (open in browser while logged in):
 *   /api/debug-oauth?secret=SECRET&clientId=UUID
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { signWithKepDecrypted } from '@/lib/dps/signer'

const DPS_OAUTH_URL = 'https://cabinet.tax.gov.ua/ws/auth/oauth/token'

// Fixed static client credential from cabinet Angular bundle (ne.oauth.clientBase64)
// Decoded: AE6867664C096C83E0530101007F45F4:AE6867664C096C83E0530101007F45F4
const DPS_CLIENT_BASIC = 'QUU2ODY3NjY0QzA5NkM4M0UwNTMwMTAxMDA3RjQ1RjQ6QUU2ODY3NjY0QzA5NkM4M0UwNTMwMTAxMDA3RjQ1RjQ='

async function tryOAuth(opts: {
  label: string
  username: string
  signData: string
  kepDecrypted: string
  kepPass: string
  useQueryString: boolean
}): Promise<{ label: string; status: number; body: string; sigLen: number; sigPrefix: string }> {
  const sig = await signWithKepDecrypted(opts.kepDecrypted, opts.kepPass, opts.signData)
  const qs = `grant_type=password&username=${encodeURIComponent(opts.username)}&password=${encodeURIComponent(sig)}`

  const url = opts.useQueryString ? `${DPS_OAUTH_URL}?${qs}` : DPS_OAUTH_URL

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${DPS_CLIENT_BASIC}`,
        ...(opts.useQueryString ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
      },
      body: opts.useQueryString ? undefined : qs,
      signal: AbortSignal.timeout(25000),
      cache: 'no-store',
    })
    const body = await res.text()
    return { label: opts.label, status: res.status, body: body.slice(0, 600), sigLen: sig.length, sigPrefix: sig.slice(0, 30) }
  } catch (e) {
    return { label: opts.label, status: 0, body: String(e), sigLen: sig.length, sigPrefix: sig.slice(0, 30) }
  }
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'not authenticated — open this URL in browser while logged in' }, { status: 401 })
  }

  const { data: tokenRow, error: dbErr } = await supabase
    .from('api_tokens')
    .select('kep_encrypted, kep_password_encrypted, kep_tax_id')
    .eq('client_id', clientId)
    .eq('user_id', user.id)
    .single()

  if (dbErr || !tokenRow?.kep_encrypted) {
    return NextResponse.json({
      error: 'no KEP found',
      userId: user.id,
      clientId,
      dbError: dbErr?.message,
      rowFound: !!tokenRow,
      hasKep: !!tokenRow?.kep_encrypted,
    }, { status: 404 })
  }

  const kepDecrypted = decrypt(tokenRow.kep_encrypted)
  const kepPass      = decrypt(tokenRow.kep_password_encrypted)
  const taxId        = (tokenRow.kep_tax_id ?? '').trim()
  const username     = `${taxId}-${taxId}-${Date.now()}`

  const base = { kepDecrypted, kepPass }

  // Probe: GET the OAuth endpoint (should return 405 Method Not Allowed)
  const getProbe = await fetch(DPS_OAUTH_URL, {
    method: 'GET',
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  }).then(r => r.text().then(t => ({ status: r.status, body: t.slice(0, 300) }))).catch(e => ({ status: 0, body: String(e) }))

  // Main test: fixed client_id + QS params (the correct format)
  const results = await Promise.all([
    // Primary: fixed client_id, QS params, sign taxId
    tryOAuth({ label: 'FIXED clientId + QS + signTaxId', username, signData: taxId, useQueryString: true, ...base }),
    // Alternative: fixed client_id, body params, sign taxId
    tryOAuth({ label: 'FIXED clientId + body + signTaxId', username, signData: taxId, useQueryString: false, ...base }),
    // Alternative: sign the full username instead of taxId
    tryOAuth({ label: 'FIXED clientId + QS + signUsername', username, signData: username, useQueryString: true, ...base }),
  ])

  return NextResponse.json({
    taxId,
    username,
    clientBase64prefix: DPS_CLIENT_BASIC.slice(0, 20) + '...',
    getProbe,
    results,
  })
}
