/**
 * DPS Cabinet OAuth2 authentication via KEP (КЕП).
 *
 * Flow:
 *   1. Sign taxId string with KEP → CAdES-BES base64 signature
 *   2. POST to ws/auth/oauth/token with grant_type=password
 *      Authorization: Basic base64("{SHA1(taxId).toUpperCase()}:{SHA1(taxId).toUpperCase()}")
 *      username = {taxId}-{taxId}-{Date.now()}
 *      password = {base64 signature}
 *   3. Get access_token (lives 600s / 10 min)
 *
 * access_token is then used as Bearer for ws/api/* endpoints:
 *   - ws/api/regdoc/list          → reports
 *   - ws/api/corr/correspondence  → incoming documents
 *
 * The Basic auth header uses the taxId SHA1 as "client credentials"
 * (doubled, uppercase, colon-separated). This is how the DPS Angular cabinet
 * authenticates the OAuth client — not a standard client_id/secret.
 */
import { signWithKepDecrypted } from './signer'

const DPS_OAUTH_URL = 'https://cabinet.tax.gov.ua/ws/auth/oauth/token'

export interface DpsSession {
  accessToken: string
  expiresIn: number // seconds (typically 600)
}

/** Build the Authorization: Basic header required by DPS OAuth */
function buildBasicAuth(taxId: string): string {
  // DPS OAuth client auth: taxId doubled, colon-separated
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
  const username = `${taxId}-${taxId}-${Date.now()}`
  // Sign the full username string (not just taxId) — DPS OAuth verifies signature against username
  const signature = await signWithKepDecrypted(kepDecrypted, password, username)

  const res = await fetch(DPS_OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': buildBasicAuth(taxId),
    },
    body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(signature)}`,
    signal: AbortSignal.timeout(25000),
    cache: 'no-store',
  })

  if (!res.ok) {
    const preview = await res.text().catch(() => '')
    throw new Error(`DPS OAuth ${res.status}: ${preview.slice(0, 200)}`)
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
