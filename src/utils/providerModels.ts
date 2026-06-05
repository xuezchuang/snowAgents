import type { ProviderConfig } from '../types/provider'

export interface SelectableModel {
  id: string
  providerId: string
  credentialId: string | null
  credentialName: string | null
  modelId: string
  modelName: string
  label: string
}

export function getSelectableModels(providers: ProviderConfig[]): SelectableModel[] {
  const enabledProviders = providers.filter(
    (provider) =>
      provider.enabled ||
      provider.models.some((model) => model.enabled) ||
      (provider.credentials ?? []).some((credential) => credential.enabled),
  )

  return enabledProviders.flatMap((provider) => {
    const enabledCredentials = providerUsesCredentials(provider)
      ? (provider.credentials ?? []).filter((credential) => credential.enabled)
      : [{ id: null, name: null }]
    const enabledModels = (provider.models ?? []).filter((model) => model.enabled)
    const modelChoices =
      enabledModels.length > 0
        ? enabledModels.map((model) => ({
            id: model.id,
            name: model.name || model.id,
          }))
        : provider.defaultModel.trim().length > 0
          ? [{ id: provider.defaultModel, name: provider.defaultModel }]
          : []

    return enabledCredentials.flatMap((credential) =>
      modelChoices.map((model) => ({
        id: `${provider.id}:${credential.id ?? 'default'}:${model.id}`,
        providerId: provider.id,
        credentialId: credential.id,
        credentialName: credential.name,
        modelId: model.id,
        modelName: model.name,
        label: credential.name
          ? `${provider.name} / ${credential.name} / ${model.name}`
          : `${provider.name} / ${model.name}`,
      })),
    )
  })
}

function providerUsesCredentials(provider: ProviderConfig): boolean {
  return provider.type !== 'ollama'
}
