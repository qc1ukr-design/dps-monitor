import React from 'react'
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ClientsStackParamList } from '../../navigation/types'
import { useDocuments } from '../../hooks/useDocuments'
import { Document } from '../../lib/api'
import { COLORS } from '../../lib/constants'
import { formatDate } from '../../lib/formatters'
import LoadingScreen from '../../components/ui/LoadingScreen'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'

type Props = NativeStackScreenProps<ClientsStackParamList, 'ClientDocuments'>

function getDocIcon(cdoc: string): string {
  if (cdoc === 'BOTB0501') return '📋'
  if (cdoc === 'D0300201') return '📬'
  if (cdoc === 'F1419104') return '📄'
  if (cdoc.startsWith('PDI')) return '❗'
  return '📎'
}


interface DocumentListItemProps {
  doc: Document
}

function DocumentListItem({ doc }: DocumentListItemProps): React.JSX.Element {
  return (
    <View style={styles.item}>
      <Text style={styles.itemIcon}>{getDocIcon(doc.cdoc)}</Text>
      <View style={styles.itemBody}>
        <Text style={styles.itemName} numberOfLines={2}>
          {doc.name}
        </Text>
        <View style={styles.itemMeta}>
          <Text style={styles.itemDate}>{formatDate(doc.date)}</Text>
          {doc.csti !== undefined && doc.csti !== '' && (
            <Text style={styles.itemCsti}>Відпр.: {doc.csti}</Text>
          )}
        </View>
        {doc.text !== undefined && doc.text !== '' && (
          <Text style={styles.itemText} numberOfLines={1}>
            {doc.text}
          </Text>
        )}
      </View>
    </View>
  )
}

export default function ClientDocumentsScreen({ route }: Props): React.JSX.Element {
  const { clientId } = route.params
  const { documents, loading, error, refresh } = useDocuments(clientId)
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

  return (
    <FlatList
      data={documents}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <DocumentListItem doc={item} />}
      ListEmptyComponent={
        <EmptyState icon="📂" title="Документів немає" subtitle="Документи відсутні або ще не завантажені" />
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
        documents.length === 0 && styles.listEmpty,
      ]}
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
  },
  listEmpty: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.CARD,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  itemIcon: {
    fontSize: 24,
    marginRight: 12,
    marginTop: 1,
  },
  itemBody: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT,
    marginBottom: 4,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemDate: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  itemCsti: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  itemText: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
    marginTop: 3,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.BORDER,
    marginLeft: 52,
  },
})
