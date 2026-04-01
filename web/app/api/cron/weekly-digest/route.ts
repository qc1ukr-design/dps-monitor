/**
 * GET /api/cron/weekly-digest
 *
 * Called by Vercel Cron every Monday at 08:00 UTC (11:00 Kyiv).
 * Sends each user a weekly summary email + Telegram message with:
 *   • Clients with active debt
 *   • Clients not syncing (stale > 48h)
 *   • Clients with KEP expiring soon or expired
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { normalizeBudget } from '@/lib/dps/normalizer'
import type { BudgetCalculations } from '@/lib/dps/types'
import { sendTelegramMessage } from '@/lib/telegram'

export async function GET(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const now = new Date()

  // ── Fetch all tokens (to get unique users with KEP) ───────────────────────
  const { data: tokens, error: tokensError } = await supabase
    .from('api_tokens')
    .select('client_id, user_id, kep_valid_to')
    .not('kep_encrypted', 'is', null)

  if (tokensError) return NextResponse.json({ error: tokensError.message }, { status: 500 })
  if (!tokens?.length) return NextResponse.json({ ok: true, message: 'No clients with KEP' })

  const uniqueUserIds = Array.from(new Set(tokens.map(t => t.user_id)))
  const allClientIds  = tokens.map(t => t.client_id)
  const tokenMap      = new Map(tokens.map(t => [t.client_id, t]))

  // ── Batch fetch: clients, cache, archive flags ────────────────────────────
  const [clientsRes, cacheRes, archiveRes] = await Promise.all([
    supabase.from('clients').select('id, name, user_id').in('id', allClientIds),
    supabase.from('dps_cache')
      .select('client_id, data_type, data, fetched_at')
      .in('client_id', allClientIds)
      .in('data_type', ['profile', 'budget']),
    supabase.from('dps_cache')
      .select('client_id')
      .in('client_id', allClientIds)
      .eq('data_type', 'archive_flag')
      .contains('data', { archived: true }),
  ])

  const allClients  = clientsRes.data ?? []
  const cacheRows   = cacheRes.data   ?? []
  const archivedIds = new Set((archiveRes.data ?? []).map(r => r.client_id))

  // ── Telegram contact lookup ───────────────────────────────────────────────
  const userTelegramMap = new Map<string, string>()

  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, telegram_chat_id')
    .in('user_id', uniqueUserIds)
    .eq('notify_telegram', true)
    .not('telegram_chat_id', 'is', null)

  for (const s of settings ?? []) {
    if (s.telegram_chat_id) userTelegramMap.set(s.user_id, s.telegram_chat_id)
  }

  // ── Build digest per user ─────────────────────────────────────────────────
  let digestsSent = 0
  const debugLog: Record<string, unknown>[] = []

  for (const userId of uniqueUserIds) {
    const tgChatId = userTelegramMap.get(userId)
    if (!tgChatId) continue

    // Active (non-archived) clients belonging to this user
    const userClients = allClients.filter(c => c.user_id === userId && !archivedIds.has(c.id))
    if (!userClients.length) continue

    const debtClients:     { name: string; debt: number }[]                                = []
    const staleClients:    { name: string; daysSince: number }[]                           = []
    const kepIssueClients: { name: string; daysLeft: number; validToStr: string; expired: boolean }[] = []

    for (const client of userClients) {
      const cid = client.id

      // ── Debt ──────────────────────────────────────────────────────────────
      const budgetRow = cacheRows.find(r => r.client_id === cid && r.data_type === 'budget')
      if (budgetRow?.data) {
        const budget = normalizeBudget(budgetRow.data) as BudgetCalculations
        const totalDebt = (budget.calculations ?? []).reduce((s, r) => s + (r.debt ?? 0), 0)
        if (totalDebt > 1) debtClients.push({ name: client.name, debt: Math.round(totalDebt) })
      }

      // ── Stale sync ────────────────────────────────────────────────────────
      const times = cacheRows
        .filter(r => r.client_id === cid && (r.data_type === 'profile' || r.data_type === 'budget'))
        .map(r => r.fetched_at)
        .filter(Boolean)

      const token = tokenMap.get(cid)
      if (token && times.length > 0) {
        const lastSynced = times.reduce((a, b) => (a > b ? a : b))
        const msAgo = now.getTime() - new Date(lastSynced).getTime()
        if (msAgo > 48 * 60 * 60 * 1000) {
          staleClients.push({
            name: client.name,
            daysSince: Math.floor(msAgo / (24 * 60 * 60 * 1000)),
          })
        }
      }

      // ── KEP expiry ────────────────────────────────────────────────────────
      if (token?.kep_valid_to) {
        const validTo  = new Date(token.kep_valid_to)
        const msLeft   = validTo.getTime() - now.getTime()
        const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))
        const expired  = daysLeft <= 0
        const validToStr = validTo.toLocaleDateString('uk-UA', {
          day: '2-digit', month: '2-digit', year: 'numeric',
        })
        if (daysLeft <= 30) {
          kepIssueClients.push({ name: client.name, daysLeft, validToStr, expired })
        }
      }
    }

    const issueCount  = debtClients.length + staleClients.length + kepIssueClients.length
    const generatedAt = now.toLocaleDateString('uk-UA', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    })

    // ── Send Telegram ─────────────────────────────────────────────────────
    const lines: string[] = [
        `<b>📊 Тижневий звіт ДПС-Монітор</b>`,
        `${generatedAt}`,
        ``,
        `Активних клієнтів: <b>${userClients.length}</b>  |  Проблем: <b>${issueCount}</b>`,
      ]

      if (debtClients.length > 0) {
        const fmtDebt = (n: number) =>
          new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 0 }).format(n) + '\u00a0грн'
        lines.push(``, `💰 <b>Заборгованість (${debtClients.length}):</b>`)
        for (const c of debtClients) lines.push(`• ${c.name} — ${fmtDebt(c.debt)}`)
      }

      if (staleClients.length > 0) {
        lines.push(``, `⚠️ <b>Не оновлюються (${staleClients.length}):</b>`)
        for (const c of staleClients) lines.push(`• ${c.name} — ${c.daysSince} дн. тому`)
      }

      if (kepIssueClients.length > 0) {
        lines.push(``, `🔑 <b>КЕП (${kepIssueClients.length}):</b>`)
        for (const c of kepIssueClients) {
          lines.push(c.expired
            ? `• ${c.name} — прострочено (${c.validToStr})`
            : `• ${c.name} — ${c.daysLeft} дн. до ${c.validToStr}`)
        }
      }

      if (issueCount === 0) {
        lines.push(``, `✅ Все гаразд — борги та проблеми відсутні`)
      }

    lines.push(``, `<a href="https://dps-monitor.vercel.app/dashboard">Перейти на дашборд →</a>`)
    let tgError: string | null = null
    try {
      await sendTelegramMessage(tgChatId, lines.join('\n'))
    } catch (e) {
      tgError = String(e)
    }

    digestsSent++
    debugLog.push({ userId, tgChatId, tgError, issues: debtClients.length + staleClients.length + kepIssueClients.length, clients: userClients.length })
  }

  return NextResponse.json({ ok: true, digestsSent, _debug: debugLog })
}
