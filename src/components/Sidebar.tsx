import {
  Edit3,
  Folder,
  FolderKanban,
  MoreHorizontal,
  Settings as SettingsIcon,
  UserRound,
} from 'lucide-react'
import type { View } from '../state/appState'
import type { ProjectSession } from '../types/project'
import type { AgentTask } from '../types/task'
import WorkspaceHistoryList from './WorkspaceHistoryList'

interface SidebarProps {
  view: View
  projects: ProjectSession[]
  activeProjectId: string | null
  currentTaskId: string | null
  historyDays: number
  tasksById: Record<string, AgentTask>
  taskIdsByProjectId: Record<string, string[]>
  onNavigate: (view: View) => void
  onOpenProject: (projectId: string) => void
  onOpenHistoryTask: (task: AgentTask) => void
  onNewChat: (projectId: string) => void
}

function Sidebar({
  view,
  projects,
  activeProjectId,
  currentTaskId,
  historyDays,
  tasksById,
  taskIdsByProjectId,
  onNavigate,
  onOpenProject,
  onOpenHistoryTask,
  onNewChat,
}: SidebarProps) {
  return (
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
          className={view === 'profile' ? 'nav-item active' : 'nav-item'}
          onClick={() => onNavigate('profile')}
        >
          <UserRound size={18} aria-hidden="true" />
          Profile
        </button>

        <button
          type="button"
          className={view === 'projects' ? 'nav-item active' : 'nav-item'}
          onClick={() => onNavigate('projects')}
        >
          <FolderKanban size={18} aria-hidden="true" />
          Projects
        </button>

        <div className="sidebar-project-list" aria-label="Workspace projects">
          {projects.map((project) => {
            const projectTasks = (taskIdsByProjectId[project.id] ?? [])
              .map((taskId) => tasksById[taskId])
              .filter((task): task is AgentTask => Boolean(task))
              .reverse()
            const active = view === 'workspace' && project.id === activeProjectId

            return (
              <div className="sidebar-project-group" key={project.id}>
                <div className="sidebar-project-row">
                  <button
                    type="button"
                    className={
                      active ?
                        'sidebar-project-button active'
                      : 'sidebar-project-button'
                    }
                    onClick={() => onOpenProject(project.id)}
                    title={project.name}
                  >
                    <Folder size={15} aria-hidden="true" />
                    <span>{project.name}</span>
                    <MoreHorizontal className="sidebar-project-more" size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="sidebar-new-chat-button"
                    onClick={() => onNewChat(project.id)}
                    title={`Start new chat in ${project.name}`}
                    aria-label={`Start new chat in ${project.name}`}
                  >
                    <Edit3 size={14} aria-hidden="true" />
                  </button>
                </div>
                {projectTasks.length > 0 ? (
                  <WorkspaceHistoryList
                    key={`${project.id}:${historyDays}`}
                    tasks={projectTasks}
                    currentTaskId={currentTaskId}
                    historyDays={historyDays}
                    showHeader={false}
                    onSelectTask={onOpenHistoryTask}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      </nav>
      <div className="sidebar-bottom-nav">
        <button
          type="button"
          className={view === 'settings' ? 'nav-item active' : 'nav-item'}
          onClick={() => onNavigate('settings')}
        >
          <SettingsIcon size={18} aria-hidden="true" />
          Settings
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
