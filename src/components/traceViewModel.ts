import type { ToolTraceEvent, TraceStatus } from '../types/trace'
import { normalizeDisplayText, normalizePathsInValue } from '../utils/path'

export interface TraceSummaryItem {
  label: string
  value: string
  multiline?: boolean
}

export interface TraceStepViewModel {
  id: string
  index: number
  title: string
  status: TraceStatus
  durationMs: number | null
  summaryItems: TraceSummaryItem[]
  inputSummary: TraceSummaryItem[]
  outputSummary: TraceSummaryItem[]
  rawInput: unknown | null
  rawOutput: unknown | null
}

export function createTraceStepViewModels(events: ToolTraceEvent[]): TraceStepViewModel[] {
  const steps: TraceStepViewModel[] = []

  for (const event of events) {
    if (event.type === 'model_message') {
      const finalMessage = extractMessage(event.output) ?? event.outputSummary ?? ''
      const sanitizedMessage = sanitizeModelMessage(finalMessage)
      const chatCompletion = [...steps]
        .reverse()
        .find((step) => step.title === 'Chat completion')

      if (chatCompletion && sanitizedMessage) {
        appendOrReplaceItem(chatCompletion.outputSummary, {
          label: 'Final Message',
          value: sanitizedMessage,
          multiline: true,
        })
        chatCompletion.rawOutput = {
          chatCompletion: chatCompletion.rawOutput,
          finalMessage: normalizePathsInValue(event.output),
        }
        continue
      }
    }

    steps.push(toTraceStepViewModel(event))
  }

  return steps
}

export function sanitizeModelMessage(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toTraceStepViewModel(event: ToolTraceEvent): TraceStepViewModel {
  const input = asRecord(event.input)
  const output = asRecord(event.output)
  const rawInput = event.input === undefined ? null : normalizePathsInValue(event.input)
  const rawOutput = event.output === undefined ? null : normalizePathsInValue(event.output)

  if (event.title === 'Start task') {
    return {
      ...baseStep(event, 'Start task', rawInput, rawOutput),
      inputSummary: compactItems([
        item('Project', stringValue(input.projectName)),
        item('Prompt', stringValue(input.prompt), true),
      ]),
    }
  }

  if (event.title === 'select_model') {
    return {
      ...baseStep(event, 'Select model', rawInput, rawOutput),
      summaryItems: compactItems([
        item('Provider', stringValue(output.provider)),
        item('Model', stringValue(output.model)),
        item('Base URL', stringValue(output.baseUrl)),
        item('API Key', stringValue(output.apiKey ?? input.apiKey)),
      ]),
    }
  }

  if (event.title === 'chat_completion') {
    const message = extractMessage(event.output)
    const tokens = readTokenUsage(output)
    return {
      ...baseStep(event, 'Chat completion', rawInput, rawOutput),
      summaryItems: compactItems([
        item('Provider', stringValue(input.provider)),
        item('Model', stringValue(input.model ?? output.model)),
        item('Duration', formatDuration(event.durationMs)),
        item('Tokens', tokens.display),
      ]),
      inputSummary: compactItems([
        item('Prompt chars', stringValue(input.promptChars)),
        item('Messages', stringValue(input.messages ?? input.messageCount)),
        item('Input tokens', tokens.inputTokens),
      ]),
      outputSummary: compactItems([
        item('Model', stringValue(output.model ?? input.model)),
        item('Message chars', stringValue(output.messageChars)),
        item('Output tokens', tokens.outputTokens),
        item('Total tokens', tokens.totalTokens),
        item('Final Message', message ? sanitizeModelMessage(message) : '', true),
      ]),
    }
  }

  if (event.type === 'model_message') {
    const message = extractMessage(event.output) ?? event.outputSummary ?? ''
    return {
      ...baseStep(event, 'Final message', rawInput, rawOutput),
      outputSummary: compactItems([
        item('Final Message', sanitizeModelMessage(message), true),
      ]),
    }
  }

  if (event.status === 'failed' || event.type === 'error') {
    const error = stringValue(output.error) || event.outputSummary || 'Step failed'
    return {
      ...baseStep(event, normalizeTraceTitle(event.title), rawInput, rawOutput),
      outputSummary: compactItems([
        item('Error', normalizeDisplayText(error), true),
      ]),
    }
  }

  return {
    ...baseStep(event, normalizeTraceTitle(event.title), rawInput, rawOutput),
    summaryItems: compactItems([
      item('Tool', event.toolName ?? ''),
      item('Summary', event.outputSummary ?? '', true),
      item('Duration', formatDuration(event.durationMs)),
    ]),
  }
}

function baseStep(
  event: ToolTraceEvent,
  title: string,
  rawInput: unknown | null,
  rawOutput: unknown | null,
): TraceStepViewModel {
  return {
    id: event.id,
    index: event.stepIndex,
    title,
    status: event.status,
    durationMs: event.durationMs,
    summaryItems: compactItems([item('Duration', formatDuration(event.durationMs))]),
    inputSummary: [],
    outputSummary: [],
    rawInput,
    rawOutput,
  }
}

function appendOrReplaceItem(items: TraceSummaryItem[], nextItem: TraceSummaryItem): void {
  const index = items.findIndex((item) => item.label === nextItem.label)
  if (index >= 0) {
    items[index] = nextItem
  } else {
    items.push(nextItem)
  }
}

function item(label: string, value: string, multiline = false): TraceSummaryItem {
  return { label, value, multiline }
}

function compactItems(items: TraceSummaryItem[]): TraceSummaryItem[] {
  return items.filter((item) => item.value.trim().length > 0)
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
  if (typeof value === 'string') {
    return sanitizeModelMessage(value)
  }
  return String(value)
}

function extractMessage(value: unknown): string | null {
  const record = asRecord(value)
  const message = record.message
  return typeof message === 'string' ? message : null
}

function readTokenUsage(record: Record<string, unknown>): {
  inputTokens: string
  outputTokens: string
  totalTokens: string
  display: string
} {
  const inputTokens = tokenValue(record, ['inputTokens', 'promptTokens', 'prompt_tokens'])
  const outputTokens = tokenValue(record, [
    'outputTokens',
    'completionTokens',
    'completion_tokens',
  ])
  const totalTokens =
    tokenValue(record, ['totalTokens', 'total_tokens']) ||
    sumTokenStrings(inputTokens, outputTokens)
  const displayParts = compactStrings([
    inputTokens ? `${inputTokens} in` : '',
    outputTokens ? `${outputTokens} out` : '',
    totalTokens ? `${totalTokens} total` : '',
  ])

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    display: displayParts.join(' / ') || 'not reported',
  }
}

function tokenValue(record: Record<string, unknown>, keys: string[]): string {
  const tokenSources = [
    record,
    asRecord(record.tokens),
    asRecord(record.usage),
    asRecord(record.tokenUsage),
  ]
  for (const source of tokenSources) {
    for (const key of keys) {
      const value = source[key]
      if (value !== null && value !== undefined && value !== '') {
        return stringValue(value)
      }
    }
  }
  return ''
}

function sumTokenStrings(left: string, right: string): string {
  if (!left || !right) {
    return ''
  }
  const leftValue = Number(left)
  const rightValue = Number(right)
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
    return ''
  }
  return String(leftValue + rightValue)
}

function compactStrings(values: string[]): string[] {
  return values.filter((value) => value.trim().length > 0)
}

function formatDuration(durationMs: number | null): string {
  return typeof durationMs === 'number' ? `${durationMs} ms` : ''
}

function normalizeTraceTitle(title: string): string {
  return normalizeDisplayText(title)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (value) => value.toUpperCase())
}
