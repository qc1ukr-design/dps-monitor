/**
 * DSTU 4145 CMS signing for DPS Cabinet API authentication.
 *
 * DPS ws/public_api requires Authorization header:
 *   base64(PKCS#7 CAdES-BES signed data of РНОКПП/ЄДРПОУ string)
 * No "Bearer" prefix — raw base64.
 */

// jkurwa is CommonJS, loaded at runtime (serverExternalPackages in next.config)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jk = require('jkurwa') as typeof import('jkurwa')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gost89 = require('gost89') as { compat: { algos: () => unknown } }

export interface KepInfo {
  /** Auto-detected CA name (from certificate subject) */
  caName: string
  /** Certificate owner name */
  ownerName: string
  /** Certificate serial number */
  serial: string
  /** Valid from (ISO string) */
  validFrom: string
  /** Valid to (ISO string) */
  validTo: string
  /** РНОКПП or ЄДРПОУ extracted from certificate */
  taxId: string
}

/**
 * Parse a .pfx/.p12/dat key store and return info about the signing certificate.
 * Does NOT expose the private key.
 */
export async function inspectKep(
  pfxBuffer: Buffer,
  password: string
): Promise<KepInfo> {
  const algo = gost89.compat.algos()
  const box = new jk.Box({ algo })

  box.loadMaterial([{
    keyBuffers: [pfxBuffer],
    password,
  }])

  const keyInfo = box.keyFor('sign', undefined)
  if (!keyInfo) throw new Error('No signing key found in KEP file')

  const cert = keyInfo.cert
  if (!cert) throw new Error('No certificate found for signing key')

  const subj = cert.subject as Record<string, string>
  const validity = cert.validity as { notBefore: Date; notAfter: Date }
  const issuer = cert.issuer as Record<string, string>

  // Extract РНОКПП / ЄДРПОУ from serial number field (Ukrainian PKI convention)
  const taxId = subj.serialNumber?.replace(/^УНЗР|^РНОКПП|^ЄДРПОУ/i, '').trim()
    ?? subj.serialNumber
    ?? ''

  return {
    caName: issuer.organizationName ?? issuer.commonName ?? 'Невідомий АЦСК',
    ownerName: [subj.givenName, subj.surname].filter(Boolean).join(' ')
      || subj.commonName
      || subj.organizationName
      || 'Невідомо',
    serial: cert.serial?.toString('hex') ?? '',
    validFrom: validity?.notBefore?.toISOString() ?? '',
    validTo: validity?.notAfter?.toISOString() ?? '',
    taxId,
  }
}

/**
 * Sign `data` with the signing key from the KEP file.
 * Returns base64-encoded CMS/PKCS#7 SignedData — ready for DPS Authorization header.
 */
export async function signWithKep(
  pfxBuffer: Buffer,
  password: string,
  data: string | Buffer
): Promise<string> {
  const algo = gost89.compat.algos()
  const box = new jk.Box({ algo })

  box.loadMaterial([{
    keyBuffers: [pfxBuffer],
    password,
  }])

  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')

  // sign returns a Message; as_asn1() gives the DER-encoded CMS SignedData
  const message = await box.sign(dataBuffer, undefined, null, {
    tsp: false,
    detached: false,
  })

  const asn1 = (message as { as_asn1: () => Buffer }).as_asn1()
  return asn1.toString('base64')
}
