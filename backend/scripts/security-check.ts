/**
 * security-check.ts
 * Run: npm run security-check  (from backend/)
 *
 * Checks:
 *   1. Required ENV variables
 *   2. AWS KMS connected and working (GenerateDataKey + Encrypt + Decrypt round-trip)
 *   3. Supabase reachable
 *   4. Tables kep_credentials and kep_access_log exist
 *
 * Exit code 0 = all passed, 1 = one or more failures.
 */

import { generateDataKey, encryptWithKMS, decryptWithKMS } from '../src/lib/kmsClient'
import { getSupabaseClient } from '../src/lib/supabase'

// ─── Output helpers ───────────────────────────────────────────────────────────

let failures = 0

function ok(label: string): void {
  console.log(`  ✅  ${label}`)
}

function fail(label: string, reason: string): void {
  console.log(`  ❌  ${label}  →  ${reason}`)
  failures++
}

function section(title: string): void {
  console.log(`\n${title}\n${'─'.repeat(title.length)}`)
}

// ─── 1. ENV variables ─────────────────────────────────────────────────────────

function checkEnv(): void {
  section('1. ENV Variables')

  const required = [
    'BACKEND_API_SECRET',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'AWS_KMS_KEY_ID',
  ]

  for (const name of required) {
    const value = process.env[name]
    if (value && value.trim().length > 0) {
      ok(name)
    } else {
      fail(name, 'missing or empty')
    }
  }
}

// ─── 2. AWS KMS ───────────────────────────────────────────────────────────────

async function checkKms(): Promise<void> {
  section('2. AWS KMS')

  // Guard: skip if essential ENV is missing (would produce misleading errors)
  const missing = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_KMS_KEY_ID']
    .filter((k) => !process.env[k])
  if (missing.length > 0) {
    fail('KMS', `skipped — missing ENV: ${missing.join(', ')}`)
    return
  }

  // GenerateDataKey
  let dek: Buffer | null = null
  try {
    const { plaintext, ciphertext } = await generateDataKey()
    dek = plaintext
    ok(`GenerateDataKey — DEK ${ciphertext.length} bytes (KMS-wrapped)`)
  } catch (err) {
    fail('GenerateDataKey', describeError(err))
    return
  } finally {
    if (dek !== null) { dek.fill(0); dek = null }
  }

  // Encrypt
  const testPayload = Buffer.from('dps-monitor-security-check')
  let encrypted: Buffer | null = null
  try {
    encrypted = await encryptWithKMS(testPayload)
    ok('Encrypt — payload encrypted successfully')
  } catch (err) {
    fail('Encrypt', describeError(err))
    return
  }

  // Decrypt + round-trip
  try {
    const decrypted = await decryptWithKMS(encrypted)
    if (!decrypted.equals(testPayload)) {
      decrypted.fill(0)
      fail('Decrypt round-trip', 'decrypted bytes do not match original payload')
      return
    }
    decrypted.fill(0)
    ok('Decrypt — round-trip verified')
  } catch (err) {
    fail('Decrypt', describeError(err))
  }
}

/** Safe error description: strips ARNs, shows error name + HTTP status or syscall code. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error'
  const meta = (err as Record<string, unknown>)['$metadata'] as { httpStatusCode?: number } | undefined
  if (meta?.httpStatusCode) return `${err.name} (HTTP ${meta.httpStatusCode})`
  const code = (err as NodeJS.ErrnoException).code
  if (code) return `${err.name} (${code})`
  return err.name
}

// ─── 3. Supabase + 4. Tables ──────────────────────────────────────────────────

async function checkSupabaseAndTables(): Promise<void> {
  section('3. Supabase Connectivity')

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail('Supabase', 'skipped — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing')
    return
  }

  let supabase: ReturnType<typeof getSupabaseClient>
  try {
    supabase = getSupabaseClient()
    ok('Client initialised')
  } catch (err) {
    fail('Client init', err instanceof Error ? err.message : 'unknown error')
    return
  }

  // Basic connectivity via a lightweight query
  try {
    const { error } = await supabase.from('clients').select('id').limit(1)
    if (error) throw new Error(error.message)
    ok('Supabase reachable — query executed')
  } catch (err) {
    fail('Supabase reachable', err instanceof Error ? err.message : 'unknown error')
    // Still try table checks — connectivity may be fine, clients table may just be RLS-restricted
  }

  section('4. Required Tables')

  for (const table of ['kep_credentials', 'kep_access_log'] as const) {
    try {
      // SELECT with limit 0 verifies table exists; PostgREST errors if the table is absent
      const { error } = await supabase.from(table).select('id').limit(0)
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim())
      ok(table)
    } catch (err) {
      fail(table, err instanceof Error ? err.message : 'unknown error')
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║   DPS-Monitor — Security Check       ║')
  console.log('╚══════════════════════════════════════╝')

  checkEnv()
  await checkKms()
  await checkSupabaseAndTables()

  console.log('\n' + '═'.repeat(42))
  if (failures === 0) {
    console.log('✅  All checks passed — system is ready')
  } else {
    console.log(`❌  ${failures} check(s) failed — see details above`)
  }
  console.log('═'.repeat(42) + '\n')

  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n❌  Unexpected error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
