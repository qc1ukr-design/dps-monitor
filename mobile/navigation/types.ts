export type AuthStackParamList = {
  Login: undefined
  ForgotPassword: undefined
}

export type ClientsStackParamList = {
  ClientsList: undefined
  ClientDetail: {
    clientId: string
    clientName: string
  }
  ClientDocuments: {
    clientId: string
    clientName: string
  }
}

export type AppTabParamList = {
  Dashboard: undefined
  Clients: undefined
  Alerts: undefined
  Profile: undefined
}
