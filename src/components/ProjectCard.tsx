import { Edit3, MonitorUp, PanelRightOpen, Trash2 } from 'lucide-react'
import type { ProjectSession } from '../types/project'
import { normalizeDisplayPath } from '../utils/path'
import { vsStatus, vsStatusClass } from '../utils/projectStatus'

interface ProjectCardProps {
  project: ProjectSession
  active: boolean
  busy: boolean
  onOpenVisualStudio: (project: ProjectSession) => void
  onOpenWorkspace: (projectId: string) => void
  onEdit: (project: ProjectSession) => void
  onDelete: (project: ProjectSession) => void
}

function ProjectCard({
  project,
  active,
  busy,
  onOpenVisualStudio,
  onOpenWorkspace,
  onEdit,
  onDelete,
}: ProjectCardProps) {
  return (
    <article className={active ? 'project-card active' : 'project-card'}>
      <div className="project-card-main">
        <div className="project-card-copy">
          <h3>{project.name}</h3>
          <p className="path-line">{normalizeDisplayPath(project.repoRoot)}</p>
          <p className="path-line">
            {project.solutionPath ? normalizeDisplayPath(project.solutionPath) : 'No solution mapped'}
          </p>
        </div>
        <span className={`vs-badge ${vsStatusClass(project)}`}>
          {vsStatus(project)}
        </span>
      </div>
      <div className="project-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => onOpenVisualStudio(project)}
          disabled={busy || !project.solutionPath}
          title={project.solutionPath ? 'Open Visual Studio' : 'Map a solutionPath first'}
        >
          <MonitorUp size={16} aria-hidden="true" />
          Open VS
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onOpenWorkspace(project.id)}
        >
          <PanelRightOpen size={16} aria-hidden="true" />
          Open Workspace
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => onEdit(project)}
          aria-label={`Edit ${project.name}`}
          title="Edit"
        >
          <Edit3 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button danger"
          onClick={() => onDelete(project)}
          aria-label={`Delete ${project.name}`}
          title="Delete"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

export default ProjectCard
