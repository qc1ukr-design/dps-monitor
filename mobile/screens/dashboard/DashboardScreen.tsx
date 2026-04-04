import React, { useMemo } from 'react'
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useClients } from '../../hooks/useClients'
import { Client } from '../../lib/api'
import { COLORS } from '../../lib/constants'
import { formatMoney } from '../../lib/formatters'
import SummaryCard from '../../components/clients/SummaryCard'
import LoadingScreen from '../../components/ui/LoadingScreen'


interface ClientShortRowProps {
  client: Client
}

function ClientShortRow({ client }: ClientShortRowProps): React.JSX.Element {
  const hasDebt = typeof client.debt === 'number' && client.debt > 0
  const hasOverpayment =
    typeof client.overpayment === 'number' && client.overpayment > 0

  return (
    <View style={styles.clientRow}>
      <Text style={styles.clientName} numberOfLines={1}>
        {client.name}
      </Text>
      {hasDebt && (
        <Text style={styles.debtValue}>
          -{formatMoney(client.debt!)}
        </Text>
      )}
      {!hasDebt && hasOverpayment && (
        <Text style={styles.overpayValue}>
          +{formatMoney(client.overpayment!)}
        </Text>
      )}
      {!hasDebt && !hasOverpayment && (
        <Text style={styles.neutralValue}>0.00 грн</Text>
      )}
    </View>
  )
}

export default function DashboardScreen(): React.JSX.Element {
  const { clients, loading, error, refresh } = useClients()
  const [refreshing, setRefreshing] = React.useState(false)

  async function handleRefresh(): Promise<void> {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  const stats = useMemo(() => {
    const totalClients = clients.length
    const withDebt = clients.filter(
      (c) => typeof c.debt === 'number' && c.debt > 0
    ).length
    const totalDebt = clients.reduce((sum, c) => {
      if (typeof c.debt === 'number' && c.debt > 0) return sum + c.debt
      return sum
    }, 0)
    const totalOverpayment = clients.reduce((sum, c) => {
      if (typeof c.overpayment === 'number' && c.overpayment > 0)
        return sum + c.overpayment
      return sum
    }, 0)
    return { totalClients, withDebt, totalDebt, totalOverpayment }
  }, [clients])

  if (loading && !refreshing) {
    return <LoadingScreen />
  }

  if (error !== null) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    )
  }

  const ListHeader = (
    <View>
      <View style={styles.grid}>
        <View style={styles.gridRow}>
          <SummaryCard
            title="Всього клієнтів"
            value={stats.totalClients}
            color={COLORS.PRIMARY}
            icon="👥"
          />
          <SummaryCard
            title="З боргом"
            value={stats.withDebt}
            color={stats.withDebt > 0 ? COLORS.DANGER : COLORS.TEXT_SECONDARY}
            icon="🔴"
          />
        </View>
        <View style={styles.gridRow}>
          <SummaryCard
            title="Загальний борг, грн"
            value={formatMoney(stats.totalDebt)}
            color={stats.totalDebt > 0 ? COLORS.DANGER : COLORS.TEXT_SECONDARY}
            icon="💸"
          />
          <SummaryCard
            title="Загальна переплата, грн"
            value={formatMoney(stats.totalOverpayment)}
            color={
              stats.totalOverpayment > 0 ? COLORS.SUCCESS : COLORS.TEXT_SECONDARY
            }
            icon="💰"
          />
        </View>
      </View>

      {clients.length > 0 && (
        <Text style={styles.listTitle}>Клієнти</Text>
      )}
    </View>
  )

  return (
    <FlatList
      data={clients}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ClientShortRow client={item} />}
      ListHeaderComponent={ListHeader}
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Клієнтів ще немає</Text>
        </View>
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
      contentContainerStyle={styles.listContent}
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
    paddingBottom: 24,
  },
  grid: {
    padding: 12,
  },
  gridRow: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  listTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.TEXT_SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.CARD,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  clientName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.TEXT,
    marginRight: 8,
  },
  debtValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.DANGER,
  },
  overpayValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.SUCCESS,
  },
  neutralValue: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.BORDER,
    marginLeft: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.TEXT_SECONDARY,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: COLORS.BACKGROUND,
  },
  errorText: {
    fontSize: 15,
    color: COLORS.DANGER,
    textAlign: 'center',
  },
})
