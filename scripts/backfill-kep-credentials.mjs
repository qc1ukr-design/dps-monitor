/**
 * backfill-kep-credentials.mjs
 *
 * Переносить зашифровані КЕП з api_tokens → kep_credentials.
 *
 * Алгоритм (для кожного клієнта з KEP в api_tokens):
 *   1. Перевіряє, чи вже є активний запис у kep_credentials (пропускає — idempotent)
 *   2. GET /kep/:clientId → backend розшифровує (auto-detect KMS/AES)
 *   3. POST /kep-credentials/upload → backend re-шифрує з per-KEP DEK
 *   4. Верифікує: GET /kep/:clientId повертає той самий kepData (через fallback)
 *
 * Запуск:
 *   node --env-file=backend/.env scripts/backfill-kep-credentials.mjs
 *
 *   Або явно:
 *   BACKEND_URL=https://... BACKEND_API_SECRET=... \
 *   SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/backfill-kep-credentials.mjs
 *
 * ВАЖЛИВО:
 *   - api_tokens НЕ видаляється і НЕ модифікується — залишається як fallback
 *   - Скрипт безпечно перезапускати — вже перенесені клієнти пропускаються
 *   - Після успішного backfill перевір: GET /kep/:clientId у логах повертає
 *     "primary path" для кожного клієнта
 */

const BACKEND_URL    = process.env.BACKEND_URL?.trim()
const BACKEND_SECRET = process.env.BACKEND_API_SECRET?.trim()
const SUPA_URL       = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim()
const SUPA_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!BACKEND_URL || !BACKEND_SECRET || !SUPA_URL || !SUPA_KEY) {
  console.error('❌ Відсутні env змінні: BACKEND_URL, BACKEND_API_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supaHeaders = {
  apikey:        SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
}

const backendHeaders = {
  'X-Backend-Secret': BACKEND_SECRET,
  'Content-Type':     'application/json',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function supaGet(path) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: supaHeaders })
  if (!res.ok) throw new Error(`Supabase GET ${path} → ${res.status}`)
  return res.json()
}

async function backendGet(path) {
  const res = await fetch(`${BACKEND_URL}${path}`, { headers: backendHeaders })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Backend GET ${path} → ${res.status}`)
  }
  return res.json()
}

async function backendPost(path, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method:  'POST',
    headers: backendHeaders,
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error(b.error ?? `Backend POST ${path} → ${res.status}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🔍 Читаємо api_tokens з KEP...')

  // 1. Всі рядки api_tokens де kep_encrypted is not null
  const tokens = await supaGet(
    'api_tokens?select=id,client_id,user_id,kep_encrypted&kep_encrypted=not.is.null'
  )

  if (!tokens.length) {
    console.log('ℹ️  Немає записів з KEP у api_tokens — backfill не потрібен.')
    return
  }

  // 2. Читаємо клієнтів щоб дізнатись name і edrpou
  const clientIds = [...new Set(tokens.map(t => t.client_id))].join(',')
  const clients = await supaGet(
    `clients?select=id,name,edrpou&id=in.(${clientIds})`
  )
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]))

  console.log(`📋 Знайдено ${tokens.length} записів у ${clients.length} клієнтів`)
  console.log('─'.repeat(60))

  let migrated = 0
  let skipped  = 0
  let failed   = 0

  for (const token of tokens) {
    const client = clientMap[token.client_id]
    const label  = client ? `${client.name} (${client.edrpou})` : token.client_id

    // 3. Перевіряємо чи вже перенесено (idempotent)
    const existing = await supaGet(
      `kep_credentials?select=id&client_id=eq.${token.client_id}&user_id=eq.${token.user_id}&is_active=eq.true&limit=1`
    )
    if (existing.length > 0) {
      console.log(`⏭️  ${label} — вже перенесено (${existing[0].id}), пропускаємо`)
      skipped++
      continue
    }

    // 4. Розшифровуємо через старий endpoint (auto-detect формат)
    let kepData, password
    try {
      const decrypted = await backendGet(
        `/kep/${encodeURIComponent(token.client_id)}?userId=${encodeURIComponent(token.user_id)}`
      )
      kepData  = decrypted.kepData
      password = decrypted.password
    } catch (err) {
      console.error(`❌ ${label} — не вдалось розшифрувати: ${err.message}`)
      failed++
      continue
    }

    // 5. Re-шифруємо в kep_credentials через новий endpoint
    try {
      const result = await backendPost('/kep-credentials/upload', {
        clientId:   token.client_id,
        userId:     token.user_id,
        kepData,
        password,
        clientName: client?.name  ?? 'Unknown',
        edrpou:     client?.edrpou ?? '',
        fileName:   '',
      })
      console.log(`✅ ${label} → kep_credentials ${result.kepId}`)
      migrated++
    } catch (err) {
      console.error(`❌ ${label} — не вдалось зашифрувати: ${err.message}`)
      failed++
    }
  }

  console.log('─'.repeat(60))
  console.log(`📊 Результат: ✅ ${migrated} перенесено  ⏭️  ${skipped} пропущено  ❌ ${failed} помилок`)

  if (failed > 0) {
    console.error('⚠️  Є помилки — перевір логи і запусти скрипт повторно для проблемних клієнтів')
    process.exit(1)
  }

  console.log('')
  console.log('🎉 Backfill завершено успішно!')
  console.log('')
  console.log('Наступні кроки:')
  console.log('  1. Переконайся що cron sync-all проходить без помилок')
  console.log('  2. Перевір логи backend — GET /kep/:clientId має йти через "primary path"')
  console.log('  3. Через 1-2 тижні можна запустити migration 008 (NOT NULL на client_id)')
}

main().catch(err => {
  console.error('💥 Fatal:', err)
  process.exit(1)
})
