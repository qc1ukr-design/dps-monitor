import React, { useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ClientsStackParamList } from '../../navigation/types'
import { useClient } from '../../hooks/useClient'
import { syncClient } from '../../lib/api'
import { COLORS } from '../../lib/constants'
import { formatMoney, formatDate } from '../../lib/formatters'
import LoadingScreen from '../../components/ui/LoadingScreen'
import ErrorState from '../../components/ui/ErrorState'

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
}

function InfoRow({ label, value, valueColor }: InfoRowProps): React.JSX.Element {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, valueColor !== undefined && { color: valueColor }]}>
        {value}
      </Text>
    </View>
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
        {typeof client.status === 'string' && (
          <InfoRow label="Статус платника" value={client.status} />
        )}
        {client.debt === undefined &&
          client.overpayment === undefined &&
          client.status === undefined && (
            <Text style={styles.noData}>Немає даних</Text>
          )}
      </Section>

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

      <Section title="Документи">
        <TouchableOpacity
          style={styles.docsButton}
          onPress={handleViewDocuments}
          activeOpacity={0.8}
        >
          <Text style={styles.docsButtonIcon}>📂</Text>
          <Text style={styles.docsButtonText}>Переглянути документи</Text>
          <Text style={styles.docsButtonChevron}>›</Text>
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
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.TEXT_SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingLeft: 4,
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
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
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
  docsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  docsButtonIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  docsButtonText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.PRIMARY,
  },
  docsButtonChevron: {
    fontSize: 22,
    color: COLORS.TEXT_SECONDARY,
    marginLeft: 4,
  },
})
