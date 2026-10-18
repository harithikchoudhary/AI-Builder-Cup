import { useEffect, useRef, useState } from 'react'
import { Check, Database, LoaderCircle, Search, Settings, X } from 'lucide-react'

function ConnectionsDialog({ datasets, datasetId, projectId, loading, error, onChange, onClose }) {
  const dialog = useRef(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(datasetId)
  const available = datasets.filter((dataset) => dataset.dataset_id.toLowerCase().includes(query.toLowerCase().trim()))
  useEffect(() => {
    const node = dialog.current
    node.showModal()
    return () => node.close()
  }, [])
  return <dialog ref={dialog} className="connections-dialog" aria-labelledby="connections-heading" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose() } }}>
    <header className="connections-heading"><span className="connections-mark"><Database size={23} /></span><div><h2 id="connections-heading">Manage connections</h2><p>Choose the BigQuery dataset for your data workspace.</p></div><button type="button" className="header-icon-button" aria-label="Close connections" onClick={onClose}><X size={19} /></button></header>
    <div className="connections-project"><span>Google Cloud project</span><strong>{projectId || 'Project unavailable'}</strong></div>
    <label className="connections-search"><Search size={17} /><input type="search" placeholder="Search datasets…" aria-label="Search connected datasets" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus /></label>
    <div className="connections-list" role="radiogroup" aria-label="Available BigQuery datasets">
      {loading ? <p className="connections-empty"><LoaderCircle size={18} className="spin" /> Loading connections…</p> : error ? <p role="alert" className="connections-error">Could not load connections. {error}</p> : available.length ? available.map((dataset) => <label key={dataset.dataset_id} className={`connection-option ${selected === dataset.dataset_id ? 'is-selected' : ''}`}><input type="radio" name="connected-dataset" value={dataset.dataset_id} checked={selected === dataset.dataset_id} onChange={() => setSelected(dataset.dataset_id)} /><Database size={19} /><span><strong>{dataset.dataset_id}</strong><small>{projectId}.{dataset.dataset_id}</small></span>{dataset.dataset_id === datasetId && <span className="connection-active"><Check size={13} /> Active</span>}</label>) : <p className="connections-empty">{datasets.length ? 'No datasets match your search.' : 'No BigQuery datasets are available.'}</p>}
    </div>
    <footer className="connections-footer"><button className="subtle-action" type="button" onClick={onClose}>Cancel</button><button className="uw-start-button" type="button" disabled={loading || !!error || !datasets.some((dataset) => dataset.dataset_id === selected)} onClick={() => { if (selected !== datasetId) onChange(selected); onClose() }}>Use dataset</button></footer>
  </dialog>
}

export default function HeaderSettings(props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const root = useRef(null)
  const trigger = useRef(null)
  const manageButton = useRef(null)
  useEffect(() => {
    if (!menuOpen) return
    manageButton.current?.focus()
    const outside = (event) => { if (!root.current?.contains(event.target)) setMenuOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') { setMenuOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [menuOpen])
  return <div className="header-settings" ref={root}>
    <button className="header-icon-button" ref={trigger} type="button" aria-label="Settings" title="Settings" aria-expanded={menuOpen} aria-controls="workspace-settings" onClick={() => setMenuOpen(!menuOpen)}><Settings size={19} /></button>
    {menuOpen && <div className="settings-popover" id="workspace-settings"><span>Workspace settings</span><button ref={manageButton} type="button" onClick={() => { setMenuOpen(false); setConnectionsOpen(true) }}><Database size={18} /><span><strong>Manage connections</strong><small>Choose your BigQuery dataset</small></span></button></div>}
    {connectionsOpen && <ConnectionsDialog {...props} onClose={() => { setConnectionsOpen(false); trigger.current?.focus() }} />}
  </div>
}
