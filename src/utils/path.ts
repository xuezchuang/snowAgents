export function normalizeDisplayPath(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${path.slice('\\\\?\\UNC\\'.length)}`
  }

  if (path.startsWith('\\\\?\\')) {
    return path.slice('\\\\?\\'.length)
  }

  return path
}

export function normalizeDisplayText(text: string): string {
  return text
    .replace(/\\\\\?\\UNC\\/g, '\\\\')
    .replace(/\\\\\?\\/g, '')
}

export function normalizePathsInValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return normalizeDisplayText(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizePathsInValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        normalizePathsInValue(entry),
      ]),
    )
  }

  return value
}
