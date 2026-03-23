declare module 'jkurwa' {
  class Box {
    constructor(opts?: { algo?: unknown; keys?: unknown[] })
    loadMaterial(info: unknown[]): void
    load(keyinfo: unknown): void
    keyFor(usage: string, role: unknown): { priv: unknown; cert: Certificate } | null
    sign(data: Buffer, role: unknown, cert: unknown, opts: {
      tsp?: boolean | string
      detached?: boolean
      time?: number
      includeChain?: boolean | string
      ocsp?: boolean
    }): Promise<{ as_asn1(): Buffer }>
    encrypt(data: Buffer, role: unknown, cert: unknown, opts?: unknown): Promise<unknown>
    unwrap(data: Buffer, content?: Buffer, opts?: unknown): Promise<unknown>
  }

  class Certificate {
    subject: Record<string, string>
    issuer: Record<string, string>
    serial: Buffer
    validity: { notBefore: Date; notAfter: Date }
    static from_asn1(data: Buffer): Certificate
    static from_pem(data: Buffer | string): Certificate
  }

  class Priv {
    static from_asn1(data: Buffer): Priv
    static from_pem(data: Buffer | string): Priv
    static from_protected(data: Buffer, password: string, algo: unknown): unknown
  }

  export { Box, Certificate, Priv }
  export const standard: Record<string, unknown>
  export const Keycoder: { guess_parse(data: Buffer): unknown }
}

declare module 'gost89' {
  const compat: {
    algos(): unknown
  }
  export { compat }
}
