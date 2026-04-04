import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

interface BadgeProps {
  text: string
  color: string
  backgroundColor: string
}

export default function Badge({ text, color, backgroundColor }: BadgeProps): React.JSX.Element {
  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <Text style={[styles.text, { color }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
})
