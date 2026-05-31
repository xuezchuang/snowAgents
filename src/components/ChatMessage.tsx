import { Bot, UserRound } from 'lucide-react'
import CodeLink from './CodeLink'
import { renderTextWithCodeLinks } from './codeLinkText'
import type { ChatMessage as ChatMessageModel } from '../types/task'

interface ChatMessageProps {
  message: ChatMessageModel
  projectId: string
  onCodeLinkResult: (message: string) => void
  onCodeLinkError: (message: string) => void
  onTraceChanged: () => void
}

function ChatMessage({
  message,
  projectId,
  onCodeLinkResult,
  onCodeLinkError,
  onTraceChanged,
}: ChatMessageProps) {
  const isUser = message.role === 'user'

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
            message.content,
            projectId,
            message.taskId,
            onCodeLinkResult,
            onCodeLinkError,
            onTraceChanged,
          )}
        </div>
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
                  onTraceChanged={onTraceChanged}
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
