import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderKanban, Settings as SettingsIcon } from 'lucide-react'
import './App.css'
import { getSettings, listProjects } from './api/tauriApi'
import ProjectDetail from './components/ProjectDetail'
import ProjectList from './components/ProjectList'
import Settings from './components/Settings'
import type { ProjectSession } from './types/project'
import type { AppSettings } from './types/settings'

type View = 'projects' | 'settings'

function App() {
  const [view, setView] = useState<View>('projects')
  const [projects, setProjects] = useState<ProjectSession[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refreshProjects = useCallback(async () => {
    const nextProjects = await listProjects()
    setProjects(nextProjects)
    setSelectedProjectId((current) => {
      if (!current) {
        return current
      }
      return nextProjects.some((project) => project.id === current) ? current : null
    })
  }, [])

  const refreshSettings = useCallback(async () => {
    const nextSettings = await getSettings()
    setSettings(nextSettings)
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [nextProjects, nextSettings] = await Promise.all([
          listProjects(),
          getSettings(),
        ])
        if (!cancelled) {
          setProjects(nextProjects)
          setSettings(nextSettings)
          setError(null)
        }
      } catch (caught) {
        if (!cancelled) {
          setError(toMessage(caught))
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshProjects().catch((caught) => {
        setError(toMessage(caught))
      })
    }, 3000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [refreshProjects])

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )

  const handleError = useCallback((message: string) => {
    setError(message)
    setNotice(null)
  }, [])

  const handleNotice = useCallback((message: string) => {
    setNotice(message)
    setError(null)
  }, [])

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <h1>SnowAgent</h1>
            <span>Desktop MVP</span>
          </div>
        </div>
        <nav className="nav">
          <button
            type="button"
            className={view === 'projects' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('projects')}
          >
            <FolderKanban size={18} aria-hidden="true" />
            Projects
          </button>
          <button
            type="button"
            className={view === 'settings' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('settings')}
          >
            <SettingsIcon size={18} aria-hidden="true" />
            Settings
          </button>
        </nav>
      </aside>

      <main className="workspace">
        {(error || notice) && (
          <div className={error ? 'banner error' : 'banner notice'}>
            {error ?? notice}
          </div>
        )}

        {view === 'projects' && selectedProject ? (
          <ProjectDetail
            project={selectedProject}
            onBack={() => setSelectedProjectId(null)}
            onError={handleError}
            onNotice={handleNotice}
            onProjectChanged={refreshProjects}
          />
        ) : null}

        {view === 'projects' && !selectedProject ? (
          <ProjectList
            projects={projects}
            selectedProjectId={selectedProjectId}
            onOpenProject={setSelectedProjectId}
            onRefresh={refreshProjects}
            onError={handleError}
            onNotice={handleNotice}
          />
        ) : null}

        {view === 'settings' ? (
          <Settings
            settings={settings}
            onRefresh={refreshSettings}
            onError={handleError}
            onNotice={handleNotice}
          />
        ) : null}
      </main>
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
