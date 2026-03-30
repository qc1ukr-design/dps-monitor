/**
 * Normalizers for raw DPS Cabinet API responses.
 *
 * The DPS ws/public_api endpoints return data in a "grouped" format:
 *   Array<{ idGroup, title, headers, values: Record<string, unknown>, listValues }>
 *
 * These functions convert that raw format to the app's internal types.
 * They also pass through data that is already in normalized format (for backwards compat).
 */
import type { TaxpayerProfile, BudgetCalculations, BudgetRow, KvedEntry, IncomingDocument, DocumentsList, TaxReport, ReportsList } from './types'

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

function stripHtml(v: unknown): string {
  return str(v).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
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

  // Extract address — DPS returns it as ADR_NS in "Реєстраційні дані" group
  const address = str(
    v.ADR_NS ?? v.ADRESS ?? v.ADDRESS ?? v.C_ADRESS ?? v.ADRES ?? v.C_ADRES_FULL ?? v.ADR_FACT
  ) || undefined

  // Extract KVEDs from "Види діяльності" group (listValues)
  // DPS fields: KVED (code, may have leading underscore), KVED_NAME, IS_MAIN (1 = primary)
  const kvedList: KvedEntry[] = []
  for (const g of groups) {
    const title = (g.title ?? '').toLowerCase()
    if (
      title.includes('види діяльності') ||
      title.includes('вид діяльності') ||
      title.includes('квед') ||
      title.includes('kved')
    ) {
      if (Array.isArray(g.listValues)) {
        for (const item of g.listValues as Record<string, unknown>[]) {
          const rawCode = str(item.KVED ?? item.KOD_KVED ?? item.CODE_KVED ?? item.code ?? '')
          const code = rawCode.replace(/^_+/, '') // strip leading underscores
          const name = str(item.KVED_NAME ?? item.NAME_KVED ?? item.NAME ?? item.name ?? '')
          const isPrimary = item.IS_MAIN === 1 || item.IS_MAIN === '1' ||
                            item.OZNAKA === '1' || item.OZNAKA === 1 ||
                            item.IS_PRIMARY === true
          if (code || name) kvedList.push({ code, name, isPrimary: !!isPrimary })
        }
      }
    }
  }
  // Fallback: single KVED from top-level values
  if (kvedList.length === 0 && (v.KVED || v.KVED_NAME)) {
    const code = str(v.KVED).replace(/^_+/, '')
    kvedList.push({ code, name: str(v.KVED_NAME) })
  }

  return {
    name: str(v.FULL_NAME) || str(v.TIN),
    edrpou: str(v.EDRPOU) || str(v.TIN),
    rnokpp: str(v.TIN) || null,
    status,
    registrationDate: str(v.D_REG_STI),
    taxAuthority: str(v.C_STI_MAIN_NAME),
    accountingType,
    address,
    kvedList: kvedList.length > 0 ? kvedList : undefined,
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

// ── Documents (Correspondence) ─────────────────────────────────────────────

/**
 * Normalise DPS correspondence response → DocumentsList.
 * DPS may return:
 *   - { count: N, data: [{ id, docDate, docNumber, docName, docTypeName, orgName, statusCode, hasFiles }] }
 *   - Array of document objects directly
 *   - Already-normalised { documents: [...], total: N }
 */
export function normalizeDocuments(raw: unknown): DocumentsList {
  // Already normalised?
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    if (Array.isArray(r.documents)) {
      return raw as DocumentsList
    }
    // Spring Boot Page: { content: [...], totalElements: N }
    if (Array.isArray(r.content)) {
      const docs = _mapDocumentRows(r.content as Record<string, unknown>[])
      return { documents: docs, total: typeof r.totalElements === 'number' ? r.totalElements : docs.length }
    }
    // { count, data } shape
    if (Array.isArray(r.data)) {
      const docs = _mapDocumentRows(r.data as Record<string, unknown>[])
      return { documents: docs, total: typeof r.count === 'number' ? r.count : docs.length }
    }
  }

  // Raw array
  if (Array.isArray(raw) && raw.length > 0) {
    const docs = _mapDocumentRows(raw as Record<string, unknown>[])
    return { documents: docs, total: docs.length }
  }

  return { documents: [], total: 0 }
}

function _mapStatusCode(row: Record<string, unknown>): IncomingDocument['status'] {
  // ws/public_api/post/incoming: isRead (false=new, true=read)
  if (row.isRead !== undefined) {
    return (row.isRead === true || row.isRead === 1 || row.isRead === '1') ? 'read' : 'new'
  }
  const s = String(row.statusId ?? row.statusCode ?? row.status ?? row.STATUS_CODE ?? row.STATUS ?? '1')
  if (s === '1') return 'new'
  if (s === '2') return 'read'
  if (s === '3') return 'answered'
  return 'new'
}

function _mapDocumentRows(arr: Record<string, unknown>[]): IncomingDocument[] {
  return arr.map((row, idx) => ({
    // ws/api/corr/correspondence fields: id, num, dget, typeName, name, statusId, orgName, hasFiles
    // ws/public_api/post/incoming fields: id, idContent, cdoc, text, dateIn, csti, isRead, name, p7s
    id: str(row.id ?? row.docId ?? row.ID ?? String(idx)),
    number: str(row.idContent ?? row.codRegdocRef ?? row.num ?? row.docNumber ?? row.number ?? row.DOC_NUMBER ?? row.NUM ?? ''),
    date: str(row.dateIn ?? row.operDate ?? row.dget ?? row.docDate ?? row.date ?? row.DOC_DATE ?? row.DATE ?? ''),
    type: str(row.cdoc ?? row.typeName ?? row.docTypeName ?? row.type ?? row.DOC_TYPE_NAME ?? row.TYPE_NAME ?? ''),
    subject: stripHtml(row.text ?? row.name ?? row.docName ?? row.subject ?? row.DOC_NAME ?? row.TITLE ?? ''),
    status: _mapStatusCode(row),
    fromOrg: str(row.csti ?? row.orgName ?? row.fromOrg ?? row.ORG_NAME ?? row.FROM_ORG ?? ''),
    hasAttachments: !!(row.p7s ?? row.hasFiles ?? row.hasAttachments ?? row.HAS_FILES ?? false),
  }))
}

// ── Reports (Звітність) ─────────────────────────────────────────────────────

function _mapReportStatus(code: unknown, text: unknown): TaxReport['status'] {
  const s = String(code ?? text ?? '').toLowerCase()
  if (s.includes('прийнят') || s === '1' || s === 'accepted') return 'accepted'
  if (s.includes('відхилен') || s === '2' || s === 'rejected') return 'rejected'
  if (s.includes('обробк') || s === '3' || s === 'processing') return 'processing'
  return 'pending'
}

export function normalizeReports(raw: unknown): ReportsList {
  // Already normalised?
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    if (Array.isArray(r.reports)) return raw as ReportsList
    // Spring Boot Page: { content: [...], totalElements: N }
    if (Array.isArray(r.content)) {
      const reports = _mapReportRows(r.content as Record<string, unknown>[])
      return { reports, total: typeof r.totalElements === 'number' ? r.totalElements : reports.length }
    }
    // { count, data } shape
    if (Array.isArray(r.data)) {
      const reports = _mapReportRows(r.data as Record<string, unknown>[])
      return { reports, total: typeof r.count === 'number' ? r.count : reports.length }
    }
  }
  if (Array.isArray(raw) && raw.length > 0) {
    const reports = _mapReportRows(raw as Record<string, unknown>[])
    return { reports, total: reports.length }
  }
  return { reports: [], total: 0 }
}

function _mapReportRows(arr: Record<string, unknown>[]): TaxReport[] {
  return arr.map((row, idx) => {
    const statusText = str(
      row.statusName ?? row.status_name ?? row.STATUS_NAME ?? row.status ?? row.STATUS ?? ''
    )
    return {
      // ws/api/regdoc/list fields: id, dname, formCode, dperiod, dget, statusName, dnum
      id: str(row.id ?? row.docId ?? row.ID ?? String(idx)),
      name: str(row.dname ?? row.name ?? row.docName ?? row.DOC_NAME ?? row.zvit_name ?? row.ZVIT_NAME ?? ''),
      formCode: str(row.formCode ?? row.form_code ?? row.FORM_CODE ?? row.kod_formy ?? row.KOD_FORMY ?? ''),
      period: str(row.dperiod ?? row.period ?? row.zvit_period ?? row.ZVIT_PERIOD ?? row.periodName ?? row.PERIOD_NAME ?? ''),
      submittedAt: str(row.dget ?? row.submittedAt ?? row.date_sub ?? row.DATE_SUB ?? row.docDate ?? row.DOC_DATE ?? ''),
      status: _mapReportStatus(row.statusCode ?? row.STATUS_CODE, statusText),
      statusText: statusText || 'Невідомо',
      regNumber: str(row.dnum ?? row.regNumber ?? row.reg_num ?? row.REG_NUM ?? row.docNumber ?? row.DOC_NUMBER ?? ''),
    }
  })
}
