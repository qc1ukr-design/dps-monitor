import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useSession } from '../hooks/useSession'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { AuthStackParamList } from './types'
import LoadingScreen from '../components/ui/LoadingScreen'
import LoginScreen from '../screens/auth/LoginScreen'
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen'
import AppTabNavigator from './AppTabNavigator'

const AuthStack = createNativeStackNavigator<AuthStackParamList>()

function AuthenticatedRoot(): React.JSX.Element {
  usePushNotifications()
  return <AppTabNavigator />
}

export default function RootNavigator(): React.JSX.Element {
  const { session, loading } = useSession()

  if (loading) {
    return <LoadingScreen />
  }

  if (session !== null) {
    return <AuthenticatedRoot />
  }

  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  )
}
