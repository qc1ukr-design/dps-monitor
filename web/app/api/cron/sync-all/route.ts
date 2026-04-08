/**
 * GET /api/cron/sync-all
 *
 * Called by Vercel Cron (see vercel.json).
 * Syncs DPS data for ALL clients with KEP configured,
 * then detects changes and writes alerts.
 *
 * Protected by CRON_SECRET env var.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
// backendGetKep is used here (not backendGetKepCredentialByClient) because sync-all
// runs as a cron with a Supabase service_role client — no individual user JWTs available.
// userId is NOT passed — the backend resolves it from the kep_credentials row.
import { backendGetKep } from '@/lib/backend'
import { signWithKepDecrypted } from '@/lib/dps/signer'
import { normalizeProfile, normalizeBudget } from '@/lib/dps/normalizer'
import { detectAlerts, detectDocumentAlerts, alertIcon } from '@/lib/dps/alerts'
import type { RawDpsDoc } from '@/lib/dps/alerts'
import { normalizeDocuments } from '@/lib/dps/normalizer'
import { sendAlertEmail } from '@/lib/email'
import { sendTelegramMessage } from '@/lib/telegram'

const DPS_BASE = 'https://cabinet.tax.gov.ua/ws/public_api'

async function dpsFetch(endpoint: string, authHeader: string) {
  const res = await fetch(`${DPS_BASE}/${endpoint}`, {
    method: 'GET',
    headers: { Authorization: authHeader, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  })
  const text = await res.text()
  let body: unknown
  try { body = JSON.parse(text) } catch { body = null }
  return { ok: res.ok, status: res.status, body }
}

async function sendExpoPush(token: string, title: string, body: string): Promise<void> {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default' }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    // fire-and-forget — не зупиняємо cron при помилці push
  }
}

export async function GET(request: NextRequest) {
  // ── Auth: verify Vercel cron secret ──────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  let synced = 0
  let errors = 0
  let alertsCreated = 0
  const clientResults: Record<string, unknown> = {}

  // ── Fetch all active KEPs from kep_credentials ───────────────────────────
  // Previously read from api_tokens — migrated here so new KEP uploads (which
  // write to kep_credentials only) are picked up automatically.
  const { data: tokens, error: tokensError } = await supabase
    .from('kep_credentials')
    .select('client_id, user_id, tax_id, valid_to')
    .eq('is_active', true)
    .not('client_id', 'is', null)

  if (tokensError) {
    return NextResponse.json({ error: tokensError.message }, { status: 500 })
  }
  if (!tokens?.length) {
    return NextResponse.json({ ok: true, message: 'No clients with KEP', synced: 0 })
  }

  // ── Client name lookup ────────────────────────────────────────────────────
  const clientIds = tokens.map(t => t.client_id)
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, edrpou')
    .in('id', clientIds)
  const clientMap    = new Map(clients?.map(c => [c.id, c.name])   ?? [])
  const clientEdrpouMap = new Map(clients?.map(c => [c.id, c.edrpou ?? '']) ?? [])

  // ── User email + Telegram lookup (for notifications) ─────────────────────
  const uniqueUserIds = Array.from(new Set(tokens.map(t => t.user_id)))
  const userEmailMap = new Map<string, string>()
  const userTelegramMap = new Map<string, string>() // user_id → chat_id

  for (const uid of uniqueUserIds) {
    try {
      const { data: { user } } = await supabase.auth.admin.getUserById(uid)
      if (user?.email) userEmailMap.set(uid, user.email)
    } catch { /* skip */ }
  }

  // Fetch Telegram chat IDs for users who opted in
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, telegram_chat_id')
    .in('user_id', uniqueUserIds)
    .eq('notify_telegram', true)
    .not('telegram_chat_id', 'is', null)

  for (const s of settings ?? []) {
    if (s.telegram_chat_id) userTelegramMap.set(s.user_id, s.telegram_chat_id)
  }

  // Fetch Expo push tokens for users who have them (push відправляємо всім у кого є token)
  const { data: pushSettings } = await supabase
    .from('user_settings')
    .select('user_id, expo_push_token')
    .in('user_id', uniqueUserIds)
    .not('expo_push_token', 'is', null)

  const userPushTokenMap = new Map<string, string>()
  for (const s of pushSettings ?? []) {
    if (s.expo_push_token) userPushTokenMap.set(s.user_id, s.expo_push_token)
  }

  // ── Process each client ───────────────────────────────────────────────────
  for (const token of tokens) {
    const { client_id: clientId, user_id: userId } = token
    const clientName = clientMap.get(clientId) ?? clientId

    try {
      // Fetch and decrypt KEP via backend (userId resolved server-side from kep_credentials)
      const { kepData: kepDecrypted, password } = await backendGetKep(clientId)
      // For ЮО (legal entities): clients.edrpou is the 8-digit ЄДРПОУ.
      // kep_credentials.tax_id stores the director's РНОКПП (10 digits).
      // DPS requires signing with ЄДРПОУ for ЮО — same logic as sync/route.ts.
      const clientEdrpou = clientEdrpouMap.get(clientId)?.trim() ?? ''
      const taxId = (clientEdrpou && /^\d{8}$/.test(clientEdrpou))
        ? clientEdrpou
        : (token.tax_id?.trim() ?? '')
      if (!taxId) { errors++; continue }

      // Sign
      const auth = await signWithKepDecrypted(kepDecrypted, password, taxId)

      // Read OLD cached data before overwriting
      const { data: oldCache } = await supabase
        .from('dps_cache')
        .select('data_type, data')
        .eq('client_id', clientId)
        .in('data_type', ['profile', 'budget', 'documents'])

      const oldProfile  = oldCache?.find(r => r.data_type === 'profile')?.data ?? null
      const oldBudget   = oldCache?.find(r => r.data_type === 'budget')?.data ?? null
      const oldDocCache = oldCache?.find(r => r.data_type === 'documents')?.data as { ids?: string[] } | null

      // Fetch fresh data from DPS
      const year = new Date().getFullYear()
      const [profileResult, budgetResult, docsResult] = await Promise.all([
        dpsFetch('payer_card', auth),
        dpsFetch(`ta/splatp?year=${year}`, auth),
        dpsFetch('post/incoming?page=0&size=50', auth),
      ])

      const now = new Date().toISOString()
      let newProfile: unknown = null
      let newBudget: unknown = null

      if (profileResult.ok && profileResult.body) {
        newProfile = normalizeProfile(profileResult.body)
        await supabase.from('dps_cache').upsert({
          client_id: clientId, user_id: userId,
          data_type: 'profile', data: newProfile,
          fetched_at: now, is_mock: false,
        }, { onConflict: 'client_id,data_type' })
      }

      if (budgetResult.ok && budgetResult.body) {
        newBudget = normalizeBudget(budgetResult.body)
        await supabase.from('dps_cache').upsert({
          client_id: clientId, user_id: userId,
          data_type: 'budget', data: newBudget,
          fetched_at: now, is_mock: false,
        }, { onConflict: 'client_id,data_type' })
      }

      // ── Documents: detect new arrivals ───────────────────────────────────
      let docAlerts = 0
      if (docsResult.ok && docsResult.body) {
        const body = docsResult.body as Record<string, unknown>
        const rawDocs: RawDpsDoc[] = Array.isArray(body.content)
          ? (body.content as RawDpsDoc[])
          : Array.isArray(body) ? (body as RawDpsDoc[]) : []

        if (rawDocs.length > 0) {
          const cachedIds = new Set<string>(oldDocCache?.ids ?? [])
          const freshIds  = rawDocs.map(d => String(d.id))

          // Only alert when we have a prior cache (first run = just seed, no alerts)
          if (cachedIds.size > 0) {
            const newDocAlerts = detectDocumentAlerts(rawDocs, cachedIds, clientName)
            if (newDocAlerts.length > 0) {
              await supabase.from('alerts').insert(
                newDocAlerts.map(a => ({
                  user_id: userId,
                  client_id: clientId,
                  type: a.type,
                  message: a.message,
                  data: a.data ?? null,
                  is_read: false,
                }))
              )
              docAlerts = newDocAlerts.length
              alertsCreated += docAlerts

              // Telegram
              const tgChatId = userTelegramMap.get(userId)
              if (tgChatId) {
                const lines = newDocAlerts.map(a => `${alertIcon(a.type)} ${a.message}`).join('\n')
                await sendTelegramMessage(tgChatId, `<b>ДПС-Монітор</b>\n\n${lines}`)
              }

              // Expo Push
              const pushToken = userPushTokenMap.get(userId)
              if (pushToken) {
                const summary = `${newDocAlerts.length} нових документів для ${clientName}`
                await sendExpoPush(pushToken, 'ДПС-Монітор', summary)
              }
            }
          }

          // Update document IDs cache (for deduplication) + full docs cache (for UI)
          const normalizedDocs = normalizeDocuments(docsResult.body)
          await Promise.all([
            supabase.from('dps_cache').upsert({
              client_id: clientId, user_id: userId,
              data_type: 'documents', data: { ids: freshIds },
              fetched_at: now, is_mock: false,
            }, { onConflict: 'client_id,data_type' }),
            supabase.from('dps_cache').upsert({
              client_id: clientId, user_id: userId,
              data_type: 'documents_full', data: normalizedDocs,
              fetched_at: now, is_mock: false,
            }, { onConflict: 'client_id,data_type' }),
          ])
        }
      }

      // Detect alerts (only when we have prior data to compare with)
      let clientAlerts = 0
      if ((oldProfile || oldBudget) && (newProfile || newBudget)) {
        const detected = detectAlerts(oldProfile, newProfile, oldBudget, newBudget, clientName)
        if (detected.length > 0) {
          await supabase.from('alerts').insert(
            detected.map(a => ({
              user_id: userId,
              client_id: clientId,
              type: a.type,
              message: a.message,
              data: a.data ?? null,
              is_read: false,
            }))
          )
          clientAlerts = detected.length
          alertsCreated += clientAlerts

          // Email notification (fire-and-forget)
          const emailAddr = userEmailMap.get(userId)
          if (emailAddr) {
            sendAlertEmail({
              to: emailAddr,
              clientName,
              alerts: detected.map(a => ({ message: a.message })),
            }).catch(() => { /* ignore */ })
          }

          // Telegram notification
          const tgChatId = userTelegramMap.get(userId)
          if (tgChatId) {
            const lines = detected.map(a => `${alertIcon(a.type)} ${a.message}`).join('\n')
            await sendTelegramMessage(tgChatId, `<b>ДПС-Монітор</b>\n\n${lines}`)
          }

          // Expo Push
          const pushToken = userPushTokenMap.get(userId)
          if (pushToken) {
            const summary = detected.map(a => a.message).join('; ').slice(0, 150)
            await sendExpoPush(pushToken, 'ДПС-Монітор', summary)
          }
        }
      }

      clientResults[clientId] = { ok: true, alerts: clientAlerts + docAlerts }
      synced++
    } catch (e) {
      clientResults[clientId] = { ok: false, error: String(e) }
      errors++
    }
  }

  // ── KEP expiry check ─────────────────────────────────────────────────────
  // Runs after all client syncs. Checks valid_to for each token and sends
  // a warning if expiring within 30 days or already expired.
  // Deduplication: skips if a kep_expiring/kep_expired alert was already created
  // in the last 6 days for that client (to avoid daily spam).
  const kepAlertClientIds = tokens
    .filter(t => t.valid_to)
    .map(t => t.client_id)

  const { data: recentKepAlerts } = kepAlertClientIds.length
    ? await supabase
        .from('alerts')
        .select('client_id, type')
        .in('client_id', kepAlertClientIds)
        .in('type', ['kep_expiring', 'kep_expired'])
        .gte('created_at', new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString())
    : { data: [] }

  const recentKepAlertSet = new Set(recentKepAlerts?.map(a => a.client_id) ?? [])
  const cronNow = new Date()

  for (const token of tokens) {
    if (!token.valid_to) continue
    if (recentKepAlertSet.has(token.client_id)) continue

    const validTo = new Date(token.valid_to)
    const msLeft = validTo.getTime() - cronNow.getTime()
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))

    let alertType: 'kep_expiring' | 'kep_expired' | null = null
    let message = ''

    const clientName = clientMap.get(token.client_id) ?? token.client_id
    const validToStr = validTo.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })

    if (daysLeft <= 0) {
      alertType = 'kep_expired'
      message = `КЕП клієнта ${clientName} прострочено (${validToStr}). Необхідно оновити ключ.`
    } else if (daysLeft <= 30) {
      alertType = 'kep_expiring'
      message = `КЕП клієнта ${clientName} закінчується через ${daysLeft} дн. (${validToStr}). Оновіть ключ завчасно.`
    }

    if (!alertType) continue

    // Insert into alerts table
    await supabase.from('alerts').insert({
      user_id: token.user_id,
      client_id: token.client_id,
      type: alertType,
      message,
      data: { daysLeft, validTo: token.valid_to },
      is_read: false,
    })
    alertsCreated++

    // Telegram
    const tgChatId = userTelegramMap.get(token.user_id)
    if (tgChatId) {
      const icon = alertType === 'kep_expired' ? '🚫' : '🔑'
      await sendTelegramMessage(tgChatId, `<b>ДПС-Монітор</b>\n\n${icon} ${message}`)
    }

    // Expo Push
    const kepPushToken = userPushTokenMap.get(token.user_id)
    if (kepPushToken) {
      const icon = alertType === 'kep_expired' ? '🚫' : '🔑'
      await sendExpoPush(kepPushToken, 'ДПС-Монітор', `${icon} ${message}`)
    }

    // Email
    const emailAddr = userEmailMap.get(token.user_id)
    if (emailAddr) {
      sendAlertEmail({
        to: emailAddr,
        clientName,
        alerts: [{ message }],
      }).catch(() => { /* ignore */ })
    }
  }

  // ── Stale sync check ────────────────────────────────────────────────────
  // After syncs complete, check which clients still haven't been updated in
  // over 48 hours. Alert once per 6 days (same dedup pattern as KEP alerts).
  const staleClientIds = clientIds.filter(id => {
    const res = clientResults[id] as { ok: boolean } | undefined
    // Only flag clients that FAILED the current sync (succeeded ones are fresh)
    return res && !res.ok
  })

  if (staleClientIds.length > 0) {
    // Get latest fetched_at per client from dps_cache
    const { data: cacheTimestamps } = await supabase
      .from('dps_cache')
      .select('client_id, fetched_at')
      .in('client_id', staleClientIds)
      .in('data_type', ['profile', 'budget'])

    // Max fetched_at per client
    const lastSyncMap = new Map<string, string>()
    for (const row of cacheTimestamps ?? []) {
      const prev = lastSyncMap.get(row.client_id)
      if (!prev || row.fetched_at > prev) lastSyncMap.set(row.client_id, row.fetched_at)
    }

    // Deduplicate: skip if sync_stale alert already sent in last 6 days
    const { data: recentStaleAlerts } = await supabase
      .from('alerts')
      .select('client_id')
      .in('client_id', staleClientIds)
      .eq('type', 'sync_stale')
      .gte('created_at', new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString())

    const recentStaleSet = new Set(recentStaleAlerts?.map(a => a.client_id) ?? [])

    for (const token of tokens.filter(t => staleClientIds.includes(t.client_id))) {
      if (recentStaleSet.has(token.client_id)) continue

      const lastSynced = lastSyncMap.get(token.client_id) ?? null
      if (!lastSynced) continue // never synced — skip (no baseline)

      const msAgo = cronNow.getTime() - new Date(lastSynced).getTime()
      const daysAgo = Math.floor(msAgo / (24 * 60 * 60 * 1000))
      if (msAgo < 48 * 60 * 60 * 1000) continue // less than 48h — not stale yet

      const clientName = clientMap.get(token.client_id) ?? token.client_id
      const lastSyncedStr = new Date(lastSynced).toLocaleDateString('uk-UA', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })
      const message = `${clientName}: синхронізація не виконується ${daysAgo} дн. (остання: ${lastSyncedStr}). Перевірте КЕП.`

      await supabase.from('alerts').insert({
        user_id: token.user_id,
        client_id: token.client_id,
        type: 'sync_stale',
        message,
        data: { daysAgo, lastSynced },
        is_read: false,
      })
      alertsCreated++

      const tgChatId = userTelegramMap.get(token.user_id)
      if (tgChatId) {
        await sendTelegramMessage(tgChatId, `<b>ДПС-Монітор</b>\n\n⚠️ ${message}`)
      }

      const emailAddr = userEmailMap.get(token.user_id)
      if (emailAddr) {
        sendAlertEmail({
          to: emailAddr,
          clientName,
          alerts: [{ message }],
        }).catch(() => { /* ignore */ })
      }
    }
  }

  return NextResponse.json({
    ok: true,
    synced,
    errors,
    alertsCreated,
    results: clientResults,
  })
}
