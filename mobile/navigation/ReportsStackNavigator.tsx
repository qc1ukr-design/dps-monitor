import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { ReportsStackParamList } from './types'
import { COLORS } from '../lib/constants'
import ReportsScreen from '../screens/reports/ReportsScreen'
import ClientReportsScreen from '../screens/reports/ClientReportsScreen'

const Stack = createNativeStackNavigator<ReportsStackParamList>()

export default function ReportsStackNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: COLORS.CARD,
        },
        headerTintColor: COLORS.TEXT,
        headerTitleStyle: {
          fontWeight: '600',
        },
        headerBackTitle: 'Назад',
        contentStyle: {
          backgroundColor: COLORS.BACKGROUND,
        },
      }}
    >
      <Stack.Screen
        name="ReportsList"
        component={ReportsScreen}
        options={{ title: 'Звіти' }}
      />
      <Stack.Screen
        name="ClientReports"
        component={ClientReportsScreen}
        options={({ route }) => ({ title: route.params.clientName })}
      />
    </Stack.Navigator>
  )
}
