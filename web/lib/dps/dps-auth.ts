/**
 * DPS Cabinet OAuth2 authentication via KEP (КЕП).
 *
 * Flow:
 *   1. Sign taxId string with KEP → CAdES-BES base64 signature
 *   2. POST to ws/auth/oauth/token with grant_type=password
 *      Authorization: Basic base64("{taxId}:{taxId}")   ← plain TIN, NOT hash
 *      username = {taxId}-{taxId}-{Date.now()}
 *      password = base64(CAdES-BES signed taxId)
 *   3. Get access_token (lives 600s / 10 min)
 *
 * access_token is then used as Bearer for ws/api/* endpoints:
 *   - ws/api/regdoc/list          → reports
 *   - ws/api/corr/correspondence  → incoming documents
 *
 * Source: https://github.com/NadozirnySvyatoslav/l10n_ua (Python reference impl)
 *         https://dou.ua/forums/topic/34457/
 * The Basic auth header encodes TIN:TIN (not SHA1).
 */
import { signWithKepDecrypted } from './signer'

const DPS_OAUTH_URL = 'https://cabinet.tax.gov.ua/ws/auth/oauth/token'

export interface DpsSession {
  accessToken: string
  expiresIn: number // seconds (typically 600)
}

/** Build the Authorization: Basic header required by DPS OAuth.
 *  DPS uses the raw taxpayer TIN as both client_id and client_secret
 *  (TIN:TIN, base64-encoded). Confirmed from Python reference implementation. */
function buildBasicAuth(taxId: string): string {
  return 'Basic ' + Buffer.from(`${taxId}:${taxId}`).toString('base64')
}

/**
 * Authenticate to DPS Cabinet via KEP signature.
 *
 * @param kepDecrypted - decrypted KEP value from DB (raw pfxBase64 or v2 JSON)
 * @param password     - KEP password (decrypted)
 * @param taxId        - РНОКПП / ЄДРПОУ of the taxpayer
 */
export async function loginWithKep(
  kepDecrypted: string,
  password: string,
  taxId: string
): Promise<DpsSession> {
  // Username format: taxId-taxId-timestamp (milliseconds)
  // Confirmed from DOU forum + Python reference implementation
  const username = `${taxId}-${taxId}-${Date.now()}`
  // Sign the plain taxId (not the username)
  const signature = await signWithKepDecrypted(kepDecrypted, password, taxId)

  // DPS Cabinet OAuth: params go in the query string (not POST body)
  const qs = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(signature)}`
  const url = `${DPS_OAUTH_URL}?${qs}`
  console.log('[dps-auth] POST', DPS_OAUTH_URL, '| username:', username, '| taxId:', taxId, '| sigLen:', signature.length)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': buildBasicAuth(taxId),
    },
    signal: AbortSignal.timeout(25000),
    cache: 'no-store',
  })

  if (!res.ok) {
    const preview = await res.text().catch(() => '')
    console.error('[dps-auth] OAuth error', res.status, preview)
    throw new Error(`DPS OAuth ${res.status} [taxId=${taxId} sigLen=${signature.length}]: ${preview.slice(0, 400)}`)
  }

  const data = await res.json() as { access_token: string; expires_in?: number }
  if (!data.access_token) {
    throw new Error('DPS OAuth: no access_token in response')
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 600,
  }
}
