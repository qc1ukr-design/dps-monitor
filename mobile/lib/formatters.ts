/**
 * Formats a monetary amount in Ukrainian hryvnias.
 * DPS API normalizer stores amounts in hryvnias (e.g. 1234.56).
 */
export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + ' грн'
}

/**
 * Formats a date string to Ukrainian locale (DD.MM.YYYY).
 */
export function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}
