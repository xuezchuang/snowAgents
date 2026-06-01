import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ToolTraceEvent } from '../types/trace'

interface TraceDrawerProps {
  open: boolean
  taskId: string | null
  traceEvents: ToolTraceEvent[]
  onClose: () => void
}

interface TraceScrollbarState {
  visible: boolean
  top: number
  height: number
  thumbTop: number
  thumbHeight: number
}

const hiddenScrollbar: TraceScrollbarState = {
  visible: false,
  top: 0,
  height: 0,
  thumbTop: 0,
  thumbHeight: 0,
}

function TraceDrawer({ open, taskId, traceEvents, onClose }: TraceDrawerProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [scrollbar, setScrollbar] = useState<TraceScrollbarState>(hiddenScrollbar)
  const [formatEscapedNewlines, setFormatEscapedNewlines] = useState(false)
  const payload = useMemo(
    () => createTracePayload(taskId, traceEvents),
    [taskId, traceEvents],
  )

  const updateScrollbar = useCallback(() => {
    const body = bodyRef.current
    if (!body) {
      setScrollbar(hiddenScrollbar)
      return
    }

    const maxScroll = body.scrollHeight - body.clientHeight
    const trackInset = 8
    const trackHeight = Math.max(0, body.clientHeight - trackInset * 2)
    if (maxScroll <= 1 || trackHeight <= 0) {
      setScrollbar(hiddenScrollbar)
      return
    }

    const thumbHeight = Math.max(
      44,
      Math.round((body.clientHeight / body.scrollHeight) * trackHeight),
    )
    const thumbTravel = Math.max(0, trackHeight - thumbHeight)
    const thumbTop = Math.round((body.scrollTop / maxScroll) * thumbTravel)
    const nextScrollbar = {
      visible: true,
      top: body.offsetTop + trackInset,
      height: trackHeight,
      thumbTop,
      thumbHeight,
    }

    setScrollbar((current) =>
      current.visible === nextScrollbar.visible &&
      current.top === nextScrollbar.top &&
      current.height === nextScrollbar.height &&
      current.thumbTop === nextScrollbar.thumbTop &&
      current.thumbHeight === nextScrollbar.thumbHeight
        ? current
        : nextScrollbar,
    )
  }, [])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const body = bodyRef.current
    const content = contentRef.current
    if (!body) {
      return undefined
    }

    updateScrollbar()
    const animationFrame = window.requestAnimationFrame(updateScrollbar)
    body.addEventListener('scroll', updateScrollbar, { passive: true })
    window.addEventListener('resize', updateScrollbar)

    const resizeObserver = new ResizeObserver(updateScrollbar)
    resizeObserver.observe(body)
    if (content) {
      resizeObserver.observe(content)
    }

    const mutationObserver = new MutationObserver(updateScrollbar)
    mutationObserver.observe(body, {
      attributes: true,
      childList: true,
      subtree: true,
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
      body.removeEventListener('scroll', updateScrollbar)
      window.removeEventListener('resize', updateScrollbar)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [open, traceEvents.length, updateScrollbar])

  if (!open) {
    return null
  }

  return (
    <aside className="trace-drawer" aria-label="Trace drawer">
      <div className="trace-drawer-header">
        <div>
          <h3>Trace</h3>
          <p>{taskId ? `message trace: ${taskId}` : 'No message trace selected'}</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close trace">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="trace-drawer-body" ref={bodyRef}>
        <div className="trace-drawer-content" ref={contentRef}>
          {traceEvents.length === 0 ? (
            <div className="empty-state">No trace events yet.</div>
          ) : (
            <>
              <div className="trace-json-toolbar">
                <label className="trace-newline-toggle">
                  <input
                    type="checkbox"
                    checked={formatEscapedNewlines}
                    onChange={(event) => setFormatEscapedNewlines(event.target.checked)}
                  />
                  <span>{'Render \\n as line breaks'}</span>
                </label>
              </div>
              <TraceJsonPanel
                title="Input"
                value={payload.input}
                formatEscapedNewlines={formatEscapedNewlines}
              />
              <TraceJsonPanel
                title="Output"
                value={payload.output}
                formatEscapedNewlines={formatEscapedNewlines}
              />
            </>
          )}
        </div>
      </div>
      {scrollbar.visible ? (
        <div
          className="trace-scrollbar"
          style={{ top: scrollbar.top, height: scrollbar.height }}
          aria-hidden="true"
        >
          <div
            className="trace-scrollbar-thumb"
            style={{
              height: scrollbar.thumbHeight,
              transform: `translateY(${scrollbar.thumbTop}px)`,
            }}
          />
        </div>
      ) : null}
    </aside>
  )
}

interface TracePayload {
  input: unknown | null
  output: unknown | null
}

function TraceJsonPanel({
  title,
  value,
  formatEscapedNewlines,
}: {
  title: string
  value: unknown | null
  formatEscapedNewlines: boolean
}) {
  return (
    <section className="trace-section trace-json-panel">
      <h4>{title}</h4>
      {value === null || value === undefined ? (
        <div className="empty-state">No {title.toLowerCase()} JSON.</div>
      ) : (
        <pre className="trace-raw-code trace-json-code">
          {formatJson(value, formatEscapedNewlines)}
        </pre>
      )}
    </section>
  )
}

function createTracePayload(taskId: string | null, events: ToolTraceEvent[]): TracePayload {
  const chatCompletion = events.find((event) => event.title === 'chat_completion')
  if (chatCompletion) {
    const input = asRecord(chatCompletion.input)
    const output = asRecord(chatCompletion.output)
    return {
      input: input.request ?? chatCompletion.input ?? null,
      output: output.response ?? chatCompletion.output ?? null,
    }
  }

  const failedChatCompletion = events.find((event) => event.title === 'chat_completion failed')
  if (failedChatCompletion) {
    const input = asRecord(failedChatCompletion.input)
    return {
      input: input.request ?? failedChatCompletion.input ?? null,
      output: failedChatCompletion.output ?? null,
    }
  }

  return {
    input: {
      taskId,
      events: events.map((event) => ({
        id: event.id,
        taskId: event.taskId,
        stepIndex: event.stepIndex,
        type: event.type,
        toolName: event.toolName,
        title: event.title,
        startedAt: event.startedAt,
        input: event.input,
      })),
    },
    output: {
      taskId,
      events: events.map((event) => ({
        id: event.id,
        taskId: event.taskId,
        stepIndex: event.stepIndex,
        type: event.type,
        toolName: event.toolName,
        title: event.title,
        status: event.status,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        durationMs: event.durationMs,
        outputSummary: event.outputSummary,
        output: event.output,
      })),
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function formatJson(value: unknown, formatEscapedNewlines: boolean): string {
  const json = JSON.stringify(value, null, 2)
  if (!formatEscapedNewlines) {
    return json
  }
  return json.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')
}

export default TraceDrawer
