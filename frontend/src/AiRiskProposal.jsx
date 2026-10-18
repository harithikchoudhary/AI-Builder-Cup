import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, ShieldCheck, Sparkles } from 'lucide-react'

// The proposal is built from the applicant data record and validated server-side; this card only presents it.
export function acceptPayload(proposal, pending) {
  return {
    result_id: pending.result_id, medical_class: proposal.medical_class, tobacco_status: proposal.tobacco_status,
    review_note: `Accepted the AI-assessed classification (${proposal.model}): ${proposal.summary}`.slice(0, 2000),
    evidence_document_ids: [], confirmed: true, resolutions: [], rule_reviews: [],
  }
}

const classLabel = (value) => String(value ?? '').replaceAll('_', ' ')

export default function AiRiskProposal({ proposal, pending, busy, onAccept, onPrefill }) {
  const [error, setError] = useState('')
  const [accepting, setAccepting] = useState(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  if (!proposal) return null
  if (proposal.status === 'unavailable') return <section className="ai-proposal is-unavailable"><div className="ai-proposal-head"><Sparkles size={17} /><strong>AI assessment unavailable</strong></div><p>{proposal.reason} Classify the case manually below.</p></section>
  const payload = acceptPayload(proposal, pending)
  const validated = proposal.status === 'validated'
  async function accept() {
    setAccepting(true); setError('')
    try { await onAccept(payload) } catch (err) { if (mounted.current) setError(err.message) } finally { if (mounted.current) setAccepting(false) }
  }
  return <section className={`ai-proposal ${validated ? 'is-validated' : 'needs-review'}`}>
    <div className="ai-proposal-head"><Sparkles size={17} /><strong>AI assessment</strong><span className="flow-badge neutral">{proposal.model}</span>{proposal.confidence != null && <span className="flow-badge neutral">{Math.round(proposal.confidence * 100)}% confidence</span>}</div>
    <div className="ai-proposal-classes"><div><small>Medical class</small><strong>{classLabel(proposal.medical_class)}</strong></div><div><small>Tobacco</small><strong>{classLabel(proposal.tobacco_status)}</strong></div></div>
    <p>{proposal.summary}</p>
    <ul className="ai-proposal-checks">{proposal.checks.map((check) => <li key={check.label} className={check.passed ? 'passed' : 'failed'}><Check size={13} />{check.label}</li>)}</ul>
    {error && <p className="flow-form-error" role="alert">{error}</p>}
    <div className="ai-proposal-actions">
      {onAccept && <button type="button" className="uw-start-button" disabled={!validated || !payload || busy || accepting} onClick={accept}>{accepting ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}Confirm AI assessment & price</button>}
      {onPrefill && <button type="button" className="subtle-action" disabled={busy} onClick={() => onPrefill(proposal)}>Use as starting point</button>}
      {!validated && <small>Some checks failed. Review the evidence before choosing a class.</small>}
    </div>
  </section>
}
