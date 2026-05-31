export interface ProjectSession {
  id: string
  name: string
  repoRoot: string
  solutionPath: string
  uprojectPath: string | null
  buildCommand: string | null
  vsProcessId: number | null
  vsBridgeEndpoint: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectInput {
  name: string
  repoRoot: string
  solutionPath: string
  uprojectPath: string | null
  buildCommand: string | null
}

export interface OpenVisualStudioResult {
  project: ProjectSession
  processId: number
  devenvPath: string
  message: string
}
