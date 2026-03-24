/**
 * POST /api/dps/inspect-kep
 * Deep debug: inspect KEP file structure step by step.
 * Body: multipart/form-data with file + password
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const password = (formData.get('password') as string | null) ?? ''

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const arrayBuffer = await file.arrayBuffer()
  const pfxBuffer = Buffer.from(arrayBuffer)

  const report: Record<string, unknown> = {
    fileName: file.name,
    fileSize: pfxBuffer.length,
    firstBytes: pfxBuffer.slice(0, 8).toString('hex'),
    isZip: pfxBuffer[0] === 0x50 && pfxBuffer[1] === 0x4B,
    isPkcs12: pfxBuffer[0] === 0x30, // DER SEQUENCE
  }

  // ── Step 1: jkurwa raw ────────────────────────────────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jk = require('jkurwa')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gost89 = require('gost89')
    const algo = gost89.compat.algos()
    const box = new jk.Box({ algo })
    box.loadMaterial([{ keyBuffers: [pfxBuffer], password }])

    const b = box as { keys?: unknown[]; certs?: unknown[] }
    const keys = (b.keys ?? []) as Array<{ priv: unknown; cert: unknown; sbox: unknown }>
    const certs = (b.certs ?? []) as unknown[]

    report.jkurwa = {
      keyCount: keys.length,
      certCount: certs.length,
      keys: keys.map((k, i) => ({
        index: i,
        hasPriv: !!k.priv,
        hasCert: !!k.cert,
        hasSbox: !!k.sbox,
        privType: k.priv ? typeof k.priv : null,
        certType: k.cert ? typeof k.cert : null,
      })),
    }

    // Try keyFor
    try {
      const sk = box.keyFor('sign', undefined)
      report.jkurwa_keyForSign = { ok: true, hasPriv: !!(sk as {priv:unknown}).priv, hasCert: !!(sk as {cert:unknown}).cert }
    } catch (e) {
      report.jkurwa_keyForSign = { ok: false, error: String(e) }
    }
    try {
      const ek = box.keyFor('enc', undefined)
      report.jkurwa_keyForEnc = { ok: true, hasPriv: !!(ek as {priv:unknown}).priv, hasCert: !!(ek as {cert:unknown}).cert }
    } catch (e) {
      report.jkurwa_keyForEnc = { ok: false, error: String(e) }
    }
  } catch (e) {
    report.jkurwa = { error: String(e) }
  }

  // ── Step 2: node-forge raw ────────────────────────────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const forge = require('node-forge')
    const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'))
    const p12Asn1 = forge.asn1.fromDer(p12Der)

    let p12: ReturnType<typeof forge.pkcs12.pkcs12FromAsn1>
    let forgeLoadError: string | null = null
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password)
    } catch (e1) {
      forgeLoadError = String(e1)
      try {
        p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, true, password)
        forgeLoadError = null
      } catch (e2) {
        report.forge = { error: `strict=false: ${forgeLoadError} | strict=true: ${String(e2)}` }
        p12 = null as unknown as ReturnType<typeof forge.pkcs12.pkcs12FromAsn1>
      }
    }

    if (p12) {
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
      const keyBags2 = p12.getBags({ bagType: forge.pki.oids.keyBag })

      const certBagsArr = certBags[forge.pki.oids.certBag] ?? []
      const keyBagsArr = [
        ...(keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
        ...(keyBags2[forge.pki.oids.keyBag] ?? []),
      ]

      report.forge = {
        loadError: forgeLoadError,
        certBagCount: certBagsArr.length,
        keyBagCount: keyBagsArr.length,
        certBags: certBagsArr.map((bag: {cert: unknown; asn1: unknown; type: string}, i: number) => {
          const info: Record<string, unknown> = {
            index: i,
            type: bag.type,
            hasCert: !!bag.cert,
            hasAsn1: !!bag.asn1,
          }
          if (bag.asn1) {
            try {
              const asn1 = bag.asn1 as { value?: unknown[] }
              info.asn1ValueLength = Array.isArray(asn1.value) ? asn1.value.length : 'string'
              if (Array.isArray(asn1.value) && asn1.value[1]) {
                const wrapper = asn1.value[1] as { value?: unknown[] }
                info.wrapperValueLength = Array.isArray(wrapper.value) ? wrapper.value.length : 'string'
                if (Array.isArray(wrapper.value) && wrapper.value[0]) {
                  const inner = wrapper.value[0] as { type: number; value: unknown }
                  info.innerType = inner.type
                  info.innerValueLength = typeof inner.value === 'string' ? inner.value.length : 'array'
                }
              }
            } catch (e) {
              info.asn1NavError = String(e)
            }
          }
          return info
        }),
        keyBags: keyBagsArr.map((bag: {key: unknown; asn1: unknown; type: string}, i: number) => ({
          index: i,
          type: bag.type,
          hasKey: !!bag.key,
          hasAsn1: !!bag.asn1,
        })),
      }

      // Try to extract cert DER bytes
      const extractedCerts: number[] = []
      for (const bag of certBagsArr as Array<{cert: unknown; asn1: {value?: unknown[]} | undefined}>) {
        try {
          if (bag.asn1) {
            const wrapperArr = bag.asn1.value
            if (Array.isArray(wrapperArr) && wrapperArr.length >= 2) {
              const wrapper = wrapperArr[1] as { value?: unknown[] }
              if (Array.isArray(wrapper?.value) && wrapper.value.length >= 1) {
                const inner = wrapper.value[0] as { type: number; value: unknown }
                const certDerBytes = inner.type === 4
                  ? (inner.value as string)
                  : forge.asn1.toDer(inner).getBytes()
                if (certDerBytes) extractedCerts.push(certDerBytes.length)
              }
            }
          }
        } catch { /* skip */ }
      }
      report.forge_extractedCertSizes = extractedCerts
    }
  } catch (e) {
    report.forge = { outerError: String(e) }
  }

  // ── Step 3: raw PKCS#12 ASN.1 top-level peek ────────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const forge = require('node-forge')
    const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'))
    const p12Asn1 = forge.asn1.fromDer(p12Der) as { value: Array<{type: number; value: unknown}> }

    // Version + AuthSafe ContentInfo
    const version = p12Asn1.value?.[0]
    const authSafe = p12Asn1.value?.[1] as { value?: Array<{type: number; value: unknown}> }

    report.raw_pkcs12 = {
      topLevelChildren: p12Asn1.value?.length,
      version: version ? String(version.value) : null,
      authSafeChildren: authSafe?.value?.length,
      authSafeContentTypeOid: authSafe?.value?.[0]?.value,
    }
  } catch (e) {
    report.raw_pkcs12 = { error: String(e) }
  }

  return NextResponse.json(report, { status: 200 })
}
