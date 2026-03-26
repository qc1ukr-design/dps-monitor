/**
 * Lightweight DPS probe — no DB, no KEP, no auth required.
 * Tests session-cookie theory: GET cabinet first, then use cookie in OAuth.
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
  const qs = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(garbage)}`

  const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

  // Step 1: GET cabinet to harvest session cookie
  let sessionCookie = ''
  let setCookieHeader = ''
  let cabinetStatus = 0
  try {
    const cabRes = await fetch('https://cabinet.tax.gov.ua/', {
      method: 'GET',
      headers: {
        'User-Agent': browserUA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'uk-UA,uk;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
      redirect: 'follow',
    })
    cabinetStatus = cabRes.status
    const cookies: string[] = []
    // @ts-expect-error - Headers iteration
    for (const [k, v] of cabRes.headers.entries()) {
      if (k.toLowerCase() === 'set-cookie') {
        setCookieHeader += v + '; '
        // Extract cookie name=value part (before ;)
        const nameVal = v.split(';')[0].trim()
        if (nameVal) cookies.push(nameVal)
      }
    }
    sessionCookie = cookies.join('; ')
  } catch (e) {
    setCookieHeader = String(e)
  }

  const baseHeaders: Record<string, string> = {
    'User-Agent': browserUA,
    'Origin': 'https://cabinet.tax.gov.ua',
    'Referer': 'https://cabinet.tax.gov.ua/',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'uk-UA,uk;q=0.9',
  }
  const headersWithCookie = sessionCookie
    ? { ...baseHeaders, 'Cookie': sessionCookie }
    : baseHeaders

  const results = await Promise.all([
    // 1. No auth, no cookie (baseline)
    probe('no-auth + no-cookie (→400)', `${DPS_OAUTH}?${qs}`, {
      method: 'POST',
    }),
    // 2. TIN:TIN + no cookie + browser UA
    probe('TIN:TIN + no-cookie + UA', `${DPS_OAUTH}?${qs}`, {
      method: 'POST',
      headers: { ...baseHeaders, 'Authorization': basicTin },
    }),
    // 3. TIN:TIN + session cookie + browser UA
    probe('TIN:TIN + session-cookie + UA', `${DPS_OAUTH}?${qs}`, {
      method: 'POST',
      headers: { ...headersWithCookie, 'Authorization': basicTin },
    }),
    // 4. SHA1 + session cookie (control)
    probe('SHA1(TIN) + session-cookie + UA', `${DPS_OAUTH}?${qs}`, {
      method: 'POST',
      headers: { ...headersWithCookie, 'Authorization': basicSha1 },
    }),
    // 5. Challenge endpoint GET (does it exist?)
    probe('GET /ws/auth/challenge', 'https://cabinet.tax.gov.ua/ws/auth/challenge', {
      method: 'GET',
      headers: baseHeaders,
    }),
    // 6. Challenge with taxId POST
    probe('POST /ws/auth/challenge {username:taxId}', 'https://cabinet.tax.gov.ua/ws/auth/challenge', {
      method: 'POST',
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username }),
    }),
  ])

  return NextResponse.json({
    taxId, username,
    sessionHarvest: { cabinetStatus, setCookieHeader: setCookieHeader.slice(0, 300), sessionCookie: sessionCookie.slice(0, 200) },
    results,
  })
}
