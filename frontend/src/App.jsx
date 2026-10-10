import { useEffect, useState } from 'react'
import {
  Activity, ArrowDownToLine, ArrowRight, BarChart3, BookOpen, Check,
  ChevronDown, CircleAlert, Cloud, Code2, Compass, Copy, Database,
  ExternalLink, Layers3, LoaderCircle, Menu, MessageSquareText, Plus,
  Search, Send, ShieldCheck, Sparkles, Table2, Trophy, X,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, ScatterChart,
  Scatter, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
} from 'recharts'

const examples = [
  { icon: BarChart3, label: 'Monthly Health claim trends', question: 'Calculate the monthly average claim amount and percentage change from the previous month for Health claims.' },
  { icon: Trophy, label: 'Largest claims', question: 'Show the top 5 claims by amount with their status.' },
  { icon: Layers3, label: 'Status breakdown', question: 'Count claims by claim_type and claim_status.' },
]

async function post(path, data) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : `Request failed (${response.status})`)
  }
  return response.json()
}

async function postStream(path, data, onProgress) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : `Request failed (${response.status})`)
  }
  if (!response.body) throw new Error('This browser cannot read the live progress stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() || ''
    for (const frame of frames) {
      const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith('data:'))
      if (!dataLine) continue
      const event = JSON.parse(dataLine.slice(5).trim())
      if (event.type === 'progress') onProgress?.(event)
      if (event.type === 'error') throw new Error(event.message || 'The agent workflow failed.')
      if (event.type === 'result') return event.result
    }
    if (done) break
  }
  throw new Error('The agent stream ended before returning a result.')
}

function downloadCsv(rows, columns) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [columns.map(escape).join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'builder-cup-results.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function Brand() {
  return <div className="brand"><div className="brand-icon"><Sparkles size={21} strokeWidth={2.2} /></div><div><strong>Intentra</strong><span>ASK BETTER. SEE FURTHER.</span></div></div>
}

function Sidebar({ view, setView, history, selectHistory, newQuestion, open, close, datasets, datasetId, projectId, datasetLoading, datasetError, onDatasetChange }) {
  const [datasetMenuOpen, setDatasetMenuOpen] = useState(false)
  const selectedDataset = datasets.find((dataset) => dataset.dataset_id === datasetId)
  return <>
    {open && <button className="nav-scrim" aria-label="Close menu" onClick={close} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="side-top"><Brand /><button className="icon-button side-close" aria-label="Close menu" onClick={close}><X size={19} /></button></div>
      <div className="side-nav">
        <span className="nav-caption">WORKSPACE</span>
        <div className="sidebar-dataset">
          <span className="dataset-caption">ACTIVE DATASET</span>
          <button className="dataset-picker" type="button" onClick={() => setDatasetMenuOpen((value) => !value)} aria-expanded={datasetMenuOpen} aria-haspopup="listbox" disabled={datasetLoading || datasets.length === 0}>
            <span className="dataset-picker-icon"><Database size={17} /></span>
            <span className="dataset-picker-copy"><small>BIGQUERY SOURCE</small><strong>{datasetLoading ? 'Loading datasets…' : selectedDataset?.dataset_id || 'Select a dataset'}</strong><em>{selectedDataset ? projectId : 'Choose a source to begin'}</em></span>
            <ChevronDown className={datasetMenuOpen ? 'dataset-chevron open' : 'dataset-chevron'} size={15} />
          </button>
          {datasetMenuOpen && <div className="dataset-menu" role="listbox" aria-label="Choose a BigQuery dataset">{datasets.map((dataset) => <button key={dataset.dataset_id} type="button" role="option" aria-selected={dataset.dataset_id === datasetId} className={dataset.dataset_id === datasetId ? 'selected' : ''} onClick={() => { onDatasetChange(dataset.dataset_id); setDatasetMenuOpen(false); close() }}><Database size={14} /><span>{dataset.dataset_id}<small>{projectId}</small></span>{dataset.dataset_id === datasetId && <Check size={14} />}</button>)}</div>}
          {datasetError && <span className="sidebar-dataset-error" title={datasetError}>Could not load datasets</span>}
        </div>
        <button className="new-chat-button" onClick={() => { newQuestion(); close() }}><Plus size={17} /> New chat <span>⌘ K</span></button>
        <button className={`nav-item ${view === 'ask' ? 'selected' : ''}`} onClick={() => { setView('ask'); close() }}><MessageSquareText size={19} /> Ask your data <ArrowRight className="nav-end" size={16} /></button>
        <button className={`nav-item ${view === 'catalog' ? 'selected' : ''}`} onClick={() => { setView('catalog'); close() }}><Database size={19} /> Catalog explorer <ArrowRight className="nav-end" size={16} /></button>
        <button className={`nav-item ${view === 'knowledge-agent' ? 'selected' : ''}`} onClick={() => { setView('knowledge-agent'); close() }}><Sparkles size={19} /> Catalog agent <ArrowRight className="nav-end" size={16} /></button>
        <span className="nav-caption recent-label">RECENT QUERIES</span>
        {history.length === 0 ? <div className="empty-history">Your chats will appear here.</div> : history.map((entry, index) => <button key={entry.id} className="history-item" onClick={() => { selectHistory(index); close() }} title={entry.question}>{entry.mode === 'knowledge-agent' ? <Sparkles size={16} /> : <Activity size={16} />}<span>{entry.question}</span></button>)}
      </div>
      <div className="side-footer"><div className="cloud-mark"><Cloud size={20} /><span>Powered by<br /><strong>Google Cloud</strong></span></div><div className="event-rule"><i /><i /><i /><i /></div></div>
    </aside>
  </>
}

function Status({ state }) {
  return <span className={`connection ${state}`}><span className="status-dot" />{state === 'online' ? 'API connected' : state === 'offline' ? 'API offline' : 'Connecting'}</span>
}

function ProgressTimeline({ events = [] }) {
  const activeIndex = events.findLastIndex((event) => event.kind !== 'agent_complete')
  return <ol className="progress-timeline">{events.map((event, index) => <li key={`${event.agent}-${event.message}-${index}`} className={index === activeIndex ? 'active' : ''}><span className="progress-mark">{event.kind === 'agent_complete' || index < activeIndex ? <Check size={12} /> : <LoaderCircle className="spin" size={12} />}</span><span><small>{event.agent === 'data_analyst' ? 'SQL AGENT' : event.agent === 'visualization' ? 'VISUALIZATION AGENT' : event.agent === 'knowledge_gap' ? 'KNOWLEDGE CATALOG AGENT' : 'INTENTRA'}</small>{event.message}</span></li>)}</ol>
}

function Table({ rows, columns }) {
  return <div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column} title={String(row[column] ?? '')}>{row[column] == null ? '—' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</td>)}</tr>)}</tbody></table></div>
}

const chartLabels = { bar: 'Bar', line: 'Line', area: 'Area', pie: 'Pie', scatter: 'Scatter', radar: 'Radar' }
const chartColors = ['#7546df', '#159b83', '#e6a23c', '#db6f8c', '#536bc4', '#4a9d9a']

function VisualizationAgent({ question, rows, columns, initialAnalysis }) {
  const [analysis, setAnalysis] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setAnalysis(null)
    setError('')
    if (initialAnalysis) {
      if (initialAnalysis.status === 'error') {
        setError(initialAnalysis.message || 'Visualization Agent failed.')
        return () => { current = false }
      }
      setAnalysis(initialAnalysis)
      return () => { current = false }
    }
    post('/visualize', { question, columns, rows: rows.slice(0, 200) })
      .then((data) => {
        if (!current) return
        setAnalysis(data)
      })
      .catch((requestError) => { if (current) setError(requestError.message) })
    return () => { current = false }
  }, [question, columns, rows, initialAnalysis])

  if (error) return <div className="no-results">Visualization agent unavailable: {error}</div>
  if (!analysis) return <div className="chart-agent-loading"><LoaderCircle className="spin" size={19} /><span>Visualization agent is analyzing the result shape…</span></div>

  const charts = analysis.charts?.length ? analysis.charts : (analysis.recommendation?.chart_type ? [analysis.recommendation] : [])
  if (!charts.length) return <div className="no-results">No charts could be created from these results.</div>
  return <div className="visualization-agent">
    <div className="visualization-recommendation"><span><Sparkles size={15} /> VISUALIZATION AGENT · {charts.length} CHARTS</span><p>Explore the same query results through different chart views.</p></div>
    <div className="charts-grid">{charts.map((chart, index) => <ChartCard key={`${chart.chart_type}-${index}`} chart={chart} rows={rows} numericColumns={analysis.numeric_columns || []} xColumns={analysis.x_columns || []} />)}</div>
  </div>
}

function ChartCard({ chart, rows, numericColumns, xColumns }) {
  const [chartType, setChartType] = useState(chart.chart_type)
  const xOptions = chartType === 'scatter' || (!xColumns.length && chartType !== 'pie')
    ? numericColumns
    : (xColumns.length ? xColumns : numericColumns)
  const safeX = xOptions.includes(chart.x_key) ? chart.x_key : xOptions[0]
  const preferredY = (chart.y_keys || []).filter((key) => numericColumns.includes(key))
  const activeY = (chartType === 'scatter' ? preferredY.filter((key) => key !== safeX) : preferredY).slice(0, 4)
  if (!safeX || !activeY.length) return null
  const viewTypes = [
    'bar', 'line', 'area',
    ...(rows.length <= 12 ? ['pie'] : []),
    ...(numericColumns.length >= 2 ? ['scatter'] : []),
    ...(numericColumns.length >= 2 && xColumns.includes(safeX) ? ['radar'] : []),
  ]
  const common = { data: rows, margin: { top: 12, right: 18, left: 2, bottom: 28 } }
  const axisStyle = { fill: '#687487', fontSize: 11 }
  const chartView = chartType === 'pie'
    ? <PieChart><Tooltip /><Legend /><Pie data={rows} dataKey={activeY[0]} nameKey={safeX} cx="50%" cy="48%" outerRadius={92} label>{rows.map((row, index) => <Cell key={`${row[safeX]}-${index}`} fill={chartColors[index % chartColors.length]} />)}</Pie></PieChart>
    : chartType === 'scatter'
      ? <ScatterChart {...common}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" dataKey={safeX} tick={axisStyle} /><YAxis type="number" dataKey={activeY[0]} tick={axisStyle} /><Tooltip /><Scatter data={rows} fill={chartColors[0]} /></ScatterChart>
      : chartType === 'radar'
        ? <RadarChart data={rows}><PolarGrid /><PolarAngleAxis dataKey={safeX} tick={axisStyle} /><PolarRadiusAxis tick={axisStyle} /><Tooltip />{activeY.map((key, i) => <Radar key={key} name={key} dataKey={key} stroke={chartColors[i]} fill={chartColors[i]} fillOpacity={0.16} />)}<Legend /></RadarChart>
        : chartType === 'line'
          ? <LineChart {...common}><CartesianGrid vertical={false} stroke="#e9edf2" /><XAxis dataKey={safeX} tick={axisStyle} /><YAxis tick={axisStyle} /><Tooltip /><Legend />{activeY.map((key, i) => <Line key={key} type="monotone" dataKey={key} stroke={chartColors[i]} strokeWidth={2.5} dot={{ r: 3 }} />)}</LineChart>
          : chartType === 'area'
            ? <AreaChart {...common}><CartesianGrid vertical={false} stroke="#e9edf2" /><XAxis dataKey={safeX} tick={axisStyle} /><YAxis tick={axisStyle} /><Tooltip /><Legend />{activeY.map((key, i) => <Area key={key} type="monotone" dataKey={key} stroke={chartColors[i]} fill={chartColors[i]} fillOpacity={0.18} />)}</AreaChart>
            : <BarChart {...common}><CartesianGrid vertical={false} stroke="#e9edf2" /><XAxis dataKey={safeX} tick={axisStyle} /><YAxis tick={axisStyle} /><Tooltip /><Legend />{activeY.map((key, i) => <Bar key={key} dataKey={key} fill={chartColors[i]} radius={[4, 4, 0, 0]} maxBarSize={54} />)}</BarChart>
  return <article className="chart-card"><div className="chart-card-head"><div className="chart-card-toolbar"><span>VIEW AS</span><div className="chart-switcher" role="group" aria-label="Change chart type">{viewTypes.map((type) => <button key={type} type="button" className={chartType === type ? 'active' : ''} aria-pressed={chartType === type} onClick={() => setChartType(type)}>{chartLabels[type]}</button>)}</div></div><h4>{chart.title || `${chartLabels[chartType]} chart`}</h4>{chart.rationale && <p>{chart.rationale}</p>}</div><div className="chart-wrap"><ResponsiveContainer width="100%" height={270}>{chartView}</ResponsiveContainer></div></article>
}

function AnalysisValue({ value }) {
  if (value == null || value === '') return null
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}><AnalysisValue value={item} /></li>)}</ul>
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd><AnalysisValue value={item} /></dd></div>)}</dl>
  return <p>{String(value)}</p>
}

function SqlAnalysis({ analysis }) {
  if (!analysis || typeof analysis !== 'object') return null
  const sections = [
    ['Question understood', analysis.question_understanding],
    ['Analysis approach', analysis.approach],
    ['Data scope', analysis.data_scope],
    ['Query steps', analysis.transformations],
    ['Assumptions and limitations', analysis.assumptions_and_limitations],
  ].filter(([, value]) => value != null && value !== '' && (!Array.isArray(value) || value.length > 0))
  if (!sections.length) return null
  return <section className="sql-analysis" aria-label="Detailed analysis">
    <div className="sql-analysis-heading"><span><Compass size={16} /> DETAILED ANALYSIS</span></div>
    <div className="sql-analysis-grid">{sections.map(([title, value], index) => <article key={title} className={`sql-analysis-card ${index === 0 || index === 1 ? 'wide' : ''}`}><h4>{title}</h4><AnalysisValue value={value} /></article>)}</div>
  </section>
}

function Answer({ entry }) {
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState('Result')
  useEffect(() => {
    setCopied(false)
    setActiveTab('Result')
  }, [entry])
  if (!entry) return null
  const { result } = entry
  const rows = result.rows || []
  const columns = result.columns || (rows[0] ? Object.keys(rows[0]) : [])
  const canChart = rows.length > 0 && columns.length > 0

  async function copySql() {
    try { await navigator.clipboard.writeText(result.sql); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { setCopied(false) }
  }

  return <section className="answer" aria-live="polite">
    {result.error ? <div className="assistant-response"><div className="assistant-avatar"><Sparkles size={17} /></div><div className="assistant-content"><div className="assistant-label">INTENTRA <span>·</span> COULD NOT COMPLETE</div><div className="error-panel"><CircleAlert size={20} /><span>{result.error}</span></div></div></div> : <>
      <div className="assistant-response"><div className="assistant-avatar"><Sparkles size={17} /></div><div className="assistant-content"><div className="assistant-label">INTENTRA <span>·</span> DATA INSIGHT</div><div className="summary-block"><p>{result.summary || (rows.length ? `Query completed with ${result.row_count ?? rows.length} results. Explore the data below.` : 'The query ran successfully but returned no rows.')}</p></div></div></div>
      <nav className="answer-tabs" aria-label="Answer sections" role="tablist">{['Result', 'Charts', 'Details Analysis', 'View SQL with Table'].map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab === 'Charts' && <BarChart3 size={15} />}{tab === 'Details Analysis' && <Compass size={15} />}{tab === 'View SQL with Table' && <Code2 size={15} />}{tab}</button>)}</nav>
      {activeTab === 'Result' && <section className="answer-panel" role="tabpanel">
        <div className="result-heading"><div><span className="block-label"><Table2 size={16} /> QUERY RESULTS</span><h3>{result.row_count ?? rows.length} {rows.length === 1 ? 'row' : 'rows'} returned</h3></div>{rows.length > 0 && <button className="subtle-action" onClick={() => downloadCsv(rows, columns)}><ArrowDownToLine size={17} /> Export CSV</button>}</div>
        <div className="result-frame">{rows.length === 0 ? <div className="no-results">No matching rows found for this query.</div> : <Table rows={rows} columns={columns} />}</div>
      </section>}
      {activeTab === 'Charts' && <section className="answer-panel" role="tabpanel">{canChart ? <VisualizationAgent question={entry.question} rows={rows} columns={columns} initialAnalysis={result.visualization} /> : <div className="no-results">There are no rows to visualize yet.</div>}</section>}
      {activeTab === 'Details Analysis' && <section className="answer-panel" role="tabpanel"><SqlAnalysis analysis={result.analysis} />{result.catalog_entries?.length > 0 && <details className="assets-details"><summary><span><Database size={18} /> Catalog assets consulted</span><ChevronDown size={18} /></summary><div className="asset-list">{result.catalog_entries.map((asset) => <div key={asset.name}><Database size={15} /><span>{asset.displayName || asset.fqn}<small>{asset.fqn}</small></span><em>{asset.system}</em></div>)}</div></details>}</section>}
      {activeTab === 'View SQL with Table' && <section className="answer-panel sql-table-panel" role="tabpanel"><details className="sql-details" open><summary><span><Code2 size={18} /> Generated SQL</span><ChevronDown size={18} /></summary><div className="code-toolbar"><span>BIGQUERY SQL</span><button aria-label={copied ? 'Copied SQL' : 'Copy SQL'} title={copied ? 'Copied' : 'Copy SQL'} onClick={copySql}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><pre><code>{result.sql}</code></pre></details><div className="result-heading"><div><span className="block-label"><Table2 size={16} /> QUERY RESULTS</span><h3>{result.row_count ?? rows.length} {rows.length === 1 ? 'row' : 'rows'} returned</h3></div></div><div className="result-frame">{rows.length ? <Table rows={rows} columns={columns} /> : <div className="no-results">No matching rows found for this query.</div>}</div></section>}
    </>}
  </section>
}

function CatalogAgentResult({ entry }) {
  if (entry.pending) return <div className="assistant-response loading-response"><div className="assistant-avatar"><Sparkles size={17} /></div><div className="assistant-content"><div className="assistant-label">INTENTRA <span>·</span> KNOWLEDGE CATALOG AGENT</div><div className="loading-state"><div><strong>Reviewing catalog metadata</strong><span>Live agent and tool activity:</span></div><ProgressTimeline events={entry.progress || []} /></div></div></div>
  if (entry.error) return <div className="assistant-response"><div className="assistant-avatar"><Sparkles size={17} /></div><div className="assistant-content"><div className="assistant-label">INTENTRA <span>·</span> KNOWLEDGE CATALOG AGENT</div><div className="error-panel"><CircleAlert size={20} /><span>{entry.error}</span></div></div></div>
  const response = entry.response || {}
  const data = response.data && typeof response.data === 'object' ? response.data : {}
  const fields = Object.entries(data).filter(([, value]) => value != null && value !== '' && (!Array.isArray(value) || value.length > 0))
  const status = response.status || 'success'
  return <div className="assistant-response"><div className="assistant-avatar"><Sparkles size={17} /></div><div className="assistant-content"><div className="assistant-label">INTENTRA <span>·</span> KNOWLEDGE CATALOG AGENT <i className={`catalog-agent-status ${status}`}>{status.replaceAll('_', ' ')}</i></div><div className="catalog-agent-result"><p className="catalog-agent-message">{response.message || 'The Knowledge Catalog Agent completed its review.'}</p>{fields.length > 0 && <div className="catalog-agent-fields">{fields.map(([key, value]) => <article key={key}><h4>{key.replaceAll('_', ' ')}</h4><AnalysisValue value={value} /></article>)}</div>}</div></div></div>
}

function CatalogAgentWorkspace({ datasetId, entry, onSubmit }) {
  const [input, setInput] = useState('')
  const busy = Boolean(entry?.pending)
  function submit(value = input) {
    const trimmed = value.trim()
    if (!trimmed || busy || !datasetId) return
    onSubmit(trimmed)
    setInput('')
  }
  return <section className="catalog-agent-workspace">
    <div className="catalog-agent-welcome"><span className="welcome-badge"><Sparkles size={14} /> KNOWLEDGE CATALOG AGENT</span><h2>Make your catalog<br /><em>more useful.</em></h2><p>Review metadata gaps, improve asset descriptions, and get grounded recommendations for your selected dataset.</p></div>
    {entry && <div className="conversation-thread"><div className="user-message"><span>{entry.question}</span><div className="user-avatar">YOU</div></div><CatalogAgentResult entry={entry} /></div>}
    {!entry && <div className="catalog-agent-suggestions"><span>TRY A CATALOG REVIEW</span><div>{[
      'Review this dataset for missing table and column descriptions.',
      'Find unclear or inconsistent business definitions in this dataset.',
      'Suggest metadata improvements that would help an analyst query this data.',
    ].map((suggestion) => <button key={suggestion} type="button" onClick={() => submit(suggestion)} disabled={!datasetId}><Sparkles size={14} />{suggestion}<ArrowRight size={15} /></button>)}</div></div>}
    <form className="ask-box catalog-agent-composer" onSubmit={(event) => { event.preventDefault(); submit() }}><div className="ask-icon"><Sparkles size={21} /></div><label htmlFor="catalog-agent-question" className="sr-only">Ask the Knowledge Catalog Agent</label><textarea id="catalog-agent-question" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} rows={2} placeholder={datasetId ? 'Ask the catalog agent to review or improve metadata…' : 'Select a dataset in the sidebar to get started…'} disabled={busy || !datasetId} /><div className="ask-footer"><span><ShieldCheck size={15} /> Updates are reported only when confirmed</span><button type="submit" disabled={!input.trim() || busy || !datasetId} aria-label="Send request">{busy ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}<span>{busy ? 'Reviewing' : 'Send'}</span></button></div></form>
  </section>
}

function App() {
  const [view, setView] = useState('ask')
  const [history, setHistory] = useState([])
  const [selected, setSelected] = useState(null)
  const [activeQuestion, setActiveQuestion] = useState('')
  const [catalogAgentEntry, setCatalogAgentEntry] = useState(null)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [assets, setAssets] = useState(null)
  const [connection, setConnection] = useState('checking')
  const [menuOpen, setMenuOpen] = useState(false)
  const [datasets, setDatasets] = useState([])
  const [projectId, setProjectId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [datasetLoading, setDatasetLoading] = useState(true)
  const [datasetError, setDatasetError] = useState('')

  useEffect(() => {
    fetch('/health').then((response) => setConnection(response.ok ? 'online' : 'offline')).catch(() => setConnection('offline'))
    fetch('/datasets').then(async (response) => {
      if (!response.ok) throw new Error(`Dataset request failed (${response.status})`)
      return response.json()
    }).then((data) => {
      setProjectId(data.project_id || '')
      setDatasets(data.datasets || [])
      const initial = (data.datasets || []).find((dataset) => dataset.dataset_id === 'knowledge_catalog_poc') || data.datasets?.[0]
      if (initial) setDatasetId(initial.dataset_id)
    }).catch((error) => setDatasetError(error.message)).finally(() => setDatasetLoading(false))
  }, [])

  async function ask(value) {
    const text = value.trim()
    if (!text || loading) return
    setView('ask')
    setQuestion('')
    setActiveQuestion(text)
    setLoading(true)
    setProgress([{ agent: 'intentra', kind: 'agent_start', message: 'Starting the agent workflow.' }])
    setSelected(null)
    try {
      const result = await postStream('/ask/stream', { question: text, dataset_id: datasetId }, (event) => {
        setProgress((previous) => previous.at(-1)?.message === event.message ? previous : [...previous, event].slice(-8))
      })
      const entry = { id: Date.now(), question: text, result }
      setHistory((previous) => [entry, ...previous])
      setSelected(entry)
    } catch (error) {
      setSelected({ id: Date.now(), question: text, result: { error: error.message } })
    } finally { setLoading(false) }
  }

  async function askCatalogAgent(value) {
    const text = value.trim()
    if (!text || catalogAgentEntry?.pending || !datasetId) return
    setView('knowledge-agent')
    setSelected(null)
    const pending = { id: Date.now(), mode: 'knowledge-agent', question: text, pending: true, progress: [{ agent: 'knowledge_gap', kind: 'agent_start', message: 'Starting the Knowledge Catalog review.' }] }
    let latestProgress = pending.progress
    setCatalogAgentEntry(pending)
    setHistory((previous) => [pending, ...previous])
    try {
      const response = await postStream('/catalog-agent/stream', { question: text, dataset_id: datasetId }, (event) => {
        latestProgress = [...latestProgress, event].slice(-8)
        setCatalogAgentEntry((current) => current?.id === pending.id ? { ...current, progress: latestProgress } : current)
        setHistory((previous) => previous.map((entry) => entry.id === pending.id ? { ...entry, progress: latestProgress } : entry))
      })
      const completed = { ...pending, pending: false, progress: latestProgress, response }
      setCatalogAgentEntry(completed)
      setHistory((previous) => previous.map((entry) => entry.id === pending.id ? completed : entry))
    } catch (error) {
      const failed = { ...pending, pending: false, progress: latestProgress, error: error.message }
      setCatalogAgentEntry(failed)
      setHistory((previous) => previous.map((entry) => entry.id === pending.id ? failed : entry))
    }
  }

  async function search(event) {
    event.preventDefault()
    if (!searchTerm.trim() || searching) return
    setSearching(true)
    setSearchError('')
    setAssets(null)
    try {
      const response = await post('/search', {
        query: searchTerm.trim(),
        page_size: 1000,
        dataset_id: datasetId,
      })
      setAssets(response.entries || [])
    } catch (error) { setSearchError(error.message) } finally { setSearching(false) }
  }

  return <div className="app-shell">
    <Sidebar view={view} setView={setView} history={history} selectHistory={(index) => { const entry = history[index]; if (entry.mode === 'knowledge-agent') { setCatalogAgentEntry(entry); setView('knowledge-agent') } else { setSelected(entry); setActiveQuestion(entry.question); setView('ask') } }} newQuestion={() => { setSelected(null); setCatalogAgentEntry(null); setActiveQuestion(''); setQuestion(''); setView('ask') }} open={menuOpen} close={() => setMenuOpen(false)} datasets={datasets} datasetId={datasetId} projectId={projectId} datasetLoading={datasetLoading} datasetError={datasetError} onDatasetChange={(id) => { setDatasetId(id); setSelected(null); setCatalogAgentEntry(null); setActiveQuestion(''); setQuestion(''); setView('ask') }} />
    <main className="main-panel">
      <header className="topbar"><div className="top-left"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={22} /></button><span className="breadcrumb"><span className="breadcrumb-product">INTENTRA</span><span>/</span> {view === 'ask' ? 'DATA CHAT' : view === 'knowledge-agent' ? 'KNOWLEDGE CATALOG AGENT' : 'CATALOG EXPLORER'}</span></div><div className="top-right"><Status state={connection} /><div className="top-avatar" aria-label="Intentra"><Sparkles size={16} /></div></div></header>
      <div className={`content ${view !== 'catalog' ? 'chat-content' : ''}`}>
        {view === 'catalog' && <div className="event-banner"><div className="banner-image" /><div className="banner-overlay" /><div className="banner-content"><span className="event-tag"><Trophy size={14} /> INTENTRA KNOWLEDGE STUDIO</span><h1>Know your data.<br /><em>Know your next move.</em></h1><div className="banner-bottom"><span>Intentra</span><span className="banner-separator" /><span>Built on Google Cloud</span></div></div><span className="banner-deco">01 / DISCOVER</span></div>}
        {view === 'ask' ? <>
          <section className={`chat-workspace ${!selected && !activeQuestion ? 'chat-workspace-empty' : ''}`}>
            {!selected && !activeQuestion && <div className="chat-welcome"><span className="welcome-badge"><Sparkles size={14} /> INTENTRA DATA COPILOT</span><h2>Ask better.<br /><em>See further.</em></h2><p>{datasetId ? 'Your data has a story. Ask a question and Intentra will help you uncover it.' : 'Choose a dataset from the left sidebar, then ask Intentra a question about your data.'}</p></div>}
            {(activeQuestion || selected) && <div className="conversation-thread">
              <div className="user-message"><span>{selected?.question || activeQuestion}</span><div className="user-avatar">YOU</div></div>
              {loading ? <div className="assistant-response loading-response"><div className="assistant-avatar"><Sparkles size={17} /></div><div className="assistant-content"><div className="assistant-label">INTENTRA <span>·</span> WORKING ON IT</div><div className="loading-state"><div><strong>Following the data trail</strong><span>Live activity from the agents and their tools:</span></div><ProgressTimeline events={progress} /></div></div></div> : selected && <Answer entry={selected} />}
            </div>}
            {!selected && !loading && !activeQuestion && <section className="suggestions"><div className="suggestions-title"><Compass size={17} /><span>TRY ASKING</span></div><div className="suggestion-grid">{examples.map(({ icon: Icon, label, question: example }) => <button key={label} className="suggestion" onClick={() => ask(example)}><span className="suggestion-icon"><Icon size={21} /></span><span>{label}<small>{example}</small></span><ArrowRight className="suggestion-arrow" size={18} /></button>)}</div></section>}
            <form className="ask-box" onSubmit={(event) => { event.preventDefault(); ask(question) }}><div className="ask-icon"><Sparkles size={21} /></div><label htmlFor="question" className="sr-only">Ask Intentra about your data</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(question) } }} rows={2} placeholder="Message Intentra about your data…" disabled={loading || !datasetId} /><div className="ask-footer"><span><ShieldCheck size={15} /> Grounded in your catalog</span><button type="submit" disabled={!question.trim() || loading || !datasetId} aria-label="Send message">{loading ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />} <span>{loading ? 'Analyzing' : 'Send'}</span></button></div></form>
          </section>
        </> : view === 'knowledge-agent' ? <CatalogAgentWorkspace datasetId={datasetId} entry={catalogAgentEntry} onSubmit={askCatalogAgent} /> : <section className="catalog-section"><div className="section-head"><div><span className="eyebrow"><span className="eyebrow-mark" /> KNOWLEDGE CATALOG</span><h2>Discover your data assets<span className="period">.</span></h2><p>Search tables and datasets indexed by Google Cloud.</p></div></div><form className="catalog-search" onSubmit={search}><Search size={21} /><label className="sr-only" htmlFor="catalog-query">Search catalog</label><input id="catalog-query" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search for claims, customers, transactions..." /><button type="submit" disabled={searching || !searchTerm.trim()}>{searching ? <LoaderCircle className="spin" size={18} /> : 'Search assets'}</button></form>{searchError && <div className="error-panel"><CircleAlert size={18} />{searchError}</div>}{assets && <div className="catalog-results"><div className="catalog-result-head"><span>{assets.length} {assets.length === 1 ? 'ASSET' : 'ASSETS'} FOUND</span><span>KNOWLEDGE CATALOG</span></div>{assets.length ? assets.map((asset) => <div className="catalog-row" key={asset.name}><div className="catalog-icon"><Database size={20} /></div><div className="catalog-meta"><strong>{asset.displayName || asset.fqn}</strong><small>{asset.fqn}</small><span>{asset.system || 'Data asset'} <i /> {asset.location || 'Unknown region'}</span></div><button className="icon-button" aria-label={`Ask about ${asset.displayName || asset.fqn}`} title="Ask about this asset" onClick={() => { setView('ask'); setQuestion(`Tell me about ${asset.displayName || asset.fqn}`) }}><ArrowRight size={19} /></button></div>) : <div className="no-results">No assets matched. Try a different term.</div>}</div>}{!assets && !searchError && <div className="catalog-placeholder"><BookOpen size={32} /><strong>Your catalog, one search away.</strong><span>Find relevant assets before you start building.</span></div>}</section>}
        <footer className="page-footer"><span><span className="footer-bars"><i /><i /><i /><i /></span> INTENTRA · ASK BETTER. SEE FURTHER.</span><span>BUILT ON GOOGLE CLOUD <ExternalLink size={13} /></span></footer>
      </div>
    </main>
  </div>
}

export default App
