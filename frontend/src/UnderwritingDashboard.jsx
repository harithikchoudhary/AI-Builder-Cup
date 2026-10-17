import { useState } from 'react'
import { AlertCircle, ArrowRight, CheckCircle2, FileText, LoaderCircle, ScrollText, ShieldCheck } from 'lucide-react'
import ApplicantDeclaration from './ApplicantDeclaration'
import CaseJourney from './CaseJourney'

export const money = (value, currency = 'INR') => value == null ? 'Not calculated' : `${currency} ${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
export const evidenceLabels = { evidence_found: 'Evidence found', evidence_missing: 'More information needed', review_needed: 'Employee review needed' }

function unresolvedRequirements(application) {
  const workflow = application.workflow || {}
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
}

export function EvidenceTable({ review }) {
  if (!review?.rules?.length) return <p className="flow-muted">No rule-by-rule evidence comparison is available for this saved review.</p>
  return <div className="pipeline-table-scroll"><table className="pipeline-result-table flow-evidence-table"><thead><tr><th scope="col">Policy requirement</th><th scope="col">Application finding</th><th scope="col">Evidence status</th><th scope="col">Employee action</th></tr></thead><tbody>{review.rules.map((rule) => <tr key={rule.id}><td><strong>{rule.topic}</strong><small>{rule.policy_name}</small><details><summary>View policy wording</summary><p>{rule.rule_text}</p>{rule.source_quote && <blockquote>{rule.source_quote}</blockquote>}</details></td><td>{rule.observation}{rule.evidence?.length > 0 && <details><summary>View recorded evidence ({rule.evidence.length})</summary><ul>{rule.evidence.map((evidence) => <li key={evidence.id}><strong>{evidence.source}</strong>{evidence.field && <small>{evidence.field}</small>}<p>{evidence.value}</p>{evidence.quote && <blockquote>{evidence.quote}</blockquote>}</li>)}</ul></details>}</td><td><span className={`flow-badge ${rule.status === 'evidence_found' ? 'neutral' : 'attention'}`}>{rule.employee_review?.disposition === 'satisfied' ? 'Employee assessed requirement met' : rule.employee_review?.disposition === 'not_applicable' ? 'Employee: not applicable' : evidenceLabels[rule.status] || 'Needs review'}</span></td><td>{rule.employee_review ? <><strong>{rule.employee_review.disposition.replaceAll('_', ' ')}</strong><p>{rule.employee_review.note}</p></> : rule.status === 'evidence_found' ? 'Verify the source and decide whether it satisfies this requirement.' : rule.status === 'evidence_missing' ? 'Request the missing evidence or document why this requirement does not apply.' : 'Interpret the requirement against the source policy, or refer for specialist review.'}</td></tr>)}</tbody></table></div>
}

export function DecisionPanel({ application, onDecision, saving, readOnly = false }) {
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
    {!readOnly && !final && <><p className="flow-muted">Review the recommendation, premium and open items, then record your decision. Processing completion does not approve the policy.</p><label htmlFor="dashboard-decision-note">Assessment & rationale</label><textarea id="dashboard-decision-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the evidence reviewed, outstanding requirements and reason for your decision…" disabled={saving} />{error && <p className="flow-form-error" role="alert">{error}</p>}<div className="dashboard-decision-actions"><button type="button" className="subtle-action" disabled={saving || !note.trim()} onClick={() => record('Request information')}>Request information</button><button type="button" className="subtle-action" disabled={saving || !note.trim()} onClick={() => record('Refer')}>Refer to specialist</button><button type="button" className="uw-start-button" disabled={saving || !note.trim()} onClick={() => record('Approve')}>{saving && <LoaderCircle size={16} className="spin" />}Record approval</button><button type="button" className="policy-delete-button" disabled={saving || !note.trim()} onClick={() => record('Decline')}>Record decline</button></div></>}
  </section>
}

export default function UnderwritingDashboard({ application, steps, PremiumPanel, renderStep, onDecision, saving, readOnly = false }) {
  const workflow = application.workflow || {}
  const results = workflow.steps || {}
  const premium = results.premium || {}
  const recommendation = results.recommendation || {}
  const risk = results.risk?.risk_assessment || {}
  const policies = application.policy_selection?.policies || []
  const gaps = unresolvedRequirements(application)
  const cover = application.application_details?.sum_insured_inr
  const details = [ ['Applicant', application.applicant], ['Application ID', application.application_id], ['Date of birth', application.date_of_birth], ['Product', application.plan], ['Insurance type', application.insurance_type], ['Requested cover', cover ? money(cover) : 'Not recorded'] ]
  return <section className="underwriting-dashboard">
    <header className="dashboard-heading"><div><span className="uw-eyebrow"><CheckCircle2 size={16} /> REVIEW SUMMARY</span><h3>What should happen to this application?</h3><p>All findings, applied policies and outstanding requirements in one place.</p><div className="dashboard-checkpoint-summary"><span className="flow-badge neutral">{results.documents?.reviewer_confirmed ? 'Document review recorded' : 'Document review not recorded'}</span><span className="flow-badge neutral">{results.risk?.reviewer_confirmed ? 'Findings review recorded' : 'Findings review not recorded'}</span></div></div><span className="flow-badge neutral">{workflow.completed_at ? `Completed ${new Date(workflow.completed_at).toLocaleString()}` : 'Processing complete'}</span></header>
    <div className="dashboard-metrics"><article><span>Employee outcome</span><strong>{application.status === 'In review' ? 'Decision pending' : application.status}</strong><small>{application.decision ? 'Recorded employee action' : 'No automatic approval'}</small></article><article className={premium.premium == null ? 'needs-attention' : ''}><span>Annual premium before tax</span><strong>{money(premium.premium, premium.currency)}</strong><small>{premium.premium == null ? 'Pricing configuration or inputs unresolved' : 'Calculated indication · not an issued quote'}</small></article><article><span>Risk assessment</span><strong>{risk.status === 'triage_completed' ? risk.band : risk.score == null ? 'Review required' : risk.band}</strong><small>{risk.status === 'triage_completed' ? 'Employee-reviewed product triage · no predictive score' : risk.score == null ? 'No validated risk rating available' : `Recorded score: ${risk.score}`}</small></article><article className={gaps.length ? 'needs-attention' : ''}><span>Open requirements</span><strong>{gaps.length}</strong><small>{gaps.length ? 'Remain open after processing' : 'No gaps listed in this record'}</small></article></div>
    <section className="dashboard-recommendation"><div className="dashboard-recommendation-icon"><ShieldCheck size={24} /></div><div><span>UNDERWRITING RECOMMENDATION</span><h4>{recommendation.recommendation || 'Employee review required'}</h4><p>{recommendation.rationale || recommendation.summary || 'Review the collected evidence before deciding.'}</p>{recommendation.supporting_evidence?.length > 0 && <ul>{recommendation.supporting_evidence.map((item, index) => <li key={index}>{item}</li>)}</ul>}<small>Advisory recommendation. The employee records the final outcome below.</small></div></section>
    <CaseJourney application={application} steps={steps} complete />
    <div className="dashboard-details-grid"><section className="case-panel"><div className="case-panel-heading"><FileText size={18} /><h3>Application & health details</h3></div><dl className="case-facts">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl><ApplicantDeclaration details={application.application_details || {}} /></section><div className="dashboard-side-stack"><section className="case-panel"><div className="case-panel-heading"><AlertCircle size={18} /><h3>What is still needed?</h3><span>{gaps.length}</span></div>{gaps.length ? <ul className="dashboard-open-items">{gaps.map((text, index) => <li key={index}><span>{index + 1}</span><p>{text}</p></li>)}</ul> : <p className="flow-muted">No missing requirements are listed. The employee must still record the decision.</p>}</section><section className="case-panel"><div className="case-panel-heading"><ScrollText size={18} /><h3>Premium calculation</h3></div>{premium.premium_calculation ? <PremiumPanel calculation={premium.premium_calculation} /> : <><p className="flow-muted">{premium.summary || 'No premium calculation is saved.'}</p><ul>{premium.findings?.map((finding, index) => <li key={index}>{finding}</li>)}</ul></>}</section></div></div>
    <section className="case-panel"><div className="case-panel-heading"><ScrollText size={18} /><h3>Policies applied to this application</h3><span>{policies.length}</span></div><p className="flow-muted">These are the saved policy versions used in the run. Evidence found is separate from policy approval or compliance certification.</p><div className="pipeline-table-scroll"><table className="pipeline-result-table"><thead><tr><th scope="col">Policy & version</th><th scope="col">Category</th><th scope="col">Evidence review</th><th scope="col">Source</th></tr></thead><tbody>{policies.map((policy) => {
      const stage = policy.policy_kind === 'regulatory' ? 'irdai' : 'company_policy'
      const reviewedRules = results[stage]?.evidence_review?.rules?.filter((rule) => rule.policy_id === policy.policy_id) || []
      const found = reviewedRules.filter((rule) => rule.status === 'evidence_found').length
      return <tr key={policy.policy_id}><td><strong>{policy.policy_name}</strong><small>Version {policy.version || 'not specified'} · {policy.product_code || 'No product code'}</small></td><td>{policy.policy_kind === 'regulatory' ? 'Regulatory' : 'Company'}</td><td>{reviewedRules.length ? `${found}/${reviewedRules.length} rules have recorded evidence` : 'No comparison saved'}<small>{results.risk?.reviewer_confirmed ? 'Included in employee findings review' : 'Employee rule review not recorded'}</small></td><td><a target="_blank" rel="noreferrer" href={`/underwriting/policies/${encodeURIComponent(policy.policy_id)}/source`}>View source <ArrowRight size={13} /></a></td></tr>
    })}</tbody></table></div>{['irdai', 'company_policy'].map((stage) => <details className="dashboard-review-details" key={stage}><summary>{stage === 'irdai' ? 'Regulatory' : 'Company'} rule findings</summary><EvidenceTable review={results[stage]?.evidence_review} /></details>)}</section>
    <section className="case-panel"><div className="case-panel-heading"><FileText size={18} /><h3>Source documents & review trail</h3></div><div className="dashboard-documents">{application.documents?.map((doc) => <a key={doc.document_id || doc.name} href={doc.object_uri ? `/underwriting/cases/${encodeURIComponent(application.application_id)}/documents/${encodeURIComponent(doc.document_id)}/source` : undefined} target="_blank" rel="noreferrer"><FileText size={17} /><span>{doc.name}<small>{doc.state} · {doc.fields?.length || 0} extracted fields</small></span>{doc.object_uri && <ArrowRight size={14} />}</a>)}</div><div className="dashboard-audit">{steps.map((step) => <details className="dashboard-review-details" key={step.id}><summary><span>{step.title}</span><small>{results[step.id]?.completion_mode === 'employee_review' || results[step.id]?.reviewer_confirmed ? 'Employee reviewed' : 'Automatically processed'}</small></summary>{results[step.id] ? <><p className="flow-muted">{results[step.id].completed_at && new Date(results[step.id].completed_at).toLocaleString()}{results[step.id].reviewer_attestation && ` · ${results[step.id].reviewer_attestation}`}</p>{renderStep(step, results[step.id])}</> : <p>No saved result.</p>}</details>)}</div></section>
    <DecisionPanel application={application} onDecision={onDecision} saving={saving} readOnly={readOnly} />
  </section>
}
