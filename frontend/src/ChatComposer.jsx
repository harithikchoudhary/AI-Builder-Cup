import { useLayoutEffect, useRef } from 'react'
import { LoaderCircle, Send, Sparkles } from 'lucide-react'

export default function ChatComposer({ id, label, value, onChange, onSubmit, placeholder, busy, disabled, busyLabel = 'Analyzing', className = '' }) {
  const input = useRef(null)
  useLayoutEffect(() => {
    const field = input.current
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 156)}px`
    field.style.overflowY = field.scrollHeight > 156 ? 'auto' : 'hidden'
  }, [value])
  const submit = () => { if (value.trim() && !busy && !disabled) onSubmit(value) }
  return <form className={`ask-box inline-composer ${className}`} aria-busy={busy} onSubmit={(event) => { event.preventDefault(); submit() }}>
    <div className="ask-icon" aria-hidden="true"><Sparkles size={21} /></div>
    <label htmlFor={id} className="sr-only">{label}</label>
    <textarea ref={input} id={id} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} rows={1} placeholder={placeholder} disabled={busy || disabled} />
    <button className="composer-send" type="submit" disabled={!value.trim() || busy || disabled} aria-label={busy ? busyLabel : 'Send message'} title="Send message (Enter)">
      {busy ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}<span>{busy ? busyLabel : 'Send'}</span>
    </button>
  </form>
}
