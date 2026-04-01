/**
 * Email notifications via Resend.
 * Gracefully skips if RESEND_API_KEY is not configured.
 */

const FROM_ADDRESS = 'DPS-Монітор <alerts@dps-monitor.com.ua>'

export interface AlertEmailPayload {
  to: string
  clientName: string
  alerts: { message: string }[]
}

export async function sendAlertEmail(payload: AlertEmailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)

  const bulletList = payload.alerts
    .map(a => `<li style="margin-bottom:8px">${escapeHtml(a.message)}</li>`)
    .join('\n')

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1d4ed8">🔔 Нові алерти — ${escapeHtml(payload.clientName)}</h2>
      <ul style="padding-left:20px;color:#374151">
        ${bulletList}
      </ul>
      <p style="margin-top:24px">
        <a href="https://web-qc1ukr-designs-projects.vercel.app/dashboard/alerts"
           style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">
          Переглянути алерти →
        </a>
      </p>
      <p style="margin-top:32px;color:#9ca3af;font-size:12px">
        DPS-Монітор · Ви отримали цей лист тому що підписані на сповіщення
      </p>
    </div>
  `

  await resend.emails.send({
    from: FROM_ADDRESS,
    to: payload.to,
    subject: `🔔 ${payload.alerts.length} нових алертів — ${payload.clientName}`,
    html,
  })
}

// ── Weekly digest ─────────────────────────────────────────────────────────────

export interface DigestDebtClient     { name: string; debt: number }
export interface DigestStaleClient    { name: string; daysSince: number }
export interface DigestKepClient      { name: string; daysLeft: number; validToStr: string; expired: boolean }

export interface WeeklyDigestPayload {
  to: string
  generatedAt: string          // formatted, e.g. "01.04.2026"
  totalClients: number
  debtClients:    DigestDebtClient[]
  staleClients:   DigestStaleClient[]
  kepIssueClients: DigestKepClient[]
}

export async function sendWeeklyDigest(payload: WeeklyDigestPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)

  const issueCount = payload.debtClients.length + payload.staleClients.length + payload.kepIssueClients.length
  const fmt = (n: number) => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 0 }).format(n) + '\u00a0грн'

  const sections: string[] = []

  if (payload.debtClients.length > 0) {
    const rows = payload.debtClients
      .map(c => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${escapeHtml(c.name)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#dc2626;font-weight:600;text-align:right">${fmt(c.debt)}</td>
      </tr>`).join('')
    sections.push(`
      <h3 style="color:#dc2626;margin:24px 0 8px">💰 Заборгованість (${payload.debtClients.length})</h3>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
        <thead><tr style="background:#fef2f2">
          <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:12px">Клієнт</th>
          <th style="padding:8px 12px;text-align:right;color:#6b7280;font-size:12px">Борг</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`)
  }

  if (payload.staleClients.length > 0) {
    const rows = payload.staleClients
      .map(c => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${escapeHtml(c.name)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#d97706;text-align:right">${c.daysSince} дн. тому</td>
      </tr>`).join('')
    sections.push(`
      <h3 style="color:#d97706;margin:24px 0 8px">⚠️ Не оновлюються (${payload.staleClients.length})</h3>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
        <thead><tr style="background:#fffbeb">
          <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:12px">Клієнт</th>
          <th style="padding:8px 12px;text-align:right;color:#6b7280;font-size:12px">Остання синх.</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`)
  }

  if (payload.kepIssueClients.length > 0) {
    const rows = payload.kepIssueClients
      .map(c => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${escapeHtml(c.name)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right;${c.expired ? 'color:#dc2626;font-weight:600' : 'color:#d97706'}">
          ${c.expired ? `Прострочено (${c.validToStr})` : `${c.daysLeft} дн. (до ${c.validToStr})`}
        </td>
      </tr>`).join('')
    sections.push(`
      <h3 style="color:#7c3aed;margin:24px 0 8px">🔑 КЕП (${payload.kepIssueClients.length})</h3>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
        <thead><tr style="background:#f5f3ff">
          <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:12px">Клієнт</th>
          <th style="padding:8px 12px;text-align:right;color:#6b7280;font-size:12px">Статус КЕП</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`)
  }

  const noIssuesBanner = issueCount === 0
    ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin:16px 0;color:#166534;font-weight:500">
        ✅ Всі клієнти в нормі — боргів, проблем з КЕП та збоїв синхронізації не виявлено
       </div>`
    : ''

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1f2937">

      <div style="background:#1d4ed8;padding:24px 28px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;margin:0;font-size:20px">📊 Тижневий звіт ДПС-Монітор</h1>
        <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px">${escapeHtml(payload.generatedAt)}</p>
      </div>

      <div style="background:#f8fafc;padding:20px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">

        <div style="display:flex;gap:16px;margin-bottom:8px">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px 20px;flex:1;text-align:center">
            <div style="font-size:24px;font-weight:700;color:#1d4ed8">${payload.totalClients}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:2px">Активних клієнтів</div>
          </div>
          <div style="background:#fff;border:1px solid ${issueCount > 0 ? '#fca5a5' : '#bbf7d0'};border-radius:8px;padding:12px 20px;flex:1;text-align:center">
            <div style="font-size:24px;font-weight:700;color:${issueCount > 0 ? '#dc2626' : '#16a34a'}">${issueCount}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:2px">Проблем</div>
          </div>
        </div>

        ${noIssuesBanner}
        ${sections.join('\n')}

        <p style="margin-top:28px;text-align:center">
          <a href="https://web-qc1ukr-designs-projects.vercel.app/dashboard"
             style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
            Перейти на дашборд →
          </a>
        </p>

        <p style="margin-top:28px;color:#9ca3af;font-size:11px;text-align:center">
          DPS-Монітор · Тижневий дайджест щопонеділка
        </p>
      </div>
    </div>
  `

  const subjectEmoji = issueCount === 0 ? '✅' : '⚠️'
  const subject = issueCount === 0
    ? `✅ Тижневий звіт: все гаразд — ${payload.totalClients} клієнтів`
    : `${subjectEmoji} Тижневий звіт: ${issueCount} проблем — ${payload.generatedAt}`

  await resend.emails.send({ from: FROM_ADDRESS, to: payload.to, subject, html })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
