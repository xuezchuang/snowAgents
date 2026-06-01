import {
  Bot,
  Copy,
  ExternalLink,
  PanelRightOpen,
  ThumbsDown,
  ThumbsUp,
  UserRound,
} from 'lucide-react'
import CodeLink from './CodeLink'
import { renderTextWithCodeLinks } from './codeLinkText'
import { sanitizeModelMessage } from './traceViewModel'
import type { ChatMessage as ChatMessageModel } from '../types/task'

interface ChatMessageProps {
  message: ChatMessageModel
  projectId: string
  onCodeLinkResult: (message: string) => void
  onCodeLinkError: (message: string) => void
  onTraceChanged: (taskId: string) => void
  onOpenTrace: (message: ChatMessageModel) => void
}

function ChatMessage({
  message,
  projectId,
  onCodeLinkResult,
  onCodeLinkError,
  onTraceChanged,
  onOpenTrace,
}: ChatMessageProps) {
  const isUser = message.role === 'user'
  const displayContent = isUser ? message.content : sanitizeModelMessage(message.content)

  return (
    <article className={isUser ? 'chat-message user' : 'chat-message assistant'}>
      <div className="message-avatar">
        {isUser ? (
          <UserRound size={16} aria-hidden="true" />
        ) : (
          <Bot size={16} aria-hidden="true" />
        )}
      </div>
      <div className="message-body">
        <div className="message-meta">
          <span>{isUser ? 'You' : 'SnowAgent'}</span>
          <time>{formatTime(message.createdAt)}</time>
        </div>
        <div className="message-content">
          {renderTextWithCodeLinks(
            displayContent,
            projectId,
            message.taskId,
            onCodeLinkResult,
            onCodeLinkError,
            () => onTraceChanged(message.taskId),
          )}
        </div>
        {!isUser ? (
          <div className="message-actions" aria-label="Message actions">
            <button
              type="button"
              className="message-action-button"
              aria-label="Copy response"
              title="Copy response"
              onClick={() => {
                void navigator.clipboard.writeText(displayContent)
              }}
            >
              <Copy size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="message-action-button"
              aria-label="Good response"
              title="Good response"
            >
              <ThumbsUp size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="message-action-button"
              aria-label="Bad response"
              title="Bad response"
            >
              <ThumbsDown size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="message-action-button trace-message-button"
              aria-label="Show response trace"
              title="Show response trace"
              onClick={() => onOpenTrace(message)}
            >
              <PanelRightOpen size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="message-action-button"
              aria-label="Open response"
              title="Open response"
            >
              <ExternalLink size={15} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {message.codeLinks && message.codeLinks.length > 0 ? (
          <div className="suggested-edit-card">
            <div>
              <strong>Suggested edit</strong>
              <span>Review the referenced file in Visual Studio.</span>
            </div>
            <div className="code-link-row">
              {message.codeLinks.map((link) => (
                <CodeLink
                  key={link.rawLink}
                  projectId={projectId}
                  taskId={message.taskId}
                  rawLink={link.rawLink}
                  onResult={onCodeLinkResult}
                  onError={onCodeLinkError}
                  onTraceChanged={() => onTraceChanged(message.taskId)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default ChatMessage
