import type { TaxpayerProfile, BudgetCalculations } from './types'

export type AlertType =
  | 'new_debt'
  | 'debt_increased'
  | 'debt_cleared'
  | 'overpayment_changed'
  | 'status_changed'

export interface AlertPayload {
  type: AlertType
  message: string
  data?: Record<string, unknown>
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
    default: return '🔔'
  }
}
