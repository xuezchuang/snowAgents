import type { ProjectSession } from '../types/project'

export function vsStatus(project: ProjectSession): string {
  if (project.vsBridgeEndpoint) {
    return 'Bridge Connected'
  }
  if (project.vsProcessId) {
    return 'Process Started'
  }
  return 'Disconnected'
}

export function vsStatusClass(project: ProjectSession): string {
  if (project.vsBridgeEndpoint) {
    return 'connected'
  }
  if (project.vsProcessId) {
    return 'started'
  }
  return 'disconnected'
}
