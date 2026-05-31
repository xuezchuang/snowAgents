import type { UiPreferences as UiPreferencesModel } from '../types/settings'

interface UiPreferencesProps {
  preferences: UiPreferencesModel
  onChange: (preferences: UiPreferencesModel) => void
}

function UiPreferences({ preferences, onChange }: UiPreferencesProps) {
  return (
    <section className="settings-card">
      <div className="panel-header">
        <h3>UI Preferences</h3>
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={preferences.showTraceButton}
          onChange={(event) =>
            onChange({ ...preferences, showTraceButton: event.target.checked })
          }
        />
        <span>Show trace button</span>
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={preferences.autoOpenTraceOnErrors}
          onChange={(event) =>
            onChange({
              ...preferences,
              autoOpenTraceOnErrors: event.target.checked,
            })
          }
        />
        <span>Auto-open trace on errors</span>
      </label>
      <label>
        Visual style
        <select
          value={preferences.visualStyle}
          onChange={(event) =>
            onChange({
              ...preferences,
              visualStyle:
                event.target.value === 'snowagent' ? 'snowagent' : 'codex',
            })
          }
        >
          <option value="codex">Codex compact dark</option>
          <option value="snowagent">SnowAgent classic</option>
        </select>
      </label>
      <label>
        Default workspace layout
        <select
          value={preferences.defaultWorkspaceLayout}
          onChange={(event) =>
            onChange({
              ...preferences,
              defaultWorkspaceLayout:
                event.target.value === 'split-chat-trace'
                  ? 'split-chat-trace'
                  : 'chat-only',
            })
          }
        >
          <option value="chat-only">Chat only</option>
          <option value="split-chat-trace">Split: Chat + Trace</option>
        </select>
      </label>
    </section>
  )
}

export default UiPreferences
