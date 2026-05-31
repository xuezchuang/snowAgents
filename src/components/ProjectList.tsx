import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  addProject,
  deleteProject,
  openVisualStudio,
  updateProject,
} from '../api/tauriApi'
import ProjectCard from './ProjectCard'
import ProjectForm from './ProjectForm'
import type { ProjectInput, ProjectSession } from '../types/project'

interface ProjectListProps {
  projects: ProjectSession[]
  activeProjectId: string | null
  onOpenWorkspace: (projectId: string) => void
  onRefresh: () => Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
}

function ProjectList({
  projects,
  activeProjectId,
  onOpenWorkspace,
  onRefresh,
  onError,
  onNotice,
}: ProjectListProps) {
  const [editingProject, setEditingProject] = useState<ProjectSession | null>(null)
  const [adding, setAdding] = useState(false)
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null)

  const saveProject = async (input: ProjectInput) => {
    try {
      if (editingProject) {
        await updateProject(editingProject.id, input)
        onNotice('Project updated')
      } else {
        await addProject(input)
        onNotice('Project added')
      }
      setEditingProject(null)
      setAdding(false)
      await onRefresh()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const removeProject = async (project: ProjectSession) => {
    if (!window.confirm(`Delete project "${project.name}"?`)) {
      return
    }
    try {
      await deleteProject(project.id)
      onNotice('Project deleted')
      await onRefresh()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const launchVs = async (project: ProjectSession) => {
    try {
      setBusyProjectId(project.id)
      const result = await openVisualStudio(project.id)
      onNotice(`Visual Studio started, PID ${result.processId}`)
      await onRefresh()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusyProjectId(null)
    }
  }

  const cancelEdit = () => {
    setEditingProject(null)
    setAdding(false)
  }

  return (
    <section className="projects-page">
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p>Manage project sessions and their Visual Studio bridge state.</p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setEditingProject(null)
            setAdding(true)
          }}
        >
          <Plus size={16} aria-hidden="true" />
          Add Project
        </button>
      </div>

      {adding || editingProject ? (
        <ProjectForm
          key={editingProject?.id ?? 'new-project'}
          project={editingProject}
          onSave={saveProject}
          onCancel={cancelEdit}
          onError={onError}
        />
      ) : null}

      <div className="project-list">
        {projects.length === 0 ? (
          <div className="empty-state">No projects registered.</div>
        ) : null}
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            active={project.id === activeProjectId}
            busy={busyProjectId === project.id}
            onOpenVisualStudio={launchVs}
            onOpenWorkspace={onOpenWorkspace}
            onEdit={(nextProject) => {
              setAdding(false)
              setEditingProject(nextProject)
            }}
            onDelete={removeProject}
          />
        ))}
      </div>
    </section>
  )
}

export default ProjectList
