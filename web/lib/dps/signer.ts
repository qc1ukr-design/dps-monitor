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
 * - .dat / Key-6.dat (Ukrainian proprietaty format)
 * - .ZS2 / .ZS3 etc. — ZIP containers with Key-6.dat + *.cer inside
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

/** Check if buffer is a ZIP file (magic bytes PK\x03\x04) */
function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04
}

/**
 * If the file is a ZIP container (.ZS2, .ZS3, .zip, etc.),
 * extract key buffers and cert buffers from it.
 * Returns file list for debugging.
 */
function extractFromZip(zipBuf: Buffer): {
  keyBuffers: Buffer[]
  certBuffers: Buffer[]
  fileNames: string[]
} {
  const zip = new AdmZip(zipBuf)
  const entries = zip.getEntries()

  const CERT_EXTS = ['.cer', '.crt', '.p7b', '.p7c', '.pem']
  const KEY_EXTS  = ['.dat', '.pfx', '.p12', '.jks', '.key']

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
      // Unknown extension — try as key buffer (jkurwa will reject if invalid)
      otherBuffers.push(data)
    }
  }

  // If no explicit key files found, try all "other" files as keys
  const finalKeyBuffers = keyBuffers.length > 0
    ? keyBuffers
    : otherBuffers

  if (finalKeyBuffers.length === 0) {
    throw new Error(
      `No key files found inside ZIP container. Files found: ${fileNames.join(', ') || '(empty)'}`
    )
  }

  return { keyBuffers: finalKeyBuffers, certBuffers, fileNames }
}

/**
 * Load a Box from a KEP file buffer + password.
 * Handles both direct files and ZIP containers.
 */
function loadBox(pfxBuffer: Buffer, password: string): InstanceType<typeof jk.Box> {
  const algo = gost89.compat.algos()
  const box = new jk.Box({ algo })

  if (isZip(pfxBuffer)) {
    // .ZS2 / .ZS3 / .zip — ZIP container with Key-6.dat + cert.cer inside
    const { keyBuffers, certBuffers } = extractFromZip(pfxBuffer)
    box.loadMaterial([{ keyBuffers, certBuffers, password }])
  } else {
    // Direct .pfx / .p12 / .dat / .jks
    box.loadMaterial([{ keyBuffers: [pfxBuffer], password }])
  }

  return box
}

/**
 * Get the signing key from the box.
 * Falls back to any available key-cert pair if no explicit signing key found.
 */
function getSigningKey(box: InstanceType<typeof jk.Box>): { priv: unknown; cert: InstanceType<typeof jk.Certificate> } {
  // Try the standard signing key first
  try {
    return box.keyFor('sign', undefined) as { priv: unknown; cert: InstanceType<typeof jk.Certificate> }
  } catch {
    // Fall back: any key with a cert
    const allKeys = (box as unknown as { keys: Array<{ priv: unknown; cert: InstanceType<typeof jk.Certificate> }> }).keys
    const complete = allKeys?.filter(k => k.priv && k.cert)
    if (complete?.length) return complete[0]
    throw new Error('No key-certificate pair found in KEP file')
  }
}

/**
 * Parse a KEP file and return info about the signing certificate.
 */
export async function inspectKep(pfxBuffer: Buffer, password: string): Promise<KepInfo> {
  const box = loadBox(pfxBuffer, password)
  const keyInfo = getSigningKey(box)
  const cert = keyInfo.cert

  const subj = cert.subject as Record<string, string>
  const validity = cert.validity as { notBefore: Date; notAfter: Date }
  const issuer = cert.issuer as Record<string, string>

  // РНОКПП / ЄДРПОУ is usually in serialNumber field of subject
  const rawSerial = subj.serialNumber ?? ''
  const taxId = rawSerial
    .replace(/^(УНЗР|РНОКПП|ЄДРПОУ|TINUA-)/i, '')
    .trim()

  return {
    caName: issuer.organizationName ?? issuer.commonName ?? 'Невідомий АЦСК',
    ownerName: [subj.givenName, subj.surname].filter(Boolean).join(' ')
      || subj.commonName
      || subj.organizationName
      || 'Невідомо',
    serial: (cert.serial as Buffer | undefined)?.toString('hex') ?? '',
    validFrom: validity?.notBefore?.toISOString() ?? '',
    validTo: validity?.notAfter?.toISOString() ?? '',
    taxId,
  }
}

/**
 * Sign `data` with the KEP private key.
 * Returns base64-encoded CMS/PKCS#7 SignedData → Authorization header for DPS.
 */
export async function signWithKep(pfxBuffer: Buffer, password: string, data: string | Buffer): Promise<string> {
  const box = loadBox(pfxBuffer, password)
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')

  const message = await box.sign(dataBuffer, undefined, null, {
    tsp: false,
    detached: false,
  })

  const asn1 = (message as { as_asn1: () => Buffer }).as_asn1()
  return asn1.toString('base64')
}
