/**
 * Lightweight DPS probe — no DB, no KEP, no auth required.
 * Tests the FIXED static DPS OAuth client_id found in the Angular bundle.
 * DELETE after debugging is done.
 */
import { NextRequest, NextResponse } from 'next/server'

const DPS_OAUTH = 'https://cabinet.tax.gov.ua/ws/auth/oauth/token'

// Fixed static client credential from cabinet Angular bundle (ne.oauth.clientBase64)
// Decoded: AE6867664C096C83E0530101007F45F4:AE6867664C096C83E0530101007F45F4
const DPS_CLIENT_BASIC = 'QUU2ODY3NjY0QzA5NkM4M0UwNTMwMTAxMDA3RjQ1RjQ6QUU2ODY3NjY0QzA5NkM4M0UwNTMwMTAxMDA3RjQ1RjQ='

async function probe(
  label: string,
  url: string,
  init: RequestInit,
): Promise<{ label: string; status: number; body: string }> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(12000), cache: 'no-store' })
    const body = await r.text()
    return { label, status: r.status, body: body.slice(0, 600) }
  } catch (e) {
    return { label, status: 0, body: String(e) }
  }
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const taxId = req.nextUrl.searchParams.get('taxId') ?? '2858814822'
  const garbage = Buffer.alloc(64).toString('base64')  // 64 zero bytes (not real signature)
  const username = `${taxId}-${taxId}-${Date.now()}`
  const qs = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(garbage)}`

  const results = await Promise.all([
    // 1. Baseline: no auth (→400 expected)
    probe('no-auth (baseline→400)', `${DPS_OAUTH}?${qs}`, { method: 'POST' }),

    // 2. CORRECT fixed client_id + garbage sig
    //    Expected: NOT 500 — should get signature error like
    //    {"error":"Помилка","error_description":"Помилка перевірки підпису:хибний підпис"}
    probe('FIXED client_id + garbage sig', `${DPS_OAUTH}?${qs}`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${DPS_CLIENT_BASIC}` },
    }),

    // 3. CORRECT fixed client_id + garbage sig in body (alternative)
    probe('FIXED client_id + garbage sig body', DPS_OAUTH, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${DPS_CLIENT_BASIC}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: qs,
    }),

    // 4. Wrong fake taxId with fixed client_id
    probe('FIXED client_id + fake taxId garbage sig', `${DPS_OAUTH}?grant_type=password&username=1234567890-1234567890-${Date.now()}&password=${encodeURIComponent(garbage)}`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${DPS_CLIENT_BASIC}` },
    }),

    // 5. Old SHA1 format (control — should still 500)
    probe('SHA1(TIN) auth (old broken→500)', `${DPS_OAUTH}?${qs}`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic N0Q5MkNERTVFMjg3QjdDMjY5MTdCQTMyRDUzMjg2MjcxRDc5RDlFODo3RDkyQ0RFNUUyODdCN0MyNjkxN0JBMzJENTMyODYyNzFENzlEOUU4'
        // = Basic base64(SHA1(2858814822):SHA1(2858814822)) — our old wrong format
      },
    }),
  ])

  return NextResponse.json({
    taxId, username,
    clientBase64: DPS_CLIENT_BASIC.slice(0, 20) + '...',
    results,
  })
}
