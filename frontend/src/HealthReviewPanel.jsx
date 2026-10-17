import { useEffect, useState } from 'react'
import { LoaderCircle, Save } from 'lucide-react'
import HealthRateGrid from './HealthRateGrid'

export default function HealthReviewPanel({ application, pending, busy, onSave }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [medical, setMedical] = useState('')
  const [tobacco, setTobacco] = useState('')
  const [note, setNote] = useState('')
  const [documents, setDocuments] = useState([])
  const [confirmed, setConfirmed] = useState(false)
  const [resolutions, setResolutions] = useState({})
  const [rules, setRules] = useState({})
  const id = application.application_id
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError(''); setConfirmed(false)
    fetch(`/underwriting/cases/${encodeURIComponent(id)}/health-review`, { signal: controller.signal }).then(async (response) => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || 'Could not load health review')
      return body
    }).then((body) => {
      setData(body); setMedical(body.inputs?.medical_class || ''); setTobacco(body.inputs?.tobacco_status || '')
      setNote(body.inputs?.review_note || ''); setDocuments(body.inputs?.evidence_document_ids || [])
      setResolutions({ ...Object.fromEntries(Object.entries(body.followup_evidence || {}).map(([key, value]) => [key, { disposition: 'pending', reference: value.reference, note: '' }])), ...(body.resolutions || {}) })
      setRules(Object.fromEntries((body.rules || []).filter((r) => r.employee_review).map((r) => [r.id, r.employee_review])))
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [id, pending.result_id])
  const update = (setter, key, patch) => setter((old) => ({ ...old, [key]: { ...old[key], ...patch } }))
  async function save(event) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      await onSave({ result_id: pending.result_id, medical_class: medical, tobacco_status: tobacco,
        review_note: note, evidence_document_ids: documents, confirmed,
        resolutions: Object.entries(resolutions).map(([key, value]) => ({ id: key, disposition: value.disposition || 'pending', note: value.note || '', reference: value.reference || '' })),
        rule_reviews: Object.entries(rules).filter(([, value]) => value.disposition).map(([key, value]) => ({ id: key, disposition: value.disposition, note: value.note || '' })) })
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  if (!data) return <section className="health-review-panel"><p role={error ? 'alert' : 'status'}>{error || 'Loading product rating and evidence checklist…'}</p></section>
  if (!data.product) return <section className="health-review-panel"><h4>Health product configuration needed</h4><p>Select a matching health product with a health rate table in a new run. The existing generic or term-insurance policies cannot calculate this health premium.</p></section>
  const config = data.product.config
  return <form className="health-review-panel" onSubmit={save}>
    <h4>Employee assessment before pricing</h4><p>Use the source documents and selected product rules. Record your classifications and evidence review; the system will then calculate the configured premium.</p>
    <div className="health-product-context"><strong>{data.product.policy_name}</strong><small>{config.product_id} · {config.version} · Configured rates before tax</small></div>
    <HealthRateGrid config={config} />
    <div className="health-rating-fields"><label>Medical classification<select required value={medical} disabled={busy || saving} onChange={(event) => setMedical(event.target.value)}><option value="">Select after reviewing medical evidence</option>{(config.triage?.medical_classes || []).map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select><small>STANDARD is for no declared conditions. CONTROLLED CONDITION requires employee assessment of the submitted medical evidence.</small></label><label>Tobacco classification<select required value={tobacco} disabled={busy || saving} onChange={(event) => setTobacco(event.target.value)}><option value="">Select after reviewing the declaration</option>{Object.keys(config.rate_tables?.tobacco_multipliers || {}).map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label></div>
    <fieldset disabled={busy || saving}><legend>Source documents you reviewed</legend><div className="health-source-checks">{data.documents.map((doc) => <label key={doc.document_id}><input type="checkbox" checked={documents.includes(doc.document_id)} onChange={(event) => setDocuments((old) => event.target.checked ? [...old, doc.document_id] : old.filter((key) => key !== doc.document_id))} /><a href={`/underwriting/cases/${encodeURIComponent(id)}/documents/${encodeURIComponent(doc.document_id)}/source`} target="_blank" rel="noreferrer">{doc.name}</a></label>)}</div></fieldset>
    <button type="button" className="subtle-action" disabled={busy || saving || !note.trim()} onClick={() => {
      setResolutions((old) => Object.fromEntries(Object.entries(old).map(([key, value]) => [key, value.disposition && value.disposition !== 'pending' && !value.note ? { ...value, note } : value])))
      setRules((old) => Object.fromEntries(Object.entries(old).map(([key, value]) => [key, value.disposition && !value.note ? { ...value, note } : value])))
    }}>Use assessment note for selected requirements</button>
    <details className="health-evidence-review"><summary>Verification requirements · {data.checks.length} items</summary><p>Keep pending items open. Resolve an item only with the actual verification or supporting reference you reviewed. These are employee records; no external authentication is performed by this form.</p>{data.checks.map((check) => <div className="health-review-item" key={check.id}><strong>{check.title}</strong><p>{check.detail}</p>{data.followup_evidence?.[check.id] && <small>Follow-up record: {data.followup_evidence[check.id].filename} · {data.followup_evidence[check.id].reference}</small>}<select aria-label={`${check.title} disposition`} value={resolutions[check.id]?.disposition || 'pending'} disabled={busy || saving} onChange={(event) => update(setResolutions, check.id, { disposition: event.target.value })}><option value="pending">Still pending</option><option value="verified">Employee verified</option><option value="not_applicable">Not applicable · explain why</option></select>{resolutions[check.id]?.disposition && resolutions[check.id].disposition !== 'pending' && <><input required aria-label={`${check.title} evidence reference`} placeholder="Evidence / verification reference" value={resolutions[check.id]?.reference || ''} onChange={(event) => update(setResolutions, check.id, { reference: event.target.value })} maxLength={300} /><textarea required aria-label={`${check.title} rationale`} placeholder="What did you verify, or why is this not applicable?" value={resolutions[check.id]?.note || ''} onChange={(event) => update(setResolutions, check.id, { note: event.target.value })} rows={2} maxLength={2000} /></>}</div>)}</details>
    <details className="health-evidence-review"><summary>Policy requirements · {data.rules.length} findings</summary><p>Record the employee assessment for each applicable rule. Unreviewed requirements stay open in the final dashboard.</p>{data.rules.map((rule) => <div className="health-review-item" key={rule.id}><small>{rule.policy_name}</small><strong>{rule.topic}</strong><p>{rule.observation}</p><details><summary>View rule wording</summary><p>{rule.rule_text}</p></details><select aria-label={`${rule.topic} employee assessment`} value={rules[rule.id]?.disposition || ''} disabled={busy || saving} onChange={(event) => update(setRules, rule.id, { disposition: event.target.value })}><option value="">Not yet reviewed</option><option value="satisfied">Employee assessed requirement met</option><option value="not_applicable">Not applicable to this case</option><option value="more_information">More information required</option></select>{rules[rule.id]?.disposition && <textarea required aria-label={`${rule.topic} rationale`} rows={2} maxLength={2000} placeholder="Record the supporting evidence and assessment, or explain non-applicability" value={rules[rule.id]?.note || ''} onChange={(event) => update(setRules, rule.id, { note: event.target.value })} />}</div>)}</details>
    <label className="checkpoint-note">Medical assessment and rating rationale<textarea required value={note} maxLength={2000} rows={3} disabled={busy || saving} onChange={(event) => setNote(event.target.value)} placeholder="Document what you reviewed and why the selected product rating class applies." /></label>
    <label className="checkpoint-confirm"><input required type="checkbox" checked={confirmed} disabled={busy || saving} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed the selected evidence and product criteria. These are my recorded assessments; unresolved requirements remain open.</span></label>
    {error && <p role="alert" className="flow-form-error">{error}</p>}
    <button type="submit" className="uw-start-button" disabled={busy || saving || !confirmed || !documents.length || !medical || !tobacco || !note.trim()}>{saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}Save assessment & refresh findings</button>
  </form>
}
