/**
 * GET /api/export/excel
 *
 * Generates a styled Excel workbook:
 *   Sheet 1 — «Зведений звіт»:   summary per client
 *   Sheet 2 — «Бюджет деталі»:   tax details per client
 *   Sheet 3 — «Звіти»:           submitted reports for current year (live DPS fetch)
 */
export const maxDuration = 60 // Vercel: allow up to 60s for parallel DPS fetches

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ExcelJS from 'exceljs'
import { normalizeBudget, normalizeProfile, normalizeReports } from '@/lib/dps/normalizer'
import type { BudgetCalculations, TaxpayerProfile } from '@/lib/dps/types'
import { decrypt } from '@/lib/crypto'
import { loginWithKep, loginWithKepStamp } from '@/lib/dps/dps-auth'

const DPS_API  = 'https://cabinet.tax.gov.ua/ws/api'
const DPS_A    = 'https://cabinet.tax.gov.ua/ws/a'
const RPT_YEAR = new Date().getFullYear()

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  hdrBg:    'FF1D4ED8',  // blue-700  — header fill
  hdrFg:    'FFFFFFFF',  // white     — header text
  titleBg:  'FF1E3A8A',  // blue-900  — title fill
  altRow:   'FFF5F8FF',  // blue-50   — alternating row
  totalBg:  'FFDBEAFE',  // indigo-100— totals row
  redBg:    'FFFEE2E2',  // red-100
  redFg:    'FFB91C1C',  // red-700
  grnBg:    'FFF0FDF4',  // green-50
  grnFg:    'FF15803D',  // green-700
  bluBg:    'FFEFF6FF',  // blue-50
  bluFg:    'FF1D4ED8',  // blue-700
  bdr:      'FFE5E7EB',  // gray-200
  bdrLight: 'FFF3F4F6',  // gray-100
  gray:     'FF6B7280',  // gray-500
  white:    'FFFFFFFF',
}

// ── Style helpers ─────────────────────────────────────────────────────────────
function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}
function thin(c = C.bdr): ExcelJS.Border {
  return { style: 'thin', color: { argb: c } }
}
function allBorders(): Partial<ExcelJS.Borders> {
  return { top: thin(), bottom: thin(), left: thin(), right: thin() }
}

function styleHeader(row: ExcelJS.Row, cols: number) {
  row.height = 26
  for (let i = 1; i <= cols; i++) {
    const cell = row.getCell(i)
    cell.font      = { bold: true, color: { argb: C.hdrFg }, size: 10, name: 'Calibri' }
    cell.fill      = fill(C.hdrBg)
    cell.border    = allBorders()
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
  }
}

function styleData(row: ExcelJS.Row, isAlt: boolean, cols: number) {
  row.height = 19
  for (let i = 1; i <= cols; i++) {
    const cell = row.getCell(i)
    cell.fill   = fill(isAlt ? C.altRow : C.white)
    cell.border = { bottom: thin(), left: thin(C.bdrLight), right: thin(C.bdrLight) }
  }
}

function styleTotals(row: ExcelJS.Row, cols: number) {
  row.height = 22
  for (let i = 1; i <= cols; i++) {
    const cell = row.getCell(i)
    cell.font   = { bold: true, size: 10, name: 'Calibri' }
    cell.fill   = fill(C.totalBg)
    cell.border = allBorders()
  }
}

function moneyCell(cell: ExcelJS.Cell, value: number, type: 'debt' | 'ovr' | 'neutral') {
  cell.value     = value === 0 ? null : value
  cell.numFmt    = '# ##0.00'
  cell.alignment = { horizontal: 'right', vertical: 'middle' }
  if (value > 0 && type === 'debt') {
    cell.fill = fill(C.redBg)
    cell.font = { bold: true, color: { argb: C.redFg }, size: 10, name: 'Calibri' }
  } else if (value > 0 && type === 'ovr') {
    cell.fill = fill(C.grnBg)
    cell.font = { bold: true, color: { argb: C.grnFg }, size: 10, name: 'Calibri' }
  }
}

function addTitle(ws: ExcelJS.Worksheet, title: string, cols: number, dateStr: string) {
  // Row 1 — main title
  ws.mergeCells(1, 1, 1, cols)
  const t = ws.getCell(1, 1)
  t.value     = `  ${title}`
  t.font      = { bold: true, size: 13, color: { argb: C.hdrFg }, name: 'Calibri' }
  t.fill      = fill(C.titleBg)
  t.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(1).height = 32

  // Row 2 — date
  ws.mergeCells(2, 1, 2, cols)
  const d = ws.getCell(2, 1)
  d.value     = `  Дата формування: ${dateStr}`
  d.font      = { italic: true, size: 9, color: { argb: C.gray }, name: 'Calibri' }
  d.fill      = fill('FFF8FAFF')
  d.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(2).height = 18

  // Row 3 — spacer
  ws.addRow([]).height = 4
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev',
  })
}

function round2(n: number) { return Math.round(n * 100) / 100 }

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  // Parallel DB fetches
  const [clientsRes, tokenRes, cacheRes] = await Promise.all([
    supabase.from('clients').select('id, name, edrpou').eq('user_id', user.id).order('name'),
    supabase.from('api_tokens')
      .select('client_id, kep_encrypted, kep_password_encrypted, kep_tax_id, kep_valid_to, token_encrypted')
      .eq('user_id', user.id),
    supabase.from('dps_cache')
      .select('client_id, data_type, data, fetched_at')
      .in('data_type', ['profile', 'budget']),
  ])

  const clients   = clientsRes.data ?? []
  const tokens    = tokenRes.data   ?? []
  const cacheRows = cacheRes.data   ?? []

  if (!clients.length) return NextResponse.json({ error: 'No clients' }, { status: 404 })

  const tokenMap = new Map(tokens.map(t => [t.client_id, t]))

  // ── Cache lookup ────────────────────────────────────────────────────────────
  type Cached = { profile: TaxpayerProfile | null; budget: BudgetCalculations | null; lastSynced: string | null }
  const byClient = new Map<string, Cached>()
  for (const c of clients) {
    const pr = cacheRows.find(r => r.client_id === c.id && r.data_type === 'profile')
    const br = cacheRows.find(r => r.client_id === c.id && r.data_type === 'budget')
    const times = [pr?.fetched_at, br?.fetched_at].filter(Boolean) as string[]
    byClient.set(c.id, {
      profile: pr?.data ? normalizeProfile(pr.data) as TaxpayerProfile : null,
      budget:  br?.data ? normalizeBudget(br.data)  as BudgetCalculations : null,
      lastSynced: times.length ? times.reduce((a, b) => new Date(a) > new Date(b) ? a : b) : null,
    })
  }

  // ── Fetch reports for all clients in parallel ───────────────────────────────
  type RptResult = { clientId: string; reports: ReturnType<typeof normalizeReports>['reports']; error: string | null }

  const reportFetches = await Promise.allSettled(
    clients.map(async (c): Promise<RptResult> => {
      const tok  = tokenMap.get(c.id)
      const hasKep  = !!(tok?.kep_encrypted && tok?.kep_password_encrypted)
      const hasUuid = !!tok?.token_encrypted
      if (!hasKep && !hasUuid) return { clientId: c.id, reports: [], error: 'Немає KEP' }

      const edrpou   = c.edrpou?.trim() ?? ''
      const kepTaxId = (tok?.kep_tax_id ?? '').trim()
      const rptUrl  = `${DPS_API}/regdoc/list?periodYear=${RPT_YEAR}&page=0&size=100&sort=dget,desc`
      const rptUrlA = `${DPS_A}/regdoc/list?periodYear=${RPT_YEAR}&page=0&size=100&sort=dget,desc`

      if (hasKep) {
        try {
          const kepDecrypted = decrypt(tok!.kep_encrypted!)
          const kepPwd       = decrypt(tok!.kep_password_encrypted!)
          const isYuo        = !!(edrpou && /^\d{8}$/.test(edrpou))

          let accessToken: string | null = null

          // For ЮО: use stamp cert OAuth (ЄДРПОУ context) to get ЮО reports
          if (isYuo) {
            const stampResult = await loginWithKepStamp(kepDecrypted, kepPwd)
            if (typeof stampResult === 'object') {
              accessToken = stampResult.accessToken
            }
          }

          // Fallback to ФО OAuth (also used for ФО/ФОП clients)
          if (!accessToken) {
            const result = await loginWithKep(kepDecrypted, kepPwd, kepTaxId)
            accessToken = result.accessToken
          }

          const res = await fetch(rptUrl, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(12000), cache: 'no-store',
          })
          if (res.ok) return { clientId: c.id, reports: normalizeReports(await res.json()).reports, error: null }
          const body = await res.text().catch(() => '')
          return { clientId: c.id, reports: [], error: `ДПС HTTP ${res.status}: ${body.slice(0, 120)}` }
        } catch (e) {
          const msg = String(e)
          if (!hasUuid) return { clientId: c.id, reports: [], error: msg.slice(0, 120) }
          // else fall through to uuid
        }
      }

      if (hasUuid) {
        try {
          const res = await fetch(rptUrlA, {
            headers: { Authorization: `Bearer ${decrypt(tok!.token_encrypted!).trim()}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(12000), cache: 'no-store',
          })
          if (res.ok) return { clientId: c.id, reports: normalizeReports(await res.json()).reports, error: null }
          const body = await res.text().catch(() => '')
          return { clientId: c.id, reports: [], error: `ДПС HTTP ${res.status}: ${body.slice(0, 120)}` }
        } catch (e) {
          return { clientId: c.id, reports: [], error: String(e).slice(0, 120) }
        }
      }

      return { clientId: c.id, reports: [], error: 'Немає KEP або UUID токена' }
    })
  )

  const reportsMap = new Map<string, RptResult>(
    reportFetches
      .filter((r): r is PromiseFulfilledResult<RptResult> => r.status === 'fulfilled')
      .map(r => [r.value.clientId, r.value])
  )

  // ── Build workbook ──────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator  = 'DPS-Monitor'
  wb.created  = new Date()
  wb.modified = new Date()

  const dateStr = new Date().toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev',
  })

  // ════════════════════════════════════════════════════════════════════════════
  // Sheet 1: Зведений звіт
  // ════════════════════════════════════════════════════════════════════════════
  {
    const ws   = wb.addWorksheet('Зведений звіт')
    ws.views   = [{ state: 'frozen', ySplit: 4 }]
    const COLS = 8
    addTitle(ws, 'ДПС-Монітор  ·  Зведений звіт', COLS, dateStr)

    const hdr = ws.addRow(['№', 'Клієнт', 'ЄДРПОУ', 'Статус платника', 'Заборгованість, грн', 'Переплата, грн', 'Синхронізовано', 'КЕП дійсний до'])
    styleHeader(hdr, COLS)

    const excelNow = new Date()
    let totDebt = 0, totOvr = 0
    clients.forEach((c, i) => {
      const { profile, budget, lastSynced } = byClient.get(c.id)!
      const debt = (budget?.calculations ?? []).reduce((s, r) => s + (r.debt        ?? 0), 0)
      const ovr  = (budget?.calculations ?? []).reduce((s, r) => s + (r.overpayment ?? 0), 0)
      totDebt += debt; totOvr += ovr

      const tok = tokenMap.get(c.id)
      const kepValidToStr = tok?.kep_valid_to ?? null
      const kepValidTo = kepValidToStr ? new Date(kepValidToStr) : null
      const kepExpired = kepValidTo ? kepValidTo < excelNow : false
      const kepExpiringSoon = !kepExpired && kepValidTo
        ? (kepValidTo.getTime() - excelNow.getTime()) < 30 * 24 * 60 * 60 * 1000
        : false
      const kepDisplay = kepValidTo
        ? kepValidTo.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Kiev' })
        : '—'

      const row = ws.addRow([i + 1, c.name, c.edrpou ?? '', profile?.status ?? '', null, null, fmtDate(lastSynced), kepDisplay])
      styleData(row, i % 2 === 1, COLS)
      row.getCell(1).alignment = { horizontal: 'center' }
      row.getCell(2).font      = { bold: true, size: 10, name: 'Calibri' }
      row.getCell(3).alignment = { horizontal: 'center' }
      row.getCell(3).font      = { size: 9, color: { argb: C.gray }, name: 'Calibri' }
      row.getCell(7).font      = { size: 9, color: { argb: C.gray }, name: 'Calibri' }
      moneyCell(row.getCell(5), round2(debt), 'debt')
      moneyCell(row.getCell(6), round2(ovr),  'ovr')
      const kepCell = row.getCell(8)
      kepCell.alignment = { horizontal: 'center', vertical: 'middle' }
      if (kepExpired) {
        kepCell.fill = fill(C.redBg)
        kepCell.font = { bold: true, color: { argb: C.redFg }, size: 10, name: 'Calibri' }
      } else if (kepExpiringSoon) {
        kepCell.fill = fill('FFFFF7ED')  // amber-50
        kepCell.font = { bold: true, color: { argb: 'FFB45309' }, size: 10, name: 'Calibri' }  // amber-700
      } else {
        kepCell.font = { size: 9, color: { argb: C.gray }, name: 'Calibri' }
      }
    })

    ws.addRow([]).height = 4
    const tot = ws.addRow(['', 'РАЗОМ', '', '', round2(totDebt), round2(totOvr), '', ''])
    styleTotals(tot, COLS)
    tot.getCell(5).numFmt    = '# ##0.00'
    tot.getCell(5).alignment = { horizontal: 'right' }
    tot.getCell(6).numFmt    = '# ##0.00'
    tot.getCell(6).alignment = { horizontal: 'right' }
    if (totDebt > 0) { tot.getCell(5).fill = fill(C.redBg); tot.getCell(5).font = { bold: true, color: { argb: C.redFg }, size: 10 } }
    if (totOvr  > 0) { tot.getCell(6).fill = fill(C.grnBg); tot.getCell(6).font = { bold: true, color: { argb: C.grnFg }, size: 10 } }

    ws.columns = [
      { width: 5  },
      { width: 38 },
      { width: 13 },
      { width: 28 },
      { width: 22 },
      { width: 20 },
      { width: 22 },
      { width: 18 },
    ]
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Sheet 2: Бюджет деталі
  // ════════════════════════════════════════════════════════════════════════════
  {
    const ws   = wb.addWorksheet('Бюджет деталі')
    ws.views   = [{ state: 'frozen', ySplit: 4 }]
    const COLS = 8
    addTitle(ws, 'ДПС-Монітор  ·  Деталі розрахунків з бюджетом', COLS, dateStr)

    const hdr = ws.addRow(['Клієнт', 'ЄДРПОУ', 'Код', 'Назва податку', 'Нараховано, грн', 'Сплачено, грн', 'Борг, грн', 'Переплата, грн'])
    styleHeader(hdr, COLS)

    let ri = 0
    for (const c of clients) {
      const { budget } = byClient.get(c.id)!
      const rows = budget?.calculations ?? []
      if (!rows.length) {
        const row = ws.addRow([c.name, c.edrpou ?? '', '', 'Немає даних', '', '', '', ''])
        styleData(row, ri % 2 === 1, COLS)
        row.getCell(4).font = { italic: true, color: { argb: C.gray }, size: 10, name: 'Calibri' }
        ri++; continue
      }
      for (const r of rows) {
        const row = ws.addRow([c.name, c.edrpou ?? '', r.taxCode ?? '', r.taxName ?? '', null, null, null, null])
        styleData(row, ri % 2 === 1, COLS)
        row.getCell(2).alignment = { horizontal: 'center' }
        row.getCell(3).alignment = { horizontal: 'center' }
        row.getCell(3).font = { size: 9, color: { argb: C.gray }, name: 'Calibri' }
        moneyCell(row.getCell(5), round2(r.charged     ?? 0), 'neutral')
        moneyCell(row.getCell(6), round2(r.paid        ?? 0), 'neutral')
        moneyCell(row.getCell(7), round2(r.debt        ?? 0), 'debt')
        moneyCell(row.getCell(8), round2(r.overpayment ?? 0), 'ovr')
        ri++
      }
    }

    ws.columns = [
      { width: 36 },
      { width: 13 },
      { width: 12 },
      { width: 48 },
      { width: 18 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
    ]
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Sheet 3: Звіти (current year, live DPS)
  // ════════════════════════════════════════════════════════════════════════════
  {
    const ws   = wb.addWorksheet('Звіти')
    ws.views   = [{ state: 'frozen', ySplit: 4 }]
    const COLS = 7
    addTitle(ws, `ДПС-Монітор  ·  Звіти за ${RPT_YEAR} рік`, COLS, dateStr)

    const hdr = ws.addRow(['Клієнт', 'ЄДРПОУ', 'Дата подачі', 'Назва звіту', 'Форма', 'Звітний період', 'Статус'])
    styleHeader(hdr, COLS)

    const STATUS_LABEL: Record<string, string> = {
      accepted: 'Прийнято', rejected: 'Відхилено', processing: 'В обробці', pending: 'Очікує',
    }
    const STATUS_CLR: Record<string, { bg: string; fg: string }> = {
      accepted:   { bg: C.grnBg, fg: C.grnFg },
      rejected:   { bg: C.redBg, fg: C.redFg },
      processing: { bg: C.bluBg, fg: C.bluFg },
    }

    let ri = 0
    for (const c of clients) {
      const result = reportsMap.get(c.id)
      if (!result || result.error) {
        const row = ws.addRow([c.name, c.edrpou ?? '', '', result?.error ?? 'Немає KEP', '', '', ''])
        styleData(row, ri % 2 === 1, COLS)
        row.getCell(4).font = { italic: true, color: { argb: C.gray }, size: 10, name: 'Calibri' }
        ri++; continue
      }
      if (!result.reports.length) {
        const row = ws.addRow([c.name, c.edrpou ?? '', '', `Звітів за ${RPT_YEAR} рік не знайдено`, '', '', ''])
        styleData(row, ri % 2 === 1, COLS)
        row.getCell(4).font = { italic: true, color: { argb: C.gray }, size: 10, name: 'Calibri' }
        ri++; continue
      }
      for (const rep of result.reports) {
        const submittedFmt = rep.submittedAt
          ? new Date(rep.submittedAt).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kiev' })
          : '—'
        const row = ws.addRow([
          c.name, c.edrpou ?? '', submittedFmt,
          rep.name || '—', rep.formCode || '—', rep.period || '—',
          STATUS_LABEL[rep.status] ?? rep.statusText ?? rep.status,
        ])
        styleData(row, ri % 2 === 1, COLS)
        row.getCell(2).alignment = { horizontal: 'center' }
        row.getCell(3).alignment = { horizontal: 'center' }
        const sc  = row.getCell(7)
        sc.alignment = { horizontal: 'center' }
        const clr = STATUS_CLR[rep.status]
        if (clr) {
          sc.fill = fill(clr.bg)
          sc.font = { bold: true, color: { argb: clr.fg }, size: 10, name: 'Calibri' }
        }
        ri++
      }
    }

    ws.columns = [
      { width: 36 },
      { width: 13 },
      { width: 14 },
      { width: 52 },
      { width: 14 },
      { width: 16 },
      { width: 14 },
    ]
  }

  // ── Stream response ─────────────────────────────────────────────────────────
  const buf      = await wb.xlsx.writeBuffer()
  const dateFile = new Date().toISOString().slice(0, 10)

  return new NextResponse(Buffer.from(buf), {
    status: 200,
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="dps-monitor-${dateFile}.xlsx"`,
    },
  })
}
