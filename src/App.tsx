import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { getSettings, listProjects } from './api/tauriApi'
import ProjectList from './components/ProjectList'
import Settings from './components/Settings'
import Sidebar from './components/Sidebar'
import Toast from './components/Toast'
import type { ToastState } from './components/Toast'
import Workspace from './components/Workspace'
import {
  ensureWorkspaceProject,
  initialAppState,
  latestTaskIdForProject,
  normalizeSettings,
} from './state/appState'
import type { AppState, View } from './state/appState'

function App() {
  const [view, setView] = useState<View>('projects')
  const [appState, setAppState] = useState<AppState>(initialAppState)
  const [toast, setToast] = useState<ToastState | null>(null)
  const visualStyle = appState.settings?.uiPreferences.visualStyle ?? 'codex'

  const showToast = useCallback((kind: ToastState['kind'], message: string) => {
    const id = Date.now()
    setToast({ id, kind, message })
    window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current))
    }, 3000)
  }, [])

  const refreshProjects = useCallback(async () => {
    const nextProjects = await listProjects()
    setAppState((current) => {
      const activeProjectId =
        current.activeProjectId &&
        nextProjects.some((project) => project.id === current.activeProjectId)
          ? current.activeProjectId
          : null
      const nextState = {
        ...current,
        projects: nextProjects,
        activeProjectId,
      }
      return {
        ...nextState,
        currentWorkspaceTaskId: latestTaskIdForProject(nextState, activeProjectId),
      }
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [nextProjects, rawSettings] = await Promise.all([
          listProjects(),
          getSettings(),
        ])
        if (cancelled) {
          return
        }
        const settings = normalizeSettings(rawSettings)
        setAppState((current) => ({
          ...current,
          projects: nextProjects,
          settings,
          providers: settings.providers,
        }))
      } catch (caught) {
        if (!cancelled) {
          showToast('error', toMessage(caught))
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [showToast])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshProjects().catch((caught) => {
        showToast('error', toMessage(caught))
      })
    }, 3000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [refreshProjects, showToast])

  const navigate = (nextView: View) => {
    if (nextView === 'workspace') {
      setAppState((current) => ensureWorkspaceProject(current))
    }
    setView(nextView)
  }

  const openWorkspace = (projectId: string) => {
    setAppState((current) => ({
      ...current,
      activeProjectId: projectId,
      currentWorkspaceTaskId: latestTaskIdForProject(current, projectId),
      traceDrawerOpen: false,
    }))
    setView('workspace')
  }

  const handleSettingsChanged = (settings: AppState['settings']) => {
    if (!settings) {
      return
    }
    const normalized = normalizeSettings(settings)
    setAppState((current) => ({
      ...current,
      settings: normalized,
      providers: normalized.providers,
    }))
  }

  return (
    <div className={`app-root ${visualStyle === 'codex' ? 'codex-style' : 'classic-style'}`}>
      <div className="app-shell">
        <Sidebar view={view} onNavigate={navigate} />

        <main className="main-panel">
          <Toast toast={toast} onDismiss={() => setToast(null)} />

          <div className="main-scroll">
            {view === 'projects' ? (
              <ProjectList
                projects={appState.projects}
                activeProjectId={appState.activeProjectId}
                onOpenWorkspace={openWorkspace}
                onRefresh={refreshProjects}
                onError={(message) => showToast('error', message)}
                onNotice={(message) => showToast('notice', message)}
              />
            ) : null}

            {view === 'workspace' ? (
              <Workspace
                state={appState}
                setState={setAppState}
                onRefreshProjects={refreshProjects}
                onGlobalNotice={(message) => showToast('notice', message)}
                onGlobalError={(message) => showToast('error', message)}
              />
            ) : null}

            {view === 'settings' ? (
              <Settings
                settings={appState.settings}
                providers={appState.providers}
                onSettingsChanged={handleSettingsChanged}
                onProvidersChanged={(providers) =>
                  setAppState((current) => ({ ...current, providers }))
                }
                onError={(message) => showToast('error', message)}
                onNotice={(message) => showToast('notice', message)}
              />
            ) : null}
          </div>
        </main>
      </div>
    </div>
  )
}

function toMessage(caught: unknown): string {
  if (caught instanceof Error) {
    return caught.message
  }
  return String(caught)
}

export default App
