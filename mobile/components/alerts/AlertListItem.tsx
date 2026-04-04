import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Alert } from '../../lib/api'
import { ALERT_ICONS, COLORS } from '../../lib/constants'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'щойно'
  if (hours < 24) return `${hours} год тому`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'вчора'
  return `${days} дн тому`
}

interface AlertListItemProps {
  alert: Alert
  onPress: () => void
}

export default function AlertListItem({
  alert,
  onPress,
}: AlertListItemProps): React.JSX.Element {
  const icon = ALERT_ICONS[alert.type] ?? '🔔'
  const isRead = alert.is_read

  return (
    <TouchableOpacity
      style={[styles.container, isRead ? styles.containerRead : styles.containerUnread]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.icon}>{icon}</Text>
      <View style={styles.content}>
        {alert.client_name !== undefined && (
          <Text style={styles.clientName} numberOfLines={1}>
            {alert.client_name}
          </Text>
        )}
        <Text
          style={[styles.message, !isRead && styles.messageUnread]}
          numberOfLines={2}
        >
          {alert.message}
        </Text>
        <Text style={styles.time}>{timeAgo(alert.created_at)}</Text>
      </View>
      {!isRead && <View style={styles.dot} />}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  containerUnread: {
    backgroundColor: COLORS.CARD,
  },
  containerRead: {
    backgroundColor: '#F3F4F6',
  },
  icon: {
    fontSize: 22,
    marginRight: 12,
    marginTop: 1,
  },
  content: {
    flex: 1,
  },
  clientName: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
    marginBottom: 2,
  },
  message: {
    fontSize: 14,
    color: COLORS.TEXT,
    lineHeight: 20,
  },
  messageUnread: {
    fontWeight: '600',
  },
  time: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
    marginTop: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.PRIMARY,
    marginTop: 6,
    marginLeft: 8,
  },
})
