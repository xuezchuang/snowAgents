import type { ToolTraceEvent } from './trace'

export interface VSInstance {
  instanceId: string
  projectId: string | null
  processId: number
  solutionPath: string
  endpoint: string
  connectedAt: string
  lastHeartbeatAt: string
}

export interface VSRegisterPayload {
  instanceId: string
  processId: number
  solutionPath: string
  endpoint: string
}

export interface OpenCodeLinkResult {
  resolvedPath: string
  line: number
  column: number | null
  bridgeCalled: boolean
  fallbackStartedVs: boolean
  message: string
  traceEvent: ToolTraceEvent | null
}
