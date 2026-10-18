import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, FileText, LoaderCircle, Play, ScrollText, ShieldCheck } from 'lucide-react'
import AgentTheater from './AgentTheater'
import AiRiskProposal from './AiRiskProposal'
import { PriceBuildUp, PriceScenarios, RiskDriverChart } from './BriefCharts'
import { DecisionPanel, money, unresolvedRequirements } from './UnderwritingDashboard'
import { caseOutcome, readableClass, reasonsFor, riskProposal } from './caseSummary'

const sourceUrl = (application, documentId) => `/underwriting/cases/${encodeURIComponent(application.application_id)}/documents/${encodeURIComponent(documentId)}/source`

function EvidenceChip({ application, item }) {
  const linked = item.document_id && application.documents?.some((doc) => doc.document_id === item.document_id && doc.object_uri)
  const label = <><FileText size={12} />{item.source}{item.field ? ` · ${item.field}` : ''}: {item.value}</>
  return <li>{linked ? <a href={sourceUrl(application, item.document_id)} target="_blank" rel="noreferrer" title={item.quote || undefined}>{label}</a> : <span title={item.quote || undefined}>{label}</span>}</li>
}

function StartCard({ application, busy, onStart, onOpenPolicies }) {
  const policies = application.policy_selection?.policies || []
  const ready = policies.some((p) => p.policy_kind === 'company') && policies.some((p) => p.policy_kind === 'regulatory')
  return <section className="brief-hero is-start"><div><span className="uw-eyebrow"><ShieldCheck size={14} /> READY FOR AI UNDERWRITING</span>
    <h3>Let the agents retrieve the applicant record and prepare a recommendation.</h3>
    <p>They pull the yes/no applicant data, check your policies, propose a risk class, and price it. You confirm the risk class once, then decide.</p></div>
    <div className="brief-hero-actions">
      <button type="button" className="uw-start-button" disabled={!ready || busy} onClick={onStart}>{busy ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}Run underwriting agents</button>
      {!ready && <button type="button" className="subtle-action" onClick={onOpenPolicies}><ScrollText size={15} />Select policies first</button>}
    </div></section>
}

function BlockedCheck({ pending, onOpenAudit }) {
  const issues = pending.outcome?.issues || []
  return <section className="brief-hero is-action"><div><span className="uw-eyebrow"><AlertCircle size={14} /> YOUR INPUT</span><h3>Something is missing before the agents can continue</h3>
    {issues.length > 0 && <ul className="brief-issues">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</div>
    <div className="brief-hero-actions"><button type="button" className="subtle-action" onClick={onOpenAudit}>Open audit trail <ArrowRight size={14} /></button></div></section>
}

function RiskCheck({ application, pending, busy, onHealthReview, onResume, onOpenAudit }) {
  const inputs = application.health_rating_inputs
  const recorded = inputs?.confirmed && pending.risk_assessment?.status === 'triage_completed'
  if (recorded) return <section className="brief-hero is-action"><div><span className="uw-eyebrow"><ShieldCheck size={14} /> CLASSIFICATION RECORDED</span><h3>{readableClass(inputs.medical_class)} · {readableClass(inputs.tobacco_status)}</h3><p>Continue to pricing and the recommendation.</p></div>
    <div className="brief-hero-actions"><button type="button" className="uw-start-button" disabled={busy} onClick={() => onResume({ result_id: pending.result_id, note: inputs.review_note, confirmed: true })}><Play size={16} />Continue to pricing</button></div></section>
  return <>
    <AiRiskProposal proposal={pending.risk_proposal} pending={pending} busy={busy} onAccept={(payload) => onHealthReview(payload, true)} />
    <p className="brief-manual">Prefer to classify it yourself? <button type="button" className="link-button" onClick={onOpenAudit}>Open the manual assessment <ArrowRight size={13} /></button></p>
  </>
}

function useRateTables(application, enabled) {
  const [tables, setTables] = useState(null)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetch(`/underwriting/cases/${encodeURIComponent(application.application_id)}/health-review`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null).then((body) => setTables(body?.product?.config?.rate_tables || null)).catch(() => {})
    return () => controller.abort()
  }, [application.application_id, enabled])
  return tables
}

function Verdict({ application, proposal, onOpenAudit }) {
  const steps = application.workflow?.steps || {}
  const recommendation = steps.decision || {}
  const premium = recommendation.premium_result || {}
  const estimated = premium.premium_basis === 'ai_estimate'
  const outcome = caseOutcome(application)
  const gaps = unresolvedRequirements(application)
  return <section className={`brief-verdict tone-${outcome.tone}`}>
    <div className="brief-verdict-main"><span className="brief-chip">{outcome.label}</span><h3>{recommendation.recommendation || 'Employee review required'}</h3><p>{recommendation.rationale || proposal?.summary}</p>
      {gaps.length > 0 && <details className="brief-open-items"><summary>{gaps.length} {gaps.length === 1 ? 'item' : 'items'} still open</summary><ul>{gaps.map((text) => <li key={text}>{text}</li>)}</ul><button type="button" className="link-button" onClick={onOpenAudit}>Resolve in audit trail <ArrowRight size={13} /></button></details>}</div>
    <div className="brief-premium"><small>{estimated ? 'AI-estimated annual premium' : 'Annual premium before tax'}</small><strong>{premium.premium == null ? 'Not calculated' : money(premium.premium, premium.currency)}</strong><small>{estimated ? `Standard rate + ${premium.ai_estimate.loading_pct}% medical loading · non-binding, pending specialist review` : premium.premium == null ? 'Needs a confirmed risk class' : 'Indicative · not an issued quote'}</small></div>
  </section>
}

function PremiumWhy({ premium }) {
  const estimate = premium.ai_estimate
  const calculation = premium.premium_calculation || {}
  const text = estimate ? estimate.rationale : calculation.pricing_ai?.explanation
  if (premium.premium == null || !text) return null
  const formula = estimate ? estimate.formula : calculation.formula
  const model = estimate ? estimate.model : calculation.pricing_ai.model
  return <section className="brief-reasons brief-premium-why"><h4>How this premium was worked out</h4>
    <p>{text}</p>
    {estimate?.factors?.length > 0 && <ul>{estimate.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul>}
    {formula && <p className="brief-formula"><strong>Calculation:</strong> {formula}</p>}
    <small>{estimate ? 'AI estimate for a referred case · non-binding, pending specialist underwriting' : 'Rate-table calculation checked by AI against the product grid'} · {model}</small></section>
}

function Reasons({ application, proposal }) {
  const reasons = reasonsFor(proposal)
  if (!reasons.length) return null
  return <section className="brief-reasons"><h4>Why this recommendation</h4><ol>{reasons.map((reason) => <li key={reason.title} className={`effect-${reason.effect}`}><strong>{reason.title}</strong><p>{reason.text}</p>{reason.evidence?.length > 0 && <ul>{reason.evidence.map((item) => <EvidenceChip key={item.id} application={application} item={item} />)}</ul>}</li>)}</ol>
    {proposal?.employee_action && <small>AI proposal by {proposal.model} · {proposal.employee_action === 'accepted' ? 'confirmed by the employee' : 'adjusted by the employee'}</small>}</section>
}

export default function CaseBrief({ application, pending, busy, saving, events, onStart, onResume, onDecision, onHealthReview, onOpenPolicies, onOpenAudit }) {
  const workflow = application.workflow || {}
  const checkpoint = workflow.intervention
  const complete = workflow.current_step === 'complete'
  const result = workflow.pending_result || pending
  const premium = workflow.steps?.decision?.premium_result?.premium_calculation
  const tables = useRateTables(application, complete && Boolean(premium))
  const proposal = riskProposal(application, result)
  const working = Boolean(busy)
  if (!workflow.started_at) return <StartCard application={application} busy={working} onStart={onStart} onOpenPolicies={onOpenPolicies} />
  return <div className="case-brief">
    {(working || !complete) && <AgentTheater application={application} events={events} busy={working} compact={complete} />}
    {!working && checkpoint && result && (checkpoint.step === 'risk' ? <RiskCheck application={application} pending={result} busy={saving} onHealthReview={onHealthReview} onResume={onResume} onOpenAudit={onOpenAudit} />
      : <BlockedCheck pending={result} onOpenAudit={onOpenAudit} />)}
    {!working && !checkpoint && !complete && <section className="brief-hero is-action"><div><h3>The review stopped before finishing</h3><p>Resume from the saved stage.</p></div><div className="brief-hero-actions"><button type="button" className="uw-start-button" onClick={onStart}><Play size={16} />Resume</button></div></section>}
    {complete && <>
      <Verdict application={application} proposal={proposal} onOpenAudit={onOpenAudit} />
      <Reasons application={application} proposal={proposal} />
      <PremiumWhy premium={workflow.steps?.decision?.premium_result || {}} />
      <div className="brief-charts"><RiskDriverChart drivers={proposal?.drivers} /><PriceBuildUp calculation={premium} /></div>
      <PriceScenarios calculation={premium} tables={tables} />
      <DecisionPanel application={application} onDecision={onDecision} saving={saving} />
    </>}
  </div>
}
