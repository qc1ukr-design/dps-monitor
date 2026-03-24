/**
 * DSTU 4145 CMS signing for DPS Cabinet API authentication.
 *
 * DPS ws/public_api requires Authorization header:
 *   base64(PKCS#7 CAdES-BES signed data of РНОКПП/ЄДРПОУ string)
 * No "Bearer" prefix — raw base64.
 *
 * Supports:
 * - .pfx / .p12 (PKCS#12)
 * - .jks (Java KeyStore)
 * - .dat / Key-6.dat (Ukrainian proprietary format)
 * - .ZS2 / .ZS3 etc. — ZIP containers with Key-6.dat + *.cer inside
 * - Multiple separate files: key file(s) + cert file(s) uploaded together
 */

// jkurwa / gost89 are CommonJS, loaded at runtime (serverExternalPackages in next.config)
/* eslint-disable @typescript-eslint/no-require-imports */
const jk = require('jkurwa') as typeof import('jkurwa')
const gost89 = require('gost89') as { compat: { algos: () => unknown } }
const AdmZip = require('adm-zip') as new (buf: Buffer) => {
  getEntries(): Array<{ entryName: string; isDirectory: boolean; header: { size: number }; getData(): Buffer }>
}
/* eslint-enable @typescript-eslint/no-require-imports */

export interface KepInfo {
  caName: string
  ownerName: string
  serial: string
  validFrom: string
  validTo: string
  taxId: string
}

// File extension classification
export const CERT_EXTS = ['.cer', '.crt', '.p7b', '.p7c', '.pem']
export const KEY_EXTS  = ['.dat', '.pfx', '.p12', '.jks', '.key', '.zs2', '.zs3', '.zs1', '.sk']

/** Get lowercase extension including the dot, e.g. ".pfx" */
function getExt(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.slice(idx).toLowerCase() : ''
}

/** Check if buffer is a ZIP file (magic bytes PK\x03\x04) */
function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04
}

/**
 * If the file is a ZIP container (.ZS2, .ZS3, .zip, etc.),
 * extract key buffers and cert buffers from it.
 */
function extractFromZip(zipBuf: Buffer): {
  keyBuffers: Buffer[]
  certBuffers: Buffer[]
  fileNames: string[]
} {
  const zip = new AdmZip(zipBuf)
  const entries = zip.getEntries()

  const keyBuffers: Buffer[] = []
  const certBuffers: Buffer[] = []
  const otherBuffers: Buffer[] = []
  const fileNames: string[] = []

  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = entry.entryName.toLowerCase()
    fileNames.push(entry.entryName)
    const data = entry.getData()

    if (CERT_EXTS.some(e => name.endsWith(e))) {
      certBuffers.push(data)
    } else if (KEY_EXTS.some(e => name.endsWith(e))) {
      keyBuffers.push(data)
    } else {
      otherBuffers.push(data)
    }
  }

  const finalKeyBuffers = keyBuffers.length > 0 ? keyBuffers : otherBuffers

  if (finalKeyBuffers.length === 0) {
    throw new Error(
      `No key files found inside ZIP container. Files found: ${fileNames.join(', ') || '(empty)'}`
    )
  }

  return { keyBuffers: finalKeyBuffers, certBuffers, fileNames }
}

/**
 * Fallback cert extractor for PKCS#12 files where jkurwa cannot decrypt
 * the certificate bags (e.g. monobank KEP uses PBKDF2/AES for cert bags,
 * while jkurwa only supports older PBE-SHA1-RC2 / PBE-SHA1-3DES).
 *
 * Strategy:
 *  1. Use node-forge to decrypt and parse the PKCS#12 fully.
 *  2. For each certBag: if forge parsed the cert → re-encode to DER.
 *     If forge failed (DSTU OID unknown) → extract raw DER via bag.asn1.
 *  3. Return cert DER buffers so jkurwa can link them to its private keys.
 */
function extractCertsFromPfxFallback(pfxBuffer: Buffer, password: string): Buffer[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const forge = require('node-forge') as {
      util: { createBuffer: (s: string) => unknown }
      asn1: {
        fromDer: (b: unknown) => FAsn1
        toDer: (a: FAsn1) => { getBytes: () => string }
        Type: { OCTETSTRING: number }
      }
      pki: {
        oids: { certBag: string }
        certificateToAsn1: (c: unknown) => FAsn1
      }
      pkcs12: {
        pkcs12FromAsn1: (
          asn1: FAsn1,
          strict: boolean,
          password: string
        ) => { getBags: (o: { bagType: string }) => Record<string, FBag[]> }
      }
    }

    type FAsn1 = {
      type: number
      value: FAsn1[] | string
    }
    type FBag = {
      cert?: unknown
      asn1?: FAsn1
    }

    const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'))
    const p12Asn1 = forge.asn1.fromDer(p12Der)
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password)

    const certBagMap = p12.getBags({ bagType: forge.pki.oids.certBag })
    const bags: FBag[] = certBagMap[forge.pki.oids.certBag] ?? []

    const certBuffers: Buffer[] = []

    for (const bag of bags) {
      try {
        if (bag.cert) {
          // Forge could parse the cert (non-DSTU key type)
          const certAsn1 = forge.pki.certificateToAsn1(bag.cert)
          const certDer = forge.asn1.toDer(certAsn1)
          certBuffers.push(Buffer.from(certDer.getBytes(), 'binary'))
        } else if (bag.asn1) {
          // Forge parsed PKCS#12 structure but couldn't parse the cert itself
          // (common for DSTU 4145 certs with non-standard OIDs).
          //
          // CertBag ASN.1:
          //   SEQUENCE {
          //     OID (certId = x509Certificate)
          //     [0] EXPLICIT {
          //       OCTET STRING { <DER-encoded X.509 cert> }
          //     }
          //   }
          const certBagSeq = bag.asn1
          const wrapperArr = certBagSeq.value
          if (!Array.isArray(wrapperArr) || wrapperArr.length < 2) continue

          const explicitWrapper = wrapperArr[1]
          const innerArr = explicitWrapper?.value
          if (!Array.isArray(innerArr) || innerArr.length < 1) continue

          const inner = innerArr[0]
          let certDerBytes: string
          if (inner.type === 4 /* OCTET STRING */) {
            // value is the raw cert DER bytes as a binary string
            certDerBytes = inner.value as string
          } else {
            // value is already a SEQUENCE (the cert) — re-encode to DER
            certDerBytes = forge.asn1.toDer(inner).getBytes()
          }
          if (certDerBytes) {
            certBuffers.push(Buffer.from(certDerBytes, 'binary'))
          }
        }
      } catch {
        // skip invalid bag
      }
    }

    return certBuffers
  } catch {
    return []
  }
}

/**
 * Load a Box from a single KEP file buffer + password.
 * Handles both direct files and ZIP containers.
 *
 * For PKCS#12 (.pfx/.p12): if jkurwa finds private keys but no certificates
 * (happens with monobank KEP where cert bags use modern encryption algorithms),
 * falls back to node-forge to extract the certs and reloads the box.
 */
function loadBox(pfxBuffer: Buffer, password: string): InstanceType<typeof jk.Box> {
  const algo = gost89.compat.algos()
  const box = new jk.Box({ algo })

  if (isZip(pfxBuffer)) {
    const { keyBuffers, certBuffers } = extractFromZip(pfxBuffer)
    box.loadMaterial([{ keyBuffers, certBuffers, password }])
    return box
  }

  box.loadMaterial([{ keyBuffers: [pfxBuffer], password }])

  // Check whether jkurwa linked any certificates to the private keys
  type BoxInternal = { keys: Array<{ priv: unknown; cert: unknown }>; certs: unknown[] }
  const b = box as unknown as BoxInternal
  const noLinkedCerts =
    !(b.certs?.length) && (b.keys ?? []).every(k => !k.cert)

  if (noLinkedCerts) {
    // Fallback: decrypt cert bags with node-forge (handles modern PKCS#12 encryption)
    const fallbackCerts = extractCertsFromPfxFallback(pfxBuffer, password)
    if (fallbackCerts.length > 0) {
      const box2 = new jk.Box({ algo })
      box2.loadMaterial([{ keyBuffers: [pfxBuffer], certBuffers: fallbackCerts, password }])
      return box2
    }
  }

  return box
}

/**
 * Load a Box from pre-separated key and cert file buffers.
 * Used when user uploads .dat + .cer files separately.
 */
function loadBoxFromFiles(
  keyBuffers: Buffer[],
  certBuffers: Buffer[],
  password: string
): InstanceType<typeof jk.Box> {
  const algo = gost89.compat.algos()
  const box = new jk.Box({ algo })
  box.loadMaterial([{ keyBuffers, certBuffers, password }])
  return box
}

/**
 * Load a Box from a decrypted KEP storage value.
 *
 * Handles two storage formats:
 *   - Legacy: raw pfxBase64 string (single file)
 *   - v2: JSON string { v: 2, files: Array<{ name: string, base64: string }> }
 */
function loadBoxFromDecrypted(kepDecrypted: string, password: string): InstanceType<typeof jk.Box> {
  if (kepDecrypted.startsWith('{')) {
    // v2 multi-file format
    const { files } = JSON.parse(kepDecrypted) as {
      v: number
      files: Array<{ name: string; base64: string }>
    }
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
    return loadBoxFromFiles(keyBuffers, certBuffers, password)
  } else {
    // Legacy: single pfxBase64
    return loadBox(Buffer.from(kepDecrypted, 'base64'), password)
  }
}

/**
 * Get the signing key from the box.
 *
 * Tries multiple strategies in order, because different KEP providers
 * (monobank, Privat24, etc.) package keys and certs differently in PKCS#12:
 *   1. Standard "sign" usage key
 *   2. "enc" usage key as fallback (some single-key containers)
 *   3. Any key that already has both priv + cert linked
 *   4. Any key with priv, paired with first cert from box.certs store
 *   5. Any key with cert (last resort)
 */
function getSigningKey(box: InstanceType<typeof jk.Box>): {
  priv: unknown
  cert: InstanceType<typeof jk.Certificate>
} {
  type KeyEntry = { priv: unknown; cert: InstanceType<typeof jk.Certificate> }
  type BoxInternal = {
    keys: KeyEntry[]
    certs: InstanceType<typeof jk.Certificate>[]
  }
  const b = box as unknown as BoxInternal
  const allKeys: KeyEntry[] = b.keys ?? []
  const allCerts: InstanceType<typeof jk.Certificate>[] = b.certs ?? []

  // 1. Standard signing key
  try {
    const k = box.keyFor('sign', undefined) as KeyEntry
    if (k?.priv && k?.cert) return k
  } catch { /* continue */ }

  // 2. Encryption key (some providers issue only one key for both purposes)
  try {
    const k = box.keyFor('enc', undefined) as KeyEntry
    if (k?.priv && k?.cert) return k
  } catch { /* continue */ }

  // 3. Any key already linked to a cert
  const withBoth = allKeys.find(k => k.priv && k.cert)
  if (withBoth) return withBoth

  // 4. Key with private key + any cert from the box cert store
  //    (PKCS#12 sometimes stores key and cert in separate bags)
  const withPriv = allKeys.find(k => k.priv)
  if (withPriv) {
    const cert = allCerts[0] ?? allKeys.find(k => k.cert)?.cert
    if (cert) return { priv: withPriv.priv, cert }
  }

  // 5. Any key that at least has a cert (sign with whatever is available)
  const withCert = allKeys.find(k => k.cert)
  if (withCert) return withCert

  throw new Error(
    `Не знайдено пару ключ+сертифікат. ` +
    `Ключів: ${allKeys.length}, сертифікатів: ${allCerts.length}. ` +
    `Спробуйте завантажити .pfx разом із .cer файлом.`
  )
}

/**
 * Extract KepInfo from a jkurwa certificate object.
 */
function extractCertInfo(cert: InstanceType<typeof jk.Certificate>): KepInfo {
  const subj = cert.subject as Record<string, string>
  const validity = cert.validity as { notBefore: Date; notAfter: Date }
  const issuer = cert.issuer as Record<string, string>

  const rawSerial = subj.serialNumber ?? ''
  const taxId = rawSerial
    .replace(/^(УНЗР|РНОКПП|ЄДРПОУ|TINUA-)/i, '')
    .trim()

  return {
    caName: issuer.organizationName ?? issuer.commonName ?? 'Невідомий АЦСК',
    ownerName:
      [subj.givenName, subj.surname].filter(Boolean).join(' ') ||
      subj.commonName ||
      subj.organizationName ||
      'Невідомо',
    serial: (cert.serial as Buffer | undefined)?.toString('hex') ?? '',
    validFrom: validity?.notBefore?.toISOString() ?? '',
    validTo: validity?.notAfter?.toISOString() ?? '',
    taxId,
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a single KEP file buffer and return info about the signing certificate.
 */
export async function inspectKep(pfxBuffer: Buffer, password: string): Promise<KepInfo> {
  const box = loadBox(pfxBuffer, password)
  const keyInfo = getSigningKey(box)
  return extractCertInfo(keyInfo.cert)
}

/**
 * Parse multiple KEP file buffers (key files + cert files separately) and return cert info.
 * Use when the user uploads .dat + .cer / .crt files together.
 */
export async function inspectKepFiles(
  keyBuffers: Buffer[],
  certBuffers: Buffer[],
  password: string
): Promise<KepInfo> {
  const box = loadBoxFromFiles(keyBuffers, certBuffers, password)
  const keyInfo = getSigningKey(box)
  return extractCertInfo(keyInfo.cert)
}

/**
 * Sign `data` using KEP stored as a decrypted DB value.
 * Handles both legacy (raw pfxBase64) and v2 (JSON multi-file) formats.
 * This is the preferred function to use from API routes after decrypting from DB.
 */
export async function signWithKepDecrypted(
  kepDecrypted: string,
  password: string,
  data: string | Buffer
): Promise<string> {
  const box = loadBoxFromDecrypted(kepDecrypted, password)
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')

  const message = await box.sign(dataBuffer, undefined, null, {
    tsp: false,
    detached: false,
  })

  const asn1 = (message as { as_asn1: () => Buffer }).as_asn1()
  return asn1.toString('base64')
}

/**
 * Sign `data` with the KEP private key from a single buffer.
 * @deprecated Prefer signWithKepDecrypted when loading KEP from DB.
 */
export async function signWithKep(
  pfxBuffer: Buffer,
  password: string,
  data: string | Buffer
): Promise<string> {
  const box = loadBox(pfxBuffer, password)
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')

  const message = await box.sign(dataBuffer, undefined, null, {
    tsp: false,
    detached: false,
  })

  const asn1 = (message as { as_asn1: () => Buffer }).as_asn1()
  return asn1.toString('base64')
}
