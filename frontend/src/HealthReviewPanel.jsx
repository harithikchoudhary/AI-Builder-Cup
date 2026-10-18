import { useEffect, useState } from 'react'
import { LoaderCircle, Save } from 'lucide-react'
import HealthRateGrid from './HealthRateGrid'
import AiRiskProposal from './AiRiskProposal'

export default function HealthReviewPanel({ application, pending, busy, onSave }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [medical, setMedical] = useState('')
  const [tobacco, setTobacco] = useState('')
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const id = application.application_id
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError(''); setConfirmed(false)
    fetch(`/underwriting/cases/${encodeURIComponent(id)}/health-review`, { signal: controller.signal }).then(async (response) => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || 'Could not load health review')
      return body
    }).then((body) => {
      setData(body); setMedical(body.inputs?.medical_class || ''); setTobacco(body.inputs?.tobacco_status || ''); setNote(body.inputs?.review_note || '')
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [id, pending.result_id])
  async function save(event) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      await onSave({ result_id: pending.result_id, medical_class: medical, tobacco_status: tobacco, review_note: note, evidence_document_ids: [], confirmed, resolutions: [], rule_reviews: [] }, true)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  if (!data) return <section className="health-review-panel"><p role={error ? 'alert' : 'status'}>{error || 'Loading product rating classes…'}</p></section>
  if (!data.product) return <section className="health-review-panel"><h4>Health product configuration needed</h4><p>Select a matching health product with a health rate table in a new run. The existing generic or term-insurance policies cannot calculate this health premium.</p></section>
  const config = data.product.config
  return <form className="health-review-panel" onSubmit={save}>
    <AiRiskProposal proposal={pending.risk_proposal} pending={pending} applicationId={id} busy={busy || saving} onAccept={(payload) => onSave(payload, true)}
      onPrefill={(proposal) => { setMedical(proposal.medical_class); setTobacco(proposal.tobacco_status); setNote(proposal.summary) }} />
    <details className="health-evidence-review"><summary>Change the classes instead</summary>
      <div className="health-product-context"><strong>{data.product.policy_name}</strong><small>{config.product_id} · {config.version} · Configured rates before tax</small></div>
      <HealthRateGrid config={config} />
      <div className="health-rating-fields"><label>Medical classification<select required value={medical} disabled={busy || saving} onChange={(event) => setMedical(event.target.value)}><option value="">Select a class</option>{(config.triage?.medical_classes || []).map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select><small>STANDARD is for no declared conditions. CONTROLLED CONDITION is for a declared, stable condition the product permits.</small></label><label>Tobacco classification<select required value={tobacco} disabled={busy || saving} onChange={(event) => setTobacco(event.target.value)}><option value="">Select a class</option>{Object.keys(config.rate_tables?.tobacco_multipliers || {}).map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label></div>
      <label className="checkpoint-note">Reason for the change<textarea value={note} maxLength={2000} rows={2} disabled={busy || saving} onChange={(event) => setNote(event.target.value)} placeholder="Optional: why these classes apply." /></label>
      <label className="checkpoint-confirm"><input required type="checkbox" checked={confirmed} disabled={busy || saving} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed the applicant data and the product criteria. These classes are my recorded assessment.</span></label>
      {error && <p role="alert" className="flow-form-error">{error}</p>}
      <button type="submit" className="uw-start-button" disabled={busy || saving || !confirmed || !medical || !tobacco}>{saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}Save my classes & refresh findings</button>
    </details>
  </form>
}
