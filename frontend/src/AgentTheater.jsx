import { Check, Database, LoaderCircle } from 'lucide-react'
import { underwritingSteps } from './UnderwritingPipeline'

const agentNames = { intake: 'Data agent', rules: 'Policy agent', risk: 'Risk agent', decision: 'Pricing agent' }

// Shows the agents working: stage status and the yes/no applicant record each stage draws on.
export default function AgentTheater({ application, events = [], busy, compact = false }) {
  const workflow = application.workflow || {}
  const current = workflow.current_step
  const facts = workflow.steps?.intake?.profile_facts || []
  const profile = application.health_profile
  const latest = events.at(-1)?.message
  return <section className={`agent-theater ${compact ? 'is-compact' : ''}`} aria-label="AI underwriting agents">
    <ol className="agent-list">{underwritingSteps.map((step) => {
      const saved = workflow.steps?.[step.id]
      const active = busy && current === step.id
      return <li key={step.id} className={saved ? 'is-done' : active ? 'is-active' : ''}>
        <span className="agent-dot">{saved ? <Check size={14} /> : active ? <LoaderCircle size={14} className="spin" /> : null}</span>
        <div><strong>{agentNames[step.id]}</strong><small>{saved?.outcome?.title || (active ? latest || step.caption : step.caption)}</small></div>
      </li>
    })}</ol>
    <div className="agent-reader">
      <header><strong>{busy && current === 'intake' ? 'Retrieving the applicant data record' : 'Applicant data record'}</strong><span>{profile ? `${profile.data_source || (profile.synthetic ? 'Synthetic data feed' : 'Data feed')} · ${facts.length} answers` : 'Not retrieved yet'}</span></header>
      <div className="agent-docs">{profile && <span className="is-read"><Database size={13} />applicant_health_profile</span>}</div>
      <div className="agent-fields">{facts.map((fact, index) => <div key={fact.key} className="agent-field" style={{ animationDelay: `${index * 40}ms` }}><small>{fact.label}</small><strong>{fact.value}</strong></div>)}</div>
      {busy && latest && <p className="agent-ticker" role="status">{latest}</p>}
    </div>
  </section>
}
