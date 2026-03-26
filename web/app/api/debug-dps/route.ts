/**
 * Lightweight DPS probe — no DB, no KEP, no auth required.
 * Tests different request formats to diagnose the persistent 500.
 * DELETE after debugging is done.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

const DPS_OAUTH = 'https://cabinet.tax.gov.ua/ws/auth/oauth/token'

async function probe(
  label: string,
  url: string,
  init: RequestInit,
): Promise<{ label: string; status: number; body: string }> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(12000), cache: 'no-store' })
    const body = await r.text()
    return { label, status: r.status, body: body.slice(0, 400) }
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
  const sha1   = createHash('sha1').update(taxId).digest('hex').toUpperCase()
  const basicTin  = 'Basic ' + Buffer.from(`${taxId}:${taxId}`).toString('base64')
  const basicSha1 = 'Basic ' + Buffer.from(`${sha1}:${sha1}`).toString('base64')
  const garbage = Buffer.alloc(64).toString('base64')  // 64 zero bytes
  const username = `${taxId}-${taxId}-${Date.now()}`

  // Standard params as query string
  const qs = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(garbage)}`
  // Standard params as form body
  const formBody = qs

  const browserHeaders = {
    'Origin': 'https://cabinet.tax.gov.ua',
    'Referer': 'https://cabinet.tax.gov.ua/',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
  }

  const results = await Promise.all([
    // 1. Baseline: no auth, QS
    probe('no-auth + QS (baseline→400)', `${DPS_OAUTH}?${qs}`, {
      method: 'POST',
    }),
    // 2. TIN:TIN + QS (our new format)
    probe('TIN:TIN + QS', `${DPS_OAUTH}?${qs}`, {
      method: 'POST',
      headers: { 'Authorization': basicTin },
    }),
    // 3. TIN:TIN + body (maybe DPS wants body, not QS)
    probe('TIN:TIN + body', DPS_OAUTH, {
      method: 'POST',
      headers: { 'Authorization': basicTin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    }),
    // 4. TIN:TIN + QS + browser Origin/Referer
    probe('TIN:TIN + QS + browser headers', `${DPS_OAUTH}?${qs}`, {
      method: 'POST',
      headers: { 'Authorization': basicTin, ...browserHeaders },
    }),
    // 5. TIN:TIN + body + browser headers (closest to browser request)
    probe('TIN:TIN + body + browser headers', DPS_OAUTH, {
      method: 'POST',
      headers: {
        'Authorization': basicTin,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...browserHeaders,
      },
      body: formBody,
    }),
    // 6. SHA1 + QS (original broken format — should still be 500 as control)
    probe('SHA1(TIN) + QS (control→500)', `${DPS_OAUTH}?${qs}`, {
      method: 'POST',
      headers: { 'Authorization': basicSha1 },
    }),
  ])

  return NextResponse.json({ taxId, username, results })
}
