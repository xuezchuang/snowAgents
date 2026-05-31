export type ProviderType =
  | 'openai-compatible'
  | 'claude'
  | 'deepseek'
  | 'minimax'
  | 'ollama'
  | 'local-gateway'

export interface ProviderConfig {
  id: string
  type: ProviderType
  name: string
  enabled: boolean
  baseUrl: string
  baseUrlLocked: boolean
  apiKey: string
  defaultModel: string
  temperature: number
  models: ProviderModel[]
}

export interface ProviderModel {
  id: string
  name: string
  enabled: boolean
  ownedBy?: string | null
  created?: number | null
}

export const providerTypeLabels: Record<ProviderType, string> = {
  'openai-compatible': 'OpenAI-Compatible',
  claude: 'Claude',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  ollama: 'Ollama',
  'local-gateway': 'Local Gateway',
}

export const minimaxOpenAiBaseUrl = 'https://api.minimaxi.com/v1'
