/**
 * POST /api/clients/[id]/kep
 *
 * Upload KEP (.pfx) for a client:
 * - Validates the KEP file + password
 * - Auto-detects CA name, owner, expiry, РНОКПП/ЄДРПОУ
 * - Encrypts and stores in api_tokens table
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto'
import { inspectKep } from '@/lib/dps/signer'

interface RouteParams {
  params: Promise<{ id: string }>
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
    pfxBase64: string
    password: string
  }
  const { pfxBase64, password } = body

  if (!pfxBase64 || !password) {
    return NextResponse.json({ error: 'pfxBase64 and password are required' }, { status: 400 })
  }

  let pfxBuffer: Buffer
  try {
    pfxBuffer = Buffer.from(pfxBase64, 'base64')
  } catch {
    return NextResponse.json({ error: 'Invalid pfxBase64' }, { status: 400 })
  }

  // Validate KEP and extract info
  let kepInfo
  try {
    kepInfo = await inspectKep(pfxBuffer, password)
  } catch (e) {
    return NextResponse.json({
      error: 'Invalid KEP file or wrong password',
      detail: String(e),
    }, { status: 400 })
  }

  // Encrypt KEP data
  const kepEncrypted = encrypt(pfxBase64)
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

  return NextResponse.json({
    ok: true,
    kepInfo,
  })
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
