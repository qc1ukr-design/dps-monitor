/**
 * DPS Cabinet OAuth2 authentication via KEP (КЕП).
 *
 * Flow:
 *   1. Sign taxId string with KEP → CAdES-BES base64 signature
 *   2. POST to ws/auth/oauth/token with grant_type=password
 *      Authorization: Basic <clientBase64>   ← FIXED static client credential
 *      username = {taxId}-{taxId}-{Date.now()}
 *      password = base64(CAdES-BES signed taxId)
 *   3. Get access_token (lives 600s / 10 min)
 *
 * access_token is then used as Bearer for ws/api/* endpoints.
 *
 * Source: cabinet.tax.gov.ua Angular bundle (chunk-Z2AFO2O6.js), field:
 *   ne.oauth.clientBase64 = "QUU2ODY3NjY0QzA5NkM4M0UwNTMwMTAxMDA3RjQ1RjQ6..."
 * Decoded: AE6867664C096C83E0530101007F45F4:AE6867664C096C83E0530101007F45F4
 * This is a FIXED static OAuth2 client_id registered in the DPS system.
 * ALL taxpayers share the same client credential; the per-user identity
 * is established via the KEP signature in the password field.
 */
import { signWithKepDecrypted, getCertTaxId } from './signer'

const DPS_OAUTH_URL = 'https://cabinet.tax.gov.ua/ws/auth/oauth/token'

/**
 * Fixed static OAuth2 client_id:client_secret for DPS Cabinet.
 * Found in the Angular cabinet environment config (ne.oauth.clientBase64).
 * This NEVER changes — it identifies the DPS Cabinet application, not the user.
 */
const DPS_CLIENT_BASIC = 'QUU2ODY3NjY0QzA5NkM4M0UwNTMwMTAxMDA3RjQ1RjQ6QUU2ODY3NjY0QzA5NkM4M0UwNTMwMTAxMDA3RjQ1RjQ='

export interface DpsSession {
  accessToken: string
  expiresIn: number // seconds (typically 600)
}

/**
 * Authenticate to DPS Cabinet via KEP signature.
 *
 * DPS OAuth validates that the signed taxId matches the certificate's serialNumber.
 * For ЮО director certs the stored kep_tax_id may be ЄДРПОУ (8 digits) — OAuth
 * would reject it with "Не вірний податковий номер". We therefore ALWAYS extract
 * the taxId from the cert itself, ignoring the _taxIdHint parameter.
 *
 * @param kepDecrypted - decrypted KEP value from DB (raw pfxBase64 or v2 JSON)
 * @param password     - KEP password (decrypted)
 * @param _taxIdHint   - kept for API compat, actual taxId always taken from cert
 */
export async function loginWithKep(
  kepDecrypted: string,
  password: string,
  _taxIdHint: string  // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<DpsSession> {
  // Always use the cert's own taxId (РНОКПП) — OAuth rejects any mismatch
  const taxId = await getCertTaxId(kepDecrypted, password)

  // Username format: taxId-taxId-timestamp (milliseconds)
  const username = `${taxId}-${taxId}-${Date.now()}`
  // Sign the plain taxId string (not the username)
  const signature = await signWithKepDecrypted(kepDecrypted, password, taxId)

  // Params go in query string — Spring Security reads them from QS + body
  const qs = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(signature)}`
  const url = `${DPS_OAUTH_URL}?${qs}`
  console.log('[dps-auth] POST', DPS_OAUTH_URL, '| certTaxId:', taxId, '| username:', username, '| sigLen:', signature.length)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${DPS_CLIENT_BASIC}`,
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
