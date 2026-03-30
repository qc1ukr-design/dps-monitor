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

// Monkey-patch: replace GOST-34311 cert hash in signingCertificateV2 with SHA-256.
// DPS OAuth server (Java/Spring) lacks GOST-34311 JCA provider → NPE → 500.
// SHA-256 is a standard JCA algorithm and works with any JVM.
// Must run at module load time before any signing occurs.
;(function patchSigningCertificateV2() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const certidSpec = require('jkurwa/lib/spec/rfc5035-certid') as {
      SigningCertificateV2: { wrap: (cert: unknown, hash: Buffer) => Buffer; encode: (val: unknown, enc: string) => Buffer }
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rfc3280 = require('jkurwa/lib/spec/rfc3280') as {
      Certificate: { encode: (cert: unknown, enc: string) => Buffer }
    }
    const { createHash } = require('crypto') as typeof import('crypto') // eslint-disable-line @typescript-eslint/no-require-imports

    certidSpec.SigningCertificateV2.wrap = function(cert: unknown): Buffer {
      const certDer = rfc3280.Certificate.encode(cert, 'der')
      const sha256Hash = createHash('sha256').update(certDer).digest()
      // SHA-256 OID as integer array — asn1.js encodes this correctly
      // OID 2.16.840.1.101.3.4.2.1
      const SHA256_OID = [2, 16, 840, 1, 101, 3, 4, 2, 1]
      const c = cert as { tbsCertificate: { issuer: unknown; serialNumber: unknown } }
      return certidSpec.SigningCertificateV2.encode({
        certs: [{
          hashAlgorithm: { algorithm: SHA256_OID },
          certHash: sha256Hash,
          issuerSerial: {
            issuer: [{ type: 'directoryName', value: c.tbsCertificate.issuer }],
            serialNumber: c.tbsCertificate.serialNumber,
          },
        }],
      }, 'der')
    }
    console.log('[signer] signingCertificateV2 → SHA-256 patch applied')
  } catch (e) {
    console.warn('[signer] signingCertificateV2 patch failed:', e)
  }
})()


export interface KepInfo {
  caName: string
  ownerName: string   // person's full name (director for ЮО certs)
  orgName: string     // organisation name from cert (empty for personal/ФОП certs)
  serial: string
  validFrom: string
  validTo: string
  taxId: string       // ЄДРПОУ (8 digits) for ЮО certs; РНОКПП (10 digits) for personal
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
 * Ukrainian CA (ЦСК/КНЕДП) servers for CMP certificate retrieval.
 * Source: https://iit.com.ua/download/productfiles/CAs.json
 * monobank uses ca.monobank.ua — must be first since it's the target CA.
 */
const CMP_SERVERS = [
  'http://ca.monobank.ua/services/cmp/',       // monobank / Universal Bank
  'http://acsk.privatbank.ua/services/cmp/',   // PrivatBank
  'http://acskidd.gov.ua/services/cmp/',       // ДПС / IIT
  'http://ca.iit.com.ua/services/cmp/',        // IIT
  'http://ca.tax.gov.ua/services/cmp/',        // Податкова
  'http://masterkey.ua/services/cmp/',         // MasterKey
  'http://uakey.com.ua/services/cmp/',         // UAKEY
  'http://ca.vchasno.ua/services/cmp/',        // Вчасно
  'http://ca.depositsign.com/services/cmp/',   // DepositSign
]

/**
 * Fetch the certificate matching the private key from Ukrainian CA servers
 * via CMP (Certificate Management Protocol).
 *
 * This is the same mechanism used by IIT's DPS Cabinet library.
 * When a .pfx contains only private keys (no certificate bags) — which is
 * the case for monobank KEP — the cert must be retrieved from the issuing CA.
 *
 * Based on jkurwa's examples/certfetch.js.
 */
async function fetchCertFromCA(box: InstanceType<typeof jk.Box>): Promise<Buffer[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Message = require('jkurwa/lib/models/Message') as new (data: Buffer | object) => {
    as_asn1: () => Buffer
    info: unknown
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JkCertificate = require('jkurwa/lib/models/Certificate') as new (data: unknown) => {
    as_asn1: () => Buffer
  }

  type BoxInternal = {
    keys: Array<{ priv: { pub: () => { keyid: (algo: unknown) => Buffer } } }>
    algo: unknown
  }
  const b = box as unknown as BoxInternal
  if (!b.keys?.length) return []

  // Build the 120-byte CMP request payload (from jkurwa certfetch.js)
  const keyids = b.keys.map(info => info.priv.pub().keyid(b.algo))
  const ct = Buffer.alloc(120)
  ct.fill(0)
  keyids[0].copy(ct, 0x0C)
  ;(keyids[1] ?? keyids[0]).copy(ct, 0x2C)
  ct[0x6C] = 0x1
  ct[0x70] = 0x1
  ct[0x08] = 2
  ct[0] = 0x0D

  const payload = (new Message({ type: 'data', data: ct })).as_asn1()

  for (const server of CMP_SERVERS) {
    try {
      const response = await fetch(server, {
        method: 'POST',
        body: new Uint8Array(payload),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signal: (AbortSignal as any).timeout(8000),
      })

      if (!response.ok) continue

      const bodyBuf = Buffer.from(await response.arrayBuffer())

      // Parse outer envelope — type='data', info is raw Buffer
      let rmsg: { info: unknown }
      try { rmsg = new Message(bodyBuf) } catch { continue }

      const infoBuf = rmsg.info as Buffer
      if (!Buffer.isBuffer(infoBuf) || infoBuf.length < 8) continue

      // Result code at offset 4: 1 = success
      if (infoBuf.readInt32LE(4) !== 1) continue

      // Parse inner message (skip 8-byte header) — signedData with certificate[]
      let rmsg2: { info: { certificate?: unknown[] } }
      try {
        rmsg2 = new Message(infoBuf.slice(8)) as { info: { certificate?: unknown[] } }
      } catch { continue }

      const certDatas = rmsg2.info?.certificate
      if (!Array.isArray(certDatas) || certDatas.length === 0) continue

      const certBuffers: Buffer[] = []
      for (const certData of certDatas) {
        try { certBuffers.push(new JkCertificate(certData).as_asn1()) } catch { /* skip */ }
      }

      if (certBuffers.length > 0) return certBuffers
    } catch { /* try next server */ }
  }

  return []
}

/**
 * Load a Box from a single KEP file buffer + password.
 * Handles both direct files and ZIP containers.
 *
 * Fallback chain when no certificates are found after initial load:
 *   1. node-forge — decrypts modern PKCS#12 cert bags (AES/PBKDF2)
 *   2. CMP fetch  — retrieves cert from Ukrainian CA server (monobank KEP case)
 */
async function loadBox(pfxBuffer: Buffer, password: string): Promise<InstanceType<typeof jk.Box>> {
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
    // Fallback 1: decrypt cert bags with node-forge (handles modern PKCS#12 encryption)
    const forgeCerts = extractCertsFromPfxFallback(pfxBuffer, password)
    if (forgeCerts.length > 0) {
      const box2 = new jk.Box({ algo })
      box2.loadMaterial([{ keyBuffers: [pfxBuffer], certBuffers: forgeCerts, password }])
      return box2
    }

    // Fallback 2: fetch cert from Ukrainian CA via CMP protocol
    // (monobank KEP: .pfx has only private keys, cert lives on the CA server)
    const caCerts = await fetchCertFromCA(box)
    if (caCerts.length > 0) {
      const box3 = new jk.Box({ algo })
      box3.loadMaterial([{ keyBuffers: [pfxBuffer], certBuffers: caCerts, password }])
      return box3
    }
  }

  return box
}

/**
 * Load a Box from pre-separated key and cert file buffers.
 * Used when user uploads .dat + .cer files separately.
 * If no certs are provided and jkurwa finds none internally,
 * falls back to CMP fetch from Ukrainian CA servers.
 */
async function loadBoxFromFiles(
  keyBuffers: Buffer[],
  certBuffers: Buffer[],
  password: string
): Promise<InstanceType<typeof jk.Box>> {
  const algo = gost89.compat.algos()
  const box = new jk.Box({ algo })
  box.loadMaterial([{ keyBuffers, certBuffers, password }])

  // If no certs were supplied and none were loaded, try CMP fetch
  type BoxInternal = { keys: Array<{ priv: unknown; cert: unknown }>; certs: unknown[] }
  const b = box as unknown as BoxInternal
  const noLinkedCerts =
    !(b.certs?.length) && (b.keys ?? []).every(k => !k.cert)

  if (noLinkedCerts && certBuffers.length === 0) {
    // Fallback 1: node-forge (for modern PKCS#12 cert bag encryption)
    for (const keyBuf of keyBuffers) {
      const forgeCerts = extractCertsFromPfxFallback(keyBuf, password)
      if (forgeCerts.length > 0) {
        const box2 = new jk.Box({ algo })
        box2.loadMaterial([{ keyBuffers, certBuffers: forgeCerts, password }])
        return box2
      }
    }

    // Fallback 2: CMP fetch from Ukrainian CA
    const caCerts = await fetchCertFromCA(box)
    if (caCerts.length > 0) {
      const box3 = new jk.Box({ algo })
      box3.loadMaterial([{ keyBuffers, certBuffers: caCerts, password }])
      return box3
    }
  }

  return box
}

/**
 * Load a Box from a decrypted KEP storage value.
 *
 * Handles two storage formats:
 *   - Legacy: raw pfxBase64 string (single file)
 *   - v2: JSON string { v: 2, files: Array<{ name: string, base64: string }> }
 */
async function loadBoxFromDecrypted(kepDecrypted: string, password: string): Promise<InstanceType<typeof jk.Box>> {
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
    return await loadBoxFromFiles(keyBuffers, certBuffers, password)
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
    `NO_CERT:Ключів: ${allKeys.length}, сертифікатів: ${allCerts.length}. ` +
    `Не вдалося отримати сертифікат ні з файлу, ні з серверів ЦСК.`
  )
}

/** Safely convert any date-like value jkurwa might return to ISO string. */
function parseCertDate(d: unknown): string {
  if (!d) return ''
  if (d instanceof Date) return isNaN(d.getTime()) ? '' : d.toISOString()
  if (typeof d === 'number') return new Date(d).toISOString()
  if (typeof d === 'string') {
    const p = new Date(d)
    return isNaN(p.getTime()) ? d : p.toISOString()
  }
  if (typeof (d as Date).getTime === 'function') {
    const t = (d as Date).getTime()
    return isNaN(t) ? '' : new Date(t).toISOString()
  }
  return ''
}

/**
 * Extract KepInfo from a jkurwa certificate object.
 */
function extractCertInfo(cert: InstanceType<typeof jk.Certificate>): KepInfo {
  const subj = cert.subject as Record<string, string>
  const validity = cert.validity as { notBefore: unknown; notAfter: unknown }
  const issuer = cert.issuer as Record<string, string>

  const rawSerial = subj.serialNumber ?? ''
  const taxId = rawSerial
    .replace(/^(УНЗР|РНОКПП|ЄДРПОУ|TINUA-)/i, '')
    .trim()

  const personName = [subj.givenName, subj.surname].filter(Boolean).join(' ')
  const orgFromCert = subj.organizationName ?? ''

  return {
    caName: issuer.organizationName ?? issuer.commonName ?? 'Невідомий АЦСК',
    ownerName: personName || subj.commonName || orgFromCert || 'Невідомо',
    orgName: orgFromCert,
    serial: (cert.serial as Buffer | undefined)?.toString('hex') ?? '',
    validFrom: parseCertDate(validity?.notBefore),
    validTo: parseCertDate(validity?.notAfter),
    taxId,
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Scan all certificates loaded into a Box and return the first 8-digit ЄДРПОУ found.
 * Used in ЮО scenario where director's signing cert has РНОКПП (10 digits)
 * but the seal cert (also loaded) has ЄДРПОУ (8 digits).
 * DPS requires signing the ЄДРПОУ data with the director's cert for ЮО auth.
 */
function extractOrgTaxId(box: InstanceType<typeof jk.Box>): string | null {
  type BoxInternal = { keys: Array<{ priv: unknown; cert: unknown }>; certs: unknown[] }
  const b = box as unknown as BoxInternal
  const allCertObjs = [
    ...(b.certs ?? []),
    ...(b.keys ?? []).map(k => k.cert).filter(Boolean),
  ]
  for (const certObj of allCertObjs) {
    if (!certObj) continue
    try {
      const info = extractCertInfo(certObj as InstanceType<typeof jk.Certificate>)
      if (/^\d{8}$/.test(info.taxId)) return info.taxId  // 8 digits = ЄДРПОУ
    } catch { /* skip invalid cert */ }
  }
  return null
}

/**
 * Parse a single KEP file buffer and return info about the signing certificate.
 */
export async function inspectKep(pfxBuffer: Buffer, password: string): Promise<KepInfo> {
  const box = await loadBox(pfxBuffer, password)
  const keyInfo = getSigningKey(box)
  return extractCertInfo(keyInfo.cert)
}

/**
 * Like inspectKep but also returns the certificate DER buffer.
 * Used by upload routes to cache the cert alongside the key,
 * so sync never needs to fetch it from CMP servers (which may be
 * unreachable from Vercel's US/EU infrastructure).
 */
export async function inspectKepWithCert(
  pfxBuffer: Buffer,
  password: string
): Promise<{ info: KepInfo; certBuffer: Buffer | null }> {
  const box = await loadBox(pfxBuffer, password)
  const keyInfo = getSigningKey(box)
  const info = extractCertInfo(keyInfo.cert)
  let certBuffer: Buffer | null = null
  try {
    certBuffer = (keyInfo.cert as unknown as { as_asn1: () => Buffer }).as_asn1()
  } catch { /* cert serialization failed — CMP will be used at sign time */ }
  return { info, certBuffer }
}

/**
 * Parse multiple KEP file buffers (key files + cert files separately) and return cert info.
 * Use when the user uploads .dat + .cer / .crt files together, or two key files (ЮО scenario).
 *
 * ЮО (legal entity) scenario — director key + seal key uploaded together:
 *   - jkurwa classifies director cert as 'sign' (digitalSignature), seal as 'stamp'
 *   - getSigningKey() returns the director cert (РНОКПП, 10 digits)
 *   - extractOrgTaxId() finds the seal cert ЄДРПОУ (8 digits) in the same box
 *   - We return taxId = ЄДРПОУ so DPS `payer_card` returns ЮО data
 *   - box.sign(ЄДРПОУ) uses director's key automatically (correct for DPS ЮО auth)
 */
export async function inspectKepFiles(
  keyBuffers: Buffer[],
  certBuffers: Buffer[],
  password: string
): Promise<KepInfo> {
  const box = await loadBoxFromFiles(keyBuffers, certBuffers, password)
  const keyInfo = getSigningKey(box)
  const info = extractCertInfo(keyInfo.cert)

  // ЮО detection: signing cert has РНОКПП (10 digits) but another loaded cert has ЄДРПОУ (8 digits)
  // In this case override taxId with ЄДРПОУ so DPS auth returns ЮО data
  if (/^\d{10}$/.test(info.taxId)) {
    const orgTaxId = extractOrgTaxId(box)
    if (orgTaxId) {
      console.log(`[signer] ЮО detected: signing cert РНОКПП=${info.taxId}, org ЄДРПОУ=${orgTaxId}`)
      // orgName may already be in info from the signing cert; if not, we don't have it here
      return { ...info, taxId: orgTaxId }
    }
  }

  return info
}

/**
 * Extract the taxId (РНОКПП or ЄДРПОУ) directly from the signing certificate.
 *
 * For ЮО director certs the stored kep_tax_id may have been overridden to ЄДРПОУ
 * (so that public_api sync works), but DPS OAuth requires the cert's own РНОКПП.
 * This function always returns the cert's actual serialNumber-based taxId.
 */
export async function getCertTaxId(kepDecrypted: string, password: string): Promise<string> {
  const box = await loadBoxFromDecrypted(kepDecrypted, password)
  const keyInfo = getSigningKey(box)
  return extractCertInfo(keyInfo.cert).taxId
}

/**
 * Get the stamp (seal / печатка) key from the box.
 * For ЮО: the stamp cert has ЄДРПОУ as serialNumber.
 * Returns null if no stamp key is found.
 */
function getStampKey(box: InstanceType<typeof jk.Box>): {
  priv: unknown
  cert: InstanceType<typeof jk.Certificate>
} | null {
  type KeyEntry = { priv: unknown; cert: InstanceType<typeof jk.Certificate> }
  try {
    const k = box.keyFor('stamp', undefined) as KeyEntry
    if (k?.priv && k?.cert) return k
  } catch { /* no stamp key */ }
  return null
}

/**
 * Returns ЄДРПОУ from the stamp (seal) certificate in the box.
 * Used for ЮО OAuth: stamp cert has serialNumber = ЄДРПОУ → OAuth returns ЮО context.
 * Returns null if no stamp cert with 8-digit ЄДРПОУ exists.
 */
export async function getStampCertTaxId(kepDecrypted: string, password: string): Promise<string | null> {
  const box = await loadBoxFromDecrypted(kepDecrypted, password)
  const stampKey = getStampKey(box)
  if (!stampKey) return null
  const info = extractCertInfo(stampKey.cert)
  return /^\d{8}$/.test(info.taxId) ? info.taxId : null
}

/**
 * Sign data using the STAMP (печатка) key from a ЮО KEP bundle.
 * The stamp cert's serialNumber = ЄДРПОУ, so DPS OAuth will accept this
 * signature for ЮО context authentication.
 * Throws if no stamp key is found in the box.
 */
export async function signWithStampKey(
  kepDecrypted: string,
  password: string,
  data: string | Buffer
): Promise<string> {
  const box = await loadBoxFromDecrypted(kepDecrypted, password)
  const stampKey = getStampKey(box)
  if (!stampKey) throw new Error('NO_STAMP_KEY: No stamp/seal certificate found in KEP bundle')

  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  const message = await box.sign(dataBuffer, stampKey.priv, null, {
    tsp: false,
    detached: false,
  })
  const asn1 = (message as { as_asn1: () => Buffer }).as_asn1()
  return asn1.toString('base64')
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
  const box = await loadBoxFromDecrypted(kepDecrypted, password)
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')

  const message = await box.sign(dataBuffer, undefined, null, {
    tsp: false,
    detached: false,
  })

  const asn1 = (message as { as_asn1: () => Buffer }).as_asn1()
  return asn1.toString('base64')
}
