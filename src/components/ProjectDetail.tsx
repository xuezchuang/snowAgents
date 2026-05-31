import { useState } from 'react'
import { ArrowLeft, MonitorUp, Play } from 'lucide-react'
import {
  listTraces,
  openVisualStudio,
  runMockAgent,
} from '../api/tauriApi'
import TracePanel from './TracePanel'
import type { ProjectSession } from '../types/project'
import type { ToolTraceEvent } from '../types/trace'
import { normalizeDisplayPath } from '../utils/path'

interface ProjectDetailProps {
  project: ProjectSession
  onBack: () => void
  onProjectChanged: () => Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
}

function ProjectDetail({
  project,
  onBack,
  onProjectChanged,
  onError,
  onNotice,
}: ProjectDetailProps) {
  const [prompt, setPrompt] = useState(
    'Check Source/RPGMetanoiaCpp/Private/RPGMetanoiaCpp.cpp and suggest the next edit.',
  )
  const [traces, setTraces] = useState<ToolTraceEvent[]>([])
  const [taskId, setTaskId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const launchVs = async () => {
    try {
      setBusy(true)
      const result = await openVisualStudio(project.id)
      onNotice(`Visual Studio started, PID ${result.processId}`)
      await onProjectChanged()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const runTask = async () => {
    try {
      setBusy(true)
      const run = await runMockAgent(project.id, prompt)
      setTaskId(run.taskId)
      setTraces(run.traces)
      onNotice(`Mock agent produced ${run.traces.length} trace events`)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const reloadTraces = async (showNotice = true) => {
    if (!taskId) {
      return
    }
    try {
      const nextTraces = await listTraces(taskId)
      setTraces(nextTraces)
      if (showNotice) {
        onNotice('Trace events refreshed')
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <section className="page-section">
      <div className="detail-header">
        <button type="button" className="ghost-button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </button>
        <div>
          <h2>{project.name}</h2>
          <p>Project detail, VS binding, mock task flow, and trace output.</p>
        </div>
      </div>

      <div className="detail-layout">
        <section className="info-panel">
          <div className="panel-header">
            <h3>Project</h3>
            <span className={`vs-badge ${vsStatusClass(project)}`}>
              {vsStatus(project)}
            </span>
          </div>
          <dl className="project-fields">
            <dt>repoRoot</dt>
            <dd>{normalizeDisplayPath(project.repoRoot)}</dd>
            <dt>solutionPath</dt>
            <dd>{normalizeDisplayPath(project.solutionPath)}</dd>
            <dt>uprojectPath</dt>
            <dd>
              {project.uprojectPath
                ? normalizeDisplayPath(project.uprojectPath)
                : 'Not configured'}
            </dd>
            <dt>vsProcessId</dt>
            <dd>{project.vsProcessId ?? 'None'}</dd>
            <dt>vsBridgeEndpoint</dt>
            <dd>{project.vsBridgeEndpoint ?? 'Not connected'}</dd>
          </dl>
          <button
            type="button"
            className="secondary-button"
            onClick={launchVs}
            disabled={busy}
          >
            <MonitorUp size={16} aria-hidden="true" />
            Open VS
          </button>
        </section>

        <section className="task-panel">
          <div className="panel-header">
            <h3>Task</h3>
            {taskId ? <span className="task-id">taskId: {taskId}</span> : null}
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
          />
          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              onClick={runTask}
              disabled={busy || prompt.trim().length === 0}
            >
              <Play size={16} aria-hidden="true" />
              Run Mock Agent
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void reloadTraces()}
              disabled={!taskId}
            >
              Refresh Trace
            </button>
          </div>
        </section>
      </div>

      <TracePanel
        projectId={project.id}
        traces={traces}
        onResult={(message) => {
          onNotice(message)
          void onProjectChanged()
        }}
        onError={onError}
        onTraceChanged={() => {
          void reloadTraces(false)
        }}
      />
    </section>
  )
}

function vsStatus(project: ProjectSession): string {
  if (project.vsBridgeEndpoint) {
    return 'Bridge Connected'
  }
  if (project.vsProcessId) {
    return 'Process Started'
  }
  return 'Disconnected'
}

function vsStatusClass(project: ProjectSession): string {
  if (project.vsBridgeEndpoint) {
    return 'connected'
  }
  if (project.vsProcessId) {
    return 'started'
  }
  return 'disconnected'
}

export default ProjectDetail
