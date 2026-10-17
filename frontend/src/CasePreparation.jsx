import { useEffect, useState } from 'react'
import ApplicantDeclaration from './ApplicantDeclaration'
import { underwritingSteps } from './UnderwritingPipeline'
import { ArrowRight, Check, Download, ExternalLink, FileText, Layers3, Play, ScrollText, ShieldCheck, X } from 'lucide-react'

export function readWorkspaceRoute() {
  const parts = window.location.hash.slice(1).split('/').filter(Boolean)
  const view = ['underwriting', 'policies', 'ask'].includes(parts[0]) ? parts[0] : 'underwriting'
  return { view, applicationId: ['underwriting', 'policies'].includes(view) ? decodeURIComponent(parts[1] || '') : '', panel: parts[2] === 'pipeline' ? 'pipeline' : 'overview' }
}

export function writeWorkspaceRoute(view, applicationId = '', panel = 'overview') {
  const hash = `#${view}${applicationId ? `/${encodeURIComponent(applicationId)}${panel === 'pipeline' ? '/pipeline' : ''}` : ''}`
  if (window.location.hash !== hash) window.history.pushState(null, '', hash)
}

export function ApplicationOverview({ application, onOpenPolicies, onOpenPipeline }) {
  const details = application.application_details || {}
  const policies = application.policy_selection?.policies || []
  const facts = [
    ['Applicant', application.applicant], ['Date of birth', application.date_of_birth],
    ['Insurance type', application.insurance_type || 'health'], ['Product', application.plan],
    ['Product code', application.product_code], ['Received', new Date(application.received_at).toLocaleString()],
    ['Submission channel', application.submission_channel || 'Application intake'],
    ['Cover requested', details.sum_insured_inr ? `INR ${Number(details.sum_insured_inr).toLocaleString('en-IN')}` : 'Not recorded'],
  ]
  return <div className="case-overview-grid">
    <section className="case-panel"><div className="case-panel-heading"><FileText size={18} /><h3>Application details</h3></div><dl className="case-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl><ApplicantDeclaration details={details} /></section>
    <section className="case-panel"><div className="case-panel-heading"><ScrollText size={18} /><h3>Policies for this review</h3><span>{policies.length} selected</span></div>{policies.length ? <ul className="case-policy-summary">{policies.map((policy) => <li key={policy.policy_id}><Check size={15} /><div><strong>{policy.policy_name}</strong><small>{policy.policy_kind === 'company' ? 'Company policy' : 'Regulatory source'} · Version {policy.version || 'not specified'}</small></div></li>)}</ul> : <p className="case-muted">Choose the company and regulatory policies to check against this application before starting underwriting.</p>}<button type="button" className="subtle-action" onClick={onOpenPolicies}><ScrollText size={15} /> {application.workflow?.started_at ? 'View applied policies' : 'Select policies'} <ArrowRight size={15} /></button></section>
    <section className="case-panel case-panel-wide"><div className="case-panel-heading"><Layers3 size={18} /><h3>Submitted documents</h3><span>{application.documents?.length || 0} documents</span></div><div className="case-document-list">{application.documents?.length ? application.documents.map((doc) => <div key={doc.document_id}><FileText size={18} /><div><strong>{doc.name}</strong><small>{doc.state} · {doc.page_count == null ? 'Extraction pending' : `${doc.page_count} pages`}</small></div>{doc.object_uri && <a href={`/underwriting/cases/${encodeURIComponent(application.application_id)}/documents/${encodeURIComponent(doc.document_id)}/source`} target="_blank" rel="noreferrer">View document <ArrowRight size={14} /></a>}</div>) : <p className="case-muted">No documents have been attached to this application.</p>}</div></section>
    <div className="case-next-action"><div><strong>Continue to underwriting setup</strong><p>Review the selected policies, then start the seven-step pipeline.</p></div><button type="button" className="uw-start-button" onClick={onOpenPipeline}>Open pipeline <ArrowRight size={16} /></button></div>
  </div>
}

export function PipelinePreparation({ application, readiness, busy, onOpenPolicies, onStart }) {
  const policies = application.policy_selection?.policies || []
  const company = policies.filter((item) => item.policy_kind === 'company')
  const regulatory = policies.filter((item) => item.policy_kind === 'regulatory')
  const ready = company.length > 0 && regulatory.length > 0
  const guide = <section className="pipeline-setup-guide"><h4>What happens after you start?</h4><p>Start once. The agents process each stage automatically and save their findings. The pipeline pauses for document verification and a combined policy and medical review when employee input is needed.</p><ol>{underwritingSteps.map((step) => <li key={step.id}><strong>{step.title}</strong><span>{step.caption}</span></li>)}</ol><p><strong>Finish with one decision dashboard.</strong> See the applicant, applied policies, evidence findings, premium, open requirements and recommendation together. You make the final decision; unresolved information stays visible.</p></section>
  return <section className="case-panel pipeline-preparation"><span className="uw-eyebrow"><ShieldCheck size={15} /> UNDERWRITING SETUP</span><h3>Choose what this application will be checked against.</h3><p>Apply the relevant company policies and regulatory sources. Their versions are saved with the application and locked when the pipeline starts.</p><div className="pipeline-setup-checks"><div className={company.length ? 'complete' : ''}><span>{company.length ? <Check size={18} /> : '1'}</span><div><strong>Company policies</strong><small>{company.length ? `${company.length} selected for ${application.product_code}` : 'Select the matching insurer and product rules.'}</small></div></div><div className={regulatory.length ? 'complete' : ''}><span>{regulatory.length ? <Check size={18} /> : '2'}</span><div><strong>Regulatory sources</strong><small>{regulatory.length ? `${regulatory.length} selected for ${application.insurance_type}` : 'Select the requirements applicable to this insurance type.'}</small></div></div></div>{policies.length > 0 && <ul className="case-policy-summary">{policies.map((policy) => <li key={policy.policy_id}><ScrollText size={15} /><div><strong>{policy.policy_name}</strong><small>{policy.policy_kind} · Version {policy.version || 'not specified'}</small></div></li>)}</ul>}{guide}<div className="pipeline-setup-actions"><button type="button" className="subtle-action" onClick={onOpenPolicies}><ScrollText size={16} /> {policies.length ? 'Change selected policies' : 'Select policies'} <ArrowRight size={15} /></button><button type="button" className="uw-start-button" disabled={!ready || !readiness?.ready || busy} onClick={onStart}><Play size={16} /> {busy ? 'Starting…' : 'Start underwriting pipeline'}</button></div>{!ready && <p className="case-setup-hint">Select at least one company policy and one regulatory source to continue. You can upload a new policy from the policy library.</p>}{!readiness?.ready && <p className="case-setup-hint">Document processing setup is incomplete: {!readiness?.document_ai_configured ? 'OCR processor' : ''}{!readiness?.document_ai_configured && !readiness?.private_document_bucket_configured ? ' and ' : ''}{!readiness?.private_document_bucket_configured ? 'private application document storage' : ''}. Contact the workspace administrator.</p>}</section>
}

function policyStatus(policy) {
  const today = new Date().toISOString().slice(0, 10)
  if (policy.effective_to && policy.effective_to.slice(0, 10) < today) return 'Expired'
  if (policy.effective_from && policy.effective_from.slice(0, 10) > today) return 'Scheduled'
  if (!Array.isArray(policy.extracted_rules?.rules) || !policy.extracted_rules.rules.length) return 'Needs review'
  return 'In library'
}

function policyCaseUse(policy, application) {
  if (!application) return policy.product_code ? 'Product mapped' : 'Needs mapping'
  if ((policy.insurance_type || '').toLowerCase() !== (application.insurance_type || 'health').toLowerCase()) return 'Not applicable'
  if (policy.policy_kind === 'company') {
    if (!policy.product_code) return 'Needs mapping'
    if (policy.product_code.toUpperCase() !== (application.product_code || '').toUpperCase()) return 'Not applicable'
  }
  return 'Applicable'
}

function displayDate(value) {
  if (!value) return null
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function PolicyDetailsPanel({ policy, application, selected, onClose }) {
  const [source, setSource] = useState(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [showSourceText, setShowSourceText] = useState(false)
  const rules = Array.isArray(policy.extracted_rules?.rules) ? policy.extracted_rules.rules : []
  const status = policyStatus(policy)
  const kind = policy.policy_kind === 'regulatory' ? 'Regulatory source' : 'Company policy'
  const sourceMetadata = policy.extracted_rules?.source_metadata || {}
  const isPdf = (policy.source_mime_type || '').toLowerCase().includes('pdf')

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
  }, [sourceUrl])

  async function loadSource() {
    setSourceLoading(true)
    setSourceError('')
    try {
      const response = await fetch(`/underwriting/policies/${encodeURIComponent(policy.policy_id)}/source`)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail || `Could not load the original source (${response.status}).`)
      }
      const blob = await response.blob()
      if ((blob.type || policy.source_mime_type || '').toLowerCase().includes('pdf')) {
        const url = URL.createObjectURL(blob)
        setSourceUrl(url)
        setSource({ kind: 'pdf', url })
      } else {
        const content = await blob.text()
        setSource({ kind: 'text', content: content.slice(0, 250000), truncated: content.length > 250000 })
      }
    } catch (error) {
      setSourceError(error.message)
    } finally {
      setSourceLoading(false)
    }
  }

  async function toggleSourceCode() {
    if (source?.kind === 'text') {
      setShowSourceText((visible) => !visible)
      return
    }
    setShowSourceText(true)
    await loadSource()
  }

  const fields = [
    ['Policy category', kind],
    ['Insurance type', policy.insurance_type],
    ['Insurer', policy.insurer_name],
    ['Product', policy.product_name],
    ['Product code', policy.product_code],
    ['UIN / reference', policy.uin],
    ['Jurisdiction', policy.jurisdiction || sourceMetadata.jurisdiction],
  ]
  const effective = policy.effective_from || policy.effective_to
    ? `${displayDate(policy.effective_from) || 'Start date not recorded'} – ${displayDate(policy.effective_to) || 'No end date recorded'}`
    : 'Effective dates not recorded'

  return <div className="policy-details-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="policy-details-panel" role="dialog" aria-modal="true" aria-labelledby="policy-details-title">
      <header className="policy-details-heading">
        <div><span className="block-label"><ScrollText size={15} /> POLICY DETAILS</span><h2 id="policy-details-title">{policy.policy_name}</h2><p>{kind} · {policy.version || policy.uin || 'Version/reference not recorded'}</p></div>
        <div className="policy-details-header-actions">
          <button type="button" className="policy-details-close" onClick={onClose} aria-label="Close policy details"><X size={19} /></button>
        </div>
      </header>
      <div className="policy-details-content">
        <div className="policy-details-main">
        <section className="policy-details-section">
          <h3>Overview</h3>
          <dl className="policy-details-grid">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl>
        </section>
        <section className="policy-details-section">
          <h3>Applicability</h3>
          <p><strong>{policyCaseUse(policy, application)}</strong></p>
          {application && <p><strong>Case selection:</strong> {selected ? 'Selected' : 'Not selected'}</p>}
          {application
            ? <p>{policy.policy_kind === 'regulatory'
                ? `This regulatory source is listed for ${application.insurance_type || 'health'} insurance.`
                : policy.product_code
                  ? `Product code ${policy.product_code} ${policy.product_code.toUpperCase() === (application.product_code || '').toUpperCase() ? 'matches' : 'does not match'} this application (${application.product_code || 'not recorded'}).`
                  : 'No product code or other applicability mapping is recorded, so an underwriter must verify whether this policy belongs in the review.'}</p>
            : <p>{policy.product_code
                ? `Mapped to ${policy.product_name || policy.product_code}; open an application to verify the match.`
                : 'No product code or applicability mapping is recorded.'}</p>}
          {rules.some((rule) => rule.applies_when || rule.condition) && <ul>{rules.filter((rule) => rule.applies_when || rule.condition).map((rule, index) => <li key={index}><strong>{rule.topic || `Rule ${index + 1}`}:</strong> {rule.applies_when || rule.condition}</li>)}</ul>}
        </section>
        <section className="policy-details-section">
          <h3>Rules & required evidence <span>{rules.length}</span></h3>
          {rules.length ? <div className="policy-detail-rules">{rules.map((rule, index) => <article key={index}>
            <h4>{rule.topic || `Rule ${index + 1}`}</h4>
            <p>{rule.rule_text || rule.description || rule.text || 'Rule description not recorded.'}</p>
            <dl><div><dt>When it applies</dt><dd>{rule.condition || rule.applies_when || 'Not specified'}</dd></div>
              <div><dt>Required evidence</dt><dd>{Array.isArray(rule.required_evidence) && rule.required_evidence.length ? rule.required_evidence.join(', ') : 'Not specified'}</dd></div>
              <div><dt>Outcome / action</dt><dd>{rule.action || 'Not specified'}</dd></div>
              <div><dt>Source</dt><dd>{rule.source_pointer || (rule.source_quote ? 'Source wording included' : 'Review original source')}</dd></div></dl>
            {rule.source_quote && <details><summary>View cited wording</summary><blockquote>{rule.source_quote}</blockquote></details>}
          </article>)}</div> : <p>No structured rules are recorded. Review the source before using this policy.</p>}
        </section>
        <section className="policy-details-section">
          <h3>Governance</h3>
          <dl className="policy-details-grid"><div><dt>Catalog status</dt><dd><span className={`policy-status-pill ${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span>{status === 'In library' && <small>Available in the catalog; this is not an approval record.</small>}</dd></div><div><dt>Effective</dt><dd>{effective}</dd></div><div><dt>Owner</dt><dd>{policy.created_by || 'Not recorded'}</dd></div><div><dt>Added to library</dt><dd>{policy.created_at ? new Date(policy.created_at).toLocaleString() : 'Not recorded'}</dd></div><div><dt>Policy ID</dt><dd>{policy.policy_id}</dd></div></dl>
          <p>Approval status and change history are not recorded in the current catalog.</p>
          {application?.workflow?.started_at && selected && <p className="policy-lock-note"><ShieldCheck size={15} /> This version is fixed for the active assessment. Updated library versions can be selected for a new assessment.</p>}
        </section>
        </div>
        <aside className="policy-details-source">
          <span className="block-label"><FileText size={14} /> ORIGINAL SOURCE</span>
          <strong className="policy-source-filename">{policy.source_filename || 'Source document not recorded'}</strong>
          <dl className="policy-source-metadata">
            <div><dt>Type</dt><dd>{policy.source_mime_type || 'Not recorded'}</dd></div>
            <div><dt>Reference</dt><dd>{policy.uin || sourceMetadata.circular_number || 'Not recorded'}</dd></div>
            <div><dt>Extraction</dt><dd>{policy.extraction_model || policy.extracted_rules?.analysis_method || 'Not recorded'}</dd></div>
          </dl>
          <div className="policy-source-actions">
            <a className="policy-source-header-button" href={`/underwriting/policies/${encodeURIComponent(policy.policy_id)}/source`} download={policy.source_filename || 'policy-source'}><Download size={15} /> Download original</a>
            {!isPdf && <div className="policy-source-tooltip-host">
              <button type="button" className="policy-source-header-button" aria-expanded={source?.kind === 'text' && showSourceText} aria-describedby={`source-tooltip-${policy.policy_id}`} onClick={toggleSourceCode} disabled={sourceLoading}>
                <FileText size={15} /> {sourceLoading ? 'Loading source code…' : source?.kind === 'text' && showSourceText ? 'Hide source code' : 'View source code'}
              </button>
              <div className="policy-source-tooltip" id={`source-tooltip-${policy.policy_id}`} role="tooltip">
                <strong>{policy.source_filename || 'Source document not recorded'}</strong>
                <span><b>Type</b>{policy.source_mime_type || 'Not recorded'}</span>
                <span><b>Reference</b>{policy.uin || sourceMetadata.circular_number || 'Not recorded'}</span>
                <span><b>Extraction</b>{policy.extraction_model || policy.extracted_rules?.analysis_method || 'Not recorded'}</span>
              </div>
            </div>}
          </div>
          {sourceError && <p className="error-panel" role="alert">{sourceError}</p>}
          {source?.kind === 'pdf' && <iframe className="policy-source-preview" title={`Original policy source: ${policy.source_filename}`} src={source.url} />}
          {source?.kind === 'text' && showSourceText && <div className="policy-source-code-actions">
            {source.truncated && <p>Preview limited to the first 250,000 characters.</p>}
            <pre className="policy-source-text">{source.content}</pre>
          </div>}
        </aside>
      </div>
    </section>
  </div>
}

export function PolicyLibraryTable({ policies, allPolicies = policies, selectedIds, onToggle, onSelectVisible, application, locked = false, loading = false, emptyMessage }) {
  const [detailsPolicy, setDetailsPolicy] = useState(null)
  const selectablePolicies = policies.filter((policy) => !application || policy.policy_kind !== 'company' || Boolean(policy.product_code))
  const allSelected = selectablePolicies.length > 0 && selectablePolicies.every((policy) => selectedIds.includes(policy.policy_id))
  if (loading) return <p className="case-table-state">Loading policy library…</p>
  if (!policies.length) return <p className="case-table-state">{emptyMessage || 'No matching policies. Add a source document to make it available for this insurance type.'}</p>
  return <>
    <div className="case-policy-table-scroll"><table className="case-policy-table"><thead><tr>
      <th scope="col"><input type="checkbox" aria-label="Select all visible, mapped policies" checked={allSelected} disabled={locked || !selectablePolicies.length} onChange={(event) => onSelectVisible(selectablePolicies.map((policy) => policy.policy_id), event.target.checked)} /></th>
      <th scope="col">Policy</th><th scope="col">Applies to</th><th scope="col" className="policy-version-heading">Version/<br />reference</th><th scope="col">Status</th><th scope="col">Effective</th><th scope="col">Case use</th><th scope="col"><span className="visually-hidden">Details</span></th>
      </tr></thead><tbody>{policies.map((policy) => {
        const selected = selectedIds.includes(policy.policy_id)
        const status = policyStatus(policy)
        const use = policyCaseUse(policy, application)
        const productTarget = [policy.product_name, policy.product_code].filter(Boolean).join(' · ')
        const effectiveDate = policy.effective_from || policy.effective_to
          ? `${displayDate(policy.effective_from) || 'Start not recorded'} – ${displayDate(policy.effective_to) || 'No end date'}`
          : 'Dates not recorded'
        const applicableTo = policy.policy_kind === 'regulatory'
          ? `${policy.insurance_type || 'Insurance type not recorded'} · Regulatory`
          : `${policy.insurance_type || 'Insurance type not recorded'} · ${productTarget || 'Product not recorded'}`
        return <tr key={policy.policy_id} className={selected ? 'is-selected' : ''}>
          <td className="policy-select-cell"><input type="checkbox" aria-label={`Select ${policy.policy_name}`} checked={selected} disabled={locked || Boolean(application && policy.policy_kind === 'company' && !policy.product_code && !selected)} title={application && policy.policy_kind === 'company' && !policy.product_code ? 'Add a product mapping before applying this company policy.' : undefined} onChange={() => onToggle(policy.policy_id)} /></td>
          <td data-label="Policy"><strong>{policy.policy_name}</strong><small>{policy.policy_kind === 'regulatory' ? 'Regulatory source' : policy.insurer_name || 'Company policy'}</small></td>
          <td data-label="Applies to">{applicableTo}</td><td className="policy-version-cell" data-label="Version / reference">{policy.version || policy.uin || 'Not recorded'}</td>
          <td data-label="Status"><span className={`policy-status-pill ${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span></td>
          <td data-label="Effective">{effectiveDate}</td><td data-label="Case use"><span className={`policy-case-use ${use.startsWith('Needs mapping') ? 'needs-mapping' : use.startsWith('Applicable') ? 'applicable' : ''}`}>{use}</span>{application && selected && <small className="policy-selection-state">Selected for this case</small>}</td>
          <td data-label="Details"><button type="button" className="policy-view-details" onClick={() => setDetailsPolicy(policy)}>View details <ExternalLink size={14} /></button></td>
        </tr>
      })}</tbody></table></div>
    {detailsPolicy && <PolicyDetailsPanel policy={allPolicies.find((item) => item.policy_id === detailsPolicy.policy_id) || detailsPolicy} application={application} selected={selectedIds.includes(detailsPolicy.policy_id)} onClose={() => setDetailsPolicy(null)} />}
  </>
}
