import { X } from 'lucide-react'
import TraceEventRow from './TraceEventRow'
import type { ToolTraceEvent } from '../types/trace'

interface TraceDrawerProps {
  open: boolean
  taskId: string | null
  traceEvents: ToolTraceEvent[]
  onClose: () => void
}

function TraceDrawer({ open, taskId, traceEvents, onClose }: TraceDrawerProps) {
  if (!open) {
    return null
  }

  return (
    <aside className="trace-drawer" aria-label="Trace drawer">
      <div className="trace-drawer-header">
        <div>
          <h3>Trace</h3>
          <p>{taskId ? `taskId: ${taskId}` : 'No task selected'}</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close trace">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="trace-drawer-body">
        {traceEvents.length === 0 ? (
          <div className="empty-state">No trace events yet.</div>
        ) : (
          traceEvents.map((event) => <TraceEventRow key={event.id} event={event} />)
        )}
      </div>
    </aside>
  )
}

export default TraceDrawer
