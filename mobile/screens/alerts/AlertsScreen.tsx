import React, { useCallback } from 'react'
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useAlerts } from '../../hooks/useAlerts'
import { markAlertsRead } from '../../lib/api'
import { Alert } from '../../lib/api'
import { COLORS } from '../../lib/constants'
import AlertListItem from '../../components/alerts/AlertListItem'
import LoadingScreen from '../../components/ui/LoadingScreen'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'

export default function AlertsScreen(): React.JSX.Element {
  const { alerts, loading, error, refresh } = useAlerts()
  const [refreshing, setRefreshing] = React.useState(false)
  const [marking, setMarking] = React.useState(false)

  async function handleRefresh(): Promise<void> {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  async function handleMarkAllRead(): Promise<void> {
    if (marking) return
    setMarking(true)
    try {
      await markAlertsRead()
      await refresh()
    } catch {
      // ignore
    } finally {
      setMarking(false)
    }
  }

  const handleAlertPress = useCallback(
    async (alert: Alert): Promise<void> => {
      if (alert.is_read) return
      try {
        await markAlertsRead(alert.client_id)
        await refresh()
      } catch {
        // ignore
      }
    },
    [refresh]
  )

  if (loading && !refreshing) {
    return <LoadingScreen />
  }

  if (error !== null) {
    return <ErrorState message={error} onRetry={refresh} />
  }

  const hasUnread = alerts.some((a) => !a.is_read)

  return (
    <View style={styles.container}>
      <FlatList
        data={alerts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <AlertListItem
            alert={item}
            onPress={() => {
              void handleAlertPress(item)
            }}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="🔔"
            title="Алертів немає"
            subtitle="Всі клієнти в нормі"
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
        contentContainerStyle={[
          styles.listContent,
          alerts.length === 0 && styles.listEmpty,
        ]}
        style={styles.list}
      />

      {hasUnread && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.markReadButton, marking && styles.markReadButtonDisabled]}
            onPress={handleMarkAllRead}
            disabled={marking}
            activeOpacity={0.8}
          >
            <Text style={styles.markReadText}>
              {marking ? 'Позначаємо...' : 'Відмітити всі прочитаними'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 8,
  },
  listEmpty: {
    flex: 1,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.BORDER,
    marginLeft: 54,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.CARD,
    borderTopWidth: 1,
    borderTopColor: COLORS.BORDER,
  },
  markReadButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  markReadButtonDisabled: {
    opacity: 0.6,
  },
  markReadText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.CARD,
  },
})
