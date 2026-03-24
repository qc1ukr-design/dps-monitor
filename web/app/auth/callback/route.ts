import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  const supabase = await createClient()

  // PKCE flow (OAuth / magic link)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password`)
      }
      return NextResponse.redirect(`${origin}/dashboard`)
    }
  }

  // Token hash flow (password recovery email)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: type as 'recovery' | 'email' })
    if (!error) {
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password`)
      }
      return NextResponse.redirect(`${origin}/dashboard`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
