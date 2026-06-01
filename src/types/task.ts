import type { ToolTraceEvent } from './trace'

export type ChatRole = 'user' | 'assistant' | 'system'
export type AgentTaskStatus = 'running' | 'completed' | 'failed'

export interface CodeLinkRef {
  rawLink: string
}

export interface ChatMessage {
  id: string
  taskId: string
  role: ChatRole
  content: string
  codeLinks?: CodeLinkRef[]
  traceEvents?: ToolTraceEvent[]
  createdAt: string
}

export interface AgentTask {
  id: string
  projectId: string
  prompt: string
  messages: ChatMessage[]
  traceEvents: ToolTraceEvent[]
  status: AgentTaskStatus
}
