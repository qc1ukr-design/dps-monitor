/**
 * POST /api/clients/[id]/kep
 *
 * Upload KEP for a client. Accepts either:
 *   - Legacy: { pfxBase64: string, password: string }  — single file as base64
 *   - Multi-file: { files: Array<{ name: string, base64: string }>, password: string }
 *
 * Auto-detects key files vs cert files by extension.
 * Validates KEP + password, stores encrypted in api_tokens.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto'
import { inspectKep, inspectKepFiles, CERT_EXTS } from '@/lib/dps/signer'

interface RouteParams {
  params: Promise<{ id: string }>
}

function getExt(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.slice(idx).toLowerCase() : ''
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify client belongs to this user
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const body = await request.json() as {
    pfxBase64?: string                                    // legacy single-file
    files?: Array<{ name: string; base64: string }>      // new multi-file
    password: string
  }
  const { pfxBase64, files, password } = body

  if (!password) {
    return NextResponse.json({ error: 'password is required' }, { status: 400 })
  }

  let kepInfo
  let kepStorageValue: string  // what gets encrypted and stored in DB

  if (files && files.length > 0) {
    // ── Multi-file mode ────────────────────────────────────────────────────
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

    try {
      kepInfo = await inspectKepFiles(keyBuffers, certBuffers, password)
    } catch (e) {
      return NextResponse.json({
        error: 'Невірний файл KEP або неправильний пароль',
        detail: String(e),
      }, { status: 400 })
    }

    // Store as v2 JSON so sync route can reconstruct key + cert buffers
    kepStorageValue = JSON.stringify({ v: 2, files })

  } else if (pfxBase64) {
    // ── Legacy single-file mode ────────────────────────────────────────────
    let pfxBuffer: Buffer
    try {
      pfxBuffer = Buffer.from(pfxBase64, 'base64')
    } catch {
      return NextResponse.json({ error: 'Invalid pfxBase64' }, { status: 400 })
    }

    try {
      kepInfo = await inspectKep(pfxBuffer, password)
    } catch (e) {
      return NextResponse.json({
        error: 'Невірний файл KEP або неправильний пароль',
        detail: String(e),
      }, { status: 400 })
    }

    kepStorageValue = pfxBase64

  } else {
    return NextResponse.json(
      { error: 'Необхідно передати files або pfxBase64' },
      { status: 400 }
    )
  }

  // Encrypt KEP data
  const kepEncrypted = encrypt(kepStorageValue)
  const kepPasswordEncrypted = encrypt(password)

  // Update or insert api_tokens row
  const { data: existing } = await supabase
    .from('api_tokens')
    .select('id')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .single()

  const kepFields = {
    kep_encrypted: kepEncrypted,
    kep_password_encrypted: kepPasswordEncrypted,
    kep_ca_name: kepInfo.caName,
    kep_owner_name: kepInfo.ownerName,
    kep_valid_to: kepInfo.validTo || null,
    kep_tax_id: kepInfo.taxId,
    updated_at: new Date().toISOString(),
  }

  const { error } = existing
    ? await supabase
        .from('api_tokens')
        .update(kepFields)
        .eq('client_id', id)
        .eq('user_id', user.id)
    : await supabase
        .from('api_tokens')
        .insert({ client_id: id, user_id: user.id, ...kepFields })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, kepInfo })
}

// GET /api/clients/[id]/kep — return KEP metadata (no key data)
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('api_tokens')
    .select('kep_ca_name, kep_owner_name, kep_valid_to, kep_tax_id, updated_at')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .single()

  if (!data?.kep_ca_name) return NextResponse.json({ configured: false })

  return NextResponse.json({
    configured: true,
    caName: data.kep_ca_name,
    ownerName: data.kep_owner_name,
    validTo: data.kep_valid_to,
    taxId: data.kep_tax_id,
    updatedAt: data.updated_at,
  })
}
