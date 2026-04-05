/**
 * POST /api/user/push-token
 *
 * Saves an Expo Push Token for the authenticated user.
 * Used by the mobile app after obtaining a push notification token.
 *
 * Auth via Authorization: Bearer header (same pattern as /api/alerts).
 */
import { NextRequest, NextResponse } from 'next/server'
import { mobileAuth } from '@/lib/supabase/mobile'

export async function POST(request: NextRequest) {
  const { supabase, user } = await mobileAuth(request)
  if (!supabase || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  const token = (body as Record<string, unknown>)?.token
  const EXPO_TOKEN_RE = /^Expo(?:nent)?PushToken\[[A-Za-z0-9\-_]+\]$/
  if (typeof token !== 'string' || token.length > 200 || !EXPO_TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('user_settings')
    .upsert(
      { user_id: user.id, expo_push_token: token },
      { onConflict: 'user_id' }
    )

  if (error) {
    return NextResponse.json({ error: 'db error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
