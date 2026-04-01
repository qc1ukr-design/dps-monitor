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
 * Supports both KMS envelope (new) and legacy AES (old) formats transparently.
 *
 * Returns { kepData, password } — raw KEP storage string and plaintext password.
 */
export async function backendGetKep(
  clientId: string,
  userId: string,
): Promise<{ kepData: string; password: string }> {
  const { url, secret } = getBackendConfig()

  const res = await fetch(
    `${url}/kep/${encodeURIComponent(clientId)}?userId=${encodeURIComponent(userId)}`,
    {
      headers: { 'X-Backend-Secret': secret },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
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
