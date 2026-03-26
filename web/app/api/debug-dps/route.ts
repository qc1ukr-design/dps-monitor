/**
 * Lightweight DPS probe — no DB, no KEP, no auth required.
 * Tests TIN:TIN vs SHA1(TIN):SHA1(TIN) Basic auth format.
 * DELETE after debugging is done.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

const DPS_OAUTH = 'https://cabinet.tax.gov.ua/ws/auth/oauth/token'

async function probe(label: string, url: string, init: RequestInit): Promise<{ label: string; status: number; body: string }> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10000), cache: 'no-store' })
    const body = await r.text()
    return { label, status: r.status, body: body.slice(0, 500) }
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
  const sha1 = createHash('sha1').update(taxId).digest('hex').toUpperCase()
  const basicAuthSha1 = 'Basic ' + Buffer.from(`${sha1}:${sha1}`).toString('base64')
  const basicAuthTin  = 'Basic ' + Buffer.from(`${taxId}:${taxId}`).toString('base64')
  const validB64 = Buffer.alloc(64).toString('base64')  // 64 zero bytes — garbage sig, not CAdES

  const username = `${taxId}-${taxId}-${Date.now()}`

  const results = await Promise.all([
    // OLD format: SHA1(TIN):SHA1(TIN) — was causing 500
    probe('SHA1(TIN) auth + garbage sig (OLD)', `${DPS_OAUTH}?grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(validB64)}`, {
      method: 'POST', headers: { 'Authorization': basicAuthSha1 },
    }),
    // NEW format: TIN:TIN — correct per Python reference impl
    probe('TIN:TIN auth + garbage sig (NEW)', `${DPS_OAUTH}?grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(validB64)}`, {
      method: 'POST', headers: { 'Authorization': basicAuthTin },
    }),
    // No auth — expect 400 (baseline)
    probe('no auth + garbage sig (baseline)', `${DPS_OAUTH}?grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(validB64)}`, {
      method: 'POST',
    }),
  ])

  // Expected: OLD=500, NEW≠500 (401 or {"error":"Помилка перевірки підпису"} = 400/401)
  return NextResponse.json({ taxId, sha1prefix: sha1.slice(0, 8), username, results })
}
