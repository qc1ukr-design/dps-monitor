export interface TaxpayerProfile {
  name: string
  edrpou: string
  rnokpp: string | null
  status: string
  registrationDate: string
  taxAuthority: string
  accountingType: string
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
