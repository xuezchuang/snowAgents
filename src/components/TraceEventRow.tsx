import { useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
} from 'lucide-react'
import type { ToolTraceEvent } from '../types/trace'
import { normalizeDisplayText, normalizePathsInValue } from '../utils/path'

interface TraceEventRowProps {
  event: ToolTraceEvent
}

function TraceEventRow({ event }: TraceEventRowProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <article className={event.status === 'failed' ? 'drawer-trace-row failed' : 'drawer-trace-row'}>
      <button
        type="button"
        className="drawer-trace-summary"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown size={16} aria-hidden="true" />
        ) : (
          <ChevronRight size={16} aria-hidden="true" />
        )}
        <span className="trace-step">{event.stepIndex}</span>
        {event.status === 'failed' ? (
          <CircleAlert className="status-icon failed" size={16} aria-hidden="true" />
        ) : (
          <CheckCircle2 className="status-icon success" size={16} aria-hidden="true" />
        )}
        <span className="trace-title">{normalizeDisplayText(event.title)}</span>
        {event.toolName ? <span className="trace-tool">{event.toolName}</span> : null}
        <span className={`trace-status ${event.status}`}>{event.status}</span>
        <span className="trace-duration">
          <Clock3 size={13} aria-hidden="true" />
          {event.durationMs ?? 0} ms
        </span>
      </button>

      {expanded ? (
        <div className="trace-details">
          {event.status === 'failed' ? (
            <div className="trace-error">
              {normalizeDisplayText(event.outputSummary ?? 'Tool call failed')}
            </div>
          ) : null}
          <JsonBlock label="input" value={event.input} />
          <JsonBlock label="output" value={event.output} />
        </div>
      ) : null}
    </article>
  )
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

export default TraceEventRow
