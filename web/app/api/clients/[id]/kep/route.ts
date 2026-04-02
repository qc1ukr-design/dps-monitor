/**
 * POST /api/clients/[id]/kep
 *
 * Upload KEP for a client. Accepts either:
 *   - Legacy: { pfxBase64: string, password: string }  — single file as base64
 *   - Multi-file: { files: Array<{ name: string, base64: string }>, password: string }
 *
 * Auto-detects key files vs cert files by extension.
 * Validates KEP + password, stores encrypted in kep_credentials (new table, KMS per-KEP DEK).
 *
 * Крок D (2026-04-02): switched from legacy POST /kep/upload (api_tokens) to
 * POST /kep-credentials/upload (kep_credentials). Upload now requires Supabase JWT.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { backendUploadKepCredential } from '@/lib/backend'
import { inspectKepWithCert, inspectKepFiles, CERT_EXTS } from '@/lib/dps/signer'

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

  // Verify user + get session token for backend JWT auth
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    return NextResponse.json({ error: 'No active session' }, { status: 401 })
  }

  // Fetch client — need name + edrpou for kep_credentials metadata
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, edrpou')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const body = await request.json() as {
    pfxBase64?: string
    files?: Array<{ name: string; base64: string }>
    password: string
  }
  const { pfxBase64, files, password } = body

  if (!password) {
    return NextResponse.json({ error: 'password is required' }, { status: 400 })
  }

  let kepInfo
  let kepStorageValue: string
  let fileName = ''

  if (files && files.length > 0) {
    // ── Multi-file mode ──────────────────────────────────────────────────────
    const keyBuffers: Buffer[] = []
    const certBuffers: Buffer[] = []
    const keyFiles: Array<{ name: string; base64: string }> = []

    for (const f of files) {
      const ext = getExt(f.name)
      const buf = Buffer.from(f.base64, 'base64')
      if (CERT_EXTS.includes(ext)) {
        certBuffers.push(buf)
      } else {
        keyBuffers.push(buf)
        keyFiles.push(f)
      }
    }

    if (keyBuffers.length === 0) {
      return NextResponse.json(
        { error: 'Не знайдено файл ключа серед завантажених файлів' },
        { status: 400 }
      )
    }

    // Use key file name for display in UI
    fileName = keyFiles[0]?.name ?? ''

    if (certBuffers.length > 0 || keyBuffers.length > 1) {
      try {
        kepInfo = await inspectKepFiles(keyBuffers, certBuffers, password)
      } catch (e) {
        return NextResponse.json({
          error: 'Невірний файл KEP або неправильний пароль',
          detail: String(e),
        }, { status: 400 })
      }
      kepStorageValue = JSON.stringify({ v: 2, files })
    } else {
      let extractedCertBase64: string | null = null
      try {
        const result = await inspectKepWithCert(keyBuffers[0], password)
        kepInfo = result.info
        extractedCertBase64 = result.certBuffer ? result.certBuffer.toString('base64') : null
      } catch (e) {
        return NextResponse.json({
          error: 'Невірний файл KEP або неправильний пароль',
          detail: String(e),
        }, { status: 400 })
      }
      kepStorageValue = extractedCertBase64
        ? JSON.stringify({ v: 2, files: [files[0], { name: '_cert.cer', base64: extractedCertBase64 }] })
        : JSON.stringify({ v: 2, files })
    }

  } else if (pfxBase64) {
    // ── Legacy single-file mode (API compat) ─────────────────────────────────
    let pfxBuffer: Buffer
    try {
      pfxBuffer = Buffer.from(pfxBase64, 'base64')
    } catch {
      return NextResponse.json({ error: 'Invalid pfxBase64' }, { status: 400 })
    }

    fileName = 'key.pfx'

    let extractedCertBase64: string | null = null
    try {
      const result = await inspectKepWithCert(pfxBuffer, password)
      kepInfo = result.info
      extractedCertBase64 = result.certBuffer ? result.certBuffer.toString('base64') : null
    } catch (e) {
      return NextResponse.json({
        error: 'Невірний файл KEP або неправильний пароль',
        detail: String(e),
      }, { status: 400 })
    }

    kepStorageValue = extractedCertBase64
      ? JSON.stringify({ v: 2, files: [{ name: '_key.pfx', base64: pfxBase64 }, { name: '_cert.cer', base64: extractedCertBase64 }] })
      : pfxBase64

  } else {
    return NextResponse.json(
      { error: 'Необхідно передати files або pfxBase64' },
      { status: 400 }
    )
  }

  // Delegate encryption and storage to backend (kep_credentials, KMS per-KEP DEK)
  try {
    await backendUploadKepCredential({
      clientId:   id,
      userId:     user.id,
      kepData:    kepStorageValue,
      password,
      clientName: (client as { id: string; name: string; edrpou: string }).name,
      edrpou:     (client as { id: string; name: string; edrpou: string }).edrpou,
      fileName,
      accessToken: session.access_token,
      kepInfo: {
        caName:    kepInfo.caName,
        ownerName: kepInfo.ownerName,
        orgName:   kepInfo.orgName   || null,
        taxId:     kepInfo.taxId,
        validTo:   kepInfo.validTo   || null,
      },
    })
  } catch (e) {
    console.error('[kep/route] upload error:', e)
    return NextResponse.json(
      { error: 'Помилка збереження КЕП' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, kepInfo })
}

// GET /api/clients/[id]/kep — return KEP metadata (no key data)
// Dual-read: tries kep_credentials first (new), falls back to api_tokens (legacy/backfilled).
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Primary path: kep_credentials ────────────────────────────────────────
  const { data: kc } = await supabase
    .from('kep_credentials')
    .select('ca_name, owner_name, org_name, tax_id, valid_to, edrpou, client_name, updated_at')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (kc) {
    return NextResponse.json({
      configured: true,
      caName:     kc.ca_name     ?? null,
      ownerName:  kc.owner_name  ?? kc.client_name,
      orgName:    kc.org_name    ?? null,
      validTo:    kc.valid_to    ?? null,
      taxId:      kc.tax_id      ?? kc.edrpou,
      updatedAt:  kc.updated_at,
    })
  }

  // ── Fallback: api_tokens (legacy — backfilled records with no metadata row) ──
  const [baseResult, orgNameResult] = await Promise.all([
    supabase
      .from('api_tokens')
      .select('kep_ca_name, kep_owner_name, kep_valid_to, kep_tax_id, updated_at')
      .eq('client_id', id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('api_tokens')
      .select('kep_org_name')
      .eq('client_id', id)
      .eq('user_id', user.id)
      .single(),
  ])

  const data = baseResult.data
  if (!data?.kep_ca_name) return NextResponse.json({ configured: false })

  const orgName = orgNameResult.error
    ? ''
    : ((orgNameResult.data as Record<string, string | null>)?.kep_org_name ?? '')

  return NextResponse.json({
    configured: true,
    caName:    data.kep_ca_name,
    ownerName: data.kep_owner_name,
    orgName,
    validTo:   data.kep_valid_to,
    taxId:     data.kep_tax_id,
    updatedAt: data.updated_at,
  })
}
