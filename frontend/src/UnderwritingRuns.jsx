import { useEffect, useState } from 'react'
import { ArrowLeft, History, LoaderCircle, RotateCcw } from 'lucide-react'
import UnderwritingPipeline from './UnderwritingPipeline'

const date = (value) => value ? new Date(value).toLocaleString() : 'Not recorded'
async function read(response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`)
  return body
}

export default function UnderwritingRuns({ application, busy, onRegenerate, PremiumPanel }) {
  const [open, setOpen] = useState(false)
  const [runs, setRuns] = useState([])
  const [saved, setSaved] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const id = application.application_id
  const key = application.workflow?.run_id || application.workflow?.started_at
  useEffect(() => {
    setOpen(false); setSaved(null); setForm(false); setReason(''); setConfirmed(false); setError(''); setRuns([])
  }, [id])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError(''); setRuns([])
    fetch(`/underwriting/cases/${encodeURIComponent(id)}/runs`, { signal: controller.signal }).then(read).then((body) => setRuns(body.runs || [])).catch((err) => { if (!controller.signal.aborted) setError(err.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, open, refresh])
  async function view(runId) {
    setLoading(true); setError(''); setSaved(null)
    try { setSaved(await read(await fetch(`/underwriting/cases/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`))) }
    catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  async function regenerate(event) {
    event.preventDefault()
    if (!confirmed || !reason.trim() || busy || saving) return
    setSaving(true); setError('')
    try {
      const updated = await onRegenerate({ reason: reason.trim(), expected_run_key: key })
      if (updated) { setForm(false); setReason(''); setConfirmed(false); setSaved(null); setOpen(true); setRefresh((value) => value + 1) }
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  return <section className="underwriting-runs" aria-label="Underwriting run history">
    <div className="runs-toolbar"><div><strong>Underwriting run {application.workflow?.run_number || 1}</strong><p>Start a fresh review or inspect a previous assessment.</p></div><div className="runs-actions"><button type="button" className="subtle-action" disabled={saving} aria-expanded={open} onClick={() => { setOpen(!open); setSaved(null) }}><History size={16} />{open ? 'Hide previous runs' : 'View previous runs'}</button>{application.workflow?.started_at && <button type="button" className="subtle-action" disabled={busy || saving} aria-expanded={form} onClick={() => setForm(!form)}><RotateCcw size={16} />Regenerate underwriting</button>}</div></div>
    {form && <form className="runs-regenerate" onSubmit={regenerate}><h4>Start a new review for {application.applicant}?</h4><p>The current run, findings, policy versions and any recorded decision will be preserved. A new review will re-read the documents and require fresh employee confirmations. Existing policies stay selected; you can change them before starting.</p>{['Approved', 'Declined'].includes(application.status) && <p className="pipeline-gap">This reopens the application for review. The previous decision remains in its historical run; the new run starts without a decision.</p>}<label htmlFor="regenerate-reason">Reason for the new review<textarea id="regenerate-reason" rows={2} maxLength={2000} required value={reason} disabled={saving} onChange={(event) => setReason(event.target.value)} placeholder="For example: reassess after updating the selected company policies" /></label><label className="checkpoint-confirm"><input type="checkbox" checked={confirmed} disabled={saving} onChange={(event) => setConfirmed(event.target.checked)} /><span>Preserve the current review and prepare a new run with no carried-over employee confirmations.</span></label><div className="runs-actions"><button type="submit" className="uw-start-button" disabled={busy || saving || !confirmed || !reason.trim()}>{saving ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />}Save previous run & prepare new review</button><button type="button" className="subtle-action" disabled={saving} onClick={() => setForm(false)}>Cancel</button></div></form>}
    {error && <p className="flow-form-error" role="alert">{error}</p>}
    {open && <div className="runs-history"><h4>Previous underwriting runs</h4><p className="flow-muted">Read-only snapshots of the most recent 100 regenerated runs. The active run remains in the pipeline below.</p>{loading ? <p role="status">Loading saved reviews…</p> : saved ? <><button type="button" className="subtle-action" onClick={() => setSaved(null)}><ArrowLeft size={15} />Back to previous runs</button><div className="runs-snapshot-banner"><strong>Run {saved.run_number} · Read-only historical review</strong><p>Saved {date(saved.archived_at)} · Reason: {saved.reason}</p></div><UnderwritingPipeline key={saved.run_id} application={saved.case} readOnly PremiumPanel={PremiumPanel} /></> : runs.length ? <div className="pipeline-table-scroll"><table className="pipeline-result-table"><thead><tr><th scope="col">Run</th><th scope="col">Started</th><th scope="col">Review outcome</th><th scope="col">Reason for regeneration</th><th scope="col">Review record</th></tr></thead><tbody>{runs.map((run) => <tr key={run.run_id}><td>Run {run.run_number || '—'}</td><td>{date(run.started_at)}</td><td>{run.status}<small>{run.last_step === 'complete' ? 'Processing completed' : 'Archived before completion'}</small></td><td>{run.reason}</td><td><button type="button" className="subtle-action" onClick={() => view(run.run_id)}>View this run</button></td></tr>)}</tbody></table></div> : <p className="flow-muted">No previous run has been archived yet. Regenerating underwriting will preserve the current review here.</p>}</div>}
  </section>
}
