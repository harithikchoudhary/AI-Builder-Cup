import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, Check, FileText, LoaderCircle, Play, RotateCcw } from 'lucide-react'
import UnderwritingDashboard, { EvidenceTable } from './UnderwritingDashboard'

export const underwritingSteps = [
  { id: 'application_details', title: 'Check application', caption: 'Who is applying, and for what cover?', purpose: 'Check the applicant and insurance product against the submitted application.', action: 'Check application details' },
  { id: 'documents', title: 'Read documents', caption: 'Is the information complete and correct?', purpose: 'Read the submitted documents, identify missing items, and compare extracted values with the originals.', action: 'Read submitted documents' },
  { id: 'irdai', title: 'Review regulations', caption: 'Which regulatory requirements apply?', purpose: 'Review the selected regulatory sources and identify the evidence needed for each applicable requirement.', action: 'Prepare regulatory checklist' },
  { id: 'company_policy', title: 'Review company rules', caption: 'What does the selected product require?', purpose: 'Review the selected insurer’s rules against this application. Matching a policy does not establish eligibility.', action: 'Show company rule checklist' },
  { id: 'risk', title: 'Review health risks', caption: 'What needs medical or specialist review?', purpose: 'Review declared health information, available risk evidence, and information that still needs verification.', action: 'Review available risk evidence' },
  { id: 'premium', title: 'Calculate premium', caption: 'Can a price be calculated?', purpose: 'Use the selected product’s configured pricing rules and verified applicant inputs to calculate a premium.', action: 'Check pricing and calculate' },
  { id: 'recommendation', title: 'Review recommendation', caption: 'What should the employee do next?', purpose: 'Bring together the available evidence and unresolved issues before the employee records a decision.', action: 'Prepare recommendation' },
]

const labels = { application_id: 'Application ID', applicant: 'Applicant', date_of_birth: 'Date of birth', insurance_type: 'Insurance type', product_name: 'Product name', product_code: 'Product code', declared_conditions: 'Declared conditions', current_medications: 'Current medications', prior_hospitalisation: 'Previous hospitalization', tobacco_use: 'Tobacco use' }
const readable = (value) => labels[value] || String(value ?? '').replaceAll('_', ' ')
const display = (value) => value == null || value === '' ? 'Not recorded' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : Array.isArray(value) ? value.join(', ') || 'Not verified' : typeof value === 'object' ? JSON.stringify(value) : String(value)

function ReviewTable({ headings, rows }) {
  if (!rows.length) return null
  return <div className="pipeline-table-scroll"><table className="pipeline-result-table"><thead><tr>{headings.map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table></div>
}

function SourceLinks({ sources, application }) {
  return <div className="pipeline-source-links">{sources.map((source) => <a key={source.policy_id} target="_blank" rel="noreferrer" href={`/underwriting/policies/${encodeURIComponent(source.policy_id)}/source`}><FileText size={15} /><span>{source.policy_name}<small>Version {source.version || 'not specified'}</small></span><ArrowRight size={14} /></a>)}{application.documents?.filter((doc) => doc.object_uri).map((doc) => <a key={doc.document_id} target="_blank" rel="noreferrer" href={`/underwriting/cases/${encodeURIComponent(application.application_id)}/documents/${encodeURIComponent(doc.document_id)}/source`}><FileText size={15} /><span>{doc.name}<small>{doc.state}</small></span><ArrowRight size={14} /></a>)}</div>
}

function StepResult({ step, result, application, PremiumPanel }) {
  const id = step.id
  const pricingMissing = id === 'premium' && result.premium == null
  const riskMissing = id === 'risk' && result.risk_assessment?.score == null
  const outcome = !result.can_continue ? 'Action needed' : pricingMissing ? 'Price unavailable' : riskMissing ? 'Medical review needed' : id === 'recommendation' ? 'Employee decision needed' : result.reviewer_confirmed ? 'Employee reviewed' : 'Processing result'
  const next = {
    application_details: 'Compare these details with the application. Confirm only when they match.',
    documents: result.can_continue ? 'Open the original documents and verify the extracted values before continuing.' : 'Request the missing documents or information listed below. This step cannot continue yet.',
    irdai: 'Check each applicable requirement against its source and application evidence. Continuing records your review; it does not certify compliance.',
    company_policy: 'Check the relevant clauses in the original policy. Eligibility has not been automatically determined.',
    risk: riskMissing ? 'Arrange qualified medical or underwriting review. Continuing records this gap; it does not establish a risk rating.' : 'Verify the assessment basis and unresolved health information before continuing.',
    premium: pricingMissing ? 'Provide the matching product rate configuration and required inputs. Continuing records that pricing is unresolved; it does not produce a quote.' : 'Verify the pricing inputs and calculation. The result is not an approved quote.',
    recommendation: 'Review the recommendation and open issues, then continue to record the employee decision.',
  }[id]
  const sources = application.policy_selection?.policies?.filter((policy) => id === 'irdai' ? policy.policy_kind === 'regulatory' : id === 'company_policy' ? policy.policy_kind === 'company' : false) || []
  const rules = id === 'irdai' ? sources.flatMap((policy) => (policy.extracted_rules?.rules || []).map((rule) => ({ ...rule, policy_name: policy.policy_name }))) : result.policy_outline?.rules || []
  const summary = result.outcome?.summary || (id === 'recommendation' ? result.rationale : pricingMissing ? 'No premium has been calculated. Product pricing rules or required inputs are missing.' : riskMissing ? 'No risk score is available. The available declarations and evidence still need employee review.' : result.summary)
  return <article className="pipeline-result">
    <div className="pipeline-outcome"><span>{outcome}</span>{result.reviewer_confirmed && <small>Employee review recorded</small>}</div>
    <h4>{result.outcome?.title || (id === 'recommendation' ? result.recommendation : result.title || 'What we found')}</h4><p>{summary}</p>
    {result.outcome?.facts?.length > 0 && <dl className="flow-result-facts">{result.outcome.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value || 'Not recorded'}</dd></div>)}</dl>}
    {id === 'application_details' && <ReviewTable headings={['Application detail', 'Submitted value']} rows={Object.entries(result.application || {}).filter(([key]) => key !== 'selected_policy_id').map(([key, value]) => [readable(key), display(value)])} />}
    {id === 'documents' && <>
      <ReviewTable headings={['Required document', 'Received status', 'Original']} rows={(application.documents || []).map((doc) => [doc.name, doc.state, doc.object_uri ? <a href={`/underwriting/cases/${encodeURIComponent(application.application_id)}/documents/${encodeURIComponent(doc.document_id)}/source`} target="_blank" rel="noreferrer">View document</a> : 'Not available'])} />
      {result.extracted_fields?.length > 0 ? <><h5>Information read from documents</h5><ReviewTable headings={['Field', 'Extracted value', 'Source']} rows={result.extracted_fields.map((item) => [readable(item.field), display(item.value), <div>{item.document}{item.source_quote && <details><summary>View supporting text</summary><blockquote>{item.source_quote}</blockquote></details>}</div>])} /></> : <p className="pipeline-gap">No structured values are available. Review the source documents manually.</p>}
      {result.intake_values?.length > 0 && <details className="pipeline-disclosure"><summary>Compare with values entered at intake</summary><ReviewTable headings={['Field', 'Intake value']} rows={result.intake_values.map((item) => [item.field, display(item.value)])} /></details>}
    </>}
    {['irdai', 'company_policy'].includes(id) && <>
      {sources.length > 0 && <div className="pipeline-selected-sources"><h5>Selected sources</h5><SourceLinks sources={sources} application={{}} /></div>}
      {result.evidence_review ? <EvidenceTable review={result.evidence_review} /> : rules.length > 0 && <ReviewTable headings={['Requirement', 'Source rule', 'Review status']} rows={rules.map((rule) => [<strong>{rule.topic || 'Policy rule'}</strong>, <div>{rule.rule_text}{rule.applies_when && <small>Applies when: {rule.applies_when}</small>}{rule.policy_name && <small>{rule.policy_name}</small>}{rule.source_quote && <details><summary>View source wording</summary><blockquote>{rule.source_quote}</blockquote></details>}</div>, 'No evidence comparison saved'])} />}
      {result.checks?.length > 0 && <details className="pipeline-disclosure" open={!rules.length}><summary>Additional regulatory checks ({result.checks.length})</summary><ReviewTable headings={['Requirement', 'Evidence needed', 'Status']} rows={result.checks.map((check) => [check.requirement, check.evidence_needed, readable(check.status)])} /></details>}
      {!rules.length && !result.checks?.length && <p className="pipeline-gap">No rule checklist is available. Review the selected source documents.</p>}
      <p className="pipeline-gap">A listed requirement is a review item, not a passed check.</p>
    </>}
    {id === 'risk' && <>
      {result.risk_assessment && <ReviewTable headings={['Assessment', 'Available result']} rows={[[ 'Risk rating', result.risk_assessment.score == null ? 'Not assessed' : `${result.risk_assessment.band} · ${result.risk_assessment.score}`], ['Assessment basis', result.risk_assessment.basis]]} />}
      {result.medical_declaration && <><h5>Health information to verify</h5><ReviewTable headings={['Declaration', 'Recorded information']} rows={Object.entries(result.medical_declaration).filter(([key]) => key !== 'source_note').map(([key, value]) => [readable(key), value == null ? 'Not verified' : display(value)])} /></>}
      {result.open_evidence_gaps?.length > 0 && <><h5>Unresolved information</h5><ul>{result.open_evidence_gaps.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
    </>}
    {id === 'premium' && <>{result.premium != null && <div className="pipeline-price"><strong>{result.currency} {Number(result.premium).toLocaleString('en-IN')}</strong><span>Indicative amount · not an approved quote</span></div>}{result.premium_calculation && <PremiumPanel calculation={result.premium_calculation} />}</>}
    {id === 'recommendation' && <><h5>Review summary</h5><ReviewTable headings={['Review', 'Recorded outcome']} rows={underwritingSteps.filter((item) => item.id !== 'recommendation').map((item) => {
      const reviewed = application.workflow?.steps?.[item.id]
      const outcome = !reviewed ? 'Not recorded' : item.id === 'premium' && reviewed.premium == null ? 'No premium calculated' : item.id === 'risk' && reviewed.risk_assessment?.score == null ? 'Risk not assessed' : ['irdai', 'company_policy'].includes(item.id) ? 'Checklist reviewed by employee; no automated determination' : 'Employee review recorded'
      return [item.title, outcome]
    })} /><h5>Unresolved information</h5>{result.missing_information?.length ? <ul>{result.missing_information.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p>No missing items are listed in the application record. Review the unresolved risk, pricing, and rule checks above before deciding.</p>}<p className="pipeline-gap">{result.limitations}</p></>}
    {result.findings?.length > 0 && <details className="pipeline-disclosure" open={!result.can_continue || pricingMissing}><summary>Review notes ({result.findings.length})</summary><ul>{result.findings.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
    {!result.completed_at && <p className="flow-muted">{next}</p>}
    <details className="pipeline-disclosure"><summary>Source documents & full review record</summary><SourceLinks sources={sources} application={application} />{result.llm && <div className="pipeline-ai-note"><strong>AI explanation · {result.llm.status === 'completed' ? result.llm.model : 'Unavailable'}</strong><p>{result.llm.summary}</p><ul>{result.llm.findings?.map((finding, i) => <li key={i}>{finding}</li>)}</ul></div>}<details><summary>Technical review record</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></details>
  </article>
}

function EmployeeCheckpoint({ application, pending, busy, saving, onResume, onRetry, onDecision }) {
  const checkpoint = application.workflow?.intervention
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setNote(''); setConfirmed(false); setError('') }, [checkpoint?.result_id])
  const results = application.workflow?.steps || {}
  const openItems = Object.entries(results).flatMap(([step, result]) => (result.outcome?.issues || []).map((text) => ({ step, text })))
  async function record(action) {
    if (!note.trim()) return setError('Add your review note before recording this action.')
    setError('')
    await onDecision(action, note)
  }
  return <section className="employee-checkpoint" aria-labelledby="checkpoint-title">
    <div className="checkpoint-title"><AlertCircle size={22} /><div><span>EMPLOYEE INPUT NEEDED</span><h4 id="checkpoint-title">{checkpoint.title}</h4></div></div>
    <p>{checkpoint.instruction}</p>
    {checkpoint.step === 'risk' && <>
      {openItems.length > 0 && <ul className="checkpoint-open-items">{openItems.map((item, index) => <li key={`${item.step}-${index}`}>{item.text}</li>)}</ul>}
      {['irdai', 'company_policy'].map((stage) => <details className="dashboard-review-details" key={stage}><summary>{stage === 'irdai' ? 'Regulatory' : 'Company'} policy findings · {results[stage]?.evidence_review?.rules?.length || 0} rules</summary><EvidenceTable review={results[stage]?.evidence_review} /></details>)}
    </>}
    <label className="checkpoint-note" htmlFor="checkpoint-note">Your assessment & next action<textarea id="checkpoint-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} disabled={busy || saving} placeholder={checkpoint.step === 'documents' ? 'Record the document values you verified and any discrepancies…' : 'Record your assessment, remaining requirements and any specialist review needed…'} /></label>
    {!checkpoint.blocked && <label className="checkpoint-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy || saving} /><span>{checkpoint.step === 'documents' ? 'I compared the extracted values with the original submitted documents.' : 'I reviewed these findings and recorded my assessment. Any unresolved gaps remain open.'}</span></label>}
    {error && <p className="flow-form-error" role="alert">{error}</p>}
    <div className="checkpoint-actions">{!checkpoint.blocked && <button type="button" className="uw-start-button" disabled={busy || saving || !note.trim() || !confirmed} onClick={() => onResume({ result_id: pending.result_id, note, confirmed })}><Play size={16} />Record review & resume</button>}<button type="button" className="subtle-action" disabled={busy || saving || !note.trim()} onClick={() => record('Request information')}>Request information</button><button type="button" className="subtle-action" disabled={busy || saving || !note.trim()} onClick={() => record('Refer')}>Refer to specialist</button><button type="button" className="subtle-action" disabled={busy || saving} onClick={() => onRetry(pending.result_id)}><RotateCcw size={14} />Run check again</button></div>
  </section>
}

export default function UnderwritingPipeline({ application, result, busy, onRun, onResume, onRetry, onDecision, saving, events = [], PremiumPanel }) {
  const workflow = application.workflow || {}
  const [selected, setSelected] = useState('')
  const current = workflow.current_step || 'application_details'
  const isComplete = current === 'complete'
  const checkpoint = workflow.intervention
  const completed = underwritingSteps.filter((step) => workflow.steps?.[step.id]).length
  const chosen = selected && workflow.steps?.[selected] ? selected : current
  const step = underwritingSteps.find((item) => item.id === chosen) || underwritingSteps[0]
  const pending = workflow.pending_result || result
  const shownResult = chosen === current ? pending : workflow.steps?.[chosen]
  const title = busy ? 'Underwriting is running' : checkpoint ? 'The pipeline needs your input' : 'Continue underwriting'
  if (isComplete) return <UnderwritingDashboard application={application} steps={underwritingSteps} PremiumPanel={PremiumPanel} onDecision={onDecision} saving={saving} renderStep={(item, saved) => <StepResult step={item} result={saved} application={application} PremiumPanel={PremiumPanel} />} />
  return <section className="simple-pipeline automatic-pipeline">
    <header className="flow-header"><div><span className="uw-eyebrow">{busy ? 'PROCESSING APPLICATION' : checkpoint ? 'PAUSED FOR EMPLOYEE' : 'SAVED PIPELINE'}</span><h3>{title}</h3><p>{busy ? 'The agents are working through the selected policies and source documents. You only need to act when a review checkpoint appears.' : checkpoint ? checkpoint.title : 'Run the remaining stages automatically, stopping when your review is needed.'}</p></div>{!busy && !checkpoint && <button type="button" className="uw-start-button" onClick={onRun}><Play size={16} />{workflow.pipeline_status === 'running' ? 'Reconnect / resume' : 'Continue pipeline'}</button>}</header>
    <div className="flow-progress"><div><strong>{completed} of {underwritingSteps.length} stages processed</strong><span>{application.policy_selection?.policies?.length || 0} policies applied · {application.documents?.length || 0} source documents</span></div><progress value={completed} max={underwritingSteps.length} aria-label="Pipeline processing progress" /></div>
    <div className="flow-layout"><nav className="flow-stage-list" aria-label="Underwriting stages">{underwritingSteps.map((item, index) => {
      const saved = workflow.steps?.[item.id]
      const active = current === item.id
      const status = saved ? saved.reviewer_confirmed ? 'Employee reviewed' : 'Processed' : active && busy ? 'Running now' : active && checkpoint ? 'Employee input needed' : active ? 'Ready to run' : 'Queued'
      return <button type="button" key={item.id} className={`${chosen === item.id ? 'is-selected' : ''} ${active && checkpoint ? 'needs-input' : ''}`} aria-current={chosen === item.id ? 'step' : undefined} disabled={!saved && !active} onClick={() => setSelected(active ? '' : item.id)}><span className={saved ? 'stage-processed' : ''}>{saved ? <Check size={16} /> : active && busy ? <LoaderCircle size={16} className="spin" /> : index + 1}</span><div><strong>{item.title}</strong><small>{status}</small>{saved && <em>{saved.outcome?.title || saved.title}</em>}</div></button>
    })}</nav><div className="flow-work-panel">
      {busy && <div className="flow-live" role="status"><LoaderCircle size={20} className="spin" /><div><strong>{underwritingSteps.find((item) => item.id === current)?.title || 'Preparing pipeline'}</strong><p>{events.at(-1)?.message || 'Preparing the next processing stage…'}</p></div></div>}
      {chosen !== current && <button type="button" className="subtle-action flow-return" onClick={() => setSelected('')}>Return to {busy ? 'running stage' : 'current checkpoint'} <ArrowRight size={14} /></button>}
      <div className="pipeline-main"><header><span>Stage {underwritingSteps.indexOf(step) + 1} of {underwritingSteps.length}</span><h3>{step.title}</h3><p>{step.purpose}</p></header>
        {shownResult ? <StepResult step={step} result={shownResult} application={application} PremiumPanel={PremiumPanel} /> : <div className="flow-stage-empty"><FileText size={28} /><h4>{busy ? 'Preparing this stage’s findings' : 'Ready for automatic processing'}</h4><p>{busy ? 'The result will appear here when this stage finishes.' : 'Continue the pipeline to generate and save this result.'}</p></div>}
        {chosen === current && checkpoint && pending && <EmployeeCheckpoint application={application} pending={pending} busy={Boolean(busy)} saving={saving} onResume={onResume} onRetry={onRetry} onDecision={onDecision} />}
      </div>
      {events.length > 0 && <details className="flow-activity"><summary>Run activity · {events.length} updates</summary><ol>{events.map((event, index) => <li key={index}><span>{event.time}</span><p>{event.message}</p></li>)}</ol></details>}
    </div></div>
  </section>
}
