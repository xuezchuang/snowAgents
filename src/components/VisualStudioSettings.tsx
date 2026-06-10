import { FolderOpen } from 'lucide-react'
import { browseExecutableFile } from '../api/tauriApi'
import { normalizeDisplayPath } from '../utils/path'

interface VisualStudioSettingsProps {
  devenvPath: string
  dataDir: string
  configPath: string
  onChange: (path: string) => void
  onError: (message: string) => void
}

function VisualStudioSettings({
  devenvPath,
  dataDir,
  configPath,
  onChange,
  onError,
}: VisualStudioSettingsProps) {
  const browse = async () => {
    try {
      const selected = await browseExecutableFile('Choose devenv.exe')
      if (selected) {
        onChange(normalizeDisplayPath(selected))
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <section className="settings-card">
      <div className="panel-header">
        <h3>General / Visual Studio</h3>
        <span className={devenvPath ? 'vs-badge connected' : 'vs-badge disconnected'}>
          {devenvPath ? 'Visual Studio detected' : 'Auto detect'}
        </span>
      </div>
      <label>
        devenv.exe path
        <div className="field-with-button">
          <input
            value={devenvPath}
            onChange={(event) => onChange(event.target.value)}
            placeholder="C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe"
          />
          <button type="button" className="secondary-button" onClick={browse}>
            <FolderOpen size={16} aria-hidden="true" />
            Browse
          </button>
        </div>
      </label>
      <label>
        data directory
        <input value={normalizeDisplayPath(dataDir)} readOnly />
      </label>
      <label>
        config file
        <input value={normalizeDisplayPath(configPath)} readOnly />
      </label>
    </section>
  )
}

export default VisualStudioSettings
