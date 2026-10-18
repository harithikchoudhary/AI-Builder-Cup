import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, Check, FileText, LoaderCircle, Play, RotateCcw } from 'lucide-react'
import UnderwritingDashboard, { EvidenceTable } from './UnderwritingDashboard'
import CaseJourney, { stageIssues } from './CaseJourney'
import HealthReviewPanel from './HealthReviewPanel'

export const underwritingSteps = [
  { id: 'intake', title: 'Retrieve applicant data', caption: 'Is the applicant’s data on file?', purpose: 'Retrieve the applicant’s yes/no verification and health answers from the data feed.', action: 'Retrieve applicant data' },
  { id: 'rules', title: 'Check policy rules', caption: 'Which rules apply to this product?', purpose: 'Match the selected regulatory and company rules against the applicant data. A match is a reference, not an eligibility decision.', action: 'Check regulatory and company rules' },
  { id: 'risk', title: 'Assess health risk', caption: 'Which risk classes fit this applicant?', purpose: 'Review the AI-proposed medical and tobacco classes against the applicant data, then confirm or change them.', action: 'Propose risk classes' },
  { id: 'decision', title: 'Price & recommend', caption: 'What should the employee do next?', purpose: 'Calculate the premium from the confirmed classes and prepare the recommendation for the employee’s decision.', action: 'Price and recommend' },
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
  const premiumResult = result.premium_result || {}
  const pricingMissing = id === 'decision' && premiumResult.premium == null
  const riskMissing = id === 'risk' && result.risk_assessment?.score == null && result.risk_assessment?.status !== 'triage_completed'
  const outcome = result.can_continue === false ? 'Action needed' : pricingMissing ? 'Price unavailable' : riskMissing ? 'Medical review needed' : id === 'decision' ? 'Employee decision needed' : result.reviewer_confirmed ? 'Employee reviewed' : 'Processing result'
  const next = {
    intake: result.can_continue ? 'Confirm the applicant data below is the record you expect for this application.' : 'Add the applicant’s data record, then run this check again. The review cannot continue without it.',
    rules: 'Rule matches are references for the reviewer. Continuing does not certify compliance or eligibility.',
    risk: riskMissing ? 'Confirm or change the proposed classes below. Continuing records this review; it does not establish a risk rating.' : 'Verify the assessment basis and unresolved health information before continuing.',
    decision: pricingMissing ? 'Provide the matching product rate configuration and required inputs. Pricing remains unresolved; this is not a quote.' : 'Review the recommendation, premium and open issues, then record the employee decision.',
  }[id]
  const sources = application.policy_selection?.policies?.filter(() => id === 'rules') || []
  const rules = id === 'rules' ? result.policy_outline?.rules || [] : []
  const comparison = result.evidence_review
  const comparisonSummary = comparison?.rules?.length ? `Compared ${comparison.rules.length} selected rules with the applicant data record. ${comparison.rules.filter((rule) => rule.status === 'evidence_found').length} have supporting data recorded; the rest are reference only. Review the source before deciding whether a requirement is met.` : ''
  const summary = comparisonSummary || result.outcome?.summary || (id === 'decision' ? result.rationale : pricingMissing ? 'No premium has been calculated. Product pricing rules or required inputs are missing.' : riskMissing ? 'No risk score is available. The applicant data still needs employee review.' : result.summary)
  return <article className="pipeline-result">
    <div className="pipeline-outcome"><span>{outcome}</span>{result.reviewer_confirmed && <small>Employee review recorded</small>}</div>
    <span className="finding-label">WHAT WE FOUND</span>
    <h4>{result.outcome?.title || (id === 'decision' ? result.recommendation : result.title || 'What we found')}</h4><p>{summary}</p>
    {result.outcome?.facts?.length > 0 && <dl className="flow-result-facts">{result.outcome.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value || 'Not recorded'}</dd></div>)}</dl>}
    <section className={`finding-action ${stageIssues(id, result).length ? 'needs-attention' : ''}`}><h5>{stageIssues(id, result).length ? 'What needs attention' : 'What happens next'}</h5>{stageIssues(id, result).length > 0 && <ul>{stageIssues(id, result).map((issue, index) => <li key={index}>{issue}</li>)}</ul>}<p>{result.completed_at ? result.reviewer_confirmed ? 'Your review is saved. Any outstanding requirements still need to be resolved before the final decision.' : 'This finding is saved for the employee’s final review.' : next}</p></section>
    <details className="pipeline-disclosure finding-evidence"><summary>View supporting evidence & stage details</summary>
    {id === 'intake' && <>
      <ReviewTable headings={['Application detail', 'Submitted value']} rows={Object.entries(result.application || {}).filter(([key]) => key !== 'selected_policy_id').map(([key, value]) => [readable(key), display(value)])} />
      {result.profile_facts?.length > 0 ? <details className="pipeline-disclosure" open><summary>Applicant data record ({result.profile_facts.length} answers)</summary><ReviewTable headings={['Item', 'Answer']} rows={result.profile_facts.map((fact) => [fact.label, fact.value])} /></details> : <p className="pipeline-gap">No applicant data record is available.</p>}
    </>}
    {id === 'rules' && <>
      {sources.length > 0 && <div className="pipeline-selected-sources"><h5>Selected sources</h5><SourceLinks sources={sources} application={{}} /></div>}
      {result.evidence_review ? <EvidenceTable review={result.evidence_review} /> : rules.length > 0 && <ReviewTable headings={['Requirement', 'Source rule', 'Review status']} rows={rules.map((rule) => [<strong>{rule.topic || 'Policy rule'}</strong>, <div>{rule.rule_text}{rule.applies_when && <small>Applies when: {rule.applies_when}</small>}{rule.policy_name && <small>{rule.policy_name}</small>}{rule.source_quote && <details><summary>View source wording</summary><blockquote>{rule.source_quote}</blockquote></details>}</div>, 'No evidence comparison saved'])} />}
      {result.checks?.length > 0 && <details className="pipeline-disclosure" open={!rules.length}><summary>Additional regulatory checks ({result.checks.length})</summary><ReviewTable headings={['Requirement', 'Evidence needed', 'Status']} rows={result.checks.map((check) => [check.requirement, check.evidence_needed, readable(check.status)])} /></details>}
      {!rules.length && !result.evidence_review?.rules?.length && <p className="pipeline-gap">No rule checklist is available. Review the selected source documents.</p>}
      <p className="pipeline-gap">A listed requirement is a review item, not a passed check.</p>
    </>}
    {id === 'risk' && <>
      {result.risk_assessment && <ReviewTable headings={['Assessment', 'Available result']} rows={[[ 'Risk rating', result.risk_assessment.score == null ? result.risk_assessment.status === 'triage_completed' ? result.risk_assessment.band + ' · product rules' : 'Not assessed' : `${result.risk_assessment.band} · ${result.risk_assessment.score}`], ['Assessment basis', result.risk_assessment.basis]]} />}
      {result.medical_declaration && <><h5>Health information to verify</h5><ReviewTable headings={['Declaration', 'Recorded information']} rows={Object.entries(result.medical_declaration).filter(([key]) => key !== 'source_note').map(([key, value]) => [readable(key), value == null ? 'Not verified' : display(value)])} /></>}
      {result.open_evidence_gaps?.length > 0 && <><h5>Unresolved information</h5><ul>{result.open_evidence_gaps.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
    </>}
    {id === 'decision' && <>{premiumResult.premium != null && <div className="pipeline-price"><strong>{premiumResult.currency} {Number(premiumResult.premium).toLocaleString('en-IN')}</strong><span>{premiumResult.premium_basis === 'ai_estimate' ? 'AI estimate for a referred case · non-binding' : 'Indicative amount · not an approved quote'}</span></div>}{premiumResult.premium_calculation && <PremiumPanel calculation={premiumResult.premium_calculation} />}<h5>Review summary</h5><ReviewTable headings={['Stage', 'Recorded outcome']} rows={underwritingSteps.filter((item) => item.id !== 'decision').map((item) => {
      const reviewed = application.workflow?.steps?.[item.id]
      return [item.title, reviewed?.outcome?.title || reviewed?.title || 'Not recorded']
    })} /><h5>Unresolved information</h5>{result.missing_information?.length ? <ul>{result.missing_information.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p>No missing items are listed in the application record. Review the risk, pricing and rule checks above before deciding.</p>}<p className="pipeline-gap">{result.limitations}</p></>}
    {result.findings?.length > 0 && <details className="pipeline-disclosure" open={!result.can_continue || pricingMissing}><summary>Review notes ({result.findings.length})</summary><ul>{result.findings.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
    </details>
    <details className="pipeline-disclosure"><summary>Source documents & full review record</summary><SourceLinks sources={sources} application={application} />{result.llm && <div className="pipeline-ai-note"><strong>AI explanation · {result.llm.status === 'completed' ? result.llm.model : 'Unavailable'}</strong><p>{result.llm.summary}</p><ul>{result.llm.findings?.map((finding, i) => <li key={i}>{finding}</li>)}</ul></div>}<details><summary>Technical review record</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></details>
  </article>
}

function EmployeeCheckpoint({ application, pending, busy, saving, onResume, onRetry, onDecision, onHealthReview }) {
  const checkpoint = application.workflow?.intervention
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setNote(''); setConfirmed(false); setError('') }, [checkpoint?.result_id])
  const results = application.workflow?.steps || {}
  const openItems = [...Object.entries(results).flatMap(([step, result]) => (result.outcome?.issues || []).map((text) => ({ step, text }))), ...(pending.outcome?.issues || []).map((text) => ({ step: checkpoint.step, text }))]
  async function record(action) {
    if (!note.trim()) return setError('Add your review note before recording this action.')
    setError('')
    await onDecision(action, note)
  }
  return <section className="employee-checkpoint" aria-labelledby="checkpoint-title">
    <div className="checkpoint-title"><AlertCircle size={22} /><div><span>EMPLOYEE INPUT NEEDED</span><h4 id="checkpoint-title">{checkpoint.title}</h4></div></div>
    <p>{checkpoint.instruction}</p>
    <p className="checkpoint-explainer">{checkpoint.blocked ? 'This stage cannot proceed until the missing information is supplied. Add a note and request information, or refer the case.' : 'Review the evidence above, record what you checked, and resume. Recording a review does not close outstanding requirements.'}</p>
    {checkpoint.step === 'risk' && application.insurance_type === 'health' && onHealthReview && <HealthReviewPanel application={application} pending={pending} busy={busy || saving} onSave={onHealthReview} />}
    {checkpoint.step === 'risk' && <>
      {openItems.length > 0 && <ul className="checkpoint-open-items">{openItems.map((item, index) => <li key={`${item.step}-${index}`}>{item.text}</li>)}</ul>}
      <details className="dashboard-review-details"><summary>Policy rule findings · {results.rules?.evidence_review?.rules?.length || 0} rules</summary><EvidenceTable review={results.rules?.evidence_review} /></details>
    </>}
    <label className="checkpoint-note" htmlFor="checkpoint-note">Your assessment & next action<textarea id="checkpoint-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} disabled={busy || saving} placeholder="Record your assessment, remaining requirements and any specialist review needed…" /></label>
    {!checkpoint.blocked && <label className="checkpoint-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy || saving} /><span>I reviewed these findings and recorded my assessment. Any unresolved gaps remain open.</span></label>}
    {error && <p className="flow-form-error" role="alert">{error}</p>}
    <div className="checkpoint-actions">{!checkpoint.blocked && <button type="button" className="uw-start-button" disabled={busy || saving || !note.trim() || !confirmed} onClick={() => onResume({ result_id: pending.result_id, note, confirmed })}><Play size={16} />Save assessment & continue</button>}<button type="button" className="subtle-action" disabled={busy || saving || !note.trim()} onClick={() => record('Request information')}>Request information</button><button type="button" className="subtle-action" disabled={busy || saving || !note.trim()} onClick={() => record('Refer')}>Refer to specialist</button><button type="button" className="subtle-action" disabled={busy || saving} onClick={() => onRetry(pending.result_id)}><RotateCcw size={14} />Run check again</button></div>
  </section>
}

export default function UnderwritingPipeline({ application, result, busy, onRun, onResume, onRetry, onDecision, saving, events = [], PremiumPanel, readOnly = false, onHealthReview }) {
  const workflow = application.workflow || {}
  const [selected, setSelected] = useState('')
  const current = workflow.current_step || 'intake'
  const isComplete = current === 'complete'
  const checkpoint = workflow.intervention
  const completed = underwritingSteps.filter((step) => workflow.steps?.[step.id]).length
  const chosen = selected && workflow.steps?.[selected] ? selected : current
  const step = underwritingSteps.find((item) => item.id === chosen) || underwritingSteps[0]
  const pending = workflow.pending_result || result
  const shownResult = chosen === current ? pending : workflow.steps?.[chosen]
  const title = readOnly ? 'Saved underwriting review' : busy ? 'We’re reviewing this application' : checkpoint ? 'Your review is needed' : 'Ready to continue the review'
  if (isComplete) return <UnderwritingDashboard application={application} steps={underwritingSteps} PremiumPanel={PremiumPanel} onDecision={onDecision} saving={saving} readOnly={readOnly} renderStep={(item, saved) => <StepResult step={item} result={saved} application={application} PremiumPanel={PremiumPanel} />} />
  return <section className="simple-pipeline automatic-pipeline">
    <header className="flow-header"><div><span className="uw-eyebrow">{readOnly ? 'HISTORICAL REVIEW' : busy ? 'PROCESSING APPLICATION' : checkpoint ? 'PAUSED FOR EMPLOYEE' : 'SAVED PIPELINE'}</span><h3>{title}</h3><p>{busy ? 'The agents are working. You only need to act when a checkpoint appears.' : readOnly ? 'Archived record, preserved as it was when regenerated.' : checkpoint ? checkpoint.title : 'Run the remaining stages.'}</p></div>{!readOnly && !busy && !checkpoint && <button type="button" className="uw-start-button" onClick={onRun}><Play size={16} />{workflow.pipeline_status === 'running' ? 'Reconnect / resume' : 'Continue pipeline'}</button>}</header>
    <CaseJourney application={application} steps={underwritingSteps} current={current} busy={busy} />
    <div className="flow-progress"><div><strong>{completed} of {underwritingSteps.length} stages processed</strong><span>{application.policy_selection?.policies?.length || 0} policies applied · data record {application.health_profile ? 'on file' : 'missing'}</span></div><progress value={completed} max={underwritingSteps.length} aria-label="Pipeline processing progress" /></div>
    <div className="flow-layout"><nav className="flow-stage-list" aria-label="Underwriting stages">{underwritingSteps.map((item, index) => {
      const saved = workflow.steps?.[item.id]
      const active = current === item.id
      const needsAttention = saved && stageIssues(item.id, saved).length > 0
      const status = saved ? needsAttention ? 'Open requirements' : saved.reviewer_confirmed ? 'Employee reviewed' : 'Findings saved' : active && busy ? 'Running now' : active && readOnly ? 'Unfinished when archived' : active && checkpoint ? 'Employee input needed' : active ? 'Ready to run' : 'Queued'
      return <button type="button" key={item.id} className={`${chosen === item.id ? 'is-selected' : ''} ${active && checkpoint ? 'needs-input' : ''} ${needsAttention ? 'has-open-requirements' : ''}`} aria-current={chosen === item.id ? 'step' : undefined} disabled={!saved && !active} onClick={() => setSelected(active ? '' : item.id)}><span className={saved ? 'stage-processed' : ''}>{saved ? needsAttention ? <AlertCircle size={16} /> : <Check size={16} /> : active && busy ? <LoaderCircle size={16} className="spin" /> : index + 1}</span><div><strong>{item.title}</strong><small>{status}</small><p className="stage-question">{item.caption}</p>{saved && <em>{saved.outcome?.title || saved.title}</em>}</div></button>
    })}</nav><div className="flow-work-panel">
      {busy && <div className="flow-live" role="status"><LoaderCircle size={20} className="spin" /><div><strong>{underwritingSteps.find((item) => item.id === current)?.title || 'Preparing pipeline'}</strong><p>{events.at(-1)?.message || 'Preparing the next processing stage…'}</p></div></div>}
      {chosen !== current && <button type="button" className="subtle-action flow-return" onClick={() => setSelected('')}>Return to {busy ? 'running stage' : 'current checkpoint'} <ArrowRight size={14} /></button>}
      <div className="pipeline-main"><header><span>Stage {underwritingSteps.indexOf(step) + 1} of {underwritingSteps.length}</span><h3>{step.title}</h3><p>{step.purpose}</p></header>
        {shownResult ? <StepResult step={step} result={shownResult} application={application} PremiumPanel={PremiumPanel} /> : <div className="flow-stage-empty"><FileText size={28} /><h4>{readOnly ? 'This stage had no saved findings' : busy ? 'Preparing this stage’s findings' : 'Ready for automatic processing'}</h4><p>{readOnly ? 'This run was archived before the stage finished. View the active run to continue underwriting.' : busy ? 'The result will appear here when this stage finishes.' : 'Continue the pipeline to generate and save this result.'}</p></div>}
        {!readOnly && chosen === current && checkpoint && pending && <EmployeeCheckpoint application={application} pending={pending} busy={Boolean(busy)} saving={saving} onResume={onResume} onRetry={onRetry} onDecision={onDecision} onHealthReview={onHealthReview} />}
      </div>
      {events.length > 0 && <details className="flow-activity"><summary>Technical activity · {events.length} updates</summary><ol>{events.map((event, index) => <li key={index}><span>{event.time}</span><p>{event.message}</p></li>)}</ol></details>}
    </div></div>
  </section>
}
