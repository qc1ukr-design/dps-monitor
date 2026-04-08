import type { TaxpayerProfile, BudgetCalculations } from './types'

export type AlertType =
  | 'new_debt'
  | 'debt_increased'
  | 'debt_cleared'
  | 'overpayment_changed'
  | 'status_changed'
  | 'new_document'
  | 'kep_expiring'
  | 'kep_expired'
  | 'sync_stale'

export interface AlertPayload {
  type: AlertType
  message: string
  data?: Record<string, unknown>
}

// ── Raw DPS document (from ws/public_api/post/incoming) ──────────────────────
export interface RawDpsDoc {
  id: string | number
  cdoc?: string
  name?: string
  text?: string | null
  csti?: number
  dateIn?: string
}

// ── Budget classification codes that are ROUTINE for ФОП on simplified tax ───
// Per ALERT_POLICY.md §3.1 — update when adding ЮО or ФОП-загальник clients
const ROUTINE_BUDGET_CODES = new Set(['71040000', '18050400', '11011700'])

/**
 * Returns true if a BOTB0501 message contains ONLY routine taxes
 * (ЄСВ / ЄП / ВЗ for ФОП on simplified system).
 * Extracts all 8-digit budget classification codes from the text.
 */
function isRoutineBotb0501(text: string): boolean {
  const codes: string[] = []
  const re = /\b(\d{8})\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) codes.push(m[1])
  if (codes.length === 0) return false // no codes found → treat as non-routine
  return codes.every(code => ROUTINE_BUDGET_CODES.has(code))
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Detect alerts for newly arrived DPS documents.
 * rawDocs   — full document list from DPS (current fetch)
 * cachedIds — Set of document IDs already seen (from dps_cache)
 * edrpou    — clients.edrpou (8 digits = ЮО, 10 digits = ФО/ФОП)
 *
 * Rules per ALERT_POLICY.md:
 *  - J1499202 (квитанція)         → skip
 *  - csti=9999                    → skip (spam)
 *  - BOTB0501 for ФОП-єдинник:
 *      only ЄСВ/ЄП/ВЗ codes      → skip (routine)
 *      any other tax code         → alert
 *  - BOTB0501 for ЮО (edrpou 8-digit):
 *      text contains "узгоджені"  → skip (routine approval)
 *      text contains "Відмова"    → alert
 *      anything else              → alert
 *  - D0300201 "не за адресою"     → skip
 *  - D0300201 with /ІПК/          → alert (ІПК)
 *  - D0300201 other               → alert (лист)
 *  - F1419104 (довідка ДРФО)      → alert
 *  - PDI* (запит від ДПІ)         → alert
 */
export function detectDocumentAlerts(
  rawDocs: RawDpsDoc[],
  cachedIds: Set<string>,
  clientName: string,
  edrpou?: string
): AlertPayload[] {
  const isYuo = !!edrpou && /^\d{8}$/.test(edrpou)
  const alerts: AlertPayload[] = []

  for (const doc of rawDocs) {
    const id = String(doc.id)
    if (cachedIds.has(id)) continue

    const cdoc  = (doc.cdoc ?? '').trim()
    const name  = (doc.name ?? '').trim()
    const text  = doc.text ? stripHtml(doc.text) : ''
    const csti  = doc.csti ?? 0
    const date  = (doc.dateIn ?? '').slice(0, 10)

    // Квитанція №2 — завжди ігноруємо
    if (cdoc === 'J1499202') continue

    // Спам від csti=9999 (Світовий банк тощо)
    if (csti === 9999) continue

    // BOTB0501 — нарахування зобов'язань
    if (cdoc === 'BOTB0501') {
      if (isYuo) {
        // ЮО rule (ALERT_POLICY.md §3.3): "узгоджені" = routine, all else = alert
        if (text.includes('узгоджені')) continue
        const subject = text.slice(0, 120)
        alerts.push({
          type: 'new_document',
          message: `${clientName}: нове повідомлення від ДПС (${date}) — ${subject}`,
          data: { docId: id, cdoc, csti, dateIn: doc.dateIn },
        })
      } else {
        // ФОП-єдинник rule (ALERT_POLICY.md §3.1): routine codes = skip
        if (isRoutineBotb0501(text)) continue
        const taxLine = text.split('по ').slice(1).find(l => {
          const code = l.match(/\b(\d{8})\b/)?.[1]
          return code && !ROUTINE_BUDGET_CODES.has(code)
        }) ?? text.slice(0, 120)
        alerts.push({
          type: 'new_document',
          message: `${clientName}: нове нарахування від ДПС (${date}) — ${taxLine.slice(0, 100)}`,
          data: { docId: id, cdoc, csti, dateIn: doc.dateIn },
        })
      }
      continue
    }

    // D0300201 — листи різного типу
    if (cdoc === 'D0300201') {
      if (text.includes('не за адресою')) continue
      if (text.includes('/ІПК/') || name.includes('/ІПК/')) {
        alerts.push({
          type: 'new_document',
          message: `${clientName}: отримано ІПК від ДПС (${date}) — ${name || text.slice(0, 80)}`,
          data: { docId: id, cdoc, csti, dateIn: doc.dateIn },
        })
      } else {
        alerts.push({
          type: 'new_document',
          message: `${clientName}: новий лист від ДПС (${date}) — ${name || text.slice(0, 80)}`,
          data: { docId: id, cdoc, csti, dateIn: doc.dateIn },
        })
      }
      continue
    }

    // F1419104 — довідка про доходи з ДРФО
    if (cdoc === 'F1419104') {
      alerts.push({
        type: 'new_document',
        message: `${clientName}: отримано довідку про доходи (ДРФО) від ${date}`,
        data: { docId: id, cdoc, csti, dateIn: doc.dateIn },
      })
      continue
    }

    // PDI* — запит від ДПІ (потребує відповіді!)
    if (cdoc.startsWith('PDI')) {
      alerts.push({
        type: 'new_document',
        message: `${clientName}: ❗ запит від ДПІ (${date}) — ${name || text.slice(0, 80)}`,
        data: { docId: id, cdoc, csti, dateIn: doc.dateIn },
      })
      continue
    }
  }

  return alerts
}

const THRESHOLD = 1 // грн, to ignore floating-point noise

function sumField(budget: BudgetCalculations, field: 'debt' | 'overpayment'): number {
  return (budget.calculations ?? []).reduce((s, r) => s + (r[field] ?? 0), 0)
}

function fmt(n: number): string {
  return new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2 }).format(n) + '\u00a0грн'
}

/**
 * Compare old vs new normalized DPS data and return a list of alert payloads.
 * Both oldProfile/newProfile are already-normalized TaxpayerProfile objects.
 * Both oldBudget/newBudget are already-normalized BudgetCalculations objects.
 */
export function detectAlerts(
  oldProfile: unknown,
  newProfile: unknown,
  oldBudget: unknown,
  newBudget: unknown,
  clientName: string
): AlertPayload[] {
  const alerts: AlertPayload[] = []

  // ── Profile: status change ────────────────────────────────────────────────
  if (oldProfile && newProfile) {
    const op = oldProfile as TaxpayerProfile
    const np = newProfile as TaxpayerProfile
    if (op.status && np.status && op.status !== np.status) {
      alerts.push({
        type: 'status_changed',
        message: `${clientName}: статус змінився з "${op.status}" на "${np.status}"`,
        data: { oldStatus: op.status, newStatus: np.status },
      })
    }
  }

  // ── Budget: debt & overpayment changes ───────────────────────────────────
  if (oldBudget && newBudget) {
    const ob = oldBudget as BudgetCalculations
    const nb = newBudget as BudgetCalculations
    const oldDebt = sumField(ob, 'debt')
    const newDebt = sumField(nb, 'debt')
    const oldOverpayment = sumField(ob, 'overpayment')
    const newOverpayment = sumField(nb, 'overpayment')

    if (oldDebt < THRESHOLD && newDebt > THRESHOLD) {
      alerts.push({
        type: 'new_debt',
        message: `${clientName}: з'явився борг ${fmt(newDebt)}`,
        data: { oldDebt, newDebt },
      })
    } else if (newDebt > oldDebt + THRESHOLD) {
      alerts.push({
        type: 'debt_increased',
        message: `${clientName}: борг збільшився з ${fmt(oldDebt)} до ${fmt(newDebt)}`,
        data: { oldDebt, newDebt },
      })
    } else if (oldDebt > THRESHOLD && newDebt < THRESHOLD) {
      alerts.push({
        type: 'debt_cleared',
        message: `${clientName}: борг погашено (було ${fmt(oldDebt)})`,
        data: { oldDebt, newDebt },
      })
    }

    const diff = newOverpayment - oldOverpayment
    if (Math.abs(diff) > THRESHOLD) {
      alerts.push({
        type: 'overpayment_changed',
        message: `${clientName}: переплата ${diff > 0 ? 'збільшилась' : 'зменшилась'} на ${fmt(Math.abs(diff))} (тепер ${fmt(newOverpayment)})`,
        data: { oldOverpayment, newOverpayment },
      })
    }
  }

  return alerts
}

export function alertIcon(type: AlertType): string {
  switch (type) {
    case 'new_debt': return '🔴'
    case 'debt_increased': return '📈'
    case 'debt_cleared': return '✅'
    case 'overpayment_changed': return '💰'
    case 'status_changed': return '🏷️'
    case 'new_document': return '📨'
    case 'kep_expiring': return '🔑'
    case 'kep_expired': return '🚫'
    case 'sync_stale': return '⚠️'
    default: return '🔔'
  }
}
