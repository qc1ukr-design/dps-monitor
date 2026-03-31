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
import { signWithKepDecrypted, getCertTaxId, getStampCertTaxId, signWithStampKey, diagnoseBox } from './signer'

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
  taxIdUsed?: string // taxId that was successfully used for OAuth
}

/**
 * Try to authenticate as ЮО using director cert + org ЄДРПОУ in username.
 *
 * DPS Angular cabinet ЮО login format (from bundle analysis):
 *   username = {РНОКПП}-{ЄДРПОУ}-{timestamp}  ← director РНОКПП + org ЄДРПОУ
 *   password = sign(РНОКПП) with director cert  ← signs director's own РНОКПП
 *
 * Spring Security sees: "authenticate director РНОКПП in context of org ЄДРПОУ"
 * → returns ЮО-level access_token with org context.
 *
 * Returns null on failure so caller can fall back to ФО OAuth.
 */
export async function loginWithKepAsYuo(
  kepDecrypted: string,
  password: string,
  edrpou: string,
): Promise<DpsSession | string> {  // returns DpsSession on success, error string on failure
  // Director signs their own РНОКПП (cert's serialNumber)
  const rnokpp = await getCertTaxId(kepDecrypted, password)

  // Username format for ЮО: {РНОКПП}-{ЄДРПОУ}-{timestamp}
  // DPS Spring Security interprets this as director in org context
  const username = `${rnokpp}-${edrpou}-${Date.now()}`
  let signature: string
  try {
    signature = await signWithKepDecrypted(kepDecrypted, password, rnokpp)
  } catch (e) {
    const msg = `sign-failed:${String(e).slice(0, 100)}`
    console.log('[dps-auth] loginWithKepAsYuo sign failed:', e)
    return msg
  }

  const qs = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(signature)}`
  const url = `${DPS_OAUTH_URL}?${qs}`
  console.log('[dps-auth] YUO OAuth POST | rnokpp:', rnokpp, '| edrpou:', edrpou, '| sigLen:', signature.length)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${DPS_CLIENT_BASIC}` },
    signal: AbortSignal.timeout(25000),
    cache: 'no-store',
  })

  if (!res.ok) {
    const preview = await res.text().catch(() => '')
    console.log('[dps-auth] YUO OAuth error', res.status, preview.slice(0, 200))
    return `oauth-${res.status}:${preview.slice(0, 150)}`
  }

  const data = await res.json() as { access_token: string; expires_in?: number }
  if (!data.access_token) return 'no-token-in-response'

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 600,
    taxIdUsed: edrpou,
  }
}


/**
 * ЮО OAuth variant: same username format as loginWithKepAsYuo but signs ЄДРПОУ
 * instead of РНОКПП. Some DPS builds expect the org's ЄДРПОУ as the signed payload
 * to prove the director is claiming ЮО context (not personal РНОКПП context).
 */
export async function loginWithKepAsYuoSignEdrpou(
  kepDecrypted: string,
  password: string,
  edrpou: string,
): Promise<DpsSession | string> {
  const rnokpp = await getCertTaxId(kepDecrypted, password)
  const username = `${rnokpp}-${edrpou}-${Date.now()}`
  let signature: string
  try {
    signature = await signWithKepDecrypted(kepDecrypted, password, edrpou)
  } catch (e) {
    return `sign-edrpou:${String(e).slice(0, 100)}`
  }
  const qs = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(signature)}`
  const res = await fetch(`${DPS_OAUTH_URL}?${qs}`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${DPS_CLIENT_BASIC}` },
    signal: AbortSignal.timeout(25000),
    cache: 'no-store',
  })
  if (!res.ok) {
    const preview = await res.text().catch(() => '')
    return `yuo-se-${res.status}:${preview.slice(0, 150)}`
  }
  const data = await res.json() as { access_token: string; expires_in?: number }
  if (!data.access_token) return 'yuo-se-no-token'
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 600, taxIdUsed: edrpou }
}

/**
 * Authenticate to DPS using the stamp/seal certificate (ЄДРПОУ).
 *
 * For ЮО (legal entity): the stamp cert has ЄДРПОУ as its serialNumber.
 * OAuth flow mirrors the ФО flow but uses the stamp key:
 *   username = {ЄДРПОУ}-{ЄДРПОУ}-{timestamp}
 *   password = base64(CAdES-BES of ЄДРПОУ signed with stamp key)
 * → DPS Spring Security sees ЄДРПОУ cert, returns ЮО-context access_token.
 *
 * Falls back gracefully — returns an error string instead of throwing so the
 * caller can continue to the next authentication strategy.
 */
export async function loginWithKepStamp(
  kepDecrypted: string,
  password: string,
): Promise<DpsSession | string> {
  let edrpou: string | null
  try {
    edrpou = await getStampCertTaxId(kepDecrypted, password)
  } catch (e) {
    return `stamp-cert-read:${String(e).slice(0, 100)}`
  }
  if (!edrpou) {
    const diag = await diagnoseBox(kepDecrypted, password).catch(() => 'diag-failed')
    return `no-stamp-cert | ${diag}`
  }

  const username = `${edrpou}-${edrpou}-${Date.now()}`
  let signature: string
  try {
    signature = await signWithStampKey(kepDecrypted, password, edrpou)
  } catch (e) {
    return `stamp-sign:${String(e).slice(0, 100)}`
  }

  const qs = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(signature)}`
  const url = `${DPS_OAUTH_URL}?${qs}`
  console.log('[dps-auth] STAMP OAuth POST | edrpou:', edrpou, '| sigLen:', signature.length)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${DPS_CLIENT_BASIC}` },
    signal: AbortSignal.timeout(25000),
    cache: 'no-store',
  })

  if (!res.ok) {
    const preview = await res.text().catch(() => '')
    console.log('[dps-auth] STAMP OAuth error', res.status, preview.slice(0, 200))
    return `stamp-oauth-${res.status}:${preview.slice(0, 150)}`
  }

  const data = await res.json() as { access_token: string; expires_in?: number }
  if (!data.access_token) return 'stamp-no-token'

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 600,
    taxIdUsed: edrpou,
  }
}


/**
 * ЮО OAuth variant: username = {ЄДРПОУ}-{ЄДРПОУ}-{ts}, signs ЄДРПОУ with director cert.
 *
 * Mirrors the stamp-key format exactly but uses the director's personal cert.
 * Some DPS builds accept this when the director is the only authorized signatory.
 * Returns error string (not throw) so caller can chain fallbacks.
 */
export async function loginWithKepAsYuoEdrpouFormat(
  kepDecrypted: string,
  password: string,
  edrpou: string,
): Promise<DpsSession | string> {
  let signature: string
  try {
    signature = await signWithKepDecrypted(kepDecrypted, password, edrpou)
  } catch (e) {
    return `yuo-ef-sign:${String(e).slice(0, 100)}`
  }
  const username = `${edrpou}-${edrpou}-${Date.now()}`
  const qs = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(signature)}`
  const res = await fetch(`${DPS_OAUTH_URL}?${qs}`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${DPS_CLIENT_BASIC}` },
    signal: AbortSignal.timeout(25000),
    cache: 'no-store',
  })
  if (!res.ok) {
    const preview = await res.text().catch(() => '')
    return `yuo-ef-${res.status}:${preview.slice(0, 150)}`
  }
  const data = await res.json() as { access_token: string; expires_in?: number }
  if (!data.access_token) return 'yuo-ef-no-token'
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 600, taxIdUsed: edrpou }
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
