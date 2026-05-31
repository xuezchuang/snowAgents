import { FolderKanban, Settings as SettingsIcon, Sparkles } from 'lucide-react'
import type { View } from '../state/appState'

interface SidebarProps {
  view: View
  onNavigate: (view: View) => void
}

function Sidebar({ view, onNavigate }: SidebarProps) {
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
          className={view === 'projects' ? 'nav-item active' : 'nav-item'}
          onClick={() => onNavigate('projects')}
        >
          <FolderKanban size={18} aria-hidden="true" />
          Projects
        </button>
        <button
          type="button"
          className={view === 'workspace' ? 'nav-item active' : 'nav-item'}
          onClick={() => onNavigate('workspace')}
        >
          <Sparkles size={18} aria-hidden="true" />
          Workspace
        </button>
        <button
          type="button"
          className={view === 'settings' ? 'nav-item active' : 'nav-item'}
          onClick={() => onNavigate('settings')}
        >
          <SettingsIcon size={18} aria-hidden="true" />
          Settings
        </button>
      </nav>

      <div className="sidebar-foot">
        <strong>SnowAgent</strong>
        <span>Desktop MVP</span>
        <span>v0.1.0</span>
      </div>
    </aside>
  )
}

export default Sidebar
