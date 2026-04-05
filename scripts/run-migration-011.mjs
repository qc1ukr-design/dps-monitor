/**
 * run-migration-011.mjs
 *
 * Виконує міграцію 011 (expo_push_token) напряму до Supabase PostgreSQL.
 *
 * Запуск:
 *   DB_PASSWORD=твій_пароль node scripts/run-migration-011.mjs
 *
 * Пароль знаходиться в Supabase Dashboard:
 *   Settings → Database → Connection string → Password (або поруч з URI)
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const DB_PASSWORD = process.env.DB_PASSWORD?.trim()
if (!DB_PASSWORD) {
  console.error('❌ Потрібна змінна DB_PASSWORD')
  console.error('   Запуск: DB_PASSWORD=твій_пароль node scripts/run-migration-011.mjs')
  console.error('   Пароль: Supabase Dashboard → Settings → Database → Connection string')
  process.exit(1)
}

const { Client } = require(join(__dirname, '../web/node_modules/pg'))

// Supabase session-mode pooler (підтримує DDL)
const DATABASE_URL =
  `postgresql://postgres.zvvvgjmyecabhugvkyjz:${DB_PASSWORD}` +
  `@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`

const SQL = readFileSync(
  join(__dirname, '../supabase/migrations/011_expo_push_token.sql'),
  'utf8'
)

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

  console.log('🔌 Підключаємось до Supabase...')
  await client.connect()

  console.log('▶️  Виконуємо міграцію 011...')
  await client.query(SQL)

  // Верифікація: перевіряємо що колонка існує
  const { rows } = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_settings'
      AND column_name  = 'expo_push_token'
  `)

  await client.end()

  if (rows.length === 0) {
    console.error('❌ Міграція не спрацювала — колонка expo_push_token не знайдена')
    process.exit(1)
  }

  console.log('✅ Міграція 011 виконана успішно!')
  console.log(`   Колонка: ${rows[0].column_name} (${rows[0].data_type})`)
}

main().catch(err => {
  console.error('💥 Fatal:', err.message)
  process.exit(1)
})
