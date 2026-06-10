import type { ProviderConfig } from './provider'

export type WorkspaceLayout = 'chat-only' | 'split-chat-trace'
export type VisualStyle = 'snowagent' | 'codex'

export interface UiPreferences {
  showTraceButton: boolean
  autoOpenTraceOnErrors: boolean
  defaultWorkspaceLayout: WorkspaceLayout
  visualStyle: VisualStyle
  workspaceHistoryDays: number
}

export interface AppSettings {
  devenvPath: string | null
  dataDir: string
  configPath: string
  providerNotes?: string
  uiPreferences: UiPreferences
  providers: ProviderConfig[]
}

export interface SettingsInput {
  devenvPath: string | null
  providerNotes?: string | null
  uiPreferences?: UiPreferences
  providers?: ProviderConfig[]
}
