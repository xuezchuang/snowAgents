import type { ReactNode } from 'react'
import CodeLink from './CodeLink'

const codeLinkPattern =
  /((?:[A-Za-z]:[\\/](?:[^<>:"|?*\r\n]+[\\/])*[^<>:"|?*\r\n]+\.(?:c|cc|cpp|cxx|h|hh|hpp|cs|ts|tsx|rs|ini|uplugin|uproject))|(?:(?:[\w()+@.-]+[\\/])+[\w()+@.-]+\.(?:c|cc|cpp|cxx|h|hh|hpp|cs|ts|tsx|rs|ini|uplugin|uproject))):\d+(?::\d+)?/gi

export function renderTextWithCodeLinks(
  text: string,
  projectId: string,
  taskId: string | null,
  onResult?: (message: string) => void,
  onError?: (message: string) => void,
  onTraceChanged?: () => void,
): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  codeLinkPattern.lastIndex = 0

  for (const match of text.matchAll(codeLinkPattern)) {
    const rawLink = match[0]
    const index = match.index ?? 0
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index))
    }
    nodes.push(
      <CodeLink
        key={`${rawLink}-${index}`}
        projectId={projectId}
        taskId={taskId}
        rawLink={rawLink}
        onResult={onResult}
        onError={onError}
        onTraceChanged={onTraceChanged}
      />,
    )
    lastIndex = index + rawLink.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes.length > 0 ? nodes : [text]
}
