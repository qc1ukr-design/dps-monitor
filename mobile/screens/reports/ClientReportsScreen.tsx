import React from 'react'
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ReportsStackParamList } from '../../navigation/types'
import { useReports } from '../../hooks/useReports'
import { TaxReport } from '../../lib/api'
import { COLORS } from '../../lib/constants'
import LoadingScreen from '../../components/ui/LoadingScreen'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'

type Props = NativeStackScreenProps<ReportsStackParamList, 'ClientReports'>

const STATUS_LABEL: Record<TaxReport['status'], string> = {
  accepted:   'Прийнято',
  rejected:   'Відхилено',
  processing: 'Обробляється',
  pending:    'Очікує',
}

const STATUS_COLOR: Record<TaxReport['status'], string> = {
  accepted:   COLORS.SUCCESS,
  rejected:   COLORS.DANGER,
  processing: COLORS.WARNING,
  pending:    COLORS.TEXT_SECONDARY,
}

function formatSubmittedAt(dateStr: string): string {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

interface ReportItemProps {
  report: TaxReport
}

function ReportItem({ report }: ReportItemProps): React.JSX.Element {
  const statusColor = STATUS_COLOR[report.status]
  const statusLabel = STATUS_LABEL[report.status]

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.formCode}>{report.formCode}</Text>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}1A` }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {report.name !== '' && (
        <Text style={styles.reportName} numberOfLines={2}>
          {report.name}
        </Text>
      )}

      <View style={styles.cardFooter}>
        {report.period !== '' && (
          <Text style={styles.period}>{report.period}</Text>
        )}
        {report.submittedAt !== '' && (
          <Text style={styles.date}>{formatSubmittedAt(report.submittedAt)}</Text>
        )}
      </View>

      {report.regNumber !== '' && (
        <Text style={styles.regNumber}>№ {report.regNumber}</Text>
      )}
    </View>
  )
}

export default function ClientReportsScreen({ route }: Props): React.JSX.Element {
  const { clientId } = route.params
  const { reports, loading, error, hasToken, noAccess, refresh } = useReports(clientId)
  const [refreshing, setRefreshing] = React.useState(false)

  async function handleRefresh(): Promise<void> {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  if (loading && !refreshing) {
    return <LoadingScreen />
  }

  if (error !== null) {
    return <ErrorState message={error} onRetry={refresh} />
  }

  if (!hasToken) {
    return (
      <EmptyState
        icon="🔑"
        title="КЕП не підключено"
        subtitle="Завантажте КЕП через вебпортал для отримання звітів"
      />
    )
  }

  if (noAccess) {
    return (
      <EmptyState
        icon="🚫"
        title="Немає доступу до звітів"
        subtitle="ДПС не надає доступ до звітності по цьому КЕП. Зверніться до підтримки або завантажте КЕП директора."
      />
    )
  }

  const year = new Date().getFullYear()

  return (
    <FlatList
      data={reports}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ReportItem report={item} />}
      contentContainerStyle={[
        styles.listContent,
        reports.length === 0 && styles.listEmpty,
      ]}
      ListHeaderComponent={
        reports.length > 0 ? (
          <Text style={styles.yearLabel}>{year} рік — {reports.length} звітів</Text>
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          icon="📋"
          title="Звітів не знайдено"
          subtitle={`Звіти за ${year} рік відсутні в ДПС`}
        />
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={COLORS.PRIMARY}
          colors={[COLORS.PRIMARY]}
        />
      }
      style={styles.list}
    />
  )
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  listContent: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  listEmpty: {
    flex: 1,
  },
  yearLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.TEXT_SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingVertical: 8,
    paddingLeft: 4,
  },
  card: {
    backgroundColor: COLORS.CARD,
    borderRadius: 10,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  formCode: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.PRIMARY,
    fontFamily: 'monospace',
  },
  statusBadge: {
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  reportName: {
    fontSize: 14,
    color: COLORS.TEXT,
    marginBottom: 8,
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  period: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
    flex: 1,
  },
  date: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  regNumber: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
    marginTop: 4,
  },
  separator: {
    height: 8,
  },
})
