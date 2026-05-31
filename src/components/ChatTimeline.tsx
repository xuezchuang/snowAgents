import ChatMessage from './ChatMessage'
import type { AgentTask } from '../types/task'

interface ChatTimelineProps {
  task: AgentTask | null
  projectId: string
  onCodeLinkResult: (message: string) => void
  onCodeLinkError: (message: string) => void
  onTraceChanged: () => void
  onSuggestionSelect: (prompt: string) => void
}

function ChatTimeline({
  task,
  projectId,
  onCodeLinkResult,
  onCodeLinkError,
  onTraceChanged,
  onSuggestionSelect,
}: ChatTimelineProps) {
  if (!task) {
    return (
      <div className="chat-empty">
        <div className="chat-empty-content">
          <h3>What do you want SnowAgent to change?</h3>
          <p>
            Ask it to inspect code, explain files, open links in Visual Studio,
            or prepare edits.
          </p>
          <div className="suggestion-chips" aria-label="Suggested prompts">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="suggestion-chip"
                onClick={() => onSuggestionSelect(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-timeline">
      {task.messages.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
          projectId={projectId}
          onCodeLinkResult={onCodeLinkResult}
          onCodeLinkError={onCodeLinkError}
          onTraceChanged={onTraceChanged}
        />
      ))}
    </div>
  )
}

const suggestions = [
  'Inspect current project',
  'Explain selected file',
  'Find likely compile issues',
]

export default ChatTimeline
