import React from 'react'
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ClientsStackParamList } from '../../navigation/types'
import { useClients } from '../../hooks/useClients'
import { Client } from '../../lib/api'
import { COLORS } from '../../lib/constants'
import { formatMoney } from '../../lib/formatters'
import LoadingScreen from '../../components/ui/LoadingScreen'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'

type Props = NativeStackScreenProps<ClientsStackParamList, 'ClientsList'>


interface ClientRowProps {
  client: Client
  onPress: () => void
}

function ClientRow({ client, onPress }: ClientRowProps): React.JSX.Element {
  const hasDebt = typeof client.debt === 'number' && client.debt > 0

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowMain}>
        <Text style={styles.clientName} numberOfLines={1}>
          {client.name}
        </Text>
        <Text style={styles.clientCode}>{client.edrpou}</Text>
      </View>

      {hasDebt && (
        <View style={styles.debtBadge}>
          <Text style={styles.debtText}>
            Борг {formatMoney(client.debt!)}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

export default function ClientsListScreen({ navigation }: Props): React.JSX.Element {
  const { clients, loading, error, refresh } = useClients()
  const [refreshing, setRefreshing] = React.useState(false)

  async function handleRefresh(): Promise<void> {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  function handleClientPress(client: Client): void {
    navigation.navigate('ClientDetail', {
      clientId: client.id,
      clientName: client.name,
    })
  }

  if (loading && !refreshing) {
    return <LoadingScreen />
  }

  if (error !== null) {
    return <ErrorState message={error} onRetry={refresh} />
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={clients}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ClientRow client={item} onPress={() => handleClientPress(item)} />
        )}
        contentContainerStyle={[
          styles.listContent,
          clients.length === 0 && styles.listEmpty,
        ]}
        ListEmptyComponent={
          <EmptyState
            icon="🏢"
            title="Клієнтів ще немає"
            subtitle="Додайте першого клієнта через вебпортал"
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  list: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  listContent: {
    paddingVertical: 8,
  },
  listEmpty: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.CARD,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowMain: {
    flex: 1,
    marginRight: 8,
  },
  clientName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.TEXT,
  },
  clientCode: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
    marginTop: 2,
  },
  debtBadge: {
    backgroundColor: '#FEE2E2',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  debtText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.DANGER,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.BORDER,
    marginLeft: 16,
  },
})
