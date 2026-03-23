/**
 * POST /api/dps/inspect-kep
 * Debug: inspect what's inside a KEP file without saving anything.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { pfxBase64: string }
  const pfxBuffer = Buffer.from(body.pfxBase64, 'base64')

  const isZip = pfxBuffer[0] === 0x50 && pfxBuffer[1] === 0x4B && pfxBuffer[2] === 0x03 && pfxBuffer[3] === 0x04
  const result: Record<string, unknown> = {
    fileSize: pfxBuffer.length,
    isZip,
    firstBytes: pfxBuffer.slice(0, 4).toString('hex'),
  }

  if (isZip) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AdmZip = require('adm-zip') as new (buf: Buffer) => {
      getEntries(): Array<{ entryName: string; isDirectory: boolean; header: { size: number } }>
    }
    const zip = new AdmZip(pfxBuffer)
    result.zipContents = zip.getEntries().map(e => ({
      name: e.entryName,
      size: e.header.size,
      isDir: e.isDirectory,
    }))
  }

  return NextResponse.json(result)
}
