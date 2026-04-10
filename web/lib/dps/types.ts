export interface KvedEntry {
  code: string
  name: string
  isPrimary?: boolean
}

export interface TaxpayerProfile {
  name: string
  edrpou: string
  rnokpp: string | null
  status: string
  registrationDate: string
  taxAuthority: string
  accountingType: string
  address?: string
  kvedList?: KvedEntry[]
  vatNumber?: string | null
}

export interface BudgetRow {
  taxName: string
  taxCode: string
  charged: number
  paid: number
  debt: number
  overpayment: number
}

export interface BudgetCalculations {
  calculations: BudgetRow[]
}

export interface DpsApiResponse<T> {
  data: T | null
  error: string | null
  isMock: boolean
}

export interface IncomingDocument {
  id: string
  number: string
  date: string
  type: string
  subject: string
  status: 'new' | 'read' | 'answered'
  fromOrg: string
  hasAttachments: boolean
}

export interface DocumentsList {
  documents: IncomingDocument[]
  total: number
}

export interface TaxReport {
  id: string
  name: string           // Назва звіту
  formCode: string       // Код форми (напр. F0103408)
  period: string         // Звітний період (напр. "I квартал 2025")
  submittedAt: string    // Дата подачі
  status: 'accepted' | 'rejected' | 'processing' | 'pending'
  statusText: string     // Текст статусу з DPS
  regNumber: string      // Реєстраційний номер
}

export interface ReportsList {
  reports: TaxReport[]
  total: number
}
