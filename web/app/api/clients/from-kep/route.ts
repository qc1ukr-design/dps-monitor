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
import { inspectKepFiles, inspectKepWithCert, CERT_EXTS } from '@/lib/dps/signer'

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

  // Parse KEP → get owner info + extract cert buffer for storage
  let kepInfo
  let extractedCertBase64: string | null = null
  try {
    if (certBuffers.length > 0 || keyBuffers.length > 1) {
      // Multiple files: key+cert pair OR director key + seal key (ЮО scenario)
      // inspectKepFiles detects ЮО and returns ЄДРПОУ as taxId automatically
      kepInfo = await inspectKepFiles(keyBuffers, certBuffers, password)
    } else {
      // Single key file — extract cert DER for caching (avoids CMP at sync time)
      const result = await inspectKepWithCert(keyBuffers[0], password)
      kepInfo = result.info
      extractedCertBase64 = result.certBuffer ? result.certBuffer.toString('base64') : null
    }
  } catch (e) {
    return NextResponse.json({
      error: 'Невірний файл KEP або неправильний пароль',
      detail: String(e),
    }, { status: 400 })
  }

  // For ЮО: prefer organisation name from cert (orgName) over the director's personal name
  const clientName = kepInfo.orgName || kepInfo.ownerName || 'Без імені'
  // Use orgTaxId (ЄДРПОУ, 8 digits from OID 2.5.4.97 organizationIdentifier) when present
  // (ЮО director cert: orgTaxId = ЄДРПОУ, taxId = РНОКПП)
  // Fallback to taxId for ФО/ФОП certs (no orgTaxId → taxId = РНОКПП used directly)
  // NOTE: kep_tax_id always stores cert serialNumber (РНОКПП) for OAuth signing — NOT overridden
  const edrpou = kepInfo.orgTaxId ?? kepInfo.taxId ?? null

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

  // Build storage value:
  // - Multiple files (ЮО director+seal or key+cert): store all in v2 format
  // - Single file with extracted cert: embed cert in v2 format (avoids CMP at sync)
  // - Single file, cert already in file: legacy base64 (jkurwa loads it directly)
  let kepStorageValue: string
  if (certBuffers.length > 0 || keyBuffers.length > 1) {
    kepStorageValue = JSON.stringify({ v: 2, files })
  } else if (extractedCertBase64) {
    kepStorageValue = JSON.stringify({
      v: 2,
      files: [files[0], { name: '_cert.cer', base64: extractedCertBase64 }],
    })
  } else {
    kepStorageValue = files[0].base64
  }

  // Encrypt KEP via backend (KMS envelope encryption)
  const backendUrl = process.env.BACKEND_URL?.trim()
  const backendSecret = process.env.BACKEND_API_SECRET?.trim()
  if (!backendUrl || !backendSecret) {
    await supabase.from('clients').delete().eq('id', client.id)
    return NextResponse.json({ error: 'Backend not configured' }, { status: 500 })
  }

  const backendRes = await fetch(`${backendUrl}/kep/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Backend-Secret': backendSecret },
    body: JSON.stringify({
      clientId: client.id,
      userId: user.id,
      kepData: kepStorageValue,
      password,
      kepInfo: {
        caName: kepInfo.caName,
        ownerName: kepInfo.ownerName,
        validTo: kepInfo.validTo || null,
        taxId: kepInfo.taxId,
        orgName: kepInfo.orgName || null,
      },
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (!backendRes.ok) {
    const err = await backendRes.json().catch(() => ({})) as Record<string, unknown>
    // Roll back client
    await supabase.from('clients').delete().eq('id', client.id)
    return NextResponse.json({ error: (err.error as string) || 'Failed to store KEP' }, { status: 500 })
  }

  // Try to persist kep_org_name (requires migration 004 — silently skip if column missing)
  if (kepInfo.orgName) {
    await supabase
      .from('api_tokens')
      .update({ kep_org_name: kepInfo.orgName } as Record<string, string>)
      .eq('client_id', client.id)
      .eq('user_id', user.id)
      // ignore error — column may not exist yet
  }

  return NextResponse.json({
    id: client.id,
    name: clientName,
    taxId: kepInfo.taxId,
    caName: kepInfo.caName,
    validTo: kepInfo.validTo,
  }, { status: 201 })
}
