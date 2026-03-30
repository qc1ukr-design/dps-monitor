/**
 * GET  /api/settings/notifications  — read current user notification settings
 * POST /api/settings/notifications  — save telegram_chat_id + notify_telegram
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendTelegramMessage } from '@/lib/telegram'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('user_settings')
    .select('telegram_chat_id, notify_telegram')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({
    telegram_chat_id: data?.telegram_chat_id ?? '',
    notify_telegram: data?.notify_telegram ?? false,
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    telegram_chat_id?: string
    notify_telegram?: boolean
    test?: boolean
  }

  const chatId = (body.telegram_chat_id ?? '').trim()
  const notifyTelegram = !!body.notify_telegram

  // If test=true, just send a test message and return
  if (body.test) {
    if (!chatId) return NextResponse.json({ error: 'chat_id is empty' }, { status: 400 })
    await sendTelegramMessage(chatId, '✅ <b>ДПС-Монітор</b>\n\nТестове повідомлення успішно надіслано!')
    return NextResponse.json({ ok: true })
  }

  const { error } = await supabase
    .from('user_settings')
    .upsert(
      {
        user_id: user.id,
        telegram_chat_id: chatId || null,
        notify_telegram: notifyTelegram,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
