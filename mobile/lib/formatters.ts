/**
 * Formats a monetary amount in Ukrainian hryvnias.
 * DPS API returns amounts in kopecks (1 UAH = 100 kopecks).
 */
export function formatMoney(amountKopecks: number): string {
  const hryvnias = amountKopecks / 100
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(hryvnias) + ' грн'
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
