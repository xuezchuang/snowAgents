import { useMemo, useState, type ReactNode } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  ExternalLink,
  ListTree,
  PanelRightOpen,
  Search,
  ThumbsDown,
  ThumbsUp,
  UserRound,
} from 'lucide-react'
import CodeLink from './CodeLink'
import { containsCodeLink, renderTextWithCodeLinks } from './codeLinkText'
import { sanitizeModelMessage } from './traceViewModel'
import type { ChatMessage as ChatMessageModel } from '../types/task'
import type { ToolTraceEvent } from '../types/trace'

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
  const thinkingSummary = useMemo(
    () => createThinkingSummary(message.traceEvents ?? []),
    [message.traceEvents],
  )

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
        {!isUser && thinkingSummary ? (
          <ThinkingPanel summary={thinkingSummary} />
        ) : null}
        <div className="message-content">
          <MarkdownMessage
            text={displayContent}
            projectId={projectId}
            taskId={message.taskId}
            onCodeLinkResult={onCodeLinkResult}
            onCodeLinkError={onCodeLinkError}
            onTraceChanged={() => onTraceChanged(message.taskId)}
          />
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

interface MarkdownMessageProps {
  text: string
  projectId: string
  taskId: string | null
  onCodeLinkResult: (message: string) => void
  onCodeLinkError: (message: string) => void
  onTraceChanged: () => void
}

interface MarkdownCodeBlockProps {
  code: string
  language: string
}

function MarkdownMessage({
  text,
  projectId,
  taskId,
  onCodeLinkResult,
  onCodeLinkError,
  onTraceChanged,
}: MarkdownMessageProps) {
  const blocks = renderMarkdownBlocks(
    text,
    projectId,
    taskId,
    onCodeLinkResult,
    onCodeLinkError,
    onTraceChanged,
  )

  return <>{blocks}</>
}

function renderMarkdownBlocks(
  text: string,
  projectId: string,
  taskId: string | null,
  onCodeLinkResult: (message: string) => void,
  onCodeLinkError: (message: string) => void,
  onTraceChanged: () => void,
): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let orderedItems: string[] = []
  let codeLines: string[] | null = null
  let codeLanguage = ''

  const renderInline = (value: string, keyPrefix: string) =>
    renderInlineMarkdown(
      value,
      keyPrefix,
      projectId,
      taskId,
      onCodeLinkResult,
      onCodeLinkError,
      onTraceChanged,
    )

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return
    }
    const content = paragraph.join(' ')
    blocks.push(
      <p key={`p-${blocks.length}`} className="markdown-paragraph">
        {renderInline(content, `p-${blocks.length}`)}
      </p>,
    )
    paragraph = []
  }

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="markdown-list">
          {listItems.map((item, index) => (
            <li key={`${index}-${item}`}>{renderInline(item, `ul-${blocks.length}-${index}`)}</li>
          ))}
        </ul>,
      )
      listItems = []
    }
    if (orderedItems.length > 0) {
      blocks.push(
        <ol key={`ol-${blocks.length}`} className="markdown-list">
          {orderedItems.map((item, index) => (
            <li key={`${index}-${item}`}>{renderInline(item, `ol-${blocks.length}-${index}`)}</li>
          ))}
        </ol>,
      )
      orderedItems = []
    }
  }

  const flushTextBlocks = () => {
    flushParagraph()
    flushList()
  }

  for (const [lineIndex, line] of lines.entries()) {
    const fenceMatch = line.match(/^```([\w#+.-]*)\s*$/)
    if (fenceMatch) {
      if (codeLines) {
        blocks.push(
          <MarkdownCodeBlock
            key={`code-${blocks.length}`}
            code={codeLines.join('\n')}
            language={codeLanguage}
          />,
        )
        codeLines = null
        codeLanguage = ''
      } else {
        flushTextBlocks()
        codeLines = []
        codeLanguage = fenceMatch[1] ?? ''
      }
      continue
    }

    if (codeLines !== null) {
      codeLines.push(line)
      continue
    }

    if (line.trim().length === 0) {
      flushTextBlocks()
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushTextBlocks()
      const level = headingMatch[1].length
      blocks.push(
        renderHeading(level, lineIndex, renderInline(headingMatch[2], `h-${lineIndex}`)),
      )
      continue
    }

    const unorderedMatch = line.match(/^\s*[-*]\s+(.+)$/)
    if (unorderedMatch) {
      flushParagraph()
      orderedItems = []
      listItems.push(unorderedMatch[1])
      continue
    }

    const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (orderedMatch) {
      flushParagraph()
      listItems = []
      orderedItems.push(orderedMatch[1])
      continue
    }

    paragraph.push(line.trim())
  }

  if (codeLines !== null) {
    blocks.push(
      <MarkdownCodeBlock
        key={`code-${blocks.length}`}
        code={codeLines.join('\n')}
        language={codeLanguage}
      />,
    )
  }
  flushTextBlocks()

  return blocks.length > 0 ? blocks : [text]
}

function MarkdownCodeBlock({ code, language }: MarkdownCodeBlockProps) {
  const [open, setOpen] = useState(false)
  const lineCount = code.length === 0 ? 0 : code.split('\n').length
  const label = language ? language.toUpperCase() : 'CODE'

  return (
    <section className={open ? 'markdown-code-section open' : 'markdown-code-section'}>
      <button
        type="button"
        className="markdown-code-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <span>{label}</span>
        <small>{lineCount} lines</small>
      </button>
      {open ? (
        <pre className="markdown-code-block">
          <code>{code}</code>
        </pre>
      ) : null}
    </section>
  )
}

function renderHeading(level: number, lineIndex: number, children: ReactNode[]): ReactNode {
  if (level <= 1) {
    return (
      <h3 key={`h-${lineIndex}`} className="markdown-heading">
        {children}
      </h3>
    )
  }
  return (
    <h4 key={`h-${lineIndex}`} className="markdown-heading">
      {children}
    </h4>
  )
}

function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  projectId: string,
  taskId: string | null,
  onCodeLinkResult: (message: string) => void,
  onCodeLinkError: (message: string) => void,
  onTraceChanged: () => void,
): ReactNode[] {
  const segments = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter((segment) => segment.length > 0)
  const nodes: ReactNode[] = []

  segments.forEach((segment, index) => {
    if (segment.startsWith('`') && segment.endsWith('`')) {
      const codeText = segment.slice(1, -1)
      if (containsCodeLink(codeText)) {
        nodes.push(
          ...renderTextWithCodeLinks(
            codeText,
            projectId,
            taskId,
            onCodeLinkResult,
            onCodeLinkError,
            onTraceChanged,
          ).map((node, nodeIndex) => (
            <span key={`${keyPrefix}-code-link-${index}-${nodeIndex}`}>{node}</span>
          )),
        )
        return
      }
      nodes.push(
        <code key={`${keyPrefix}-code-${index}`} className="markdown-inline-code">
          {codeText}
        </code>,
      )
      return
    }

    if (segment.startsWith('**') && segment.endsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${index}`}>
          {renderTextWithCodeLinks(
            segment.slice(2, -2),
            projectId,
            taskId,
            onCodeLinkResult,
            onCodeLinkError,
            onTraceChanged,
          )}
        </strong>,
      )
      return
    }

    nodes.push(
      ...renderTextWithCodeLinks(
        segment,
        projectId,
        taskId,
        onCodeLinkResult,
        onCodeLinkError,
        onTraceChanged,
      ).map((node, nodeIndex) => (
        <span key={`${keyPrefix}-${index}-${nodeIndex}`}>{node}</span>
      )),
    )
  })

  return nodes
}

interface ThinkingSummary {
  toolCalls: number
  messages: number
  workedFor: string
  items: ThinkingItem[]
}

interface ThinkingItem {
  id: string
  kind: 'search' | 'read' | 'list' | 'tool'
  text: string
  detail?: string
}

function ThinkingPanel({ summary }: { summary: ThinkingSummary }) {
  const [open, setOpen] = useState(false)

  return (
    <section className={open ? 'message-thinking open' : 'message-thinking'}>
      <button
        type="button"
        className="thinking-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <span>
          {summary.workedFor ? `Worked for ${summary.workedFor}` : 'Thinking'}
        </span>
      </button>
      {open ? (
        <div className="thinking-details">
          <div className="thinking-label">
            Thinking
            <span>
              {summary.toolCalls} tool calls, {summary.messages} messages
            </span>
          </div>
          <div className="thinking-list">
            {summary.items.map((item) => (
              <div key={item.id} className="thinking-item">
                <ThinkingIcon kind={item.kind} />
                <span>{item.text}</span>
                {item.detail ? <code>{item.detail}</code> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ThinkingIcon({ kind }: { kind: ThinkingItem['kind'] }) {
  if (kind === 'search') {
    return <Search size={13} aria-hidden="true" />
  }
  if (kind === 'read') {
    return <Eye size={13} aria-hidden="true" />
  }
  if (kind === 'list') {
    return <ListTree size={13} aria-hidden="true" />
  }
  return <Bot size={13} aria-hidden="true" />
}

function createThinkingSummary(events: ToolTraceEvent[]): ThinkingSummary | null {
  if (events.length === 0) {
    return null
  }

  const items = events
    .filter((event) => event.type === 'tool_result' || event.type === 'error')
    .filter((event) => event.toolName && event.toolName !== 'chat_completion')
    .map(createThinkingItem)
    .filter((item): item is ThinkingItem => item !== null)

  if (items.length === 0) {
    return null
  }

  return {
    toolCalls: items.length,
    messages: inferMessageCount(events),
    workedFor: formatWorkedFor(events),
    items: items.slice(0, 30),
  }
}

function createThinkingItem(event: ToolTraceEvent): ThinkingItem | null {
  const input = asRecord(event.input)
  const argumentsValue = asRecord(input.arguments)
  const toolName = event.toolName ?? stringValue(input.toolName)
  if (!toolName) {
    return null
  }

  if (toolName === 'search_content') {
    return {
      id: event.id,
      kind: 'search',
      text: event.status === 'failed' ? 'Search failed' : 'Searched content',
      detail: compactToolDetail([
        stringValue(argumentsValue.query),
        stringValue(argumentsValue.root),
        stringValue(argumentsValue.file_glob),
      ]),
    }
  }

  if (toolName === 'search_file') {
    return {
      id: event.id,
      kind: 'search',
      text: event.status === 'failed' ? 'File search failed' : 'Searched files',
      detail: compactToolDetail([
        stringValue(argumentsValue.pattern),
        stringValue(argumentsValue.root),
      ]),
    }
  }

  if (toolName === 'list_dir') {
    return {
      id: event.id,
      kind: 'list',
      text: event.status === 'failed' ? 'List directory failed' : 'Listed directory',
      detail: stringValue(argumentsValue.path),
    }
  }

  if (toolName === 'read_file') {
    return {
      id: event.id,
      kind: 'read',
      text: event.status === 'failed' ? 'Read failed' : 'Read file',
      detail: lineRangeDetail(
        stringValue(argumentsValue.path),
        argumentsValue.start_line,
        argumentsValue.end_line,
      ),
    }
  }

  if (toolName === 'get_file_context') {
    return {
      id: event.id,
      kind: 'read',
      text: event.status === 'failed' ? 'Context read failed' : 'Read context',
      detail: lineRangeDetail(
        stringValue(argumentsValue.path),
        argumentsValue.line,
        undefined,
      ),
    }
  }

  return {
    id: event.id,
    kind: 'tool',
    text: event.status === 'failed' ? 'Tool failed' : 'Called tool',
    detail: toolName,
  }
}

function inferMessageCount(events: ToolTraceEvent[]): number {
  const counts = events
    .map((event) => {
      const input = asRecord(event.input)
      const request = asRecord(input.request)
      const directMessages = Array.isArray(input.messages) ? input.messages.length : 0
      const nestedMessages = Array.isArray(request.messages) ? request.messages.length : 0
      return Math.max(directMessages, nestedMessages)
    })
    .filter((count) => count > 0)

  return counts.length > 0 ? Math.max(...counts) : events.filter((event) => event.type === 'llm_response').length
}

function formatWorkedFor(events: ToolTraceEvent[]): string {
  const starts = events
    .map((event) => Date.parse(event.startedAt))
    .filter((value) => Number.isFinite(value))
  const ends = events
    .map((event) => Date.parse(event.endedAt ?? event.startedAt))
    .filter((value) => Number.isFinite(value))
  if (starts.length === 0 || ends.length === 0) {
    return ''
  }

  const durationSeconds = Math.max(1, Math.round((Math.max(...ends) - Math.min(...starts)) / 1000))
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

function compactToolDetail(parts: string[]): string {
  return parts.filter((part) => part.trim().length > 0).join(' ')
}

function lineRangeDetail(path: string, start: unknown, end: unknown): string {
  const startText = stringValue(start)
  const endText = stringValue(end)
  if (startText && endText) {
    return `${path} L${startText}-${endText}`
  }
  if (startText) {
    return `${path} L${startText}`
  }
  return path
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return typeof value === 'string' ? value : String(value)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default ChatMessage
