import type { ProviderConfig } from '../types/provider'

export interface SelectableModel {
  id: string
  providerId: string
  modelId: string
  label: string
}

export function getSelectableModels(providers: ProviderConfig[]): SelectableModel[] {
  const enabledProviders = providers.filter(
    (provider) => provider.enabled || provider.models.some((model) => model.enabled),
  )

  return enabledProviders.flatMap((provider) => {
    const enabledModels = (provider.models ?? []).filter((model) => model.enabled)
    if (enabledModels.length > 0) {
      return enabledModels.map((model) => ({
        id: `${provider.id}:${model.id}`,
        providerId: provider.id,
        modelId: model.id,
        label: `${provider.name} / ${model.name || model.id}`,
      }))
    }

    return [
      {
        id: `${provider.id}:${provider.defaultModel}`,
        providerId: provider.id,
        modelId: provider.defaultModel,
        label: `${provider.name} / ${provider.defaultModel}`,
      },
    ]
  })
}
