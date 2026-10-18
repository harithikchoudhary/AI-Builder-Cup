import { useEffect, useRef } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'

export default function DeletePolicyDialog({ policies, busy, error, onCancel, onDelete }) {
  const dialog = useRef(null)
  const cancel = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    cancel.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => { if (busy) dialog.current?.focus() }, [busy])
  function onKeyDown(event) {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel() }
    if (event.key !== 'Tab') return
    const buttons = [...dialog.current.querySelectorAll('button:not(:disabled)')]
    if (!buttons.length) { event.preventDefault(); return }
    const first = buttons[0]; const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return <div className="policy-delete-backdrop"><section ref={dialog} tabIndex={-1} className="policy-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="policy-delete-title" aria-describedby="policy-delete-description" aria-busy={busy} onKeyDown={onKeyDown}>
    <span className="policy-delete-icon"><Trash2 size={22} /></span><h2 id="policy-delete-title">Delete {policies.length} selected {policies.length === 1 ? 'policy' : 'policies'}?</h2><p id="policy-delete-description">These entries will be removed from the policy library. Original documents and policy versions already saved on applications are retained.</p><ul>{policies.map((policy) => <li key={policy.policy_id}><strong>{policy.policy_name}</strong><small>{policy.policy_kind === 'regulatory' ? 'Regulatory source' : 'Company policy'} · Version {policy.version || 'not specified'}</small></li>)}</ul>{error && <p className="error-panel" role="alert">{error}</p>}<div className="policy-delete-dialog-actions"><button type="button" className="subtle-action" ref={cancel} disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="policy-delete-button" disabled={busy} onClick={onDelete}>{busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}{busy ? 'Deleting…' : 'Delete from library'}</button></div>
  </section></div>
}
