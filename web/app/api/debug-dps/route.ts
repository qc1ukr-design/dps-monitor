/**
 * Lightweight DPS probe — no DB, no KEP, no auth required.
 * Tests challenge endpoint variations — the flow might be:
 *   1. GET /ws/auth/challenge?username=<taxId> → get nonce/challenge
 *   2. Sign the challenge with KEP
 *   3. POST to token endpoint with signed challenge
 * DELETE after debugging.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

const DPS_BASE  = 'https://cabinet.tax.gov.ua/ws'
const DPS_OAUTH = `${DPS_BASE}/auth/oauth/token`
const DPS_CHALLENGE = `${DPS_BASE}/auth/challenge`

async function probe(
  label: string,
  url: string,
  init: RequestInit,
): Promise<{ label: string; status: number; body: string; headers: Record<string, string> }> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(12000), cache: 'no-store' })
    const body = await r.text()
    const headers: Record<string, string> = {}
    // @ts-expect-error - Headers iteration
    for (const [k, v] of r.headers.entries()) headers[k] = v
    return { label, status: r.status, body: body.slice(0, 600), headers }
  } catch (e) {
    return { label, status: 0, body: String(e), headers: {} }
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
  const garbage = Buffer.alloc(64).toString('base64')
  const username = `${taxId}-${taxId}-${Date.now()}`
  const qs = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(garbage)}`

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  const hdr: Record<string, string> = {
    'User-Agent': ua,
    'Origin': 'https://cabinet.tax.gov.ua',
    'Referer': 'https://cabinet.tax.gov.ua/',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'uk-UA,uk;q=0.9',
  }

  const results = await Promise.all([
    // Challenge with plain taxId
    probe('GET challenge?username=taxId', `${DPS_CHALLENGE}?username=${taxId}`, {
      method: 'GET', headers: hdr,
    }),
    // Challenge with TIN:TIN:timestamp username
    probe('GET challenge?username=TIN-TIN-TS', `${DPS_CHALLENGE}?username=${encodeURIComponent(username)}`, {
      method: 'GET', headers: hdr,
    }),
    // Challenge POST with plain taxId
    probe('POST challenge form taxId', DPS_CHALLENGE, {
      method: 'POST',
      headers: { ...hdr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=${encodeURIComponent(taxId)}`,
    }),
    // Challenge POST with TIN-TIN-TS username
    probe('POST challenge form TIN-TIN-TS', DPS_CHALLENGE, {
      method: 'POST',
      headers: { ...hdr, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=${encodeURIComponent(username)}`,
    }),
    // Token endpoint OPTIONS (CORS preflight)
    probe('OPTIONS oauth/token', DPS_OAUTH, {
      method: 'OPTIONS',
      headers: { ...hdr, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
    }),
    // Token with TIN:TIN + basicAuth header (control)
    probe('TIN:TIN POST oauth QS (→500?)', `${DPS_OAUTH}?${qs}`, {
      method: 'POST', headers: { ...hdr, 'Authorization': basicTin },
    }),
    // Token with SHA1 auth (control)
    probe('SHA1 POST oauth QS (→500?)', `${DPS_OAUTH}?${qs}`, {
      method: 'POST', headers: { ...hdr, 'Authorization': basicSha1 },
    }),
    // GET token endpoint (no auth)
    probe('GET oauth/token', DPS_OAUTH, {
      method: 'GET', headers: hdr,
    }),
    // Other potential API discovery endpoints
    probe('GET /ws/auth/', `${DPS_BASE}/auth/`, { method: 'GET', headers: hdr }),
    probe('GET /ws/.well-known/openid-configuration', 'https://cabinet.tax.gov.ua/.well-known/openid-configuration', { method: 'GET', headers: hdr }),
  ])

  return NextResponse.json({ taxId, username, sha1prefix: sha1.slice(0, 8), results })
}
