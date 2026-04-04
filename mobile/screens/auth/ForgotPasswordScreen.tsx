import React, { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/constants'
import { isValidEmail } from '../../lib/validation'
import { AuthStackParamList } from '../../navigation/types'

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>

export default function ForgotPasswordScreen({ navigation }: Props): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleResetPassword(): Promise<void> {
    if (!email.trim()) {
      setErrorMessage('Введіть email')
      return
    }

    if (!isValidEmail(email)) {
      setErrorMessage('Введіть коректний email')
      return
    }

    setLoading(true)
    setErrorMessage(null)

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())

    setLoading(false)

    if (error) {
      setErrorMessage('Не вдалося надіслати листа. Перевірте email або спробуйте пізніше.')
    } else {
      setSuccess(true)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <View style={styles.header}>
          <Text style={styles.title}>Відновлення пароля</Text>
          <Text style={styles.subtitle}>Вкажіть email — надішлемо посилання для входу</Text>
        </View>

        {success ? (
          <View style={styles.successBox}>
            <Text style={styles.successIcon}>✅</Text>
            <Text style={styles.successTitle}>Перевірте email</Text>
            <Text style={styles.successText}>
              Посилання для відновлення пароля надіслано на {email.trim()}
            </Text>
          </View>
        ) : (
          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              placeholderTextColor={COLORS.TEXT_SECONDARY}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
              onSubmitEditing={handleResetPassword}
              returnKeyType="send"
            />

            {errorMessage !== null && (
              <Text style={styles.error}>{errorMessage}</Text>
            )}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleResetPassword}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.CARD} />
              ) : (
                <Text style={styles.buttonText}>Надіслати посилання</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.backButtonText}>← Назад до входу</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.CARD,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 36,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.TEXT,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
    marginTop: 8,
    textAlign: 'center',
  },
  form: {
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.TEXT,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    height: 48,
    backgroundColor: COLORS.BACKGROUND,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: COLORS.TEXT,
  },
  error: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.DANGER,
    textAlign: 'center',
  },
  button: {
    marginTop: 24,
    height: 50,
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: COLORS.CARD,
    fontSize: 16,
    fontWeight: '600',
  },
  successBox: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    backgroundColor: COLORS.BACKGROUND,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  successIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.SUCCESS,
    marginBottom: 8,
  },
  successText: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
  },
  backButton: {
    marginTop: 28,
    alignItems: 'center',
    paddingVertical: 8,
  },
  backButtonText: {
    fontSize: 15,
    color: COLORS.PRIMARY,
    fontWeight: '500',
  },
})
