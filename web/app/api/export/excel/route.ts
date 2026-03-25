/**
 * GET /api/export/excel
 *
 * Generates and streams an Excel workbook with:
 *   Sheet 1 — «Зведений звіт»: one row per client (status, debt, overpayment, last sync)
 *   Sheet 2 — «Бюджет деталі»: one row per tax per client
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import * as XLSX from 'xlsx'
import { normalizeBudget, normalizeProfile } from '@/lib/dps/normalizer'
import type { BudgetCalculations, TaxpayerProfile } from '@/lib/dps/types'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'Не синхронізовано'
  return new Date(iso).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Kiev',
  })
}

function fmtMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  // Fetch all clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, edrpou')
    .eq('user_id', user.id)
    .order('name')

  if (!clients?.length) {
    return NextResponse.json({ error: 'No clients' }, { status: 404 })
  }

  const clientIds = clients.map(c => c.id)

  // Fetch cache rows for all clients
  const { data: cacheRows } = await supabase
    .from('dps_cache')
    .select('client_id, data_type, data, fetched_at')
    .in('client_id', clientIds)
    .in('data_type', ['profile', 'budget'])

  // ── Build lookup maps ──────────────────────────────────────────────────────
  type CacheMap = Map<string, { profile: TaxpayerProfile | null; budget: BudgetCalculations | null; lastSynced: string | null }>
  const byClient: CacheMap = new Map()

  for (const c of clients) {
    const profileRow = cacheRows?.find(r => r.client_id === c.id && r.data_type === 'profile')
    const budgetRow  = cacheRows?.find(r => r.client_id === c.id && r.data_type === 'budget')

    const profile = profileRow?.data ? normalizeProfile(profileRow.data) as TaxpayerProfile : null
    const budget  = budgetRow?.data  ? normalizeBudget(budgetRow.data)   as BudgetCalculations : null

    const times = [profileRow?.fetched_at, budgetRow?.fetched_at].filter(Boolean) as string[]
    const lastSynced = times.length
      ? times.reduce((a, b) => new Date(a) > new Date(b) ? a : b)
      : null

    byClient.set(c.id, { profile, budget, lastSynced })
  }

  const now = new Date().toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Kiev',
  })

  // ── Sheet 1: Зведений звіт ─────────────────────────────────────────────────
  const summaryRows: unknown[][] = [
    ['Зведений звіт DPS-Монітор', '', '', '', '', '', `Дата формування: ${now}`],
    [],
    ['№', 'Клієнт', 'ЄДРПОУ', 'Статус', 'Борг (грн)', 'Переплата (грн)', 'Оновлено'],
  ]

  let totalDebt = 0
  let totalOverpayment = 0

  clients.forEach((c, idx) => {
    const { profile, budget, lastSynced } = byClient.get(c.id)!
    const debt = (budget?.calculations ?? []).reduce((s, r) => s + (r.debt ?? 0), 0)
    const overpayment = (budget?.calculations ?? []).reduce((s, r) => s + (r.overpayment ?? 0), 0)
    totalDebt += debt
    totalOverpayment += overpayment

    summaryRows.push([
      idx + 1,
      c.name,
      c.edrpou ?? '',
      profile?.status ?? '',
      fmtMoney(debt),
      fmtMoney(overpayment),
      fmtDate(lastSynced),
    ])
  })

  summaryRows.push([])
  summaryRows.push(['', 'РАЗОМ', '', '', fmtMoney(totalDebt), fmtMoney(totalOverpayment), ''])

  // ── Sheet 2: Бюджет деталі ─────────────────────────────────────────────────
  const detailRows: unknown[][] = [
    ['Деталі розрахунків з бюджетом', '', '', '', '', '', `Дата формування: ${now}`],
    [],
    ['Клієнт', 'ЄДРПОУ', 'Код податку', 'Назва податку', 'Нараховано (грн)', 'Сплачено (грн)', 'Борг (грн)', 'Переплата (грн)'],
  ]

  for (const c of clients) {
    const { budget } = byClient.get(c.id)!
    const rows = budget?.calculations ?? []
    if (rows.length === 0) {
      detailRows.push([c.name, c.edrpou ?? '', '', 'Немає даних', '', '', '', ''])
      continue
    }
    for (const row of rows) {
      detailRows.push([
        c.name,
        c.edrpou ?? '',
        row.taxCode,
        row.taxName,
        fmtMoney(row.charged),
        fmtMoney(row.paid),
        fmtMoney(row.debt),
        fmtMoney(row.overpayment),
      ])
    }
  }

  // ── Build workbook ─────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()

  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows)
  ws1['!cols'] = [
    { wch: 4 }, { wch: 35 }, { wch: 12 }, { wch: 28 },
    { wch: 14 }, { wch: 16 }, { wch: 18 },
  ]
  XLSX.utils.book_append_sheet(wb, ws1, 'Зведений звіт')

  const ws2 = XLSX.utils.aoa_to_sheet(detailRows)
  ws2['!cols'] = [
    { wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 40 },
    { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
  ]
  XLSX.utils.book_append_sheet(wb, ws2, 'Бюджет деталі')

  // ── Stream response ────────────────────────────────────────────────────────
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const dateStr = new Date().toISOString().slice(0, 10)
  const filename = `dps-monitor-${dateStr}.xlsx`

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
