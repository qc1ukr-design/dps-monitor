// mobile/app.config.js
module.exports = {
  ...require('./app.json').expo,
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: {
      // projectId заповнюється автоматично після `eas init`
      // або вручну з Expo Dashboard: expo.dev/accounts/<user>/projects/<slug>
      projectId: '54d0cb67-2510-4545-bea5-0bb0ab9af190',
    },
  },
}
