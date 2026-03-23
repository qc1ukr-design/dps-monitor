/**
 * Normalizers for raw DPS Cabinet API responses.
 *
 * The DPS ws/public_api endpoints return data in a "grouped" format:
 *   Array<{ idGroup, title, headers, values: Record<string, unknown>, listValues }>
 *
 * These functions convert that raw format to the app's internal types.
 * They also pass through data that is already in normalized format (for backwards compat).
 */
import type { TaxpayerProfile, BudgetCalculations, BudgetRow } from './types'

// ── Helpers ────────────────────────────────────────────────────────────────

type DpsGroup = {
  idGroup?: number
  title?: string
  values?: Record<string, unknown>
  listValues?: unknown[] | null
}

/** Flatten all .values from every group into one map */
function flattenGroups(groups: DpsGroup[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const g of groups) {
    if (g.values) Object.assign(out, g.values)
  }
  return out
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function num(v: unknown): number {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

// ── Profile ────────────────────────────────────────────────────────────────

/**
 * Normalise payer_card response → TaxpayerProfile.
 * Handles:
 *   - raw DPS array-of-groups format
 *   - already-normalised object (passthrough)
 */
export function normalizeProfile(raw: unknown): TaxpayerProfile {
  // Already normalised?
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    if (typeof r.name === 'string' && typeof r.taxAuthority === 'string') {
      return raw as TaxpayerProfile
    }
  }

  // Raw DPS format: array of groups
  if (!Array.isArray(raw)) {
    return _emptyProfile()
  }

  const v = flattenGroups(raw as DpsGroup[])

  // Determine accounting type
  let accountingType = 'Загальна система оподаткування'
  const grup = v.GRUP ? `${v.GRUP}` : ''
  const stavka = v.STAVKA ? `${v.STAVKA}` : ''
  if (grup) {
    accountingType = `Єдиний податок ${grup} група${stavka ? ` (${stavka}%)` : ''}`
  }

  // Detect VAT payer status from groups
  const groups = raw as DpsGroup[]
  const vatGroup = groups.find(g => g.title?.includes('ПДВ'))
  const hasVat = vatGroup && vatGroup.values && Object.keys(vatGroup.values).length > 0
  const status = hasVat
    ? 'Платник ПДВ'
    : grup
      ? `Єдиний податок ${grup} група`
      : 'Не платник ПДВ'

  return {
    name: str(v.FULL_NAME) || str(v.TIN),
    edrpou: str(v.EDRPOU) || str(v.TIN),
    rnokpp: str(v.TIN) || null,
    status,
    registrationDate: str(v.D_REG_STI),
    taxAuthority: str(v.C_STI_MAIN_NAME),
    accountingType,
  }
}

function _emptyProfile(): TaxpayerProfile {
  return { name: '', edrpou: '', rnokpp: null, status: '', registrationDate: '', taxAuthority: '', accountingType: '' }
}

// ── Budget ─────────────────────────────────────────────────────────────────

/**
 * Normalise ta/splatp response → BudgetCalculations.
 * DPS may return:
 *   - Array<{ KOD_POD, NAME_POD, SUM_NAR, SUM_SPL, SUM_BORG, SUM_PEREPLA }> (typical)
 *   - Already-normalised { calculations: [...] }
 *   - Array of grouped objects (same group format as payer_card)
 */
export function normalizeBudget(raw: unknown): BudgetCalculations {
  // Already normalised?
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    if (Array.isArray(r.calculations)) {
      return raw as BudgetCalculations
    }
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    return { calculations: [] }
  }

  const arr = raw as Record<string, unknown>[]

  // Check if it's the DPS group format (has idGroup / listValues)
  if ('idGroup' in arr[0] || 'listValues' in arr[0]) {
    return _normalizeBudgetFromGroups(arr as DpsGroup[])
  }

  // Flat array format: each element is a tax row
  // DPS ws/public_api/ta/splatp fields: namePlt, shot, narah0, splbd0, nedoim0, perepl0, debtAll
  const calculations: BudgetRow[] = arr.map(row => ({
    taxName: str(row.namePlt ?? row.NAME_POD ?? row.taxName ?? row.name ?? row.NKPD_NAME ?? ''),
    taxCode: str(row.shot   ?? row.KOD_POD  ?? row.taxCode ?? row.code ?? row.NKPD ?? ''),
    charged: num(row.narah0 ?? row.narahEnd ?? row.SUM_NAR ?? row.charged ?? row.accrued ?? 0),
    paid:    num(row.splbd0 ?? row.SUM_SPL  ?? row.paid ?? 0),
    debt:    num(row.nedoim0 ?? row.debtAll ?? row.SUM_BORG ?? row.debt ?? 0),
    overpayment: num(row.perepl0 ?? row.SUM_PEREPLA ?? row.overpayment ?? 0),
  })).filter(r => r.taxName || r.taxCode)

  return { calculations }
}

function _normalizeBudgetFromGroups(groups: DpsGroup[]): BudgetCalculations {
  const calculations: BudgetRow[] = []

  for (const group of groups) {
    // listValues holds the rows in this group
    if (Array.isArray(group.listValues)) {
      for (const item of group.listValues as Record<string, unknown>[]) {
        calculations.push({
          taxName: str(item.NAME_POD ?? item.taxName ?? item.name ?? group.title ?? ''),
          taxCode: str(item.KOD_POD ?? item.taxCode ?? item.code ?? ''),
          charged: num(item.SUM_NAR ?? item.charged ?? 0),
          paid:    num(item.SUM_SPL ?? item.paid ?? 0),
          debt:    num(item.SUM_BORG ?? item.debt ?? 0),
          overpayment: num(item.SUM_PEREPLA ?? item.overpayment ?? 0),
        })
      }
    }
  }

  return { calculations }
}
