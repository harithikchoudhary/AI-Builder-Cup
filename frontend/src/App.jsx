import { useEffect, useState } from 'react'
import ThemeToggle from './ThemeToggle'
import HeaderSettings from './HeaderSettings'
import ChatComposer from './ChatComposer'
import DeletePolicyDialog from './DeletePolicyDialog'
import PolicyReview from './PolicyReview'
import UnderwritingPipeline from './UnderwritingPipeline'
import { ApplicationOverview, PipelinePreparation, PolicyLibraryTable, readWorkspaceRoute, writeWorkspaceRoute } from './CasePreparation'
import {
  Activity, ArrowDownToLine, ArrowRight, BarChart3, BookOpen, Check,
  ChevronDown, CircleAlert, Cloud, Code2, Compass, Copy, Database,
  ExternalLink, Layers3, LoaderCircle, Menu, MessageSquareText, Plus,
  Search, Send, ShieldCheck, Sparkles, Table2, Trophy, X,
  ClipboardCheck, Heart, Clock3, FileText, CheckCircle2, FilePlus2, ScrollText, Trash2,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, ScatterChart,
  Scatter, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
} from 'recharts'

const suggestionIcons = { trend: Activity, compare: BarChart3, breakdown: Layers3, explore: Trophy, count: Table2, preview: Table2 }

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

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function browserSessionId() {
  try {
    let value = localStorage.getItem('intentra-session-id')
    if (!value) { value = makeId(); localStorage.setItem('intentra-session-id', value) }
    return value
  } catch { return makeId() }
}

function Brand() {
  return <div className="brand"><div className="brand-icon"><Sparkles size={21} strokeWidth={2.2} /></div><div><strong>Intentra</strong><span>ASK BETTER. SEE FURTHER.</span></div></div>
}

function Sidebar({ view, setView, history, selectHistory, newQuestion, open, close }) {
  const showDataTools = !['underwriting', 'policies'].includes(view)
  return <>
    {open && <button className="nav-scrim" aria-label="Close menu" onClick={close} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="side-top"><Brand /><button className="icon-button side-close" aria-label="Close menu" onClick={close}><X size={19} /></button></div>
      <div className="side-nav">
        <span className="nav-caption">WORKSPACE</span>
        {showDataTools && <button className="new-chat-button" onClick={() => { newQuestion(); close() }}><Plus size={17} /> New chat <span>⌘ K</span></button>}
        <button className={`nav-item ${view === 'underwriting' ? 'selected' : ''}`} onClick={() => { setView('underwriting'); close() }}><ClipboardCheck size={19} /> Applications <ArrowRight className="nav-end" size={16} /></button>
        <button className={`nav-item ${view === 'policies' ? 'selected' : ''}`} onClick={() => { setView('policies'); close() }}><ScrollText size={19} /> Policies <ArrowRight className="nav-end" size={16} /></button>
        <button className={`nav-item ${view === 'ask' ? 'selected' : ''}`} onClick={() => { setView('ask'); close() }}><MessageSquareText size={19} /> Ask your data <ArrowRight className="nav-end" size={16} /></button>
        <button className={`nav-item ${view === 'catalog' ? 'selected' : ''}`} onClick={() => { setView('catalog'); close() }}><Database size={19} /> Catalog explorer <ArrowRight className="nav-end" size={16} /></button>
        <button className={`nav-item ${view === 'knowledge-agent' ? 'selected' : ''}`} onClick={() => { setView('knowledge-agent'); close() }}><Sparkles size={19} /> Catalog agent <ArrowRight className="nav-end" size={16} /></button>
        {showDataTools && <><span className="nav-caption recent-label">CHAT HISTORY</span>
        {history.length === 0 ? <div className="empty-history">Your chats will appear here.</div> : history.map((entry, index) => <button key={entry.id} className="history-item" onClick={() => { selectHistory(index); close() }} title={entry.question}>{entry.mode === 'knowledge-agent' ? <Sparkles size={16} /> : <Activity size={16} />}<span>{entry.question}</span></button>)}</>}
      </div>
      <div className="side-footer"><div className="cloud-mark"><Cloud size={20} /><span>Powered by<br /><strong>Google Cloud</strong></span></div><div className="event-rule"><i /><i /><i /><i /></div></div>
    </aside>
  </>
}

function Status({ state }) {
  return <span className={`connection ${state}`} role="status" aria-label={state === 'online' ? 'Application services connected' : state === 'offline' ? 'Application services offline' : 'Connecting to application services'} title={state === 'online' ? 'Application services connected' : state === 'offline' ? 'Application services offline' : 'Connecting to application services'}><span className="status-dot" /><span className="connection-label">{state === 'online' ? 'Connected' : state === 'offline' ? 'Offline' : 'Connecting'}</span></span>
}

function ProgressTimeline({ events = [] }) {
  const activeIndex = events.findLastIndex((event) => event.kind !== 'agent_complete')
  return <ol className="progress-timeline">{events.map((event, index) => <li key={`${event.agent}-${event.message}-${index}`} className={index === activeIndex ? 'active' : ''}><span className="progress-mark">{event.kind === 'agent_complete' || index < activeIndex ? <Check size={12} /> : <LoaderCircle className="spin" size={12} />}</span><span><small>{event.agent === 'supervisor' ? 'SUPERVISOR' : event.agent === 'data_analyst' ? 'SQL AGENT' : event.agent === 'visualization' ? 'VISUALIZATION AGENT' : event.agent === 'knowledge_gap' ? 'KNOWLEDGE CATALOG AGENT' : 'INTENTRA'}</small>{event.message}</span></li>)}</ol>
}

function Table({ rows, columns }) {
  return <div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column} title={String(row[column] ?? '')}>{row[column] == null ? '—' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</td>)}</tr>)}</tbody></table></div>
}

function InlineMarkdown({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>
    return <span key={index}>{part}</span>
  })
}

function MarkdownContent({ text }) {
  const lines = String(text || '').split(/\r?\n/)
  const blocks = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim()
    if (!line) { index += 1; continue }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      index += 1
      continue
    }
    if (/^[-*+]\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) items.push(lines[index++].trim().replace(/^[-*+]\s+/, ''))
      blocks.push({ type: 'list', items })
      continue
    }
    const paragraph = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !/^(#{1,4})\s+/.test(lines[index].trim()) && !/^\s*[-*+]\s+/.test(lines[index])) paragraph.push(lines[index++].trim())
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
  }
  return <div className="assistant-markdown">{blocks.map((block, index) => block.type === 'heading'
    ? <h3 key={index}><InlineMarkdown text={block.text} /></h3>
    : block.type === 'list'
      ? <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineMarkdown text={item} /></li>)}</ul>
      : <p key={index}><InlineMarkdown text={block.text} /></p>)}</div>
}

const chartLabels = { bar: 'Bar', line: 'Line', area: 'Area', pie: 'Pie', scatter: 'Scatter', radar: 'Radar' }
const chartColors = ['#0d9488', '#3b82f6', '#d99a32', '#d96e82', '#68a897', '#7b8fde']

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
  const axisStyle = { fill: 'var(--ink-muted)', fontSize: 11 }
  const chartView = chartType === 'pie'
    ? <PieChart><Tooltip /><Legend /><Pie data={rows} dataKey={activeY[0]} nameKey={safeX} cx="50%" cy="48%" outerRadius={92} label>{rows.map((row, index) => <Cell key={`${row[safeX]}-${index}`} fill={chartColors[index % chartColors.length]} />)}</Pie></PieChart>
    : chartType === 'scatter'
      ? <ScatterChart {...common}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" dataKey={safeX} tick={axisStyle} /><YAxis type="number" dataKey={activeY[0]} tick={axisStyle} /><Tooltip /><Scatter data={rows} fill={chartColors[0]} /></ScatterChart>
      : chartType === 'radar'
        ? <RadarChart data={rows}><PolarGrid /><PolarAngleAxis dataKey={safeX} tick={axisStyle} /><PolarRadiusAxis tick={axisStyle} /><Tooltip />{activeY.map((key, i) => <Radar key={key} name={key} dataKey={key} stroke={chartColors[i]} fill={chartColors[i]} fillOpacity={0.16} />)}<Legend /></RadarChart>
        : chartType === 'line'
          ? <LineChart {...common}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey={safeX} tick={axisStyle} /><YAxis tick={axisStyle} /><Tooltip /><Legend />{activeY.map((key, i) => <Line key={key} type="monotone" dataKey={key} stroke={chartColors[i]} strokeWidth={2.5} dot={{ r: 3 }} />)}</LineChart>
          : chartType === 'area'
            ? <AreaChart {...common}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey={safeX} tick={axisStyle} /><YAxis tick={axisStyle} /><Tooltip /><Legend />{activeY.map((key, i) => <Area key={key} type="monotone" dataKey={key} stroke={chartColors[i]} fill={chartColors[i]} fillOpacity={0.18} />)}</AreaChart>
            : <BarChart {...common}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey={safeX} tick={axisStyle} /><YAxis tick={axisStyle} /><Tooltip /><Legend />{activeY.map((key, i) => <Bar key={key} dataKey={key} fill={chartColors[i]} radius={[4, 4, 0, 0]} maxBarSize={54} />)}</BarChart>
  return <article className="chart-card"><div className="chart-card-head"><div className="chart-card-toolbar"><span>VIEW AS</span><div className="chart-switcher" role="group" aria-label="Change chart type">{viewTypes.map((type) => <button key={type} type="button" className={chartType === type ? 'active' : ''} aria-pressed={chartType === type} onClick={() => setChartType(type)}>{chartLabels[type]}</button>)}</div></div><h4>{chart.title || `${chartLabels[chartType]} chart`}</h4>{chart.rationale && <p>{chart.rationale}</p>}</div><div className="chart-wrap"><ResponsiveContainer width="100%" height={270}>{chartView}</ResponsiveContainer></div></article>
}

function AnalysisValue({ value }) {
  if (value == null || value === '') return null
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}><AnalysisValue value={item} /></li>)}</ul>
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd><AnalysisValue value={item} /></dd></div>)}</dl>
  return <p><InlineMarkdown text={String(value)} /></p>
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
  const responseType = result.response_type || 'analysis'
  const tabs = responseType === 'analysis' ? ['Result', 'Details Analysis', 'View SQL with Table']
    : responseType === 'help' ? ['Result'] : ['Result', 'Details Analysis']
  const fullSummary = result.summary || (rows.length ? `Query completed with ${result.row_count ?? rows.length} results. Explore the data below.` : 'The query ran successfully but returned no rows.')
  const reportHeading = fullSummary.search(/^\s*#{1,4}\s*(?:Data\s+)?Analysis\s+Report\s*$/im)
  const summary = reportHeading > 0 ? fullSummary.slice(0, reportHeading).trim() : fullSummary
  const keyFindings = result.key_findings?.length
    ? result.key_findings
    : result.analysis?.key_findings || result.analysis?.result_interpretation
  const keyFindingItems = Array.isArray(keyFindings)
    ? keyFindings
    : typeof keyFindings === 'string'
      ? keyFindings.split(/(?<=[.!?])\s+(?=[A-Z])/).map((finding) => finding.trim()).filter(Boolean)
      : []
  const citationData = result.citations || result.sources || result.catalog_entries || []
  const citations = Array.isArray(citationData) ? citationData : [citationData]

  async function copySql() {
    try { await navigator.clipboard.writeText(result.sql); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { setCopied(false) }
  }

  return <section className="answer" aria-live="polite">
    {result.error ? <div className="assistant-response"><div className="assistant-avatar"><Sparkles size={17} /></div><div className="assistant-content"><div className="assistant-label">INTENTRA <span>·</span> COULD NOT COMPLETE</div><div className="error-panel"><CircleAlert size={20} /><span>{result.error}</span></div></div></div> : <>
      {responseType === 'analysis' ? <div className="answer-brand"><div className="assistant-avatar"><Sparkles size={17} /></div><div className="assistant-label">INTENTRA <span>·</span> DATA INSIGHT</div></div> : <div className="assistant-response"><div className="assistant-avatar"><Sparkles size={17} /></div><div className="assistant-content"><div className="assistant-label">INTENTRA <span>·</span> {responseType === 'catalog' ? 'KNOWLEDGE CATALOG' : responseType === 'dataset_overview' ? 'DATA CATALOG' : 'ASSISTANT'}</div><div className="summary-block"><MarkdownContent text={summary} /></div>{result.history_warning && <div className="error-panel"><CircleAlert size={17} /><span>{result.history_warning}</span></div>}</div></div>}
      {tabs.length > 1 && <nav className="answer-tabs" aria-label="Answer sections" role="tablist">{tabs.map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab === 'Charts' && <BarChart3 size={15} />}{tab === 'Details Analysis' && <Compass size={15} />}{tab === 'View SQL with Table' && <Code2 size={15} />}{tab}</button>)}</nav>}
      {activeTab === 'Result' && responseType !== 'help' && <section className="answer-panel" role="tabpanel">
        <div className="result-overview-heading"><span className="block-label"><Table2 size={16} /> RESULT</span></div>
        <section className="result-summary-card"><h3>Summary</h3><MarkdownContent text={summary} /></section>
        {keyFindingItems.length > 0 && <section className="key-findings-card"><h3>Key Findings</h3><AnalysisValue value={keyFindingItems} /></section>}
        {citations.length > 0 && <section className="response-citations"><h3>Sources</h3><ul>{citations.map((citation, index) => { const title = typeof citation === 'string' ? citation : citation?.displayName || citation?.title || citation?.name || citation?.fqn || `Source ${index + 1}`; const detail = typeof citation === 'string' ? '' : citation?.fqn || citation?.uri || citation?.location; return <li key={`${title}-${index}`}><Database size={14} /><span><strong>{title}</strong>{detail && <small>{detail}</small>}</span></li> })}</ul></section>}
        {reportHeading > 0 && <details className="full-agent-response"><summary>View full agent response</summary><MarkdownContent text={fullSummary} /></details>}
        {result.history_warning && <div className="error-panel"><CircleAlert size={17} /><span>{result.history_warning}</span></div>}
        {responseType === 'analysis' && <section className="result-charts" aria-label="Charts for this result"><div className="result-section-heading"><span><BarChart3 size={16} /> CHARTS</span><small>Visual views of the same query results</small></div>{canChart ? <VisualizationAgent question={entry.question} rows={rows} columns={columns} initialAnalysis={result.visualization} /> : <div className="no-results">No chartable rows were returned for this question.</div>}</section>}
        {rows.length > 0 && <section className="result-data-section"><div className="result-heading"><div><span className="block-label"><Table2 size={16} /> {responseType === 'dataset_overview' ? 'AVAILABLE DATA' : 'SUPPORTING DATA'}</span><h3>{result.row_count ?? rows.length} {responseType === 'dataset_overview' ? 'tables / items' : rows.length === 1 ? 'row' : 'rows'} returned</h3></div><button className="subtle-action" onClick={() => downloadCsv(rows, columns)}><ArrowDownToLine size={17} /> Export CSV</button></div><div className="result-frame"><Table rows={rows} columns={columns} /></div></section>}
        {responseType === 'catalog' && <div className="catalog-agent-fields">{Object.entries(result.data || {}).filter(([, value]) => value != null && value !== '' && (!Array.isArray(value) || value.length > 0)).map(([key, value]) => <article key={key}><h4>{key.replaceAll('_', ' ')}</h4><AnalysisValue value={value} /></article>)}</div>}
      </section>}
      {activeTab === 'Details Analysis' && <section className="answer-panel" role="tabpanel"><SqlAnalysis analysis={result.analysis} />{responseType === 'dataset_overview' && <div className="sql-analysis"><div className="sql-analysis-heading"><span><Compass size={16} /> DATASET OVERVIEW</span></div><div className="sql-analysis-grid"><article className="sql-analysis-card wide"><h4>Metadata source</h4><p>Read directly from BigQuery dataset and table metadata. No analytical query was executed.</p></article></div></div>}{result.catalog_entries?.length > 0 && <details className="assets-details"><summary><span><Database size={18} /> Catalog assets consulted</span><ChevronDown size={18} /></summary><div className="asset-list">{result.catalog_entries.map((asset) => <div key={asset.name}><Database size={15} /><span>{asset.displayName || asset.fqn}<small>{asset.fqn}</small></span><em>{asset.system}</em></div>)}</div></details>}</section>}
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
  return <div className="assistant-response"><div className="assistant-avatar"><Sparkles size={17} /></div><div className="assistant-content"><div className="assistant-label">INTENTRA <span>·</span> KNOWLEDGE CATALOG AGENT <i className={`catalog-agent-status ${status}`}>{status.replaceAll('_', ' ')}</i></div><div className="catalog-agent-result"><p className="catalog-agent-message">{response.message || 'The Knowledge Catalog Agent completed its review.'}</p>{response.history_warning && <div className="error-panel"><CircleAlert size={17} /><span>{response.history_warning}</span></div>}{fields.length > 0 && <div className="catalog-agent-fields">{fields.map(([key, value]) => <article key={key}><h4>{key.replaceAll('_', ' ')}</h4><AnalysisValue value={value} /></article>)}</div>}</div></div></div>
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
    <ChatComposer className="catalog-agent-composer" id="catalog-agent-question" label="Ask the Knowledge Catalog Agent" value={input} onChange={setInput} onSubmit={submit} placeholder={datasetId ? 'Ask the catalog agent to review or improve metadata…' : 'Choose a dataset in Settings → Manage connections…'} busy={busy} disabled={!datasetId} busyLabel="Reviewing" />
  </section>
}

const underwritingStatuses = ['All applications', 'Ready for underwriting', 'New', 'In review', 'Needs information', 'Referred', 'Approved', 'Declined']
const statusClass = (status) => status.toLowerCase().replaceAll(' ', '-')

function PremiumCalculationPanel({ calculation }) {
  const money = (value) => value == null ? 'Pending' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: calculation.currency || 'INR', maximumFractionDigits: 2 }).format(value)
  const rows = [
    ['Applicant age', calculation.age == null ? 'Pending' : `${calculation.age} · age band ${calculation.age_band || 'not selected'}`],
    ['Cover amount', money(calculation.sum_assured)],
    ['Policy term', calculation.term_years == null ? 'Pending' : `${calculation.term_years} years`],
    ['Base rate per ₹1,000', calculation.base_rate_per_1000 == null ? 'Pending' : money(calculation.base_rate_per_1000)],
    ['Rating factors', [calculation.term_multiplier, calculation.tobacco_multiplier, calculation.medical_multiplier, calculation.occupation_multiplier].some((value) => value == null) ? 'Review required' : `Term ${calculation.term_multiplier} × tobacco ${calculation.tobacco_multiplier} × medical ${calculation.medical_multiplier} × occupation ${calculation.occupation_multiplier}`],
    ['Annual premium before tax', money(calculation.annual_premium_before_tax)],
    [`${calculation.payment_frequency || 'Payment'} installment before tax`, money(calculation.installment_before_tax)],
    ['Tax / total payable', calculation.tax == null ? 'Pending current tax verification' : `${money(calculation.tax)} · ${money(calculation.total_payable)}`],
  ]
  return <section className="uw-premium-breakdown">
    <div className="uw-premium-breakdown-heading"><div><small>ILLUSTRATIVE · NOT AN APPROVED QUOTE</small><strong>{calculation.status === 'illustrative_only' ? money(calculation.annual_premium_before_tax) : 'No premium calculated'}</strong><span>{calculation.policy_name || 'Selected sample policy'} · {calculation.source_filename || 'policy configuration'}</span></div><span>{(calculation.status || 'pending').replaceAll('_', ' ')}</span></div>
    <div className="uw-premium-breakdown-grid">{rows.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
    {calculation.findings?.map((finding, index) => <p key={`premium-finding-${index}`}>{finding}</p>)}
  </section>
}

function ApplicationIntakeForm({ onSubmit, onClose, ready, busy, error }) {
  const [insuranceType, setInsuranceType] = useState('health')
  return <form className="uw-intake-form" onSubmit={onSubmit}>
    <div className="uw-intake-heading"><div><strong>Start an application</strong><span>Submit source documents for extraction and employee review.</span></div><button type="button" className="uw-back-button" onClick={onClose} aria-label="Close intake">Close</button></div>
    {!ready && <div className="uw-config-notice"><CircleAlert size={17} /><span>Document processing is not configured yet. Set the Document AI processor and private Cloud Storage bucket before accepting applicant documents.</span></div>}
    {error && <div className="error-panel"><CircleAlert size={16} />{error}</div>}
    <div className="uw-intake-fields"><label>Insurance type<select name="insurance_type" value={insuranceType} onChange={(event) => setInsuranceType(event.target.value)}><option value="health">Health</option><option value="travel">Travel</option><option value="motor">Motor</option><option value="life">Life</option><option value="other">Other</option></select></label><label>Applicant full name<input name="applicant_name" required minLength="2" maxLength="200" /></label><label>Date of birth<input name="date_of_birth" type="date" required /></label><label>Product code<input name="product_code" required maxLength="80" placeholder="Insurer product code" /></label><label>Product name<input name="product_name" required maxLength="200" placeholder="Insurance product" /></label>{insuranceType === 'life' && <><label>Sum assured (INR)<input name="sum_assured_inr" type="number" min="1" step="1" required placeholder="e.g. 5000000" /></label><label>Policy term (years)<input name="term_years" type="number" min="1" max="60" step="1" required placeholder="e.g. 20" /></label><label>Tobacco classification<select name="tobacco_status" defaultValue="UNKNOWN"><option value="NON_SMOKER">Non-smoker</option><option value="SMOKER">Smoker</option><option value="UNKNOWN">Unknown · refer for review</option></select></label><label>Medical classification<select name="medical_class" defaultValue="PENDING"><option value="STANDARD">Standard · verified</option><option value="MODERATE_RISK">Moderate risk · verified</option><option value="HIGH_RISK">High risk · specialist review</option><option value="PENDING">Pending · no automatic price</option></select></label><label>Occupation classification<select name="occupation_class" defaultValue="SPECIALIST_REVIEW"><option value="STANDARD">Standard · verified</option><option value="ELEVATED">Elevated · verified</option><option value="SPECIALIST_REVIEW">Specialist review required</option></select></label><label>Payment frequency<select name="payment_frequency" defaultValue="ANNUAL"><option value="ANNUAL">Annual</option><option value="SEMI_ANNUAL">Semi-annual</option><option value="QUARTERLY">Quarterly</option><option value="MONTHLY">Monthly</option></select></label><p className="uw-intake-pricing-note wide">Enter classifications verified against the submitted documents. Unknown or specialist-review factors stop automatic pricing.</p></>}<label className="wide">Email (optional)<input name="email" type="email" maxLength="320" /></label><label className="wide">Application documents<input name="files" type="file" required multiple accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,application/pdf,image/jpeg,image/png,image/tiff" /><small>PDF or image files · up to 10 files · 20 MB each</small></label></div>
    <label className="uw-consent"><input type="checkbox" name="consent_confirmed" value="true" required /><span>I confirm the applicant has authorized processing by Google Cloud Document AI and Vertex AI Gemini, and storage in BigQuery and Cloud Storage, for this application.</span></label>
    <div className="uw-intake-actions"><button type="button" className="subtle-action" onClick={onClose}>Cancel</button><button className="uw-start-button" type="submit" disabled={!ready || busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <FilePlus2 size={16} />} Submit and process</button></div>
    <p className="uw-intake-privacy">Original files are sent to the configured Document AI processor and stored in the private bucket. OCR text may also be processed by Vertex AI Gemini to structure fields.</p>
  </form>
}

const policyTypes = ['health', 'travel', 'motor', 'life', 'other']
const policyCategories = [
  { id: 'company', label: 'Customer policies', description: 'Company underwriting, eligibility, and product rules applied to customer applications.', icon: ScrollText },
  { id: 'regulatory', label: 'Regulatory policies', description: 'IRDAI circulars and other regulatory sources used during underwriting.', icon: ShieldCheck },
]
function PoliciesWorkspace({ application, onReturnToApplication, onPoliciesApplied }) {
  const [type, setType] = useState(application?.insurance_type || 'health')
  const [kind, setKind] = useState('company')
  const [policies, setPolicies] = useState([])
  const [selectedPolicyIds, setSelectedPolicyIds] = useState([])
  const [mode, setMode] = useState('library')
  const [primaryPolicyId, setPrimaryPolicyId] = useState('')
  const [policyLoading, setPolicyLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sourceFile, setSourceFile] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [deleteTargets, setDeleteTargets] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function refresh() {
    setPolicyLoading(true); setError('')
    try {
      const response = await fetch(`/underwriting/policies?insurance_type=${encodeURIComponent(type)}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || 'Could not load policies')
      setPolicies(body.policies || [])
    } catch (err) { setPolicies([]); setError(err.message) } finally { setPolicyLoading(false) }
  }
  useEffect(() => { refresh() }, [type])
  useEffect(() => {
    if (application) setType(application.insurance_type || 'health')
    setSelectedPolicyIds((application?.policy_selection?.policies || []).map((item) => item.policy_id))
    setPrimaryPolicyId(application?.policy_selection?.primary_policy_id || '')
  }, [application?.application_id, application?.policy_selection?.saved_at])
  const locked = Boolean(application?.workflow?.started_at)
  const casePolicies = locked ? application.policy_selection?.policies || [] : policies.filter((policy) => !application || policy.policy_kind === 'regulatory' || !policy.product_code || policy.product_code.toUpperCase() === application.product_code?.toUpperCase())
  const visiblePolicies = casePolicies.filter((policy) => policy.policy_kind === kind)
  const currentCategory = policyCategories.find((category) => category.id === kind) || policyCategories[0]
  const selectedCompanyPolicies = casePolicies.filter((policy) => policy.policy_kind === 'company' && selectedPolicyIds.includes(policy.policy_id))
  const selectedForDeletion = visiblePolicies.filter((policy) => selectedPolicyIds.includes(policy.policy_id) && policies.some((entry) => entry.policy_id === policy.policy_id))
  const selectedRegulatoryPolicies = casePolicies.filter((policy) => policy.policy_kind === 'regulatory' && selectedPolicyIds.includes(policy.policy_id))
  async function deleteSelectedPolicies() {
    if (!deleteTargets?.length || deleting) return
    setDeleting(true); setDeleteError(''); setMessage('')
    try {
      const response = await fetch('/underwriting/policies/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_ids: deleteTargets.map((policy) => policy.policy_id) }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.detail || `Deletion failed (${response.status}). Please retry.`)
      const ids = body.deleted_policy_ids || []
      setPolicies((current) => current.filter((policy) => !ids.includes(policy.policy_id)))
      setSelectedPolicyIds((current) => current.filter((id) => !ids.includes(id)))
      if (ids.includes(primaryPolicyId)) setPrimaryPolicyId('')
      setDeleteTargets(null)
      setMessage(`Deleted ${ids.length} ${ids.length === 1 ? 'policy' : 'policies'} from the library.`)
    } catch (err) { setDeleteError(err.message) } finally { setDeleting(false) }
  }
  function clearVisibleSelection() {
    const visibleIds = new Set(visiblePolicies.map((policy) => policy.policy_id))
    setSelectedPolicyIds((current) => current.filter((id) => !visibleIds.has(id)))
  }
  function togglePolicy(policyId) {
    setSelectedPolicyIds((current) => current.includes(policyId) ? current.filter((id) => id !== policyId) : [...current, policyId])
  }
  async function applySelectedPolicies() {
    if (!application) return setError('Open an application from the inbox before applying policies.')
    if (!selectedCompanyPolicies.length) return setError('Select at least one matching company policy.')
    setSaving(true); setError('')
    try {
      const response = await fetch(`/underwriting/cases/${encodeURIComponent(application.application_id)}/policies`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_ids: selectedPolicyIds, primary_policy_id: selectedCompanyPolicies.some((policy) => policy.policy_id === primaryPolicyId) ? primaryPolicyId : selectedCompanyPolicies[0].policy_id }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.detail || 'Could not apply policies to the application.')
      onPoliciesApplied(body)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  async function analyze(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage(''); setAnalysis(null)
    try {
      if (!sourceFile) throw new Error('Choose a policy file to analyze.')
      const form = new FormData(); form.append('insurance_type', type); form.append('file', sourceFile)
      const response = await fetch('/underwriting/policies/analyze', { method: 'POST', body: form })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.detail || `Analysis failed (${response.status})`)
      setAnalysis({ ...body, policies: (body.policies || []).map((candidate, index) => ({ ...candidate, selected: true, review_id: `${Date.now()}-${index}` })) })
      if (!body.policies?.length) setMessage('The file was analyzed, but no policy entries were identified.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  function updateCandidate(reviewId, field, value) {
    setAnalysis((current) => ({ ...current, policies: current.policies.map((candidate) => candidate.review_id === reviewId ? { ...candidate, [field]: value } : candidate) }))
  }
  function addReviewPolicy() {
    const reviewId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const template = analysis?.policies?.[0] || {}
    const candidate = { policy_name: '', insurance_type: template.insurance_type || type, policy_kind: 'company',
      insurer_name: template.insurer_name || '', product_name: template.product_name || '', product_code: template.product_code || '',
      version: template.version || '', effective_from: template.effective_from || '', selected: true, review_id: reviewId,
      extracted_rules: { summary: '', rules: [], source_sha256: analysis?.source_sha256, reviewer_added: true,
        source_metadata: template.extracted_rules?.source_metadata || {}, analysis_method: 'employee_added_during_review' } }
    setAnalysis((current) => ({ ...current, policies: [...current.policies, candidate] }))
    return reviewId
  }
  async function saveCandidates() {
    if (!sourceFile) return setError('Choose and analyze the source file again before saving.')
    const selected = analysis?.policies?.filter((candidate) => candidate.selected) || []
    if (!selected.length) return setError('Select at least one suggested policy to add.')
    if (selected.some((candidate) => candidate.policy_name.trim().length < 2 || (candidate.extracted_rules?.rules || []).some((rule) => !rule.topic?.trim() || !rule.rule_text?.trim()))) return setError('Each selected policy needs a name. Every rule needs a name and explanation. Review the empty fields before adding.')
    setSaving(true); setError(''); setMessage('')
    const saved = []; const failures = []
    for (const candidate of selected) {
      try {
        const form = new FormData()
        for (const field of ['policy_name', 'insurance_type', 'policy_kind', 'insurer_name', 'product_name', 'product_code', 'uin', 'version', 'effective_from', 'effective_to']) form.append(field, candidate[field] || '')
        form.append('extracted_rules_json', JSON.stringify(candidate.extracted_rules || {})); form.append('extraction_model', analysis.extraction_model || '')
        form.append('file', sourceFile)
        const response = await fetch('/underwriting/policies', { method: 'POST', body: form })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.detail || `Save failed (${response.status})`)
        saved.push(candidate.review_id)
      } catch (err) { failures.push(`${candidate.policy_name}: ${err.message}`) }
    }
    const remaining = analysis.policies.filter((candidate) => !saved.includes(candidate.review_id))
    setAnalysis(remaining.length ? { ...analysis, policies: remaining } : null)
    if (saved.length && !remaining.length) { setMode('library'); setSourceFile(null) }
    if (saved.length) { setMessage(`Added ${saved.length} ${saved.length === 1 ? 'policy' : 'policies'} to the library.`); await refresh() }
    if (failures.length) setError(failures.join(' · '))
    setSaving(false)
  }
  async function addManually(event) {
    event.preventDefault(); const manualForm = event.currentTarget; setBusy(true); setError(''); setMessage('')
    try {
      const form = new FormData(manualForm)
      form.set('insurance_type', application?.insurance_type || type)
      const response = await fetch('/underwriting/policies', { method: 'POST', body: form })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.detail || `Upload failed (${response.status})`)
      setMessage(`Added ${body.policy_name} to the policy library.`); manualForm.reset(); await refresh()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <section className="underwriting-workspace policy-workspace">
    {deleteTargets && <DeletePolicyDialog policies={deleteTargets} busy={deleting} error={deleteError} onCancel={() => { setDeleteTargets(null); setDeleteError('') }} onDelete={deleteSelectedPolicies} />}
    {application && <div className="case-context-banner"><div><span>SELECTING POLICIES FOR</span><strong>{application.applicant} · {application.application_id}</strong><small>{application.insurance_type} insurance · {application.plan} · {application.product_code}</small></div><button type="button" className="subtle-action" onClick={onReturnToApplication} disabled={saving}>Return to application <ArrowRight size={15} /></button></div>}
    <div className="uw-heading"><div><span className="uw-eyebrow"><ScrollText size={14} /> POLICY LIBRARY</span><h1>Policies & rules</h1><p>Upload a source to identify policy entries, review the suggested details, and choose what to add to the library.</p></div></div>
    <div className="policy-mode-switch" role="tablist" aria-label="Policy entry method"><button type="button" role="tab" aria-selected={mode === 'library'} className={mode === 'library' ? 'active' : ''} onClick={() => setMode('library')}><ScrollText size={15} /> Policy library</button><button type="button" role="tab" aria-selected={mode === 'analyze'} className={mode === 'analyze' ? 'active' : ''} onClick={() => { setMode('analyze'); setError('') }}><Sparkles size={15} /> Upload & review</button><button type="button" role="tab" aria-selected={mode === 'manual'} className={mode === 'manual' ? 'active' : ''} onClick={() => { setMode('manual'); setError('') }}><FilePlus2 size={15} /> Add one manually</button></div>
    {mode === 'analyze' ? <>
      <ol className="policy-import-flow" aria-label="Policy upload process"><li className={!analysis ? 'current' : ''}><span>1</span> Upload & analyze</li><li className={analysis ? 'current' : ''}><span>2</span> Review & edit</li><li><span>3</span> Add to policy library</li></ol>
      <form className="uw-intake-form policy-upload-form" onSubmit={analyze}>
        <div className="uw-intake-heading"><div><strong>Analyze a policy source</strong><span>Gemini will suggest the policy entries and details it can identify. You review and edit them before anything is saved.</span></div></div>
        <div className="uw-intake-fields"><label>Insurance type for this source<select value={type} disabled={Boolean(application) || busy || saving} onChange={(event) => { setType(event.target.value); setAnalysis(null) }}>{policyTypes.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label><label className="wide">Policy file<input type="file" accept=".pdf,.txt,.md,.json,application/pdf,text/plain,text/markdown,application/json" onChange={(event) => { setSourceFile(event.target.files?.[0] || null); setAnalysis(null) }} disabled={busy || saving} required /><small>PDF, TXT, Markdown, or JSON up to 20 MB. PDFs need selectable text; scanned PDFs require Document AI OCR.</small></label></div>
        <div className="uw-intake-actions"><button className="uw-start-button" type="submit" disabled={busy || saving}>{busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} {busy ? 'Analyzing policies & rules…' : 'Analyze source'}</button></div>
      </form>
      {analysis && <section className="policy-review-queue"><div className="policy-review-heading"><div><span className="block-label"><ClipboardCheck size={15} /> REVIEW BEFORE ADDING</span><strong>{analysis.policies.length} policy drafts · {analysis.policies.reduce((total, candidate) => total + (candidate.extracted_rules?.rules?.length || 0), 0)} rules</strong><p>{analysis.analysis_summary}</p><small>Analyzed with Gemini · {analysis.extraction_model} · {analysis.source_filename}</small></div><button className="uw-start-button" type="button" onClick={saveCandidates} disabled={saving || !analysis.policies.some((candidate) => candidate.selected)}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Add selected policies</button></div>
        {analysis.review_notes?.length > 0 && <div className="review-attention"><strong>Questions to review</strong><ul>{analysis.review_notes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}
        <PolicyReview policies={analysis.policies} onUpdate={updateCandidate} onAdd={addReviewPolicy} disabled={saving || busy} />
        <p className="uw-footer-note"><ShieldCheck size={14} /> Analysis produces review suggestions only. Confirm the source, effective dates, jurisdiction, and applicability before adding policies.</p>
      </section>}
    </> : mode === 'manual' ? <form className="uw-intake-form policy-upload-form" onSubmit={addManually}>
      <div className="uw-intake-heading"><div><strong>Add one policy manually</strong><span>Use this option when you prefer to enter the policy metadata yourself.</span></div></div>
      <div className="uw-intake-fields"><label>Policy name<input name="policy_name" required minLength="2" maxLength="200" placeholder="Product underwriting guide" /></label><label>Insurance type<select name="insurance_type" value={type} onChange={(event) => setType(event.target.value)}>{policyTypes.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label><label>Policy category<select name="policy_kind" defaultValue={kind}><option value="company">Customer policy · insurer/product rules</option><option value="regulatory">Regulatory policy</option></select></label><label>Insurer<input name="insurer_name" maxLength="200" placeholder="Insurer name" /></label><label>Product name<input name="product_name" maxLength="200" placeholder="Product name (optional)" /></label><label>Product code<input name="product_code" maxLength="80" placeholder="Product code (optional)" /></label><label>UIN / reference<input name="uin" maxLength="100" placeholder="UIN or document reference" /></label><label>Version<input name="version" maxLength="80" placeholder="Version / circular number" /></label><label>Effective from<input name="effective_from" type="date" /></label><label>Effective to<input name="effective_to" type="date" /></label><label className="wide">Policy file<input name="file" type="file" accept=".pdf,.txt,.md,.json,application/pdf,text/plain,text/markdown,application/json" required /><small>PDF, TXT, Markdown, or JSON up to 20 MB. PDFs need selectable text; scanned PDFs require Document AI OCR.</small></label></div>
      <div className="uw-intake-actions"><button className="uw-start-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <FilePlus2 size={16} />} Add policy</button></div>
    </form> : null}
    {message && <p className="uw-notice" role="status">{message}</p>}{error && <div className="error-panel"><CircleAlert size={16} />{error}</div>}
    <section className="uw-card policy-list-card">
      <div className="policy-category-tabs" role="tablist" aria-label="Policy categories">{policyCategories.map((category, index) => {
        const Icon = category.icon
        const count = casePolicies.filter((policy) => policy.policy_kind === category.id).length
        return <button type="button" role="tab" key={category.id} id={`policy-category-${category.id}`} aria-controls="policy-category-panel" aria-selected={kind === category.id} tabIndex={kind === category.id ? 0 : -1} disabled={busy || saving || deleting} onClick={() => setKind(category.id)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? policyCategories.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + policyCategories.length) % policyCategories.length
          setKind(policyCategories[next].id)
          document.getElementById(`policy-category-${policyCategories[next].id}`)?.focus()
        }}><Icon size={19} /><span><strong>{category.label}</strong><small>{category.id === 'company' ? 'Insurer & product rules' : 'Regulations & circulars'}</small></span><b aria-label={`${count} policies`}>{policyLoading ? '…' : count}</b></button>
      })}</div>
      <div id="policy-category-panel" role="tabpanel" aria-labelledby={`policy-category-${kind}`} tabIndex={0}>
      <div className="uw-table-toolbar"><div><span className="block-label">{currentCategory.label.toUpperCase()}</span><strong>{policyLoading ? 'Loading…' : `${visiblePolicies.length} policies · ${type}`}</strong><p className="policy-category-description">{currentCategory.description}</p></div><div className="uw-table-controls"><select value={type} disabled={Boolean(application) || busy || saving || deleting} onChange={(event) => { setType(event.target.value); setSelectedPolicyIds([]); setPrimaryPolicyId('') }} aria-label="Filter policies by insurance type">{policyTypes.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></div></div>
      {application && <div className="case-policy-selection-bar"><div><strong>{selectedCompanyPolicies.length} customer + {selectedRegulatoryPolicies.length} regulatory selected</strong><small>{locked ? 'Policy versions are locked for this active pipeline.' : 'Select from both categories, then apply the policies together.'}</small></div>{selectedCompanyPolicies.length > 0 && <label>Primary product policy<select value={selectedCompanyPolicies.some((policy) => policy.policy_id === primaryPolicyId) ? primaryPolicyId : selectedCompanyPolicies[0].policy_id} disabled={locked} onChange={(event) => setPrimaryPolicyId(event.target.value)}>{selectedCompanyPolicies.map((policy) => <option key={policy.policy_id} value={policy.policy_id}>{policy.policy_name}</option>)}</select></label>}<button type="button" className="uw-start-button" disabled={saving || locked || !selectedCompanyPolicies.length} onClick={applySelectedPolicies}><Check size={15} /> {saving ? 'Applying…' : 'Apply policies & return'}</button></div>}
      {!application && <p className="case-library-hint">Select policies below to manage the library. Open an application to apply policies to an underwriting review.</p>}
      {!locked && <div className="policy-library-bulk-actions"><span><strong>{selectedForDeletion.length}</strong> {kind === 'company' ? 'customer' : 'regulatory'} policies selected</span><div><button type="button" className="subtle-action" disabled={!selectedForDeletion.length || deleting || saving} onClick={clearVisibleSelection}>Clear selection</button><button type="button" className="policy-delete-button" disabled={!selectedForDeletion.length || policyLoading || deleting || saving || busy} onClick={() => { setDeleteError(''); setDeleteTargets([...selectedForDeletion]) }}><Trash2 size={15} /> Delete selected</button></div></div>}
      <PolicyLibraryTable emptyMessage={`No ${currentCategory.label.toLowerCase()} in this view. Upload a source to add entries for this insurance type.`} policies={visiblePolicies} selectedIds={selectedPolicyIds} locked={locked || deleting || saving} loading={policyLoading} onToggle={togglePolicy} onSelectVisible={(ids, checked) => setSelectedPolicyIds((current) => checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)))} />
      </div>
    </section>
    <p className="uw-footer-note"><ShieldCheck size={14} /> Extracted text is a review aid. Confirm the original document, effective dates, jurisdiction, and applicability before underwriting use.</p>
  </section>
}

function UnderwritingWorkspace({ onAskAnalytics, onOpenPolicies, applicationId, panel, onOpenCase, onCloseCase, onPanelChange }) {
  const [cases, setCases] = useState([])
  const [selectedId, setSelectedId] = useState(applicationId || '')
  const [filter, setFilter] = useState('All applications')
  const [search, setSearch] = useState('')
  const workspaceCaseId = applicationId
  const setWorkspaceCaseId = (id) => id ? onOpenCase(id) : onCloseCase()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [stepResult, setStepResult] = useState(null)
  const [runningStep, setRunningStep] = useState('')
  const [intakeStatus, setIntakeStatus] = useState(null)
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [intakeBusy, setIntakeBusy] = useState(false)
  const [intakeError, setIntakeError] = useState('')
  const [startingPipeline, setStartingPipeline] = useState(false)
  const [pipelineEvents, setPipelineEvents] = useState([])
  useEffect(() => {
    if (!applicationId) return
    let cancelled = false
    setSelectedId(applicationId); setNotice('')
    fetch(`/underwriting/cases/${encodeURIComponent(applicationId)}`).then(async (response) => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || 'Could not open the application.')
      return body
    }).then((body) => {
      if (cancelled) return
      setCases((previous) => [body, ...previous.filter((item) => item.application_id !== body.application_id)])
      setStepResult(body.workflow?.pending_result || null)
    }).catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [applicationId])

  useEffect(() => {
    fetch('/underwriting/intake-status').then((response) => response.json()).then(setIntakeStatus).catch(() => setIntakeStatus(null))
    fetch('/underwriting/cases').then(async (response) => {
      if (!response.ok) throw new Error('Could not load applications.')
      return response.json()
    }).then((data) => {
      setCases((previous) => [...previous.filter((item) => item.application_id === applicationId), ...(data.cases || []).filter((item) => !previous.some((existing) => existing.application_id === applicationId && existing.application_id === item.application_id))])
      setSelectedId(applicationId || (data.cases || [])[0]?.application_id || '')
    }).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false))
  }, [])

  const selectedCase = cases.find((item) => item.application_id === selectedId)
  async function submitIntake(event) { event.preventDefault(); setIntakeBusy(true); setIntakeError(''); try { const response = await fetch('/underwriting/applications', { method: 'POST', body: new FormData(event.currentTarget) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.detail || `Intake failed (${response.status})`); setCases((previous) => [body, ...previous]); setSelectedId(body.application_id); setWorkspaceCaseId(body.application_id); setStepResult(null); setIntakeOpen(false) } catch (err) { setIntakeError(err.message) } finally { setIntakeBusy(false) } }
  const filteredCases = cases.filter((item) => (filter === 'All applications' || item.status === filter) && `${item.application_id} ${item.applicant} ${item.plan} ${item.status}`.toLowerCase().includes(search.toLowerCase()))
  const pending = cases.filter((item) => ['New', 'Ready for underwriting', 'In review', 'Needs information', 'Referred'].includes(item.status)).length
  const today = cases.filter((item) => new Date(item.received_at).toDateString() === new Date().toDateString()).length
  const flagged = cases.filter((item) => item.issues?.length > 0 || item.documents?.some((doc) => doc.state === 'Missing')).length

  async function startPipeline() { await runPipeline('run') }

  async function recordAction(action, reviewNote = '') {
    if (!selectedCase || saving) return
    if (['Approve', 'Decline', 'Refer', 'Request information'].includes(action) && !reviewNote.trim()) {
      setNotice('Add a brief review note before recording this action.')
      return
    }
    setSaving(true)
    setNotice('')
    try {
      const updated = await post(`/underwriting/cases/${encodeURIComponent(selectedCase.application_id)}/actions`, { action, reason: reviewNote })
      setCases((previous) => previous.map((item) => item.application_id === updated.application_id ? updated : item))
      setNotice(`${action} recorded for ${updated.application_id}.`)
      return updated
    } catch (requestError) { setNotice(requestError.message) } finally { setSaving(false) }
  }

  async function runPipeline(command = 'run', payload = {}) {
    if (!workspaceCaseId || runningStep) return
    const caseId = workspaceCaseId
    setRunningStep('starting'); setStartingPipeline(true); setNotice(''); setPipelineEvents([])
    function applySnapshot(snapshot) {
      if (!snapshot || snapshot.application_id !== caseId) return
      setCases((previous) => [snapshot, ...previous.filter((item) => item.application_id !== caseId)])
      setStepResult(snapshot.workflow?.pending_result || null)
    }
    try {
      const updated = await postStream(`/underwriting/cases/${encodeURIComponent(caseId)}/pipeline/run/stream`, { command, ...payload }, (event) => {
        setRunningStep(event.agent || 'starting')
        applySnapshot(event.application)
        setPipelineEvents((previous) => [...previous, { kind: event.kind, agent: event.agent, message: event.message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }].slice(-40))
      })
      applySnapshot(updated); onPanelChange('pipeline')
    } catch (err) {
      setNotice(err.message)
      try { const response = await fetch(`/underwriting/cases/${encodeURIComponent(caseId)}`); if (response.ok) applySnapshot(await response.json()) } catch {}
    } finally { setRunningStep(''); setStartingPipeline(false) }
  }

  const workflow = selectedCase?.workflow || { steps: {}, current_step: 'documents' }


  return <section className="underwriting-workspace">
    <div className="uw-heading"><div><span className="uw-eyebrow"><Heart size={14} /> INSURANCE · EMPLOYEE WORKSPACE</span><h1>{workspaceCaseId ? 'Application workspace' : 'Applications'}</h1><p>{workspaceCaseId ? 'Review the application, apply policies, and run underwriting.' : 'Review received applications and move each case through underwriting.'}</p></div>{!workspaceCaseId && <button className="uw-start-button" onClick={() => { setIntakeOpen((open) => !open); setIntakeError('') }}><FilePlus2 size={16} /> New application</button>}</div>
    {!workspaceCaseId && <div className="uw-metrics"><article><span>Applications</span><strong>{loading ? '—' : cases.length}</strong><small>Submitted applications</small></article><article><span>Received today</span><strong>{loading ? '—' : today}</strong><small>Intake volume</small></article><article><span>Pending review</span><strong>{loading ? '—' : pending}</strong><small>Needs employee action</small></article><article><span>With open issues</span><strong>{loading ? '—' : flagged}</strong><small>Missing or inconsistent info</small></article></div>}
    {intakeOpen && !workspaceCaseId && <ApplicationIntakeForm onSubmit={submitIntake} onClose={() => setIntakeOpen(false)} ready={Boolean(intakeStatus?.ready)} busy={intakeBusy} error={intakeError} />}
    {error && <div className="error-panel"><CircleAlert size={18} />{error}</div>}
    {!workspaceCaseId ? <section className="uw-applications-panel">
      <div className="uw-table-toolbar"><div><span className="block-label"><ClipboardCheck size={15} /> APPLICATIONS</span><strong>{filteredCases.length} of {cases.length} applications</strong></div><div className="uw-table-controls"><label className="uw-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search applicant, ID, or plan" aria-label="Search applications" /></label><select id="uw-filter" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter by status">{underwritingStatuses.map((item) => <option key={item}>{item}</option>)}</select></div></div>
      {loading ? <div className="uw-loading"><LoaderCircle className="spin" size={18} /> Loading applications…</div> : <div className="uw-table-scroll"><table className="uw-applications-table"><thead><tr><th>Select</th><th>Application</th><th>Applicant</th><th>Product</th><th>Received</th><th>Status</th><th>Risk assessment</th></tr></thead><tbody>{filteredCases.map((item) => <tr key={item.application_id} className={selectedId === item.application_id ? 'selected' : ''} onClick={() => setSelectedId(item.application_id)}><td><input type="radio" name="selected-application" checked={selectedId === item.application_id} onChange={() => setSelectedId(item.application_id)} aria-label={`Select ${item.application_id}`} /></td><td><strong>{item.application_id}</strong></td><td>{item.applicant}</td><td>{item.plan}</td><td>{new Date(item.received_at).toLocaleDateString()}</td><td><span className={`uw-status-pill ${statusClass(item.status)}`}>{item.status}</span></td><td><span className={`uw-risk-pill ${statusClass(item.risk?.band || 'not assessed')}`}><strong>{item.risk?.band || 'Not assessed'}</strong><b>{item.risk?.score ?? '—'}</b></span></td></tr>)}</tbody></table>{!filteredCases.length && <div className="uw-empty uw-empty-state"><FileText size={22} /><strong>{cases.length ? 'No applications match this search.' : 'No applications yet'}</strong><span>{cases.length ? 'Try another search or status.' : 'Start with a submitted application and its source documents.'}</span>{!cases.length && <button className="uw-start-button" onClick={() => setIntakeOpen(true)}><FilePlus2 size={16} /> Start an application</button>}</div>}</div>}
      <div className="uw-table-action"><span>{selectedCase ? <>Selected: <strong>{selectedCase.application_id}</strong> · {selectedCase.applicant}</> : 'Select an application to begin.'}</span><button className="uw-start-button" disabled={!selectedCase} onClick={() => { setWorkspaceCaseId(selectedId); setStepResult(null); setNotice('') }}><FileText size={17} /> Open application <ArrowRight size={16} /></button></div>
    </section> : <section className="uw-review-workspace">
      <div className="uw-review-top"><button className="uw-back-button" onClick={() => { setWorkspaceCaseId(''); setStepResult(null); setNotice('') }}>← Applications</button><span>UNDERWRITING WORKFLOW</span><strong>{selectedCase?.application_id}</strong></div>
      {!selectedCase && <div className="case-panel">{error ? 'Application could not be loaded.' : 'Loading application details…'}</div>}
      {selectedCase && <><header className="uw-review-title"><div><span className="uw-eyebrow"><Heart size={14} /> {(selectedCase.insurance_type || 'health').toUpperCase()} INSURANCE · {selectedCase.plan}</span><h2>{selectedCase.applicant}</h2><p>{selectedCase.application_id} · Received {new Date(selectedCase.received_at).toLocaleDateString()} <span className={`uw-status-pill ${statusClass(selectedCase.status)}`}>{selectedCase.status}</span></p></div></header>
      <div className="case-workspace-tabs" role="tablist" aria-label="Application workspace"><button type="button" role="tab" aria-selected={panel !== 'pipeline'} onClick={() => onPanelChange('overview')}><FileText size={16} /> Application details</button><button type="button" role="tab" aria-selected={panel === 'pipeline'} onClick={() => onPanelChange('pipeline')}><Activity size={16} /> {workflow.current_step === 'complete' ? 'Decision dashboard' : 'Underwriting pipeline'} <span>{Object.keys(workflow.steps || {}).length}/7</span></button><button type="button" onClick={() => onOpenPolicies(selectedCase)}><ScrollText size={16} /> Applied policies ({selectedCase.policy_selection?.policies?.length || 0})</button></div>
      {notice && <div className="uw-notice" role="status">{notice}</div>}
      {panel !== 'pipeline' ? <ApplicationOverview application={selectedCase} onOpenPolicies={() => onOpenPolicies(selectedCase)} onOpenPipeline={() => onPanelChange('pipeline')} /> : !workflow.started_at ? <PipelinePreparation application={selectedCase} readiness={intakeStatus} busy={startingPipeline} onOpenPolicies={() => onOpenPolicies(selectedCase)} onStart={startPipeline} /> : <>
      <div className="case-pipeline-context"><ShieldCheck size={17} /><span>Using {selectedCase.policy_selection?.policies?.length || 0} selected policy versions. The pipeline runs automatically and pauses when employee input is needed.</span><button type="button" onClick={() => onOpenPolicies(selectedCase)}>View policies <ArrowRight size={14} /></button></div>
      <UnderwritingPipeline key={selectedCase.application_id} application={selectedCase} result={stepResult} busy={runningStep} onRun={() => runPipeline('run')} onResume={(payload) => runPipeline('resume', payload)} onRetry={(result_id) => runPipeline('retry', { result_id })} onDecision={recordAction} saving={saving} events={pipelineEvents} PremiumPanel={PremiumCalculationPanel} /></>}
      </>}
    </section>}
    <p className="uw-footer-note"><ShieldCheck size={14} /> Decision support only · An employee must verify evidence and make the final underwriting decision.</p>
  </section>
}

function App() {
  const [view, setViewState] = useState(() => readWorkspaceRoute().view)
  const [applicationId, setApplicationId] = useState(() => readWorkspaceRoute().applicationId)
  const [casePanel, setCasePanel] = useState(() => readWorkspaceRoute().panel)
  const [caseContext, setCaseContext] = useState(null)
  const [caseContextError, setCaseContextError] = useState('')
  function setView(next) {
    setViewState(next)
    writeWorkspaceRoute(next, ['underwriting', 'policies'].includes(next) ? applicationId : '', casePanel)
  }
  function openApplication(id, nextPanel = 'overview') {
    setApplicationId(id); setCasePanel(nextPanel); setViewState('underwriting')
    writeWorkspaceRoute('underwriting', id, nextPanel)
  }
  useEffect(() => {
    const syncRoute = () => {
      const route = readWorkspaceRoute()
      setViewState(route.view); setApplicationId(route.applicationId); setCasePanel(route.panel)
    }
    window.addEventListener('popstate', syncRoute); window.addEventListener('hashchange', syncRoute)
    return () => { window.removeEventListener('popstate', syncRoute); window.removeEventListener('hashchange', syncRoute) }
  }, [])
  useEffect(() => {
    let cancelled = false
    setCaseContext((current) => current?.application_id === applicationId ? current : null); setCaseContextError('')
    if (applicationId) fetch(`/underwriting/cases/${encodeURIComponent(applicationId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((body) => { if (!cancelled) { setCaseContext(body); if (!body) setCaseContextError('This application could not be opened. Return to the inbox and try again.') } }).catch(() => { if (!cancelled) setCaseContextError('Could not load the application. Check your connection and reopen it from the inbox.') })
    return () => { cancelled = true }
  }, [applicationId, view])
  const [history, setHistory] = useState([])
  const [sessionId] = useState(browserSessionId)
  const [conversationId, setConversationId] = useState(makeId)
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
  const [datasetContext, setDatasetContext] = useState(null)
  const [datasetContextLoading, setDatasetContextLoading] = useState(false)

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

  useEffect(() => {
    if (!datasetId) { setDatasetContext(null); return undefined }
    let cancelled = false
    setDatasetContext(null)
    setDatasetContextLoading(true)
    fetch(`/datasets/${encodeURIComponent(datasetId)}/context`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Dataset metadata request failed (${response.status})`)
        return response.json()
      })
      .then((data) => { if (!cancelled) setDatasetContext(data) })
      .catch(() => { if (!cancelled) setDatasetContext(null) })
      .finally(() => { if (!cancelled) setDatasetContextLoading(false) })
    return () => { cancelled = true }
  }, [datasetId])

  useEffect(() => {
    let cancelled = false
    fetch(`/history?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Chat history is unavailable.')
        return response.json()
      })
      .then(async ({ conversations = [] }) => {
        const restored = await Promise.all(conversations.map(async (conversation) => {
          const response = await fetch(`/history/${encodeURIComponent(conversation.conversation_id)}?session_id=${encodeURIComponent(sessionId)}`)
          if (!response.ok) return { ...conversation, turns: [] }
          const data = await response.json()
          return { ...conversation, id: conversation.conversation_id, turns: data.turns || [] }
        }))
        if (!cancelled) setHistory(restored)
      })
      .catch(() => { if (!cancelled) setHistory([]) })
    return () => { cancelled = true }
  }, [sessionId])

  async function ask(value) {
    const text = value.trim()
    if (!text || loading) return
    setView('ask')
    setQuestion('')
    setActiveQuestion(text)
    setLoading(true)
    setProgress([{ agent: 'intentra', kind: 'agent_start', message: 'Starting the agent workflow.' }])
    const activeConversationId = conversationId || makeId()
    const existing = selected?.conversation_id === activeConversationId ? selected : null
    const turnId = makeId()
    const turnIndex = existing?.turns?.length || 0
    setConversationId(activeConversationId)
    try {
      const result = await postStream('/ask/stream', { question: text, dataset_id: datasetId, session_id: sessionId, conversation_id: activeConversationId, turn_id: turnId, turn_index: turnIndex }, (event) => {
        setProgress((previous) => previous.at(-1)?.message === event.message ? previous : [...previous, event].slice(-8))
      })
      const turn = { id: turnId, question: text, result }
      const conversation = { ...(existing || {}), id: activeConversationId, conversation_id: activeConversationId, dataset_id: datasetId, question: text, turns: [...(existing?.turns || []), turn] }
      setHistory((previous) => [conversation, ...previous.filter((entry) => entry.conversation_id !== activeConversationId)])
      setSelected(conversation)
    } catch (error) {
      const turn = { id: turnId, question: text, result: { error: error.message } }
      const conversation = { ...(existing || {}), id: activeConversationId, conversation_id: activeConversationId, question: text, turns: [...(existing?.turns || []), turn] }
      setSelected(conversation)
    } finally { setActiveQuestion(''); setLoading(false) }
  }

  async function askCatalogAgent(value) {
    const text = value.trim()
    if (!text || catalogAgentEntry?.pending || !datasetId) return
    setView('knowledge-agent')
    setSelected(null)
    const activeConversationId = conversationId || makeId()
    const existing = history.find((entry) => entry.conversation_id === activeConversationId)
    const turnId = makeId()
    const turnIndex = existing?.turns?.length || 0
    setConversationId(activeConversationId)
    const pending = { id: turnId, mode: 'knowledge-agent', question: text, pending: true, progress: [{ agent: 'knowledge_gap', kind: 'agent_start', message: 'Starting the Knowledge Catalog review.' }] }
    let latestProgress = pending.progress
    setCatalogAgentEntry(pending)
    try {
      const response = await postStream('/catalog-agent/stream', { question: text, dataset_id: datasetId, session_id: sessionId, conversation_id: activeConversationId, turn_id: turnId, turn_index: turnIndex }, (event) => {
        latestProgress = [...latestProgress, event].slice(-8)
        setCatalogAgentEntry((current) => current?.id === pending.id ? { ...current, progress: latestProgress } : current)
      })
      const completed = { ...pending, pending: false, progress: latestProgress, response }
      setCatalogAgentEntry(completed)
      const saved = { ...response, response_type: 'catalog', summary: response.message || 'The Knowledge Catalog agent completed its review.', columns: [], rows: [], row_count: 0, analysis: { question_understanding: text, approach: 'Routed to the Knowledge Catalog agent for metadata review.' }, sql: null, visualization: null }
      const turn = { id: turnId, question: text, result: saved }
      const conversation = { ...(existing || {}), id: activeConversationId, conversation_id: activeConversationId, dataset_id: datasetId, question: text, turns: [...(existing?.turns || []), turn] }
      setHistory((previous) => [conversation, ...previous.filter((entry) => entry.conversation_id !== activeConversationId)])
      setSelected(conversation)
    } catch (error) {
      const failed = { ...pending, pending: false, progress: latestProgress, error: error.message }
      setCatalogAgentEntry(failed)
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
    <Sidebar view={view} setView={setView} history={history} selectHistory={(index) => { const entry = history[index]; if (entry.mode === 'knowledge-agent') { setCatalogAgentEntry(entry); setView('knowledge-agent') } else { setSelected(entry); setConversationId(entry.conversation_id); setActiveQuestion(''); setView('ask') } }} newQuestion={() => { setSelected(null); setConversationId(makeId()); setCatalogAgentEntry(null); setActiveQuestion(''); setQuestion(''); setView('ask') }} open={menuOpen} close={() => setMenuOpen(false)} />
    <main className="main-panel">
      <header className="topbar"><div className="top-left"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={22} /></button><span className="breadcrumb"><span className="breadcrumb-product">INTENTRA</span><span>/</span> {view === 'ask' ? 'Data copilot' : view === 'knowledge-agent' ? 'Catalog assistant' : view === 'underwriting' ? 'Underwriting' : view === 'policies' ? 'Policies & rules' : 'Catalog explorer'}</span></div><div className="top-right"><Status state={connection} /><ThemeToggle /><HeaderSettings datasets={datasets} datasetId={datasetId} projectId={projectId} loading={datasetLoading} error={datasetError} onChange={(id) => { setDatasetId(id); setSelected(null); setConversationId(makeId()); setCatalogAgentEntry(null); setActiveQuestion(''); setQuestion('') }} /></div></header>
      <div className={`content ${view !== 'catalog' ? 'chat-content' : ''}`}>
        {view === 'catalog' && <div className="event-banner"><div className="banner-image" /><div className="banner-overlay" /><div className="banner-content"><span className="event-tag"><Trophy size={14} /> INTENTRA KNOWLEDGE STUDIO</span><h1>Know your data.<br /><em>Know your next move.</em></h1><div className="banner-bottom"><span>Intentra</span><span className="banner-separator" /><span>Built on Google Cloud</span></div></div><span className="banner-deco">01 / DISCOVER</span></div>}
        {view === 'policies' ? (applicationId && !caseContext ? <div className="case-panel">{caseContextError || 'Loading application policies…'}{caseContextError && <button className="subtle-action" onClick={() => openApplication('')}>Return to applications</button>}</div> : <PoliciesWorkspace application={caseContext} onReturnToApplication={() => openApplication(applicationId, 'pipeline')} onPoliciesApplied={(updated) => { setCaseContext(updated); openApplication(updated.application_id, 'pipeline') }} />) : view === 'underwriting' ? <UnderwritingWorkspace applicationId={applicationId} panel={casePanel} onOpenCase={openApplication} onCloseCase={() => { setApplicationId(''); setCaseContext(null); setCasePanel('overview'); writeWorkspaceRoute('underwriting'); setViewState('underwriting') }} onPanelChange={(nextPanel) => { setCasePanel(nextPanel); writeWorkspaceRoute('underwriting', applicationId, nextPanel) }} onAskAnalytics={(text) => { setSelected(null); setConversationId(makeId()); setQuestion(text); setView('ask') }} onOpenPolicies={(application) => { setCaseContext(application); setApplicationId(application.application_id); setViewState('policies'); writeWorkspaceRoute('policies', application.application_id, 'pipeline') }} /> : view === 'ask' ? <>
          <section className={`chat-workspace ${!selected && !activeQuestion ? 'chat-workspace-empty' : ''}`}>
            {!selected && !activeQuestion && <div className="chat-welcome"><span className="welcome-badge"><Sparkles size={14} /> INTENTRA DATA COPILOT</span><h2>Ask better.<br /><em>See further.</em></h2><p>{datasetId ? 'Your data has a story. Ask a question and Intentra will help you uncover it.' : 'Choose a dataset in Settings → Manage connections, then ask Intentra a question about your data.'}</p>{datasetId && datasetContext && <div className="welcome-dataset-context"><Database size={15} /><strong>{datasetContext.dataset_id}</strong><span>{datasetContext.table_count} {datasetContext.table_count === 1 ? 'table' : 'tables'}</span><small>{datasetContext.project_id}</small></div>}</div>}
            {(activeQuestion || selected) && <div className="conversation-thread">
              {(selected?.turns || []).map((turn) => <div className="conversation-turn" key={turn.id}><div className="user-message"><span>{turn.question}</span><div className="user-avatar">YOU</div></div><Answer entry={turn} /></div>)}
              {activeQuestion && <><div className="user-message"><span>{activeQuestion}</span><div className="user-avatar">YOU</div></div><div className="assistant-response loading-response"><div className="assistant-avatar"><Sparkles size={17} /></div><div className="assistant-content"><div className="assistant-label">INTENTRA <span>·</span> WORKING ON IT</div><div className="loading-state"><div><strong>Following the data trail</strong><span>Live activity from the agents and their tools:</span></div><ProgressTimeline events={progress} /></div></div></div></>}
            </div>}
            {!selected && !loading && !activeQuestion && datasetContext?.suggested_questions?.length > 0 && <section className="suggestions"><div className="suggestions-title"><Compass size={17} /><span>START WITH YOUR DATA</span></div><div className="suggestion-grid">{datasetContext.suggested_questions.map(({ kind, label, description, question: example }) => { const Icon = suggestionIcons[kind] || Table2; return <button key={`${kind}-${example}`} className="suggestion" onClick={() => ask(example)}><span className="suggestion-icon"><Icon size={21} /></span><span className="suggestion-copy"><strong>{label}</strong><small>{description || example}</small></span><ArrowRight className="suggestion-arrow" size={18} /></button> })}</div></section>}
            {!selected && !loading && !activeQuestion && datasetContextLoading && <div className="schema-loading"><LoaderCircle className="spin" size={15} /> Reading this dataset’s table structure…</div>}
            <ChatComposer id="question" label="Ask Intentra about your data" value={question} onChange={setQuestion} onSubmit={ask} placeholder="Message Intentra about your data…" busy={loading} disabled={!datasetId} />
          </section>
        </> : view === 'knowledge-agent' ? <CatalogAgentWorkspace datasetId={datasetId} entry={catalogAgentEntry} onSubmit={askCatalogAgent} /> : <section className="catalog-section"><div className="section-head"><div><span className="eyebrow"><span className="eyebrow-mark" /> KNOWLEDGE CATALOG</span><h2>Discover your data assets<span className="period">.</span></h2><p>Search tables and datasets indexed by Google Cloud.</p></div></div><form className="catalog-search" onSubmit={search}><Search size={21} /><label className="sr-only" htmlFor="catalog-query">Search catalog</label><input id="catalog-query" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search for claims, customers, transactions..." /><button type="submit" disabled={searching || !searchTerm.trim()}>{searching ? <LoaderCircle className="spin" size={18} /> : 'Search assets'}</button></form>{searchError && <div className="error-panel"><CircleAlert size={18} />{searchError}</div>}{assets && <div className="catalog-results"><div className="catalog-result-head"><span>{assets.length} {assets.length === 1 ? 'ASSET' : 'ASSETS'} FOUND</span><span>KNOWLEDGE CATALOG</span></div>{assets.length ? assets.map((asset) => <div className="catalog-row" key={asset.name}><div className="catalog-icon"><Database size={20} /></div><div className="catalog-meta"><strong>{asset.displayName || asset.fqn}</strong><small>{asset.fqn}</small><span>{asset.system || 'Data asset'} <i /> {asset.location || 'Unknown region'}</span></div><button className="icon-button" aria-label={`Ask about ${asset.displayName || asset.fqn}`} title="Ask about this asset" onClick={() => { setView('ask'); setQuestion(`Tell me about ${asset.displayName || asset.fqn}`) }}><ArrowRight size={19} /></button></div>) : <div className="no-results">No assets matched. Try a different term.</div>}</div>}{!assets && !searchError && <div className="catalog-placeholder"><BookOpen size={32} /><strong>Your catalog, one search away.</strong><span>Find relevant assets before you start building.</span></div>}</section>}
        <footer className="page-footer"><span><span className="footer-bars"><i /><i /><i /><i /></span> INTENTRA · ASK BETTER. SEE FURTHER.</span><span>BUILT ON GOOGLE CLOUD <ExternalLink size={13} /></span></footer>
      </div>
    </main>
  </div>
}

export default App
