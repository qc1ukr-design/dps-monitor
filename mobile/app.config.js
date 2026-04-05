// mobile/app.config.js
module.exports = {
  ...require('./app.json').expo,
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: {
      // projectId заповнюється автоматично після `eas init`
      // або вручну з Expo Dashboard: expo.dev/accounts/<user>/projects/<slug>
      projectId: process.env.EAS_PROJECT_ID ?? '',
    },
  },
}
