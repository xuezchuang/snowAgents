export interface AppSettings {
  devenvPath: string | null
  dataDir: string
  providerNotes: string
}

export interface SettingsInput {
  devenvPath: string | null
  providerNotes: string | null
}
