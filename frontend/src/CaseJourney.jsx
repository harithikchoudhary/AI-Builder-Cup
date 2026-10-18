import { AlertCircle, FileText } from 'lucide-react'

export function stageIssues(id, result = {}) {
  const issues = [...(result.outcome?.issues || [])]
  if (id === 'decision' && result.premium_result?.premium == null && !issues.length) issues.push('No premium is available. Product rates and a confirmed risk class are needed.')
  if (id === 'risk' && result.risk_assessment?.score == null && result.risk_assessment?.status !== 'triage_completed' && !issues.length) issues.push('A qualified medical or underwriting assessment is still required.')
  if (id === 'decision') issues.push(...(result.missing_information || []))
  if (result.can_continue === false && !issues.length) issues.push(...(result.findings || ['Required information must be supplied before continuing.']))
  return [...new Set(issues.filter(Boolean))]
}

export default function CaseJourney({ application, steps, current, busy, complete = false }) {
  const results = application.workflow?.steps || {}
  const policies = application.policy_selection?.policies || []
  const amount = application.application_details?.sum_insured_inr
  return <section className="case-journey" aria-label="Application review overview">
    <div className="journey-applicant"><FileText size={22} /><div><strong>{application.applicant}</strong><p>{application.plan || 'Product not recorded'}{amount != null && ` · ₹${Number(amount).toLocaleString('en-IN')} requested cover`}</p><small>{application.application_id} · {application.health_profile ? 'applicant data on file' : 'no applicant data'} · {policies.length} selected policies</small></div></div>
    <ol className="journey-roadmap"><li><span>1</span><div><strong>Prepare the case</strong><small>Application, applicant data record and selected policies</small></div></li><li aria-current={!complete ? 'step' : undefined}><span>2</span><div><strong>Review the evidence</strong><small>{complete ? 'Findings saved for each stage' : 'Automatic checks; employee reviews exceptions'}</small></div></li><li aria-current={complete ? 'step' : undefined}><span>3</span><div><strong>Make the decision</strong><small>Recommendation, premium and employee rationale</small></div></li></ol>
    {complete && <div className="journey-results"><h4>What did the review establish?</h4><p>Read the outcome of each stage below. Saved findings and employee reviews do not mean that every requirement passed.</p><div className="pipeline-table-scroll"><table className="pipeline-result-table"><thead><tr><th scope="col">Review</th><th scope="col">Finding</th><th scope="col">Next action</th></tr></thead><tbody>{steps.map((step) => {
      const result = results[step.id]
      const issues = result ? stageIssues(step.id, result) : []
      return <tr key={step.id}><td><strong>{step.title}</strong></td><td>{result ? result.outcome?.title || result.recommendation || result.title || 'Findings saved; open the review record below.' : 'Not recorded'}</td><td>{!result ? 'Run this stage before deciding.' : issues.length ? <><span className="flow-badge attention"><AlertCircle size={12} /> Attention needed</span><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></> : result.reviewer_confirmed ? 'Review recorded; include it in your decision.' : step.id === 'decision' ? 'Record the employee decision below.' : 'Review supporting evidence before deciding.'}</td></tr>
    })}</tbody></table></div></div>}
    {!complete && <p className="journey-now" role="status"><strong>{busy ? 'Working now: ' : application.workflow?.intervention ? 'Waiting for you: ' : 'Next: '}</strong>{steps.find((step) => step.id === current)?.caption || 'Prepare this application for review.'}<span>Final outcome: an evidence-backed recommendation for the employee.</span></p>}
  </section>
}
