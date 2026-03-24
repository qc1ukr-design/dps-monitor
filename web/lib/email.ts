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
  if (!apiKey) return // gracefully skip if not configured

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)

  const bulletList = payload.alerts
    .map(a => `<li style="margin-bottom:8px">${a.message}</li>`)
    .join('\n')

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1d4ed8">🔔 Нові алерти — ${escapeHtml(payload.clientName)}</h2>
      <ul style="padding-left:20px;color:#374151">
        ${bulletList}
      </ul>
      <p style="margin-top:24px">
        <a href="https://dps-monitor.com.ua/dashboard/alerts"
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
