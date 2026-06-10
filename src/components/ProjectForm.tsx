import { useState } from 'react'
import type { FormEvent } from 'react'
import { FolderOpen, Save, X } from 'lucide-react'
import { browseDirectory, browseSolutionFile } from '../api/tauriApi'
import type { ProjectInput, ProjectSession } from '../types/project'
import { normalizeDisplayPath } from '../utils/path'

export interface ProjectFormState {
  name: string
  repoRoot: string
  solutionPath: string
}

interface ProjectFormProps {
  project: ProjectSession | null
  onSave: (input: ProjectInput) => Promise<void>
  onCancel: () => void
  onError: (message: string) => void
}

const blankProjectForm: ProjectFormState = {
  name: '',
  repoRoot: '',
  solutionPath: '',
}

function ProjectForm({ project, onSave, onCancel, onError }: ProjectFormProps) {
  const [form, setForm] = useState<ProjectFormState>(
    project
      ? {
          name: project.name,
          repoRoot: normalizeDisplayPath(project.repoRoot),
          solutionPath: project.solutionPath ? normalizeDisplayPath(project.solutionPath) : '',
        }
      : blankProjectForm,
  )
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      setBusy(true)
      await onSave({
        name: form.name.trim(),
        repoRoot: form.repoRoot.trim(),
        solutionPath: form.solutionPath.trim() || null,
        uprojectPath: null,
        buildCommand: null,
      })
    } finally {
      setBusy(false)
    }
  }

  const pickRepoRoot = async () => {
    try {
      const selected = await browseDirectory('Choose repoRoot')
      if (selected) {
        setForm((current) => ({ ...current, repoRoot: normalizeDisplayPath(selected) }))
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const pickSolution = async () => {
    try {
      const selected = await browseSolutionFile('Choose solutionPath')
      if (selected) {
        setForm((current) => ({
          ...current,
          solutionPath: normalizeDisplayPath(selected),
        }))
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <form className="edit-panel" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Name
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="RPGMetanoia"
            required
          />
        </label>
        <label>
          repoRoot
          <div className="field-with-button">
            <input
              value={form.repoRoot}
              onChange={(event) =>
                setForm({ ...form, repoRoot: event.target.value })
              }
              placeholder="D:\\Work\\Game"
              required
            />
            <button type="button" className="secondary-button" onClick={pickRepoRoot}>
              <FolderOpen size={16} aria-hidden="true" />
              Browse
            </button>
          </div>
        </label>
        <label className="span-2">
          solutionPath (optional)
          <div className="field-with-button">
            <input
              value={form.solutionPath}
              onChange={(event) =>
                setForm({ ...form, solutionPath: event.target.value })
              }
              placeholder="D:\\Work\\Game\\Game.sln"
            />
            <button type="button" className="secondary-button" onClick={pickSolution}>
              <FolderOpen size={16} aria-hidden="true" />
              Browse
            </button>
          </div>
        </label>
      </div>
      <div className="button-row">
        <button type="submit" className="primary-button" disabled={busy}>
          <Save size={16} aria-hidden="true" />
          Save
        </button>
        <button type="button" className="ghost-button" onClick={onCancel}>
          <X size={16} aria-hidden="true" />
          Cancel
        </button>
      </div>
    </form>
  )
}

export default ProjectForm
