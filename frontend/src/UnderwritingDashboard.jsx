import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, CheckCircle2, FileText, LoaderCircle, ScrollText, ShieldCheck } from 'lucide-react'
import ApplicantDeclaration from './ApplicantDeclaration'

export const money = (value, currency = 'INR') => value == null ? 'Not calculated' : `${currency} ${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
export const evidenceLabels = { evidence_found: 'Evidence found', evidence_missing: 'Evidence missing', review_needed: 'Needs interpretation' }

function unresolvedRequirements(application) {
  const workflow = application.workflow || {}
  if (Array.isArray(workflow.evidence_checklist)) {
    return workflow.evidence_checklist.filter((item) =>
      item.blocking !== false && !['Verified', 'Not applicable'].includes(item.status)
    )
  }
  const results = workflow.steps || {}
  const issues = [
    ...(workflow.open_items || []).map((item) => item.text),
    ...Object.entries(results).filter(([step]) => step !== 'recommendation').flatMap(([, result]) => result.outcome?.issues || []),
    ...(results.recommendation?.missing_information || []),
    ...(application.issues || []),
    ...(results.risk?.open_evidence_gaps || []),
    ...(application.documents || []).filter((doc) => doc.state === 'Missing').map((doc) => `Missing document: ${doc.name}`),
  ]
  // Earlier saved runs have no normalized outcome fields. Derive their real gaps
  // from saved results, without rewriting the employee's recorded review.
  if (results.premium && results.premium.premium == null && !results.premium.outcome) issues.push('Provide a supported product rate configuration and verified pricing inputs. No premium has been calculated.')
  if (results.risk && results.risk.risk_assessment?.score == null && !results.risk.outcome) issues.push('A validated risk assessment is unavailable; qualified medical or underwriting review is required.')
  for (const [step, label] of [['irdai', 'Regulatory'], ['company_policy', 'Company']]) {
    if (results[step] && !results[step].evidence_review) issues.push(`${label} rules were reviewed in the earlier workflow; no rule-by-rule evidence comparison is saved.`)
  }
  return [...new Set(issues.filter((item) => typeof item === 'string' && item.trim()))]
    .map((text, index) => ({
      id: `legacy:${index}`,
      requirement: text,
      status: 'Missing',
      blocking: true,
      next_action: 'Review the saved finding and record the required follow-up.',
      next_actor: 'Reviewer',
      evidence: [],
    }))
}

export function EvidenceTable({ review }) {
  if (!review?.rules?.length) return <p className="flow-muted">No rule-by-rule evidence comparison is available for this saved review.</p>
  return <div className="pipeline-table-scroll"><table className="pipeline-result-table flow-evidence-table"><thead><tr><th scope="col">Policy requirement</th><th scope="col">Application finding</th><th scope="col">Evidence status</th></tr></thead><tbody>{review.rules.map((rule) => <tr key={rule.id}><td><strong>{rule.topic}</strong><small>{rule.policy_name}</small><details><summary>View policy wording</summary><p>{rule.rule_text}</p>{rule.source_quote && <blockquote>{rule.source_quote}</blockquote>}</details></td><td>{rule.observation}{rule.evidence?.length > 0 && <details><summary>View recorded evidence ({rule.evidence.length})</summary><ul>{rule.evidence.map((evidence) => <li key={evidence.id}><strong>{evidence.source}</strong>{evidence.field && <small>{evidence.field}</small>}<p>{evidence.value}</p>{evidence.quote && <blockquote>{evidence.quote}</blockquote>}</li>)}</ul></details>}</td><td><span className={`flow-badge ${rule.status === 'evidence_found' ? 'neutral' : 'attention'}`}>{evidenceLabels[rule.status] || 'Needs review'}</span></td></tr>)}</tbody></table></div>
}

function EvidenceGapResolver({ application, items, onReviewRequirement, onDecision, onRerun, onUploadDocuments, saving }) {
  const [drafts, setDrafts] = useState({})
  const [errors, setErrors] = useState({})
  const [uploadFiles, setUploadFiles] = useState([])
  const [uploadRequirementId, setUploadRequirementId] = useState('')
  const [uploadError, setUploadError] = useState('')
  const missingDocuments = items.filter((item) => item.kind === 'document' && item.status === 'Missing')
  const fields = (application.documents || []).flatMap((document) =>
    (document.fields || []).map((field, index) => ({
      id: `document:${field.field_id || `${document.document_id || document.name}:${index}`}`,
      label: `${document.name} · ${field.name}: ${field.value}`,
    }))
  )
  async function review(item, status) {
    const draft = drafts[item.id] || {}
    const evidenceIds = [
      ...(item.evidence || []).map((evidence) => evidence.id).filter(Boolean),
      ...(draft.evidenceIds || []),
    ]
    try {
      await onReviewRequirement(item.id, {
        status,
        note: draft.note || '',
        reviewer_assessment: draft.assessment || undefined,
        evidence_ids: [...new Set(evidenceIds)],
        verified_value: draft.verifiedValue || undefined,
      })
      setErrors((previous) => ({ ...previous, [item.id]: '' }))
    } catch (error) {
      setErrors((previous) => ({ ...previous, [item.id]: error.message }))
    }
  }
  async function upload() {
    if (!uploadFiles.length) return
    setUploadError('')
    try {
      await onUploadDocuments(uploadFiles, uploadRequirementId)
      setUploadFiles([])
      setUploadRequirementId('')
    } catch (error) {
      setUploadError(error.message)
    }
  }
  return <section className="case-panel evidence-gap-resolver">
    <div className="case-panel-heading"><AlertCircle size={18} /><h3>Evidence Gap Resolver</h3><span>{items.length} open</span></div>
    <p className="flow-muted">Resolve each item with linked evidence and a reviewer note. Evidence located is not, by itself, proof that a policy requirement is satisfied.</p>
    {application.workflow?.stale_stages?.length > 0 && <div className="evidence-rerun-notice"><p>Evidence changed. The affected policy, risk and pricing findings need refreshing; prior results remain in the audit history.</p><button type="button" className="uw-start-button" disabled={saving} onClick={() => onRerun({ from_step: application.workflow.stale_stages[0] })}>Refresh affected findings</button></div>}
    {items.some((item) => item.kind === 'document') && <div className="evidence-upload-control">{missingDocuments.length > 0 && <label>Link upload to a missing requirement<select value={uploadRequirementId} onChange={(event) => { setUploadRequirementId(event.target.value); setUploadFiles([]) }} disabled={saving}><option value="">Match by filename or upload as additional evidence</option>{missingDocuments.map((item) => <option key={item.id} value={item.id}>{item.requirement}</option>)}</select></label>}<label>Attach missing or clearer evidence<input type="file" accept=".pdf,image/jpeg,image/png,image/tiff" multiple={!uploadRequirementId} onChange={(event) => setUploadFiles(Array.from(event.target.files || []))} disabled={saving} /></label><p>Link the upload to a requirement or add it as additional evidence. Extracted values still need reviewer verification.</p>{uploadError && <p className="flow-form-error" role="alert">{uploadError}</p>}<button type="button" className="uw-start-button" disabled={saving || !uploadFiles.length} onClick={upload}>Upload and extract</button></div>}
    {!items.length && <p className="flow-muted">No blocking evidence items are open. Review any non-blocking notices before deciding.</p>}
    <ol className="evidence-gap-list">{items.map((item) => {
      const draft = drafts[item.id] || {}
      const change = (key, value) => setDrafts((previous) => ({ ...previous, [item.id]: { ...(previous[item.id] || {}), [key]: value } }))
      return <li key={item.id} className="evidence-gap-item">
        <header><div><span className={`flow-badge ${item.status === 'Missing' || item.status === 'Conflicting' ? 'attention' : 'neutral'}`}>{item.status}</span><strong>{item.requirement}</strong></div><span className="evidence-gap-owner">{item.next_actor || 'Reviewer'} · blocking</span></header>
        <p>{item.why_required}</p>
        <p className="evidence-gap-next"><strong>Next action:</strong> {item.next_action}</p>
        {(item.policy_id || item.source_url) && <p><strong>Policy source:</strong> {item.policy_name} {item.policy_version ? `· version ${item.policy_version}` : ''}{item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">Open source</a>}{item.policy_source_quote && <blockquote>{item.policy_source_quote}</blockquote>}</p>}
        {item.evidence?.length > 0 ? <ul className="evidence-gap-evidence">{item.evidence.map((evidence, index) => {
          const document = (application.documents || []).find((doc) => doc.document_id === evidence.document_id)
          return <li key={evidence.id || index}>
            <strong>{evidence.source || 'Recorded evidence'}</strong>
            {evidence.field && <span> · {evidence.field}</span>}
            {evidence.page_numbers?.length > 0 && <span> · page {evidence.page_numbers.join(', ')}</span>}
            <p>{evidence.value || 'Evidence linked'}</p>
            {evidence.quote && <blockquote>{evidence.quote}</blockquote>}
            {document?.object_uri && <a target="_blank" rel="noreferrer" href={`/underwriting/cases/${encodeURIComponent(application.application_id)}/documents/${encodeURIComponent(document.document_id)}/source`}>Open source document</a>}
          </li>
        })}</ul> : <p className="flow-muted">No supporting evidence was found.</p>}
        {['policy_rule', 'regulatory_check'].includes(item.kind) && <label className="evidence-gap-control">Reviewer assessment
          <select value={draft.assessment || ''} onChange={(event) => change('assessment', event.target.value)} disabled={saving}>
            <option value="">Choose an assessment…</option>
            <option value="supports">Evidence supports the requirement</option>
            <option value="does_not_support">Evidence does not support the requirement</option>
            <option value="cannot_assess">Cannot assess with available evidence</option>
            <option value="not_applicable">Requirement does not apply</option>
          </select>
        </label>}
        {item.kind === 'document_field' && <label className="evidence-gap-control">Verified or corrected value
          <input value={draft.verifiedValue ?? item.verified_value ?? item.extracted_value ?? ''} onChange={(event) => change('verifiedValue', event.target.value)} disabled={saving} />
        </label>}
        {['policy_rule', 'regulatory_check'].includes(item.kind) && fields.length > 0 && <fieldset className="evidence-gap-source-picker">
          <legend>Link supporting extracted evidence</legend>
          {fields.map((field) => <label key={field.id}><input type="checkbox" checked={(draft.evidenceIds || []).includes(field.id)} onChange={(event) => change('evidenceIds', event.target.checked ? [...(draft.evidenceIds || []), field.id] : (draft.evidenceIds || []).filter((id) => id !== field.id))} disabled={saving} />{field.label}</label>)}
        </fieldset>}
        <label className="evidence-gap-control">Reviewer note
          <textarea value={draft.note || ''} onChange={(event) => change('note', event.target.value)} rows={2} maxLength={2000} disabled={saving} placeholder="Record what you checked and why…" />
        </label>
        {errors[item.id] && <p className="flow-form-error" role="alert">{errors[item.id]}</p>}
        <div className="evidence-gap-actions">
          <button type="button" className="subtle-action" disabled={saving} onClick={() => review(item, 'Verified')}>Record verification</button>
          {['policy_rule', 'regulatory_check'].includes(item.kind) && <button type="button" className="subtle-action" disabled={saving} onClick={() => review(item, 'Found—verify')}>Record unable to assess</button>}
          <button type="button" className="subtle-action" disabled={saving} onClick={() => review(item, 'Conflicting')}>Mark conflicting</button>
          <button type="button" className="subtle-action" disabled={saving} onClick={() => review(item, 'Not applicable')}>Mark not applicable</button>
          {item.next_actor === 'Applicant' && <button type="button" className="subtle-action" disabled={saving} onClick={() => onDecision('Request information', draft.note || `Request ${item.requirement}.`)}>Request from applicant</button>}
        </div>
        {item.reviewed_at && <small>Last reviewed by {item.reviewed_by || 'reviewer'} · {new Date(item.reviewed_at).toLocaleString()}</small>}
      </li>
    })}</ol>
  </section>
}

export function DecisionPanel({ application, onDecision, saving }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const final = ['Approved', 'Declined'].includes(application.status)
  async function record(action) {
    if (!note.trim()) { setError('Add your assessment and supporting evidence before recording an action.'); return }
    setError('')
    const updated = await onDecision(action, note)
    if (updated) setNote('')
  }
  return <section className="case-panel dashboard-decision">
    <div className="case-panel-heading"><ShieldCheck size={19} /><h3>Employee decision</h3><span className={`flow-badge ${final ? 'complete' : 'attention'}`}>{application.decision?.action || 'Not recorded'}</span></div>
    {application.decision && <div className="decision-record"><strong>{application.decision.action}</strong><p>{application.decision.reason}</p><small>{application.decision.reviewer} · {new Date(application.decision.recorded_at).toLocaleString()}</small></div>}
    {!final && <><p className="flow-muted">Review the recommendation, premium and open items, then record your decision. Processing completion does not approve the policy.</p><label htmlFor="dashboard-decision-note">Assessment & rationale</label><textarea id="dashboard-decision-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the evidence reviewed, outstanding requirements and reason for your decision…" disabled={saving} />{error && <p className="flow-form-error" role="alert">{error}</p>}<div className="dashboard-decision-actions"><button type="button" className="subtle-action" disabled={saving || !note.trim()} onClick={() => record('Request information')}>Request information</button><button type="button" className="subtle-action" disabled={saving || !note.trim()} onClick={() => record('Refer')}>Refer to specialist</button><button type="button" className="uw-start-button" disabled={saving || !note.trim() || application.readiness?.decision_readiness !== 'ready_for_decision'} onClick={() => record('Approve')}>{saving && <LoaderCircle size={16} className="spin" />}Record approval</button><button type="button" className="policy-delete-button" disabled={saving || !note.trim() || application.readiness?.decision_readiness !== 'ready_for_decision'} onClick={() => record('Decline')}>Record decline</button></div>{application.readiness?.decision_readiness !== 'ready_for_decision' && <p className="flow-form-error">Approval and decline are disabled until all blocking evidence requirements are resolved.</p>}</>}
  </section>
}

export default function UnderwritingDashboard({ application, steps, PremiumPanel, renderStep, onDecision, onReviewRequirement, onRerun, onUploadDocuments, onTrackReviewTime, saving }) {
  const trackReviewTime = useRef(onTrackReviewTime)
  useEffect(() => { trackReviewTime.current = onTrackReviewTime }, [onTrackReviewTime])
  useEffect(() => {
    let seconds = 0
    let lastTick = Date.now()
    let wasVisible = document.visibilityState === 'visible'
    const addVisibleTime = () => {
      const now = Date.now()
      if (wasVisible) seconds += Math.floor((now - lastTick) / 1000)
      lastTick = now
      wasVisible = document.visibilityState === 'visible'
    }
    document.addEventListener('visibilitychange', addVisibleTime)
    const timer = window.setInterval(() => {
      const now = Date.now()
      if (wasVisible) seconds += Math.floor((now - lastTick) / 1000)
      lastTick = now
      if (seconds >= 30) {
        const elapsed = 30
        seconds -= elapsed
        Promise.resolve(trackReviewTime.current?.(elapsed)).catch(() => {})
      }
    }, 1000)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', addVisibleTime)
      if (seconds > 0) Promise.resolve(trackReviewTime.current?.(Math.min(seconds, 30))).catch(() => {})
    }
  }, [application.application_id])
  const workflow = application.workflow || {}
  const results = workflow.steps || {}
  const premium = results.premium || {}
  const recommendation = results.recommendation || {}
  const risk = results.risk?.risk_assessment || {}
  const policies = application.policy_selection?.policies || []
  const gaps = unresolvedRequirements(application)
  const readiness = application.readiness || workflow.case_readiness || {}
  const readinessLabels = {
    processing: 'Processing',
    processing_failed: 'Processing failed',
    not_started: 'Not started',
    needs_information: 'Needs information',
    needs_review: 'Needs review',
    ready_for_decision: 'Ready for decision',
    decision_recorded: 'Decision recorded',
    waiting_for_employee: 'Waiting for employee',
  }
  const processedStages = steps.filter((step) => workflow.steps?.[step.id]).length
  const cover = application.application_details?.sum_insured_inr
  const details = [ ['Applicant', application.applicant], ['Application ID', application.application_id], ['Date of birth', application.date_of_birth], ['Product', application.plan], ['Insurance type', application.insurance_type], ['Requested cover', cover ? money(cover) : 'Not recorded'] ]
  return <section className="underwriting-dashboard">
    <header className="dashboard-heading"><div><span className="uw-eyebrow"><CheckCircle2 size={16} /> UNDERWRITING WORKFLOW</span><h3>Application decision dashboard</h3><p>Processing status and decision readiness are tracked separately. Stage completion alone does not mean the case is ready.</p><div className="dashboard-checkpoint-summary"><span className="flow-badge neutral">{results.documents?.reviewer_confirmed ? 'Document review recorded' : 'Document review not recorded'}</span><span className="flow-badge neutral">{results.risk?.reviewer_confirmed ? 'Findings review recorded' : 'Findings review not recorded'}</span></div></div><div className="dashboard-state-pair"><article><span>Processing</span><strong>{readiness.processing_status === 'complete' ? 'Complete' : readinessLabels[readiness.processing_status] || 'Not started'}</strong><small>{processedStages}/{steps.length} stages processed{workflow.completed_at ? ` · ${new Date(workflow.completed_at).toLocaleString()}` : ''}</small></article><article className={readiness.decision_readiness === 'ready_for_decision' || readiness.decision_readiness === 'decision_recorded' ? 'ready' : 'attention'}><span>Decision readiness</span><strong>{readinessLabels[readiness.decision_readiness] || 'Needs review'}</strong><small>{readiness.blocking_issue_count || 0} blocking items</small></article></div></header>
    <div className="dashboard-metrics"><article><span>Employee outcome</span><strong>{application.status === 'In review' ? 'Decision pending' : application.status}</strong><small>{application.decision ? 'Recorded employee action' : 'No automatic approval'}</small></article><article className={premium.premium == null ? 'needs-attention' : ''}><span>Annual premium before tax</span><strong>{money(premium.premium, premium.currency)}</strong><small>{premium.premium == null ? 'Pricing configuration or inputs unresolved' : 'Calculated indication · not an issued quote'}</small></article><article><span>Risk assessment</span><strong>{risk.score == null ? 'Review required' : risk.band}</strong><small>{risk.score == null ? 'No validated risk rating available' : `Recorded score: ${risk.score}`}</small></article><article className={gaps.length ? 'needs-attention' : ''}><span>Open requirements</span><strong>{gaps.length}</strong><small>{gaps.length ? 'Remain open after processing' : 'No gaps listed in this record'}</small></article></div>
    <section className="dashboard-recommendation"><div className="dashboard-recommendation-icon"><ShieldCheck size={24} /></div><div><span>UNDERWRITING RECOMMENDATION</span><h4>{recommendation.recommendation || 'Employee review required'}</h4><p>{recommendation.rationale || recommendation.summary || 'Review the collected evidence before deciding.'}</p>{recommendation.supporting_evidence?.length > 0 && <ul>{recommendation.supporting_evidence.map((item, index) => <li key={index}>{item}</li>)}</ul>}<small>Advisory recommendation. The employee records the final outcome below.</small></div></section>
    <div className="dashboard-details-grid"><section className="case-panel"><div className="case-panel-heading"><FileText size={18} /><h3>Application & health details</h3></div><dl className="case-facts">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl><ApplicantDeclaration details={application.application_details || {}} /></section><div className="dashboard-side-stack"><section className="case-panel"><div className="case-panel-heading"><AlertCircle size={18} /><h3>What is still needed?</h3><span>{gaps.length}</span></div>{readiness.blocking_issues?.length ? <ul className="dashboard-open-items">{readiness.blocking_issues.map((item, index) => <li key={item.id}><span>{index + 1}</span><div><p>{item.requirement}</p><small>{item.next_actor}: {item.next_action}</small></div></li>)}</ul> : <p className="flow-muted">No blocking evidence items are open. The employee must still record the decision.</p>}</section><section className="case-panel"><div className="case-panel-heading"><ScrollText size={18} /><h3>Premium calculation</h3></div>{premium.premium_calculation ? <><p className="flow-muted">{premium.premium_calculation.status === 'illustrative_only' ? 'Illustrative—synthetic pricing' : 'Pricing configuration'}</p><PremiumPanel calculation={premium.premium_calculation} /></> : <><p className="flow-muted">{premium.summary || 'Pricing unavailable—rate configuration missing.'}</p><ul>{premium.findings?.map((finding, index) => <li key={index}>{finding}</li>)}</ul></>}</section></div></div>
    <EvidenceGapResolver application={application} items={gaps} onReviewRequirement={onReviewRequirement} onDecision={onDecision} onRerun={onRerun} onUploadDocuments={onUploadDocuments} saving={saving} />
    <section className="case-panel"><div className="case-panel-heading"><ScrollText size={18} /><h3>Policies applied to this application</h3><span>{policies.length}</span></div><p className="flow-muted">These are the saved policy versions used in the run. Evidence found is separate from policy approval or compliance certification.</p><div className="pipeline-table-scroll"><table className="pipeline-result-table"><thead><tr><th scope="col">Policy & version</th><th scope="col">Category</th><th scope="col">Evidence review</th><th scope="col">Source</th></tr></thead><tbody>{policies.map((policy) => {
      const stage = policy.policy_kind === 'regulatory' ? 'irdai' : 'company_policy'
      const reviewedRules = results[stage]?.evidence_review?.rules?.filter((rule) => rule.policy_id === policy.policy_id) || []
      const found = reviewedRules.filter((rule) => rule.status === 'evidence_found').length
      return <tr key={policy.policy_id}><td><strong>{policy.policy_name}</strong><small>Version {policy.version || 'not specified'} · {policy.product_code || 'No product code'}</small></td><td>{policy.policy_kind === 'regulatory' ? 'Regulatory' : 'Company'}</td><td>{reviewedRules.length ? `${found}/${reviewedRules.length} rules have recorded evidence` : 'No comparison saved'}<small>{results.risk?.reviewer_confirmed ? 'Included in employee findings review' : 'Employee rule review not recorded'}</small></td><td><a target="_blank" rel="noreferrer" href={`/underwriting/policies/${encodeURIComponent(policy.policy_id)}/source`}>View source <ArrowRight size={13} /></a></td></tr>
    })}</tbody></table></div>{['irdai', 'company_policy'].map((stage) => <details className="dashboard-review-details" key={stage}><summary>{stage === 'irdai' ? 'Regulatory' : 'Company'} rule findings</summary><EvidenceTable review={results[stage]?.evidence_review} /></details>)}</section>
    <section className="case-panel"><div className="case-panel-heading"><FileText size={18} /><h3>Source documents & review trail</h3></div><div className="dashboard-documents">{application.documents?.map((doc) => <a key={doc.document_id || doc.name} href={doc.object_uri ? `/underwriting/cases/${encodeURIComponent(application.application_id)}/documents/${encodeURIComponent(doc.document_id)}/source` : undefined} target="_blank" rel="noreferrer"><FileText size={17} /><span>{doc.name}<small>{doc.state} · {doc.fields?.length || 0} extracted fields</small></span>{doc.object_uri && <ArrowRight size={14} />}</a>)}</div><div className="dashboard-audit">{steps.map((step) => <details className="dashboard-review-details" key={step.id}><summary><span>{step.title}</span><small>{results[step.id]?.completion_mode === 'employee_review' || results[step.id]?.reviewer_confirmed ? 'Employee reviewed' : 'Automatically processed'}</small></summary>{results[step.id] ? <><p className="flow-muted">{results[step.id].completed_at && new Date(results[step.id].completed_at).toLocaleString()}{results[step.id].reviewer_attestation && ` · ${results[step.id].reviewer_attestation}`}</p>{renderStep(step, results[step.id])}</> : <p>No saved result.</p>}</details>)}</div></section>
    <DecisionPanel application={application} onDecision={onDecision} saving={saving} />
  </section>
}
