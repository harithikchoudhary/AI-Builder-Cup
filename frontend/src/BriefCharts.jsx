import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { priceBuildUp, priceScenarios, readableClass } from './caseSummary'

const inr = (value) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const effectColor = { increases: 'var(--danger)', neutral: 'var(--ink-soft)', decreases: 'var(--success)' }
const effectText = { increases: 'Raises risk', neutral: 'Neutral', decreases: 'Lowers risk' }

export function RiskDriverChart({ drivers }) {
  const rows = [...(drivers || [])].sort((a, b) => b.weight - a.weight).map((driver) => ({ name: driver.factor, weight: driver.weight, effect: driver.effect }))
  if (!rows.length) return null
  return <figure className="brief-chart"><figcaption><strong>What drives the risk</strong><span>Impact weight, 1 to 10</span></figcaption>
    <ResponsiveContainer width="100%" height={Math.max(150, rows.length * 44)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 28, top: 4, bottom: 4 }}>
        <XAxis type="number" domain={[0, 10]} hide />
        <YAxis type="category" dataKey="name" width={150} tick={{ fill: 'var(--ink)', fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: 'transparent' }} formatter={(value, _name, item) => [`${value} · ${effectText[item.payload.effect]}`, 'Impact']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
        <Bar dataKey="weight" radius={6} isAnimationActive barSize={18}>{rows.map((row) => <Cell key={row.name} fill={effectColor[row.effect]} />)}<LabelList dataKey="weight" position="right" fill="var(--ink)" fontSize={12} /></Bar>
      </BarChart>
    </ResponsiveContainer>
    <div className="brief-legend">{Object.entries(effectText).map(([key, label]) => <span key={key}><i style={{ background: effectColor[key] }} />{label}</span>)}</div>
  </figure>
}

export function PriceBuildUp({ calculation }) {
  const steps = priceBuildUp(calculation)
  if (!steps.length) return null
  return <figure className="brief-chart"><figcaption><strong>How the price is built</strong><span>{calculation.ai_estimate && calculation.premium == null ? 'Standard rate + AI medical loading' : 'Base rate × zone × medical × tobacco'}</span></figcaption>
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={steps} margin={{ left: 0, right: 8, top: 18, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fill: 'var(--ink)', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip cursor={{ fill: 'transparent' }} formatter={(_value, _name, item) => [item.payload.signed != null ? `${item.payload.signed >= 0 ? '+' : '−'}${inr(Math.abs(item.payload.signed))} (${item.payload.detail})` : inr(item.payload.total), item.payload.label]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
        <Bar dataKey="offset" stackId="price" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="delta" stackId="price" radius={[6, 6, 0, 0]}>
          {steps.map((step) => <Cell key={step.label} fill={step.final ? 'var(--accent)' : step.signed > 0 ? 'var(--warning)' : step.signed < 0 ? 'var(--success)' : 'var(--accent-mid)'} />)}
          <LabelList dataKey="total" position="top" formatter={inr} fill="var(--ink)" fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </figure>
}

export function PriceScenarios({ calculation, tables }) {
  const scenarios = priceScenarios(calculation, tables)
  if (!scenarios) return null
  return <section className="brief-chart"><div className="brief-chart-head"><strong>What would change the price</strong><span>Same applicant and cover, other rating classes</span></div>
    <div className="pipeline-table-scroll"><table className="brief-scenarios"><thead><tr><th scope="col">Medical class</th>{scenarios.tobacco.map((tobacco) => <th scope="col" key={tobacco}>{readableClass(tobacco)}</th>)}</tr></thead>
      <tbody>{scenarios.medical.map((medical) => <tr key={medical}><th scope="row">{readableClass(medical)}</th>{scenarios.tobacco.map((tobacco) => <td key={tobacco} className={medical === calculation.medical_class && tobacco === calculation.tobacco_status ? 'is-current' : ''}>{inr(scenarios.price(medical, tobacco))}</td>)}</tr>)}</tbody></table></div>
    <small>Highlighted is the current rating. Alternatives are illustrative; a change needs an employee assessment.</small>
  </section>
}
