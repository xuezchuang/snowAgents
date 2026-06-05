import { useMemo, useState } from 'react'
import { CloudDownload, Plus, Save, TestTube2, Trash2 } from 'lucide-react'
import { fetchMiniMaxModels } from '../api/tauriApi'
import type { ProviderConfig, ProviderCredential, ProviderModel } from '../types/provider'
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
  const [selectedCredentialId, setSelectedCredentialId] = useState(
    selectedProvider?.defaultCredentialId || (selectedProvider?.credentials ?? [])[0]?.id || '',
  )
  const [apiKeyEditingCredentialId, setApiKeyEditingCredentialId] = useState<string | null>(null)
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
    setSelectedCredentialId(provider.defaultCredentialId || (provider.credentials ?? [])[0]?.id || '')
    setApiKeyEditingCredentialId(null)
    setTestResult(null)
  }

  const save = async () => {
    const normalizedModels = normalizeModels(draft.models ?? [])
    const duplicateName = duplicateModelName(normalizedModels)
    if (duplicateName) {
      setTestResult(`Model name "${duplicateName}" is already used. Add a prefix to make it unique.`)
      return
    }
    const normalizedCredentials = normalizeCredentials(draft.credentials ?? [], draft.apiKey)
    const enabledModel = normalizedModels.find((model) => model.enabled)
    const enabledCredential = normalizedCredentials.find((credential) => credential.enabled)
    await onSaveProvider({
      ...draft,
      apiKey: undefined,
      enabled: draft.enabled || Boolean(enabledModel) || Boolean(enabledCredential),
      baseUrl: isMiniMax(draft) ? minimaxOpenAiBaseUrl : draft.baseUrl,
      baseUrlLocked: isMiniMax(draft) ? true : draft.baseUrlLocked,
      credentials: normalizedCredentials,
      defaultCredentialId:
        enabledCredential?.id ?? normalizedCredentials[0]?.id ?? draft.defaultCredentialId,
      defaultModel: enabledModel?.id ?? draft.defaultModel,
      models: normalizedModels,
      temperature: Number.isFinite(draft.temperature) ? draft.temperature : 0.2,
    })
    setApiKeyEditingCredentialId(null)
  }

  const fetchModels = async () => {
    if (!isMiniMax(draft)) {
      return
    }
    const credential = activeCredential(draft, selectedCredentialId)
    if (!credential?.apiKey.trim()) {
      setTestResult('Select a MiniMax API key before fetching models')
      return
    }

    try {
      setModelFetchBusy(true)
      const fetchedModels = await fetchMiniMaxModels(credential.apiKey)
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
          <div className="model-checklist">
            <div className="model-checklist-header">
              <strong>API keys</strong>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  const nextCredential = createCredential(draft.credentials ?? [])
                  setDraft({
                    ...draft,
                    credentials: [...(draft.credentials ?? []), nextCredential],
                    defaultCredentialId: draft.defaultCredentialId || nextCredential.id,
                  })
                  setSelectedCredentialId(nextCredential.id)
                  setApiKeyEditingCredentialId(nextCredential.id)
                }}
              >
                <Plus size={16} aria-hidden="true" />
                Add Key
              </button>
            </div>
            {(draft.credentials ?? []).length === 0 ? (
              <div className="empty-state">Add a key, then choose it with a model in the composer.</div>
            ) : (
              <div className="model-list">
                {(draft.credentials ?? []).map((credential) => (
                  <div className="credential-editor" key={credential.id}>
                    <label className="toggle-row model-toggle">
                      <input
                        type="checkbox"
                        checked={credential.enabled}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            credentials: updateCredential(draft.credentials ?? [], credential.id, {
                              enabled: event.target.checked,
                            }),
                          })
                        }
                      />
                      <input
                        value={credential.name}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            credentials: updateCredential(draft.credentials ?? [], credential.id, {
                              name: event.target.value,
                            }),
                          })
                        }
                        placeholder="Key name"
                      />
                    </label>
                    <div className="field-with-button">
                      <input
                        type="password"
                        value={
                          apiKeyEditingCredentialId === credential.id
                            ? credential.apiKey
                            : maskApiKey(credential.apiKey)
                        }
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            credentials: updateCredential(draft.credentials ?? [], credential.id, {
                              apiKey: event.target.value,
                            }),
                          })
                        }
                        readOnly={apiKeyEditingCredentialId !== credential.id}
                        placeholder="Not set"
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setApiKeyEditingCredentialId(credential.id)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            credentials: (draft.credentials ?? []).filter(
                              (item) => item.id !== credential.id,
                            ),
                            defaultCredentialId:
                              draft.defaultCredentialId === credential.id
                                ? ''
                                : draft.defaultCredentialId,
                          })
                        }
                        aria-label={`Remove ${credential.name}`}
                        title={`Remove ${credential.name}`}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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

          <div className="model-checklist">
            <div className="model-checklist-header">
              <strong>Models</strong>
              <div className="button-row compact-button-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    const nextModel = createModel(draft.models ?? [], draft.defaultModel)
                    setDraft({
                      ...draft,
                      defaultModel: draft.defaultModel || nextModel.id,
                      models: [...(draft.models ?? []), nextModel],
                    })
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  Add Model
                </button>
                {isMiniMax(draft) ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void fetchModels()}
                    disabled={
                      modelFetchBusy ||
                      !activeCredential(draft, selectedCredentialId)?.apiKey.trim()
                    }
                  >
                    <CloudDownload size={16} aria-hidden="true" />
                    {modelFetchBusy ? 'Fetching' : 'Fetch Models'}
                  </button>
                ) : null}
              </div>
            </div>
            {(draft.models ?? []).length === 0 ? (
              <div className="empty-state">Add or fetch models, then choose which ones to use.</div>
            ) : (
              <div className="model-list">
                {(draft.models ?? []).map((model) => (
                  <div className="model-toggle" key={model.id}>
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
                    <input
                      value={model.name || model.id}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          models: updateModelName(draft.models ?? [], model.id, event.target.value),
                        })
                      }
                      aria-label={`${model.id} display name`}
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          models: (draft.models ?? []).filter((item) => item.id !== model.id),
                          defaultModel:
                            draft.defaultModel === model.id
                              ? (draft.models ?? []).find((item) => item.id !== model.id)?.id ?? ''
                              : draft.defaultModel,
                        })
                      }
                      aria-label={`Remove ${model.name || model.id}`}
                      title={`Remove ${model.name || model.id}`}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                    <small>{model.id}</small>
                  </div>
                ))}
              </div>
            )}
          </div>

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

function maskApiKey(apiKey: string | undefined): string {
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
    name: (model.name ?? '').trim() || model.id,
    enabled: Boolean(model.enabled),
  }))
}

function duplicateModelName(models: ProviderModel[]): string | null {
  const seen = new Set<string>()
  for (const model of models) {
    const normalizedName = (model.name || model.id).trim().toLowerCase()
    if (seen.has(normalizedName)) {
      return model.name || model.id
    }
    seen.add(normalizedName)
  }
  return null
}

function normalizeCredentials(
  credentials: ProviderCredential[],
  legacyApiKey?: string,
): ProviderCredential[] {
  const source =
    credentials.length > 0
      ? credentials
      : legacyApiKey?.trim()
        ? [
            {
              id: 'default',
              name: 'Default Key',
              enabled: true,
              apiKey: legacyApiKey,
            },
          ]
        : []

  return source
    .map((credential, index) => ({
      ...credential,
      id: (credential.id ?? '').trim() || `key-${index + 1}`,
      name: (credential.name ?? '').trim() || `Key ${index + 1}`,
      enabled: Boolean(credential.enabled),
      apiKey: (credential.apiKey ?? '').trim(),
    }))
    .filter((credential) => credential.id.length > 0)
}

function activeCredential(
  provider: ProviderConfig,
  credentialId: string,
): ProviderCredential | null {
  return (
    (provider.credentials ?? []).find((credential) => credential.id === credentialId) ??
    (provider.credentials ?? []).find((credential) => credential.enabled) ??
    (provider.credentials ?? [])[0] ??
    null
  )
}

function createCredential(credentials: ProviderCredential[]): ProviderCredential {
  const nextIndex = credentials.length + 1
  return {
    id: `key-${Date.now()}`,
    name: `Key ${nextIndex}`,
    enabled: false,
    apiKey: '',
  }
}

function createModel(models: ProviderModel[], defaultModel: string): ProviderModel {
  const usedIds = new Set(models.map((model) => model.id))
  const preferredId = defaultModel.trim()
  let modelId =
    preferredId.length > 0 && !usedIds.has(preferredId)
      ? preferredId
      : `custom-model-${models.length + 1}`
  let nextIndex = models.length + 2
  while (usedIds.has(modelId)) {
    modelId = `custom-model-${nextIndex}`
    nextIndex += 1
  }
  return {
    id: modelId,
    name: modelId,
    enabled: false,
  }
}

function updateCredential(
  credentials: ProviderCredential[],
  credentialId: string,
  patch: Partial<ProviderCredential>,
): ProviderCredential[] {
  return credentials.map((credential) =>
    credential.id === credentialId ? { ...credential, ...patch } : credential,
  )
}

function updateModelName(
  models: ProviderModel[],
  modelId: string,
  name: string,
): ProviderModel[] {
  return models.map((model) => (model.id === modelId ? { ...model, name } : model))
}

export default ProviderSettings
