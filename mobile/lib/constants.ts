export const API_BASE_URL = 'https://dps-monitor.vercel.app'

export const COLORS = {
  PRIMARY: '#2563EB',
  DANGER: '#DC2626',
  SUCCESS: '#16A34A',
  WARNING: '#D97706',
  TEXT: '#111827',
  TEXT_SECONDARY: '#6B7280',
  BACKGROUND: '#F9FAFB',
  CARD: '#FFFFFF',
  BORDER: '#E5E7EB',
} as const

export const ALERT_ICONS: Record<string, string> = {
  new_debt: '🔴',
  debt_increased: '📈',
  debt_cleared: '✅',
  overpayment_changed: '💰',
  status_changed: '🏷️',
  new_document: '📨',
  kep_expiring: '🔑',
  kep_expired: '🚫',
  sync_stale: '⚠️',
}
