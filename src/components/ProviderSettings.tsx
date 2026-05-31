import { useMemo, useState } from 'react'
import { CloudDownload, Save, TestTube2 } from 'lucide-react'
import { fetchMiniMaxModels } from '../api/tauriApi'
import type { ProviderConfig, ProviderModel } from '../types/provider'
import { minimaxOpenAiBaseUrl, providerTypeLabels } from '../types/provider'

interface ProviderSettingsProps {
  providers: ProviderConfig[]
  onSaveProvider: (provider: ProviderConfig) => Promise<void>
}

function ProviderSettings({ providers, onSaveProvider }: ProviderSettingsProps) {
  const [selectedProviderId, setSelectedProviderId] = useState(
    providers[0]?.id ?? '',
  )
  const selectedProvider = useMemo(
    () =>
      providers.find((provider) => provider.id === selectedProviderId) ??
      providers[0],
    [providers, selectedProviderId],
  )
  const [draft, setDraft] = useState<ProviderConfig | null>(
    selectedProvider ?? null,
  )
  const [apiKeyEditing, setApiKeyEditing] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [modelFetchBusy, setModelFetchBusy] = useState(false)

  if (!selectedProvider || !draft) {
    return (
      <section className="settings-card providers-card">
        <div className="empty-state">No providers configured.</div>
      </section>
    )
  }

  const selectProvider = (provider: ProviderConfig) => {
    setSelectedProviderId(provider.id)
    setDraft(provider)
    setApiKeyEditing(false)
    setTestResult(null)
  }

  const save = async () => {
    const normalizedModels = normalizeModels(draft.models ?? [])
    const enabledModel = normalizedModels.find((model) => model.enabled)
    await onSaveProvider({
      ...draft,
      baseUrl: isMiniMax(draft) ? minimaxOpenAiBaseUrl : draft.baseUrl,
      baseUrlLocked: isMiniMax(draft) ? true : draft.baseUrlLocked,
      defaultModel: enabledModel?.id ?? draft.defaultModel,
      models: normalizedModels,
      temperature: Number.isFinite(draft.temperature) ? draft.temperature : 0.2,
    })
    setApiKeyEditing(false)
  }

  const fetchModels = async () => {
    if (!isMiniMax(draft)) {
      return
    }

    try {
      setModelFetchBusy(true)
      const fetchedModels = await fetchMiniMaxModels(draft.apiKey)
      const existingEnabled = new Set(
        (draft.models ?? [])
          .filter((model) => model.enabled)
          .map((model) => model.id),
      )
      const models = fetchedModels.map((model) => ({
        ...model,
        enabled:
          existingEnabled.size > 0
            ? existingEnabled.has(model.id)
            : model.id === 'MiniMax-M2.7',
      }))
      setDraft({
        ...draft,
        baseUrl: minimaxOpenAiBaseUrl,
        baseUrlLocked: true,
        models,
        defaultModel:
          models.find((model) => model.enabled)?.id ?? models[0]?.id ?? draft.defaultModel,
      })
      setTestResult(`Fetched ${models.length} MiniMax models`)
    } catch (caught) {
      setTestResult(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setModelFetchBusy(false)
    }
  }

  return (
    <section className="settings-card providers-card">
      <div className="panel-header">
        <h3>Providers</h3>
      </div>
      <div className="providers-layout">
        <div className="provider-list" role="list">
          {providers.map((provider) => (
            <button
              type="button"
              className={
                provider.id === selectedProvider.id
                  ? 'provider-list-item active'
                  : 'provider-list-item'
              }
              key={provider.id}
              onClick={() => selectProvider(provider)}
            >
              <span>{provider.name}</span>
              <small>{provider.enabled ? 'Enabled' : 'Disabled'}</small>
            </button>
          ))}
        </div>

        <div className="provider-editor">
          <label>
            Provider Name
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            Type
            <input value={providerTypeLabels[draft.type]} readOnly />
          </label>
          <label>
            Base URL
            <input
              value={isMiniMax(draft) ? minimaxOpenAiBaseUrl : draft.baseUrl}
              onChange={(event) =>
                setDraft({ ...draft, baseUrl: event.target.value })
              }
              readOnly={isMiniMax(draft) || draft.baseUrlLocked}
              placeholder="https://api.example.com/v1"
            />
          </label>
          <label>
            API Key
            <div className="field-with-button">
              <input
                type="password"
                value={apiKeyEditing ? draft.apiKey : maskApiKey(draft.apiKey)}
                onChange={(event) =>
                  setDraft({ ...draft, apiKey: event.target.value })
                }
                readOnly={!apiKeyEditing}
                placeholder="Not set"
              />
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setApiKeyEditing(true)
                  setDraft({ ...draft, apiKey: '' })
                }}
              >
                Edit
              </button>
            </div>
          </label>
          <label>
            Default Model
            {enabledModels(draft).length > 0 ? (
              <select
                value={draft.defaultModel}
                onChange={(event) =>
                  setDraft({ ...draft, defaultModel: event.target.value })
                }
              >
                {enabledModels(draft).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name || model.id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.defaultModel}
                onChange={(event) =>
                  setDraft({ ...draft, defaultModel: event.target.value })
                }
              />
            )}
          </label>
          <label>
            Temperature
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={draft.temperature}
              onChange={(event) =>
                setDraft({ ...draft, temperature: Number(event.target.value) })
              }
            />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft({ ...draft, enabled: event.target.checked })
              }
            />
            <span>Enable Provider</span>
          </label>

          {isMiniMax(draft) ? (
            <div className="model-checklist">
              <div className="model-checklist-header">
                <strong>MiniMax models</strong>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void fetchModels()}
                  disabled={modelFetchBusy || draft.apiKey.trim().length === 0}
                >
                  <CloudDownload size={16} aria-hidden="true" />
                  {modelFetchBusy ? 'Fetching' : 'Fetch Models'}
                </button>
              </div>
              {(draft.models ?? []).length === 0 ? (
                <div className="empty-state">Fetch official models, then choose which ones to use.</div>
              ) : (
                <div className="model-list">
                  {(draft.models ?? []).map((model) => (
                    <label className="toggle-row model-toggle" key={model.id}>
                      <input
                        type="checkbox"
                        checked={model.enabled}
                        onChange={(event) => {
                          const nextModels = (draft.models ?? []).map((item) =>
                            item.id === model.id
                              ? { ...item, enabled: event.target.checked }
                              : item,
                          )
                          const nextEnabled = nextModels.find((item) => item.enabled)
                          setDraft({
                            ...draft,
                            models: nextModels,
                            defaultModel:
                              nextEnabled?.id ?? nextModels[0]?.id ?? draft.defaultModel,
                          })
                        }}
                      />
                      <span>{model.name || model.id}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {testResult ? <div className="provider-test-result">{testResult}</div> : null}

          <div className="button-row">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (isMiniMax(draft)) {
                  void fetchModels()
                  return
                }
                setTestResult(
                  draft.baseUrl.trim().length > 0
                    ? 'Connection test succeeded'
                    : 'Connection test failed',
                )
              }}
            >
              <TestTube2 size={16} aria-hidden="true" />
              Test Connection
            </button>
            <button type="button" className="primary-button" onClick={save}>
              <Save size={16} aria-hidden="true" />
              Save Provider
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return ''
  }
  return '********'
}

function isMiniMax(provider: ProviderConfig): boolean {
  return provider.id === 'minimax' || provider.type === 'minimax'
}

function enabledModels(provider: ProviderConfig): ProviderModel[] {
  return (provider.models ?? []).filter((model) => model.enabled)
}

function normalizeModels(models: ProviderModel[]): ProviderModel[] {
  return models.map((model) => ({
    ...model,
    name: model.name || model.id,
    enabled: Boolean(model.enabled),
  }))
}

export default ProviderSettings
