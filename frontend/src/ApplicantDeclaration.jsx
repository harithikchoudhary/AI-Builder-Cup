import { ClipboardList, Info } from 'lucide-react'

const fields = {
  height_cm: { label: 'Height', unit: 'cm' },
  weight_kg: { label: 'Weight', unit: 'kg' },
  tobacco: { label: 'Tobacco use' }, tobacco_use: { label: 'Tobacco use' },
  alcohol: { label: 'Alcohol use' },
  diagnosis: { label: 'Declared condition', wide: true },
  declared_conditions: { label: 'Declared conditions', wide: true },
  medication: { label: 'Current medication', wide: true },
  current_medications: { label: 'Current medications', wide: true },
  surgeries: { label: 'Previous surgeries' },
  hospitalizations_last_5_years: { label: 'Hospitalizations · last 5 years' },
  prior_hospitalisation: { label: 'Previous hospitalization' },
  family_history: { label: 'Family medical history', wide: true },
}
const readable = (key) => key.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
const display = (value) => value == null || value === '' ? 'Not recorded' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : Array.isArray(value) ? value.map(display).join('; ') || 'None listed' : typeof value === 'object' ? Object.entries(value).map(([key, item]) => `${readable(key)}: ${display(item)}`).join('; ') : String(value)

function summaryEntries(summary) {
  const body = summary.replace(/^Applicant[-–]declared,\s*not independently verified\.\s*/i, '')
  const entries = []
  for (const part of body.split(/;\s*/)) {
    const match = part.match(/^([a-z][a-z0-9 _()/-]{0,60}):\s*(.*)$/i)
    if (match) entries.push([match[1].trim().toLowerCase().replaceAll(' ', '_'), match[2]])
    else if (entries.length) entries[entries.length - 1][1] += `; ${part}`
    else return [] // Keep narrative declarations intact when they aren't field/value records.
  }
  return entries
}

export default function ApplicantDeclaration({ details }) {
  const summary = details.declaration_summary || ''
  const declaration = details.submitted_application?.health_declaration
  const hasStructured = declaration && typeof declaration === 'object' && !Array.isArray(declaration) && Object.keys(declaration).length > 0
  const entries = hasStructured ? Object.entries(declaration) : summaryEntries(summary)
  if (!summary && !entries.length) return null
  return <section className="case-declaration declaration-panel" aria-label="Applicant declaration">
    <div className="declaration-heading"><h4><ClipboardList size={17} /> Applicant declaration</h4><span>Verification pending</span></div>
    <p className="declaration-source"><Info size={15} /><span>Reported by the applicant. Verify these details against the supporting documents.</span></p>
    {entries.length ? <dl className="declaration-facts">{entries.map(([key, value], index) => {
      const field = fields[key] || { label: readable(key) }
      const text = display(value)
      return <div key={`${key}-${index}`} className={field.wide ? 'declaration-fact-wide' : ''}><dt>{field.label}</dt><dd>{field.unit && value !== null && value !== '' && /^\d+(\.\d+)?$/.test(String(value)) ? <>{text} <span className="declaration-unit">{field.unit}</span></> : text}</dd></div>
    })}</dl> : <p className="declaration-narrative">{summary}</p>}
    {entries.length > 0 && summary && <details className="declaration-original"><summary>View original declaration text</summary><p>{summary}</p></details>}
  </section>
}
