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
