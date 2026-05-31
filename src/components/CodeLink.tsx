import { FileCode } from 'lucide-react'
import { openCodeLink } from '../api/tauriApi'
import { normalizeDisplayPath } from '../utils/path'

interface CodeLinkProps {
  projectId: string
  taskId: string | null
  rawLink: string
  onResult?: (message: string) => void
  onError?: (message: string) => void
  onTraceChanged?: () => void
}

function CodeLink({
  projectId,
  taskId,
  rawLink,
  onResult,
  onError,
  onTraceChanged,
}: CodeLinkProps) {
  const handleClick = async () => {
    try {
      await openCodeLink(projectId, rawLink, taskId)
      onResult?.('Opened in Visual Studio.')
    } catch (caught) {
      onError?.(caught instanceof Error ? caught.message : String(caught))
    } finally {
      onTraceChanged?.()
    }
  }

  return (
    <button
      type="button"
      className="code-link"
      onClick={handleClick}
      title={`Open ${normalizeDisplayPath(rawLink)} in Visual Studio`}
    >
      <FileCode size={14} aria-hidden="true" />
      {normalizeDisplayPath(rawLink)}
    </button>
  )
}

export default CodeLink
