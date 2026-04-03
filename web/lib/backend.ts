/**
 * Helpers for calling the DPS-Monitor backend service (Railway).
 * All calls require X-Backend-Secret header.
 */

function getBackendConfig(): { url: string; secret: string } {
  const url = process.env.BACKEND_URL
  const secret = process.env.BACKEND_API_SECRET
  if (!url) throw new Error('BACKEND_URL is not configured')
  if (!secret) throw new Error('BACKEND_API_SECRET is not configured')
  return { url, secret }
}

/**
 * Fetch and decrypt KEP for a client from the backend.
 *
 * Used only by sync-all (cron) which runs as a service client without individual
 * user JWTs. userId is NOT passed — the backend reads it from kep_credentials.
 * New callers must use backendGetKepCredentialByClient() (JWT-authenticated).
 */
export async function backendGetKep(
  clientId: string,
): Promise<{ kepData: string; password: string }> {
  const { url, secret } = getBackendConfig()

  const res = await fetch(
    `${url}/kep/${encodeURIComponent(clientId)}`,
    {
      headers: { 'X-Backend-Secret': secret },
      cache: 'no-store',
      // 30s timeout — Railway free tier may cold-start in 15-25s when called by
      // cron at 04:00 UTC after hours of inactivity. 10s was too short.
      signal: AbortSignal.timeout(30000),
    },
  )

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ?? `Backend KEP fetch failed (${res.status})`,
    )
  }

  return res.json() as Promise<{ kepData: string; password: string }>
}

/**
 * Fetch and decrypt the active KEP for a client via the JWT-authenticated endpoint.
 *
 * Unlike backendGetKep(), userId is derived from the verified Supabase JWT on the
 * backend — never trusted from the request. Use this for all user-session contexts.
 *
 * Requires a valid Supabase access token (from supabase.auth.getSession()).
 */
export async function backendGetKepCredentialByClient(
  clientId: string,
  accessToken: string,
): Promise<{ kepData: string; password: string }> {
  const { url, secret } = getBackendConfig()

  const res = await fetch(
    `${url}/kep-credentials/by-client/${encodeURIComponent(clientId)}`,
    {
      headers: {
        'X-Backend-Secret': secret,
        'Authorization': `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    },
  )

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ?? `Backend KEP credential fetch failed (${res.status})`,
    )
  }

  return res.json() as Promise<{ kepData: string; password: string }>
}

/**
 * Upload and encrypt a KEP to kep_credentials (new table, per-KEP DEK).
 *
 * Deactivates any previously active KEP for this client, then stores the new one.
 * After backfill, GET /kep/:clientId automatically reads from kep_credentials first.
 */
export async function backendUploadKepCredential(params: {
  clientId:    string
  userId:      string
  kepData:     string
  password:    string
  clientName:  string
  edrpou:      string
  fileName?:   string
  accessToken: string   // Supabase JWT — verified server-side; userId derived from it
  kepInfo?: {
    caName?:    string | null
    ownerName?: string | null
    orgName?:   string | null
    taxId?:     string | null
    validTo?:   string | null
  }
}): Promise<{ kepId: string }> {
  const { url, secret } = getBackendConfig()

  const { accessToken, ...body } = params

  const res = await fetch(`${url}/kep-credentials/upload`, {
    method: 'POST',
    headers: {
      'X-Backend-Secret': secret,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ?? `Backend KEP upload failed (${res.status})`,
    )
  }

  return res.json() as Promise<{ kepId: string }>
}
