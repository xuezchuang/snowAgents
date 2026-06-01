import type { ProviderConfig } from '../types/provider'
import { minimaxOpenAiBaseUrl } from '../types/provider'
import type { ProjectSession } from '../types/project'
import type { AppSettings, UiPreferences } from '../types/settings'
import type { AgentTask } from '../types/task'

export type View = 'projects' | 'workspace' | 'profile' | 'settings'
type PersistedWorkspaceState = Pick<
  AppState,
  'activeProjectId' | 'currentWorkspaceTaskId' | 'tasksById' | 'taskIdsByProjectId'
>

export interface AppState {
  projects: ProjectSession[]
  activeProjectId: string | null
  settings: AppSettings | null
  providers: ProviderConfig[]
  currentWorkspaceTaskId: string | null
  traceDrawerOpen: boolean
  tasksById: Record<string, AgentTask>
  taskIdsByProjectId: Record<string, string[]>
}

export const defaultUiPreferences: UiPreferences = {
  showTraceButton: true,
  autoOpenTraceOnErrors: true,
  defaultWorkspaceLayout: 'chat-only',
  visualStyle: 'codex',
  workspaceHistoryDays: 7,
}

export const defaultProviders: ProviderConfig[] = [
  {
    id: 'openai-compatible',
    type: 'openai-compatible',
    name: 'OpenAI-Compatible',
    enabled: false,
    baseUrl: '',
    baseUrlLocked: false,
    apiKey: '',
    defaultModel: 'gpt-4.1',
    temperature: 0.2,
    models: [],
  },
  {
    id: 'claude',
    type: 'claude',
    name: 'Claude',
    enabled: false,
    baseUrl: '',
    baseUrlLocked: false,
    apiKey: '',
    defaultModel: 'Claude 4.1 Sonnet',
    temperature: 0.2,
    models: [],
  },
  {
    id: 'deepseek',
    type: 'deepseek',
    name: 'DeepSeek',
    enabled: false,
    baseUrl: '',
    baseUrlLocked: false,
    apiKey: '',
    defaultModel: 'deepseek-chat',
    temperature: 0.2,
    models: [],
  },
  {
    id: 'minimax',
    type: 'minimax',
    name: 'MiniMax',
    enabled: false,
    baseUrl: minimaxOpenAiBaseUrl,
    baseUrlLocked: true,
    apiKey: '',
    defaultModel: 'MiniMax-M2.7',
    temperature: 0.2,
    models: [],
  },
  {
    id: 'ollama',
    type: 'ollama',
    name: 'Ollama',
    enabled: false,
    baseUrl: 'http://127.0.0.1:11434',
    baseUrlLocked: false,
    apiKey: '',
    defaultModel: 'llama3.1',
    temperature: 0.2,
    models: [],
  },
  {
    id: 'local-gateway',
    type: 'local-gateway',
    name: 'Local Gateway',
    enabled: false,
    baseUrl: '',
    baseUrlLocked: false,
    apiKey: '',
    defaultModel: 'local-default',
    temperature: 0.2,
    models: [],
  },
]

export const initialAppState: AppState = {
  projects: [],
  activeProjectId: null,
  settings: null,
  providers: defaultProviders,
  currentWorkspaceTaskId: null,
  traceDrawerOpen: false,
  tasksById: {},
  taskIdsByProjectId: {},
}

const workspaceHistoryStorageKey = 'snowagent.workspaceHistory.v1'

export function normalizeSettings(settings: AppSettings): AppSettings {
  const providers =
    settings.providers && settings.providers.length > 0
      ? mergeProviders(settings.providers)
      : defaultProviders

  return {
    ...settings,
    uiPreferences: {
      ...defaultUiPreferences,
      ...(settings.uiPreferences ?? {}),
    },
    providers,
  }
}

export function latestTaskIdForProject(
  state: AppState,
  projectId: string | null,
): string | null {
  if (!projectId) {
    return null
  }
  const taskIds = state.taskIdsByProjectId[projectId] ?? []
  return taskIds.at(-1) ?? null
}

export function ensureWorkspaceProject(state: AppState): AppState {
  if (state.activeProjectId) {
    return state
  }
  if (state.projects.length !== 1) {
    return state
  }
  const projectId = state.projects[0].id
  return {
    ...state,
    activeProjectId: projectId,
    currentWorkspaceTaskId: latestTaskIdForProject(state, projectId),
  }
}

export function loadPersistedWorkspaceState(): PersistedWorkspaceState {
  if (typeof window === 'undefined') {
    return emptyPersistedWorkspaceState()
  }
  try {
    const raw = window.localStorage.getItem(workspaceHistoryStorageKey)
    if (!raw) {
      return emptyPersistedWorkspaceState()
    }
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return emptyPersistedWorkspaceState()
    }
    const tasksById = readTasksById(parsed.tasksById)
    return {
      activeProjectId: readNullableString(parsed.activeProjectId),
      currentWorkspaceTaskId: readNullableString(parsed.currentWorkspaceTaskId),
      tasksById,
      taskIdsByProjectId: readTaskIdsByProjectId(parsed.taskIdsByProjectId, tasksById),
    }
  } catch {
    return emptyPersistedWorkspaceState()
  }
}

export function persistWorkspaceState(state: AppState): void {
  if (typeof window === 'undefined') {
    return
  }
  const payload: PersistedWorkspaceState = {
    activeProjectId: state.activeProjectId,
    currentWorkspaceTaskId: state.currentWorkspaceTaskId,
    tasksById: state.tasksById,
    taskIdsByProjectId: state.taskIdsByProjectId,
  }
  try {
    window.localStorage.setItem(workspaceHistoryStorageKey, JSON.stringify(payload))
  } catch {
    // Best-effort UI history; the app can keep running if storage is unavailable.
  }
}

function mergeProviders(providers: ProviderConfig[]): ProviderConfig[] {
  const providedById = new Map(providers.map((provider) => [provider.id, provider]))
  const mergedDefaults = defaultProviders.map((provider) => ({
    ...provider,
    ...(providedById.get(provider.id) ?? {}),
    baseUrl:
      provider.id === 'minimax'
        ? minimaxOpenAiBaseUrl
        : providedById.get(provider.id)?.baseUrl ?? provider.baseUrl,
    baseUrlLocked:
      provider.id === 'minimax'
        ? true
        : providedById.get(provider.id)?.baseUrlLocked ?? provider.baseUrlLocked,
    models: providedById.get(provider.id)?.models ?? provider.models,
  }))
  const customProviders = providers.filter(
    (provider) => !defaultProviders.some((defaultProvider) => defaultProvider.id === provider.id),
  )
  return [...mergedDefaults, ...customProviders]
}

function emptyPersistedWorkspaceState(): PersistedWorkspaceState {
  return {
    activeProjectId: null,
    currentWorkspaceTaskId: null,
    tasksById: {},
    taskIdsByProjectId: {},
  }
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readTasksById(value: unknown): Record<string, AgentTask> {
  if (!isRecord(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, AgentTask] =>
      isAgentTask(entry[1]),
    ),
  )
}

function readTaskIdsByProjectId(
  value: unknown,
  tasksById: Record<string, AgentTask>,
): Record<string, string[]> {
  if (!isRecord(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
      .map(([projectId, taskIds]) => [
        projectId,
        taskIds.filter((taskId): taskId is string =>
          typeof taskId === 'string' && tasksById[taskId] !== undefined,
        ),
      ]),
  )
}

function isAgentTask(value: unknown): value is AgentTask {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.prompt === 'string' &&
    Array.isArray(value.messages) &&
    Array.isArray(value.traceEvents) &&
    (value.status === 'running' ||
      value.status === 'completed' ||
      value.status === 'failed')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
