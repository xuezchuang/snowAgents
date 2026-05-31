import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  Edit3,
  MonitorUp,
  Play,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import {
  addProject,
  deleteProject,
  openVisualStudio,
  updateProject,
} from '../api/tauriApi'
import type { ProjectInput, ProjectSession } from '../types/project'
import { normalizeDisplayPath } from '../utils/path'

interface ProjectListProps {
  projects: ProjectSession[]
  selectedProjectId: string | null
  onOpenProject: (projectId: string) => void
  onRefresh: () => Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
}

interface ProjectFormState {
  name: string
  repoRoot: string
  solutionPath: string
  uprojectPath: string
  buildCommand: string
}

const blankForm: ProjectFormState = {
  name: '',
  repoRoot: '',
  solutionPath: '',
  uprojectPath: '',
  buildCommand: '',
}

function ProjectList({
  projects,
  selectedProjectId,
  onOpenProject,
  onRefresh,
  onError,
  onNotice,
}: ProjectListProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [form, setForm] = useState<ProjectFormState>(blankForm)
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null)

  const startAdd = () => {
    setForm(blankForm)
    setEditingProjectId(null)
    setIsEditing(true)
  }

  const startEdit = (project: ProjectSession) => {
    setForm({
      name: project.name,
      repoRoot: normalizeDisplayPath(project.repoRoot),
      solutionPath: normalizeDisplayPath(project.solutionPath),
      uprojectPath: project.uprojectPath
        ? normalizeDisplayPath(project.uprojectPath)
        : '',
      buildCommand: project.buildCommand ?? '',
    })
    setEditingProjectId(project.id)
    setIsEditing(true)
  }

  const cancelEdit = () => {
    setForm(blankForm)
    setEditingProjectId(null)
    setIsEditing(false)
  }

  const saveProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const input = toProjectInput(form)
      if (editingProjectId) {
        await updateProject(editingProjectId, input)
        onNotice('Project updated')
      } else {
        await addProject(input)
        onNotice('Project added')
      }
      cancelEdit()
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

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <h2>Projects</h2>
          <p>Bind each C++ or Unreal project to its own Visual Studio session.</p>
        </div>
        <button type="button" className="primary-button" onClick={startAdd}>
          <Plus size={16} aria-hidden="true" />
          Add Project
        </button>
      </div>

      {isEditing ? (
        <form className="edit-panel" onSubmit={saveProject}>
          <div className="form-grid">
            <label>
              Name
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="MMOARPG"
                required
              />
            </label>
            <label>
              repoRoot
              <input
                value={form.repoRoot}
                onChange={(event) =>
                  setForm({ ...form, repoRoot: event.target.value })
                }
                placeholder="D:\\Work\\Game"
                required
              />
            </label>
            <label>
              solutionPath
              <input
                value={form.solutionPath}
                onChange={(event) =>
                  setForm({ ...form, solutionPath: event.target.value })
                }
                placeholder="D:\\Work\\Game\\Game.sln"
                required
              />
            </label>
            <label>
              uprojectPath
              <input
                value={form.uprojectPath}
                onChange={(event) =>
                  setForm({ ...form, uprojectPath: event.target.value })
                }
                placeholder="D:\\Work\\Game\\Game.uproject"
              />
            </label>
            <label className="span-2">
              buildCommand
              <input
                value={form.buildCommand}
                onChange={(event) =>
                  setForm({ ...form, buildCommand: event.target.value })
                }
                placeholder="Optional local build command"
              />
            </label>
          </div>
          <div className="button-row">
            <button type="submit" className="primary-button">
              <Save size={16} aria-hidden="true" />
              Save
            </button>
            <button type="button" className="ghost-button" onClick={cancelEdit}>
              <X size={16} aria-hidden="true" />
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="project-list">
        {projects.length === 0 ? (
          <div className="empty-state">No projects registered.</div>
        ) : null}
        {projects.map((project) => (
          <article
            className={
              project.id === selectedProjectId ? 'project-card active' : 'project-card'
            }
            key={project.id}
          >
            <div className="project-card-main">
              <div>
                <h3>{project.name}</h3>
                <p className="path-line">{normalizeDisplayPath(project.repoRoot)}</p>
                <p className="path-line">
                  {normalizeDisplayPath(project.solutionPath)}
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
                onClick={() => launchVs(project)}
                disabled={busyProjectId === project.id}
              >
                <MonitorUp size={16} aria-hidden="true" />
                Open VS
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => onOpenProject(project.id)}
              >
                <Play size={16} aria-hidden="true" />
                Open Task
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => startEdit(project)}
                aria-label={`Edit ${project.name}`}
                title="Edit"
              >
                <Edit3 size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button danger"
                onClick={() => removeProject(project)}
                aria-label={`Delete ${project.name}`}
                title="Delete"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function toProjectInput(form: ProjectFormState): ProjectInput {
  return {
    name: form.name.trim(),
    repoRoot: form.repoRoot.trim(),
    solutionPath: form.solutionPath.trim(),
    uprojectPath: optionalValue(form.uprojectPath),
    buildCommand: optionalValue(form.buildCommand),
  }
}

function optionalValue(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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

export default ProjectList
