import { useState } from 'react'
import type { FormEvent } from 'react'
import { Save } from 'lucide-react'
import { updateSettings } from '../api/tauriApi'
import type { AppSettings } from '../types/settings'
import { normalizeDisplayPath } from '../utils/path'

interface SettingsProps {
  settings: AppSettings | null
  onRefresh: () => Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
}

function Settings({ settings, onRefresh, onError, onNotice }: SettingsProps) {
  if (!settings) {
    return (
      <section className="page-section">
        <div className="empty-state">Loading settings...</div>
      </section>
    )
  }

  return (
    <SettingsForm
      key={`${normalizeDisplayPath(settings.devenvPath ?? 'auto')}-${
        settings.providerNotes
      }`}
      settings={settings}
      onRefresh={onRefresh}
      onError={onError}
      onNotice={onNotice}
    />
  )
}

interface SettingsFormProps {
  settings: AppSettings
  onRefresh: () => Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
}

function SettingsForm({
  settings,
  onRefresh,
  onError,
  onNotice,
}: SettingsFormProps) {
  const [devenvPath, setDevenvPath] = useState(
    normalizeDisplayPath(settings.devenvPath ?? ''),
  )
  const [providerNotes, setProviderNotes] = useState(settings.providerNotes)
  const [busy, setBusy] = useState(false)

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      setBusy(true)
      await updateSettings({
        devenvPath: devenvPath.trim().length > 0 ? devenvPath.trim() : null,
        providerNotes,
      })
      await onRefresh()
      onNotice('Settings saved')
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <h2>Settings</h2>
          <p>Configure local Visual Studio discovery and future provider notes.</p>
        </div>
      </div>

      <form className="settings-panel" onSubmit={save}>
        <label>
          devenv.exe path
          <input
            value={devenvPath}
            onChange={(event) => setDevenvPath(event.target.value)}
            placeholder="C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe"
          />
        </label>

        <label>
          data directory
          <input value={normalizeDisplayPath(settings.dataDir)} readOnly />
        </label>

        <label>
          provider configuration
          <textarea
            value={providerNotes}
            onChange={(event) => setProviderNotes(event.target.value)}
            rows={5}
          />
        </label>

        <div className="provider-placeholder">
          OpenAI-compatible API, DeepSeek, MiniMax, Claude, Ollama, and local
          gateway providers are intentionally UI-only placeholders in this MVP.
        </div>

        <button type="submit" className="primary-button" disabled={busy}>
          <Save size={16} aria-hidden="true" />
          Save Settings
        </button>
      </form>
    </section>
  )
}

export default Settings
