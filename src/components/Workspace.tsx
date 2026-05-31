import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { listTraces, openVisualStudio, runMockAgent } from '../api/tauriApi'
import type { AppState } from '../state/appState'
import type { AgentTask, ChatMessage } from '../types/task'
import type { ToolTraceEvent } from '../types/trace'
import ChatTimeline from './ChatTimeline'
import Composer from './Composer'
import Toast, { type ToastState } from './Toast'
import TraceDrawer from './TraceDrawer'
import WorkspaceHeader from './WorkspaceHeader'
import { extractCodeLinksFromText } from './codeLinkText'

interface WorkspaceProps {
  state: AppState
  setState: Dispatch<SetStateAction<AppState>>
  onRefreshProjects: () => Promise<void>
  onGlobalNotice: (message: string) => void
  onGlobalError: (message: string) => void
}

function Workspace({
  state,
  setState,
  onRefreshProjects,
  onGlobalNotice,
  onGlobalError,
}: WorkspaceProps) {
  const [busy, setBusy] = useState(false)
  const [composerDraft, setComposerDraft] = useState('')
  const [workspaceToast, setWorkspaceToast] = useState<ToastState | null>(null)
  const activeProject = useMemo(
    () =>
      state.projects.find((project) => project.id === state.activeProjectId) ??
      null,
    [state.activeProjectId, state.projects],
  )
  const currentTask =
    state.currentWorkspaceTaskId ?
      state.tasksById[state.currentWorkspaceTaskId] ?? null
    : null
  const traceEvents = currentTask?.traceEvents ?? []
  const showTraceButton = state.settings?.uiPreferences.showTraceButton ?? true

  const showWorkspaceToast = (kind: ToastState['kind'], message: string) => {
    const id = Date.now()
    setWorkspaceToast({ id, kind, message })
    window.setTimeout(() => {
      setWorkspaceToast((current) => (current?.id === id ? null : current))
    }, 3000)
  }

  const runTask = async (prompt: string) => {
    if (!activeProject) {
      return
    }

    const pendingTaskId = crypto.randomUUID()
    const userMessage = createMessage(pendingTaskId, 'user', prompt)
    const pendingTask: AgentTask = {
      id: pendingTaskId,
      projectId: activeProject.id,
      prompt,
      messages: [userMessage],
      traceEvents: [],
      status: 'running',
    }

    setBusy(true)
    setState((current) => addOrReplaceTask(current, activeProject.id, pendingTask))

    try {
      const run = await runMockAgent(activeProject.id, prompt)
      const assistantMessage = createAssistantMessage(run.taskId, run.traces)
      const completedTask: AgentTask = {
        id: run.taskId,
        projectId: activeProject.id,
        prompt,
        messages: [
          { ...userMessage, taskId: run.taskId },
          assistantMessage,
        ],
        traceEvents: run.traces,
        status: hasFailedTrace(run.traces) ? 'failed' : 'completed',
      }

      setState((current) =>
        replacePendingTask(
          current,
          activeProject.id,
          pendingTaskId,
          completedTask,
        ),
      )
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      const failedTask: AgentTask = {
        ...pendingTask,
        status: 'failed',
        messages: [
          userMessage,
          createMessage(pendingTaskId, 'system', message),
        ],
      }
      setState((current) => addOrReplaceTask(current, activeProject.id, failedTask))
      showWorkspaceToast('error', message)
    } finally {
      setBusy(false)
    }
  }

  const refreshCurrentTrace = async () => {
    if (!currentTask) {
      return
    }
    try {
      const traces = await listTraces(currentTask.id)
      setState((current) => ({
        ...current,
        tasksById: {
          ...current.tasksById,
          [currentTask.id]: {
            ...current.tasksById[currentTask.id],
            traceEvents: traces,
            status: hasFailedTrace(traces) ? 'failed' : currentTask.status,
          },
        },
      }))
    } catch (caught) {
      showWorkspaceToast(
        'error',
        caught instanceof Error ? caught.message : String(caught),
      )
    }
  }

  const launchVs = async () => {
    if (!activeProject) {
      return
    }
    try {
      setBusy(true)
      if (activeProject.vsBridgeEndpoint) {
        showWorkspaceToast('notice', 'VS already connected; bring to front is TODO.')
      }
      const result = await openVisualStudio(activeProject.id)
      onGlobalNotice(`Visual Studio started, PID ${result.processId}`)
      await onRefreshProjects()
    } catch (caught) {
      onGlobalError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const refreshBridge = () => {
    void onRefreshProjects()
      .then(() => showWorkspaceToast('notice', 'Bridge status refreshed.'))
      .catch((caught) =>
        showWorkspaceToast(
          'error',
          caught instanceof Error ? caught.message : String(caught),
        ),
      )
  }

  const clearWorkspace = () => {
    if (!activeProject) {
      return
    }
    setState((current) => {
      const taskIds = current.taskIdsByProjectId[activeProject.id] ?? []
      const tasksById = { ...current.tasksById }
      taskIds.forEach((taskId) => {
        delete tasksById[taskId]
      })
      return {
        ...current,
        currentWorkspaceTaskId: null,
        traceDrawerOpen: false,
        tasksById,
        taskIdsByProjectId: {
          ...current.taskIdsByProjectId,
          [activeProject.id]: [],
        },
      }
    })
    setComposerDraft('')
    showWorkspaceToast('notice', 'Workspace cleared.')
  }

  if (!activeProject) {
    return (
      <section className="page-section">
        <div className="empty-state workspace-empty">
          {state.projects.length === 0 ?
            'Add a project first.'
          : 'Please choose a project from Projects.'}
        </div>
      </section>
    )
  }

  return (
    <section className="workspace-page">
      <Toast toast={workspaceToast} onDismiss={() => setWorkspaceToast(null)} />
      <WorkspaceHeader
        project={activeProject}
        traceEvents={traceEvents}
        traceDrawerOpen={state.traceDrawerOpen}
        showTraceButton={showTraceButton}
        busy={busy}
        onToggleTrace={() =>
          setState((current) => ({
            ...current,
            traceDrawerOpen: !current.traceDrawerOpen,
          }))
        }
        onOpenVisualStudio={launchVs}
        onRefreshBridge={refreshBridge}
        onClearWorkspace={clearWorkspace}
        onNotice={(message) => showWorkspaceToast('notice', message)}
      />

      <div className={state.traceDrawerOpen ? 'workspace-body trace-open' : 'workspace-body'}>
        <main className="chat-shell">
          <ChatTimeline
            task={currentTask}
            projectId={activeProject.id}
            onCodeLinkResult={(message) => showWorkspaceToast('notice', message)}
            onCodeLinkError={(message) =>
              showWorkspaceToast('error', normalizeCodeLinkError(message))
            }
            onTraceChanged={() => {
              void refreshCurrentTrace()
            }}
            onSuggestionSelect={setComposerDraft}
          />
          <Composer
            providers={state.providers}
            busy={busy}
            value={composerDraft}
            onChange={setComposerDraft}
            onSend={runTask}
          />
        </main>
        <TraceDrawer
          open={state.traceDrawerOpen}
          taskId={currentTask?.id ?? null}
          traceEvents={traceEvents}
          onClose={() =>
            setState((current) => ({
              ...current,
              traceDrawerOpen: false,
            }))
          }
        />
      </div>
    </section>
  )
}

function addOrReplaceTask(
  state: AppState,
  projectId: string,
  task: AgentTask,
): AppState {
  const existingTaskIds = state.taskIdsByProjectId[projectId] ?? []
  const taskIds =
    existingTaskIds.includes(task.id) ?
      existingTaskIds
    : [...existingTaskIds, task.id]

  return {
    ...state,
    currentWorkspaceTaskId: task.id,
    tasksById: {
      ...state.tasksById,
      [task.id]: task,
    },
    taskIdsByProjectId: {
      ...state.taskIdsByProjectId,
      [projectId]: taskIds,
    },
  }
}

function replacePendingTask(
  state: AppState,
  projectId: string,
  pendingTaskId: string,
  task: AgentTask,
): AppState {
  const taskIds = (state.taskIdsByProjectId[projectId] ?? []).map((taskId) =>
    taskId === pendingTaskId ? task.id : taskId,
  )
  const { [pendingTaskId]: unusedPendingTask, ...tasksById } = state.tasksById
  void unusedPendingTask
  return {
    ...state,
    currentWorkspaceTaskId: task.id,
    traceDrawerOpen:
      state.settings?.uiPreferences.defaultWorkspaceLayout === 'split-chat-trace' ||
      (state.settings?.uiPreferences.autoOpenTraceOnErrors === true &&
        hasFailedTrace(task.traceEvents)),
    tasksById: {
      ...tasksById,
      [task.id]: task,
    },
    taskIdsByProjectId: {
      ...state.taskIdsByProjectId,
      [projectId]: taskIds,
    },
  }
}

function createMessage(
  taskId: string,
  role: ChatMessage['role'],
  content: string,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    taskId,
    role,
    content,
    createdAt: new Date().toISOString(),
  }
}

function createAssistantMessage(
  taskId: string,
  traces: ToolTraceEvent[],
): ChatMessage {
  const summary =
    traces.find((event) => event.type === 'model_message')?.outputSummary ??
    `Mock agent produced ${traces.length} trace events.`
  const links = extractCodeLinksFromText(summary).map((rawLink) => ({ rawLink }))

  return {
    ...createMessage(taskId, 'assistant', summary),
    codeLinks: links,
  }
}

function hasFailedTrace(traces: ToolTraceEvent[]): boolean {
  return traces.some((event) => event.status === 'failed')
}

function normalizeCodeLinkError(message: string): string {
  if (message.includes('Bridge not connected')) {
    return 'VS Bridge is not connected.'
  }
  if (message.startsWith('File does not exist:')) {
    return 'File does not exist.'
  }
  return message
}

export default Workspace
