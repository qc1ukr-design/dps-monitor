import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useSession } from '../hooks/useSession'
import { AuthStackParamList } from './types'
import LoadingScreen from '../components/ui/LoadingScreen'
import LoginScreen from '../screens/auth/LoginScreen'
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen'
import AppTabNavigator from './AppTabNavigator'

const AuthStack = createNativeStackNavigator<AuthStackParamList>()

export default function RootNavigator(): React.JSX.Element {
  const { session, loading } = useSession()

  if (loading) {
    return <LoadingScreen />
  }

  if (session !== null) {
    return <AppTabNavigator />
  }

  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  )
}
