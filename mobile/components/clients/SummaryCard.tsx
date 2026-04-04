import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { COLORS } from '../../lib/constants'

interface SummaryCardProps {
  title: string
  value: string | number
  color: string
  icon?: string
}

export default function SummaryCard({
  title,
  value,
  color,
  icon,
}: SummaryCardProps): React.JSX.Element {
  return (
    <View style={styles.card}>
      {icon !== undefined && <Text style={styles.icon}>{icon}</Text>}
      <Text style={[styles.value, { color }]}>{value}</Text>
      <Text style={styles.title}>{title}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: COLORS.CARD,
    borderRadius: 12,
    padding: 16,
    margin: 4,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  icon: {
    fontSize: 24,
    marginBottom: 6,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  title: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 16,
  },
})
