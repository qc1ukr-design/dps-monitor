import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://zvvvgjmyecabhugvkyjz.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dnZnam15ZWNhYmh1Z3ZreWp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxODA3OTQsImV4cCI6MjA4OTc1Njc5NH0.RrBQ3kXyQErTdKVqU5FJJN4q6OpCffbjANK0x1gwtJM'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
