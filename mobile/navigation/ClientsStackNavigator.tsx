import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { ClientsStackParamList } from './types'
import { COLORS } from '../lib/constants'
import ClientsListScreen from '../screens/clients/ClientsListScreen'
import ClientDetailScreen from '../screens/clients/ClientDetailScreen'
import ClientDocumentsScreen from '../screens/clients/ClientDocumentsScreen'

const Stack = createNativeStackNavigator<ClientsStackParamList>()

export default function ClientsStackNavigator(): React.JSX.Element {
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
        name="ClientsList"
        component={ClientsListScreen}
        options={{ title: 'Клієнти' }}
      />
      <Stack.Screen
        name="ClientDetail"
        component={ClientDetailScreen}
        options={({ route }) => ({ title: route.params.clientName })}
      />
      <Stack.Screen
        name="ClientDocuments"
        component={ClientDocumentsScreen}
        options={({ route }) => ({ title: `Документи — ${route.params.clientName}` })}
      />
    </Stack.Navigator>
  )
}
