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

export type ReportsStackParamList = {
  ReportsList: undefined
  ClientReports: {
    clientId: string
    clientName: string
  }
}

export type AppTabParamList = {
  Dashboard: undefined
  Clients: {
    screen: 'ClientDetail'
    params: { clientId: string; clientName: string }
  } | undefined
  Alerts: undefined
  Reports: undefined
  Profile: undefined
}
