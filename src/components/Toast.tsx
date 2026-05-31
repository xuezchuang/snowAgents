import { CircleAlert, CheckCircle2, X } from 'lucide-react'

export type ToastKind = 'notice' | 'error'

export interface ToastState {
  id: number
  kind: ToastKind
  message: string
}

interface ToastProps {
  toast: ToastState | null
  onDismiss: () => void
}

function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) {
    return null
  }

  const isError = toast.kind === 'error'

  return (
    <div className={`toast ${toast.kind}`} role="status" aria-live="polite">
      {isError ? (
        <CircleAlert size={16} aria-hidden="true" />
      ) : (
        <CheckCircle2 size={16} aria-hidden="true" />
      )}
      <span>{toast.message}</span>
      <button
        type="button"
        className="toast-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

export default Toast
