import { useEffect, useRef } from 'react'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { supabase } from '../lib/supabase'
import { API_BASE_URL } from '../lib/constants'

/**
 * Реєструє пристрій для Expo Push Notifications.
 * Викликається тільки після логіну (session !== null).
 *
 * Правила:
 * - На емуляторі (не фізичний пристрій) — тихо виходить
 * - Expo Go не видає реальний push token — gracefully виходить
 * - Помилки не виводяться в UI, не блокують рендер
 * - Token НЕ логується в console
 * - Реєстрація відбувається лише один раз за сесію (useRef guard)
 */
export function usePushNotifications(): void {
  const registered = useRef(false)

  useEffect(() => {
    if (registered.current) return

    void registerForPushNotifications().then((success) => {
      // Встановлюємо guard тільки при успіху — якщо токен протух,
      // наступний монтаж компонента спробує знову
      if (success) registered.current = true
    })
  }, [])
}

async function registerForPushNotifications(): Promise<boolean> {
  try {
    // Push notifications не працюють на емуляторі/симуляторі
    if (!Device.isDevice) {
      return false
    }

    // Android потребує явного налаштування каналу нотифікацій
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'DPS Monitor',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      })
    }

    // Запитуємо дозвіл
    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') {
      // Користувач відхилив — не критично, просто виходимо
      return false
    }

    // Отримуємо Expo Push Token
    // getExpoPushTokenAsync може кинути в Expo Go — ловимо gracefully
    let expoPushToken: string
    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined
      const tokenData = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      )
      expoPushToken = tokenData.data
    } catch {
      // Expo Go або інше середовище без push підтримки
      return false
    }

    // Отримуємо Bearer токен з поточної Supabase сесії
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return false
    }

    // Відправляємо token на сервер
    const response = await fetch(`${API_BASE_URL}/api/user/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ token: expoPushToken }),
    })

    if (!response.ok) {
      if (__DEV__) console.warn('Push token registration failed:', response.status)
      return false
    }

    return true
  } catch {
    // Тихо ігноруємо будь-які помилки — push не є критичним
    return false
  }
}
