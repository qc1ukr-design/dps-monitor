/**
 * POST /api/clients/from-kep
 *
 * Create a new client entirely from a KEP file:
 *   1. Parse KEP → extract ownerName + taxId
 *   2. Create clients row  (name = ownerName, edrpou = taxId)
 *   3. Create api_tokens row with encrypted KEP + cert metadata
 *   4. Return { id, name, taxId, caName, validTo }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto'
import { inspectKepFiles, inspectKep, CERT_EXTS } from '@/lib/dps/signer'

function getExt(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.slice(idx).toLowerCase() : ''
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    files: Array<{ name: string; base64: string }>
    password: string
  }
  const { files, password } = body

  if (!files?.length) {
    return NextResponse.json({ error: 'Необхідно вибрати файл(и) KEP' }, { status: 400 })
  }
  if (!password) {
    return NextResponse.json({ error: 'Введіть пароль KEP' }, { status: 400 })
  }

  // Classify files
  const keyBuffers: Buffer[] = []
  const certBuffers: Buffer[] = []
  for (const f of files) {
    const ext = getExt(f.name)
    const buf = Buffer.from(f.base64, 'base64')
    if (CERT_EXTS.includes(ext)) {
      certBuffers.push(buf)
    } else {
      keyBuffers.push(buf)
    }
  }

  if (keyBuffers.length === 0) {
    return NextResponse.json(
      { error: 'Не знайдено файл ключа серед завантажених файлів' },
      { status: 400 }
    )
  }

  // Parse KEP → get owner info
  let kepInfo
  try {
    kepInfo = certBuffers.length > 0
      ? await inspectKepFiles(keyBuffers, certBuffers, password)
      : await inspectKep(keyBuffers[0], password)
  } catch (e) {
    return NextResponse.json({
      error: 'Невірний файл KEP або неправильний пароль',
      detail: String(e),
    }, { status: 400 })
  }

  const clientName = kepInfo.ownerName || 'Без імені'
  const edrpou = kepInfo.taxId || null

  // Create client
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .insert({ user_id: user.id, name: clientName, edrpou })
    .select('id')
    .single()

  if (clientError || !client) {
    return NextResponse.json(
      { error: clientError?.message || 'Помилка створення клієнта' },
      { status: 500 }
    )
  }

  // Store encrypted KEP
  const kepStorageValue = files.length === 1 && certBuffers.length === 0
    ? files[0].base64                          // single self-contained file — legacy format
    : JSON.stringify({ v: 2, files })          // multi-file format

  const kepEncrypted = encrypt(kepStorageValue)
  const kepPasswordEncrypted = encrypt(password)

  const { error: tokenError } = await supabase
    .from('api_tokens')
    .insert({
      client_id: client.id,
      user_id: user.id,
      kep_encrypted: kepEncrypted,
      kep_password_encrypted: kepPasswordEncrypted,
      kep_ca_name: kepInfo.caName,
      kep_owner_name: kepInfo.ownerName,
      kep_valid_to: kepInfo.validTo || null,
      kep_tax_id: kepInfo.taxId,
      updated_at: new Date().toISOString(),
    })

  if (tokenError) {
    // Roll back client
    await supabase.from('clients').delete().eq('id', client.id)
    return NextResponse.json({ error: tokenError.message }, { status: 500 })
  }

  return NextResponse.json({
    id: client.id,
    name: clientName,
    taxId: kepInfo.taxId,
    caName: kepInfo.caName,
    validTo: kepInfo.validTo,
  }, { status: 201 })
}
