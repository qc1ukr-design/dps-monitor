import React, { useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
  Platform,
  Alert,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ClientsStackParamList } from '../../navigation/types'
import { useClient } from '../../hooks/useClient'
import { syncClient } from '../../lib/api'
import { COLORS } from '../../lib/constants'
import { formatMoney, formatDate } from '../../lib/formatters'
import LoadingScreen from '../../components/ui/LoadingScreen'
import ErrorState from '../../components/ui/ErrorState'

async function copyToClipboard(label: string, value: string): Promise<void> {
  await Clipboard.setStringAsync(value)
  if (Platform.OS === 'android') {
    ToastAndroid.show(`${label} скопійовано`, ToastAndroid.SHORT)
  } else {
    Alert.alert('Скопійовано', `${label}: ${value}`, [{ text: 'OK' }], { cancelable: true })
  }
}

type Props = NativeStackScreenProps<ClientsStackParamList, 'ClientDetail'>

function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

function getKepColor(kepValidTo: string): string {
  const daysLeft = Math.floor(
    (new Date(kepValidTo).getTime() - Date.now()) / 86400000
  )
  if (daysLeft > 30) return COLORS.SUCCESS
  if (daysLeft >= 10) return COLORS.WARNING
  return COLORS.DANGER
}

function getKepLabel(kepValidTo: string): string {
  const daysLeft = Math.floor(
    (new Date(kepValidTo).getTime() - Date.now()) / 86400000
  )
  if (daysLeft <= 0) return 'Прострочено'
  if (daysLeft < 10) return `Закінчується через ${daysLeft} дн`
  return `${daysLeft} дн залишилось`
}

interface SectionProps {
  title: string
  children: React.ReactNode
}

function Section({ title, children }: SectionProps): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  )
}

interface InfoRowProps {
  label: string
  value: string
  valueColor?: string
  copyable?: boolean
}

function InfoRow({ label, value, valueColor, copyable = true }: InfoRowProps): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.infoRow}
      onPress={copyable ? () => copyToClipboard(label, value) : undefined}
      activeOpacity={copyable ? 0.5 : 1}
    >
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoValueRow}>
        <Text style={[styles.infoValue, valueColor !== undefined && { color: valueColor }]}>
          {value}
        </Text>
        {copyable && <Text style={styles.copyIcon}>⎘</Text>}
      </View>
    </TouchableOpacity>
  )
}

export default function ClientDetailScreen({ route, navigation }: Props): React.JSX.Element {
  const { clientId, clientName } = route.params
  const { client, loading, error, refresh } = useClient(clientId)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  async function handleRefresh(): Promise<void> {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  async function handleSync(): Promise<void> {
    setSyncing(true)
    setSyncResult(null)
    try {
      await syncClient(clientId)
      setSyncResult('Синхронізацію завершено успішно')
      await refresh()
    } catch (err) {
      setSyncResult(
        err instanceof Error ? err.message : 'Помилка синхронізації'
      )
    } finally {
      setSyncing(false)
    }
  }

  function handleViewDocuments(): void {
    navigation.navigate('ClientDocuments', { clientId, clientName })
  }

  function handleShareProfile(): void {
    if (!client) return
    const lines: string[] = [`📋 ${client.name}`]
    if (client.edrpou)          lines.push(`ЄДРПОУ: ${client.edrpou}`)
    if (client.rnokpp)          lines.push(`РНОКПП: ${client.rnokpp}`)
    if (client.vatNumber)       lines.push(`Номер платника ПДВ: ${client.vatNumber}`)
    if (client.taxStatus)       lines.push(`Статус: ${client.taxStatus}`)
    if (client.registrationDate) lines.push(`Дата реєстрації: ${client.registrationDate}`)
    if (client.taxAuthority)    lines.push(`Контролюючий орган: ${client.taxAuthority}`)
    if (client.accountingType)  lines.push(`Система оподаткування: ${client.accountingType}`)
    if (client.address)         lines.push(`Адреса: ${client.address}`)
    Share.share({ message: lines.join('\n') })
  }

  function handleViewReports(): void {
    // Navigate to Reports tab → ClientReports screen
    const parent = navigation.getParent()
    if (parent) {
      parent.navigate('Reports' as never, {
        screen: 'ClientReports',
        params: { clientId, clientName },
      } as never)
    }
  }

  if (loading && !refreshing) {
    return <LoadingScreen />
  }

  if (error !== null) {
    return <ErrorState message={error} onRetry={refresh} />
  }

  if (client === null) {
    return <ErrorState message="Клієнта не знайдено" />
  }

  const hasDebt = typeof client.debt === 'number' && client.debt > 0
  const hasOverpayment =
    typeof client.overpayment === 'number' && client.overpayment > 0

  const hasProfile = !!(
    client.taxStatus || client.registrationDate || client.taxAuthority ||
    client.accountingType || client.address || client.rnokpp
  )

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={COLORS.PRIMARY}
          colors={[COLORS.PRIMARY]}
        />
      }
    >
      {/* Основна інформація */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Загальна інформація</Text>
        <TouchableOpacity onPress={handleShareProfile} style={styles.shareButton} activeOpacity={0.7}>
          <Text style={styles.shareButtonText}>Поділитись ↗</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.sectionCard, { marginHorizontal: 16, marginBottom: 16 }]}>
        <InfoRow label="Назва / ПІБ" value={client.name} />
        {client.edrpou ? (
          <InfoRow label="ЄДРПОУ" value={client.edrpou} />
        ) : null}
        {client.rnokpp ? (
          <InfoRow label="РНОКПП" value={client.rnokpp} />
        ) : null}
        {client.vatNumber ? (
          <InfoRow label="Номер платника ПДВ" value={client.vatNumber} />
        ) : null}
        {client.taxStatus ? (
          <InfoRow label="Статус платника" value={client.taxStatus} />
        ) : null}
        {client.registrationDate ? (
          <InfoRow label="Дата реєстрації" value={client.registrationDate} />
        ) : null}
        {client.taxAuthority ? (
          <InfoRow label="Контролюючий орган" value={client.taxAuthority} />
        ) : null}
        {client.accountingType ? (
          <InfoRow label="Система оподаткування" value={client.accountingType} />
        ) : null}
        {client.address ? (
          <InfoRow label="Адреса" value={client.address} />
        ) : null}
        {!hasProfile && !client.edrpou && (
          <Text style={styles.noData}>Немає даних — потрібна синхронізація</Text>
        )}
      </View>

      {/* КВЕДи */}
      {client.kvedList && client.kvedList.length > 0 && (
        <Section title="КВЕДи">
          {client.kvedList.map((kved, i) => (
            <View key={i} style={styles.kvedRow}>
              <View style={styles.kvedCodeBadge}>
                <Text style={styles.kvedCode}>{kved.code}</Text>
              </View>
              <Text style={styles.kvedName} numberOfLines={2}>{kved.name}</Text>
              {kved.isPrimary && (
                <View style={styles.kvedPrimaryBadge}>
                  <Text style={styles.kvedPrimaryText}>основний</Text>
                </View>
              )}
            </View>
          ))}
        </Section>
      )}

      {/* Фінансовий стан */}
      <Section title="Фінансовий стан">
        {typeof client.debt === 'number' && (
          <InfoRow
            label="Борг"
            value={formatMoney(client.debt)}
            valueColor={hasDebt ? COLORS.DANGER : COLORS.SUCCESS}
          />
        )}
        {typeof client.overpayment === 'number' && (
          <InfoRow
            label="Переплата"
            value={formatMoney(client.overpayment)}
            valueColor={hasOverpayment ? COLORS.SUCCESS : COLORS.TEXT_SECONDARY}
          />
        )}
        {client.debt === undefined && client.overpayment === undefined && (
          <Text style={styles.noData}>Немає даних</Text>
        )}
      </Section>

      {/* КЕП */}
      {typeof client.kepValidTo === 'string' && (
        <Section title="КЕП">
          <InfoRow
            label="Дата закінчення"
            value={formatDate(client.kepValidTo)}
          />
          <InfoRow
            label="Статус"
            value={getKepLabel(client.kepValidTo)}
            valueColor={getKepColor(client.kepValidTo)}
          />
        </Section>
      )}

      {/* Синхронізація */}
      <Section title="Синхронізація">
        <TouchableOpacity
          style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
          onPress={handleSync}
          disabled={syncing}
          activeOpacity={0.8}
        >
          {syncing ? (
            <ActivityIndicator size="small" color={COLORS.CARD} />
          ) : (
            <Text style={styles.syncButtonText}>Синхронізувати зараз</Text>
          )}
        </TouchableOpacity>

        {syncResult !== null && (
          <Text
            style={[
              styles.syncResult,
              syncResult.includes('успішно')
                ? styles.syncResultSuccess
                : styles.syncResultError,
            ]}
          >
            {syncResult}
          </Text>
        )}

        {typeof client.lastSyncAt === 'string' && (
          <InfoRow
            label="Остання синхронізація"
            value={formatDateTime(client.lastSyncAt)}
          />
        )}
      </Section>

      {/* Документи та Звіти */}
      <Section title="Документи та звіти">
        <TouchableOpacity
          style={styles.navButton}
          onPress={handleViewDocuments}
          activeOpacity={0.8}
        >
          <Text style={styles.navButtonIcon}>📥</Text>
          <View style={styles.navButtonContent}>
            <Text style={styles.navButtonTitle}>Вхідна документація</Text>
            <Text style={styles.navButtonSubtitle}>Листи та повідомлення від ДПС</Text>
          </View>
          <Text style={styles.navButtonChevron}>›</Text>
        </TouchableOpacity>
        <View style={styles.separator} />
        <TouchableOpacity
          style={styles.navButton}
          onPress={handleViewReports}
          activeOpacity={0.8}
        >
          <Text style={styles.navButtonIcon}>📋</Text>
          <View style={styles.navButtonContent}>
            <Text style={styles.navButtonTitle}>Звітність</Text>
            <Text style={styles.navButtonSubtitle}>Статуси поданих звітів</Text>
          </View>
          <Text style={styles.navButtonChevron}>›</Text>
        </TouchableOpacity>
      </Section>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  content: {
    paddingVertical: 12,
    paddingBottom: 32,
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingLeft: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.TEXT_SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  shareButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  shareButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.PRIMARY,
  },
  infoValueRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  copyIcon: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
    opacity: 0.5,
  },
  sectionCard: {
    backgroundColor: COLORS.CARD,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
    gap: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
    flex: 1,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT,
    textAlign: 'right',
    flex: 1,
  },
  noData: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
    paddingVertical: 12,
    textAlign: 'center',
  },
  kvedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
    gap: 8,
  },
  kvedCodeBadge: {
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kvedCode: {
    fontSize: 12,
    fontFamily: 'monospace' as const,
    color: '#4B5563',
  },
  kvedName: {
    flex: 1,
    fontSize: 13,
    color: COLORS.TEXT,
  },
  kvedPrimaryBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kvedPrimaryText: {
    fontSize: 11,
    color: '#2563EB',
  },
  syncButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginVertical: 12,
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  syncButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.CARD,
  },
  syncResult: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  syncResultSuccess: {
    color: COLORS.SUCCESS,
  },
  syncResultError: {
    color: COLORS.DANGER,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  navButtonIcon: {
    fontSize: 22,
  },
  navButtonContent: {
    flex: 1,
  },
  navButtonTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.PRIMARY,
  },
  navButtonSubtitle: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
    marginTop: 1,
  },
  navButtonChevron: {
    fontSize: 22,
    color: COLORS.TEXT_SECONDARY,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.BORDER,
  },
})
