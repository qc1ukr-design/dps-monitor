import type { TaxpayerProfile, BudgetCalculations } from './types'

export const MOCK_PROFILE: TaxpayerProfile = {
  name: 'ТОВ «Приклад»',
  edrpou: '12345678',
  rnokpp: null,
  status: 'Платник ПДВ',
  registrationDate: '2015-03-10',
  taxAuthority: 'ГУ ДПС у м. Київ',
  accountingType: 'Загальна система оподаткування',
  address: 'м. Київ, вул. Хрещатик, 1',
  kvedList: [
    { code: '62.01', name: 'Комп\'ютерне програмування', isPrimary: true },
    { code: '62.02', name: 'Консультування з питань інформатизації' },
  ],
}

export const MOCK_BUDGET: BudgetCalculations = {
  calculations: [
    {
      taxName: 'Податок на додану вартість',
      taxCode: '14060100',
      charged: 45000,
      paid: 40000,
      debt: 5000,
      overpayment: 0,
    },
    {
      taxName: 'Податок на прибуток підприємств',
      taxCode: '11021000',
      charged: 18000,
      paid: 18000,
      debt: 0,
      overpayment: 0,
    },
    {
      taxName: 'Єдиний соціальний внесок',
      taxCode: '71040000',
      charged: 9200,
      paid: 10000,
      debt: 0,
      overpayment: 800,
    },
    {
      taxName: 'ПДФО (податковий агент)',
      taxCode: '11010500',
      charged: 6500,
      paid: 6500,
      debt: 0,
      overpayment: 0,
    },
  ],
}
