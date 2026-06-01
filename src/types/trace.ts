export type TraceEventType =
  | 'tool_call'
  | 'tool_result'
  | 'model_message'
  | 'system_event'
  | 'error'

export type TraceStatus = 'running' | 'success' | 'failed'

export interface ToolTraceEvent {
  id: string
  taskId: string
  stepIndex: number
  type: TraceEventType
  toolName: string | null
  title: string
  input: unknown | null
  output: unknown | null
  outputSummary: string | null
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  status: TraceStatus
}

export interface MockAgentRun {
  taskId: string
  traces: ToolTraceEvent[]
}

export interface AgentConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentRunInput {
  projectId: string
  userPrompt: string
  messages?: AgentConversationMessage[]
  providerId: string | null
  modelId: string | null
}
