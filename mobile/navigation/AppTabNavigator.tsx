import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Ionicons } from '@expo/vector-icons'
import { AppTabParamList } from './types'
import { COLORS } from '../lib/constants'
import { useAlerts } from '../hooks/useAlerts'

import DashboardScreen from '../screens/dashboard/DashboardScreen'
import ClientsStackNavigator from './ClientsStackNavigator'
import AlertsScreen from '../screens/alerts/AlertsScreen'
import ProfileScreen from '../screens/profile/ProfileScreen'

const Tab = createBottomTabNavigator<AppTabParamList>()

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

function getTabIcon(routeName: keyof AppTabParamList, focused: boolean): IoniconName {
  switch (routeName) {
    case 'Dashboard':
      return focused ? 'home' : 'home-outline'
    case 'Clients':
      return focused ? 'people' : 'people-outline'
    case 'Alerts':
      return focused ? 'notifications' : 'notifications-outline'
    case 'Profile':
      return focused ? 'person' : 'person-outline'
  }
}

export default function AppTabNavigator(): React.JSX.Element {
  const { unreadCount } = useAlerts()

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, size }) => {
          const iconName = getTabIcon(route.name, focused)
          return (
            <Ionicons
              name={iconName}
              size={size}
              color={focused ? COLORS.PRIMARY : COLORS.TEXT_SECONDARY}
            />
          )
        },
        tabBarActiveTintColor: COLORS.PRIMARY,
        tabBarInactiveTintColor: COLORS.TEXT_SECONDARY,
        tabBarStyle: {
          borderTopColor: COLORS.BORDER,
          backgroundColor: COLORS.CARD,
        },
        headerStyle: {
          backgroundColor: COLORS.CARD,
          borderBottomColor: COLORS.BORDER,
        },
        headerTintColor: COLORS.TEXT,
        headerTitleStyle: {
          fontWeight: '600',
        },
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: 'Дашборд' }}
      />
      <Tab.Screen
        name="Clients"
        component={ClientsStackNavigator}
        options={{ title: 'Клієнти', headerShown: false }}
      />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{
          title: 'Алерти',
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Профіль' }}
      />
    </Tab.Navigator>
  )
}
