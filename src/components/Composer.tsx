import { Mic, Paperclip, Send, Wrench } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import type { ProviderConfig } from '../types/provider'
import { getSelectableModels } from '../utils/providerModels'

interface ComposerProps {
  providers: ProviderConfig[]
  busy: boolean
  value: string
  onChange: (value: string) => void
  onSend: (prompt: string) => void
}

function Composer({ providers, busy, value, onChange, onSend }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canSend = value.trim().length > 0 && !busy
  const selectableModels = getSelectableModels(providers)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    textarea.style.height = '0px'
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 42), 128)
    textarea.style.height = `${nextHeight}px`
  }, [value])

  const send = () => {
    if (!canSend) {
      return
    }
    onSend(value.trim())
    onChange('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <div className="composer">
      <div className="composer-surface">
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask SnowAgent to inspect, edit, or explain code..."
          rows={1}
          disabled={busy}
        />
        <div className="composer-bottom-bar">
          <div className="composer-tool-group">
            <button
              type="button"
              className="composer-icon-button"
              title="Attach file/image"
              aria-label="Attach file/image"
            >
              <Paperclip size={16} aria-hidden="true" />
            </button>
            <button type="button" className="composer-mode-button" title="Tools">
              <Wrench size={15} aria-hidden="true" />
              <span>Agent mode</span>
              <span className="button-caret" aria-hidden="true">
                v
              </span>
            </button>
          </div>
          <div className="composer-action-group">
            <select
              className="composer-model-select"
              defaultValue={selectableModels[0]?.id ?? ''}
              aria-label="Model"
            >
              {selectableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.modelId}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="composer-icon-button"
              title="Voice input"
              aria-label="Voice input"
            >
              <Mic size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="composer-send-button"
              onClick={send}
              disabled={!canSend}
              aria-label={busy ? 'Running' : 'Send'}
              title={busy ? 'Running' : 'Send'}
            >
              {busy ? (
                <span className="send-spinner" aria-hidden="true" />
              ) : (
                <Send size={16} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Composer
