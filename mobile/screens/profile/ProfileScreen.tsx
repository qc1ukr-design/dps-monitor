import React from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useNavigation, NavigationProp } from '@react-navigation/native'
import { supabase } from '../../lib/supabase'
import { useSession } from '../../hooks/useSession'
import { COLORS } from '../../lib/constants'
import { AuthStackParamList } from '../../navigation/types'

const APP_VERSION = '1.0.0'

export default function ProfileScreen(): React.JSX.Element {
  const { session } = useSession()
  const navigation = useNavigation<NavigationProp<AuthStackParamList>>()

  async function handleSignOut(): Promise<void> {
    await supabase.auth.signOut()
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] })
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.avatarSection}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>
            {session?.user.email?.charAt(0).toUpperCase() ?? '?'}
          </Text>
        </View>
        <Text style={styles.emailLarge}>{session?.user.email ?? '—'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Акаунт</Text>
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardRowLabel}>Email</Text>
            <Text style={styles.cardRowValue} numberOfLines={1}>
              {session?.user.email ?? '—'}
            </Text>
          </View>
          <View style={[styles.cardRow, styles.cardRowLast]}>
            <Text style={styles.cardRowLabel}>ID користувача</Text>
            <Text style={styles.cardRowValue} numberOfLines={1}>
              {session?.user.id ? `${session.user.id.slice(0, 8)}...` : '—'}
            </Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={styles.signOutButton}
        onPress={handleSignOut}
        activeOpacity={0.8}
      >
        <Text style={styles.signOutText}>Вийти</Text>
      </TouchableOpacity>

      <Text style={styles.version}>v{APP_VERSION}</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  content: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarLetter: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.CARD,
  },
  emailLarge: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.TEXT_SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingLeft: 4,
  },
  card: {
    backgroundColor: COLORS.CARD,
    borderRadius: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  cardRowLast: {
    borderBottomWidth: 0,
  },
  cardRowLabel: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
    flex: 1,
  },
  cardRowValue: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.TEXT,
    flex: 1,
    textAlign: 'right',
  },
  signOutButton: {
    height: 50,
    backgroundColor: COLORS.DANGER,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  signOutText: {
    color: COLORS.CARD,
    fontSize: 16,
    fontWeight: '600',
  },
  version: {
    textAlign: 'center',
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
  },
})
