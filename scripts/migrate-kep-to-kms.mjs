/**
 * migrate-kep-to-kms.mjs
 *
 * Міграція всіх legacy AES-зашифрованих KEP записів до AWS KMS envelope encryption.
 *
 * Алгоритм:
 *   1. Читає всі api_tokens де kep_encrypted не null
 *   2. Для кожного: GET /kep/:clientId → backend auto-decrypts (AES або KMS)
 *   3. POST /kep/upload → backend re-encrypts з KMS і перезаписує в БД
 *   4. Після міграції token_encrypted NULL-ить (UUID токени короткоживучі)
 *
 * Запуск:
 *   BACKEND_URL=https://... BACKEND_API_SECRET=... node scripts/migrate-kep-to-kms.mjs
 *
 * Або з .env:
 *   node --env-file=web/.env.local scripts/migrate-kep-to-kms.mjs
 */

const BACKEND_URL    = process.env.BACKEND_URL?.trim()
const BACKEND_SECRET = process.env.BACKEND_API_SECRET?.trim()
const SUPA_URL       = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const SUPA_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!BACKEND_URL || !BACKEND_SECRET || !SUPA_URL || !SUPA_KEY) {
  console.error('Missing env vars: BACKEND_URL, BACKEND_API_SECRET, SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const headers = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' }

async function supaFetch(path, opts = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1${path}`, { headers, ...opts })
  const body = await res.json()
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${JSON.stringify(body)}`)
  return body
}

function isKmsEnvelope(stored) {
  try {
    const decoded = Buffer.from(stored, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded)
    return parsed?.version === 1
  } catch {
    return false
  }
}

async function main() {
  console.log('=== KEP AES → KMS Migration ===\n')

  // 1. Fetch all tokens with KEP
  const tokens = await supaFetch('/api_tokens?select=client_id,user_id,kep_encrypted,kep_ca_name,kep_owner_name,kep_valid_to,kep_tax_id&kep_encrypted=not.is.null')
  console.log(`Total clients with KEP: ${tokens.length}`)

  let skipped = 0, migrated = 0, failed = 0

  for (const token of tokens) {
    const { client_id: clientId, user_id: userId } = token

    // Check if already KMS
    if (isKmsEnvelope(token.kep_encrypted)) {
      console.log(`  [SKIP] ${clientId} — already KMS envelope`)
      skipped++
      continue
    }

    process.stdout.write(`  [MIGRATING] ${clientId} ... `)

    try {
      // 2. Decrypt via backend (auto-detects AES)
      const getRes = await fetch(`${BACKEND_URL}/kep/${clientId}?userId=${userId}`, {
        headers: { 'X-Backend-Secret': BACKEND_SECRET },
        signal: AbortSignal.timeout(15000),
      })
      if (!getRes.ok) {
        const err = await getRes.json().catch(() => ({}))
        throw new Error(`GET /kep failed: ${err.error || getRes.status}`)
      }
      const { kepData, password } = await getRes.json()

      // 3. Re-encrypt via backend (KMS)
      const uploadRes = await fetch(`${BACKEND_URL}/kep/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Backend-Secret': BACKEND_SECRET },
        body: JSON.stringify({
          clientId,
          userId,
          kepData,
          password,
          kepInfo: {
            caName:     token.kep_ca_name    || null,
            ownerName:  token.kep_owner_name || null,
            validTo:    token.kep_valid_to   || null,
            taxId:      token.kep_tax_id     || null,
            orgName:    null,
          },
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}))
        throw new Error(`POST /kep/upload failed: ${err.error || uploadRes.status}`)
      }

      console.log('✅')
      migrated++
    } catch (e) {
      console.log(`❌ ${e.message}`)
      failed++
    }
  }

  // 4. Null-out token_encrypted (UUID tokens are short-lived, no value in keeping)
  console.log('\n--- Clearing legacy token_encrypted values ---')
  try {
    await supaFetch('/api_tokens?token_encrypted=not.is.null', {
      method: 'PATCH',
      body: JSON.stringify({ token_encrypted: null }),
    })
    console.log('token_encrypted → NULL ✅')
  } catch (e) {
    console.log(`token_encrypted clear failed: ${e.message}`)
  }

  console.log(`\n=== Done ===`)
  console.log(`Migrated: ${migrated}`)
  console.log(`Skipped (already KMS): ${skipped}`)
  console.log(`Failed: ${failed}`)

  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
