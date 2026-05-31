import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
} from 'lucide-react'
import { renderTextWithCodeLinks } from './codeLinkText'
import type { ToolTraceEvent } from '../types/trace'
import { normalizeDisplayText, normalizePathsInValue } from '../utils/path'

interface TracePanelProps {
  projectId: string
  traces: ToolTraceEvent[]
  onResult?: (message: string) => void
  onError?: (message: string) => void
  onTraceChanged?: () => void
}

function TracePanel({
  projectId,
  traces,
  onResult,
  onError,
  onTraceChanged,
}: TracePanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const grouped = useMemo(() => groupByTask(traces), [traces])

  const toggle = (eventId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(eventId)) {
        next.delete(eventId)
      } else {
        next.add(eventId)
      }
      return next
    })
  }

  if (traces.length === 0) {
    return <div className="empty-state">No trace events yet.</div>
  }

  return (
    <section className="trace-panel" aria-label="Tool trace panel">
      {grouped.map(([taskId, events]) => (
        <div className="trace-group" key={taskId}>
          <div className="trace-task">taskId: {taskId}</div>
          {events.map((event) => {
            const expanded = expandedIds.has(event.id)
            const displayText = normalizeDisplayText(
              event.outputSummary ?? event.title,
            )
            return (
              <article className="trace-row" key={event.id}>
                <div className="trace-summary">
                  <button
                    type="button"
                    className="trace-toggle"
                    onClick={() => toggle(event.id)}
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Collapse trace event' : 'Expand trace event'}
                  >
                    {expanded ? (
                      <ChevronDown size={16} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={16} aria-hidden="true" />
                    )}
                  </button>
                  <span className="trace-step">{event.stepIndex}</span>
                  <StatusIcon status={event.status} />
                  <span className="trace-title">
                    {event.type === 'model_message'
                      ? renderTextWithCodeLinks(
                          displayText,
                          projectId,
                          event.taskId,
                          onResult,
                          onError,
                          onTraceChanged,
                        )
                      : normalizeDisplayText(event.title)}
                  </span>
                  {event.toolName ? (
                    <span className="trace-tool">{event.toolName}</span>
                  ) : null}
                  <span className={`trace-status ${event.status}`}>
                    {event.status}
                  </span>
                  <span className="trace-duration">
                    <Clock3 size={13} aria-hidden="true" />
                    {event.durationMs ?? 0} ms
                  </span>
                </div>
                {expanded ? (
                  <div className="trace-details">
                    {event.status === 'failed' ? (
                      <div className="trace-error">
                        {normalizeDisplayText(
                          event.outputSummary ?? 'Tool call failed',
                        )}
                      </div>
                    ) : null}
                    <JsonBlock label="input" value={event.input} />
                    <JsonBlock label="output" value={event.output} />
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ))}
    </section>
  )
}

function StatusIcon({ status }: { status: ToolTraceEvent['status'] }) {
  if (status === 'failed') {
    return <CircleAlert className="status-icon failed" size={16} aria-hidden="true" />
  }
  return <CheckCircle2 className="status-icon success" size={16} aria-hidden="true" />
}

function JsonBlock({ label, value }: { label: string; value: unknown | null }) {
  if (value === null || value === undefined) {
    return null
  }

  return (
    <div className="json-block">
      <div className="json-label">{label}</div>
      <pre>{JSON.stringify(normalizePathsInValue(value), null, 2)}</pre>
    </div>
  )
}

function groupByTask(traces: ToolTraceEvent[]): [string, ToolTraceEvent[]][] {
  const groups = new Map<string, ToolTraceEvent[]>()
  for (const event of traces) {
    const group = groups.get(event.taskId) ?? []
    group.push(event)
    groups.set(event.taskId, group)
  }
  return Array.from(groups.entries())
}

export default TracePanel
