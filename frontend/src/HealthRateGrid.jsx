import { useEffect, useState } from 'react'

export default function HealthRateGrid({ config: supplied, policy }) {
  const [loaded, setLoaded] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (supplied || !policy?.source_filename?.toLowerCase().endsWith('.json')) return
    const controller = new AbortController()
    fetch(`/underwriting/policies/${encodeURIComponent(policy.policy_id)}/source`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Could not read the pricing source.')
      return response.json()
    }).then((body) => setLoaded(body.premium_calculation_config || null)).catch((err) => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [supplied, policy?.policy_id, policy?.source_filename])
  const config = supplied || loaded
  if (error) return <p className="flow-muted">{error}</p>
  if (config?.calculation_method?.name !== 'annual_health_premium') return null
  return <details className="health-rate-grid"><summary>Rate grid & premium calculation rules</summary><p>Annual premium before tax = age-and-cover base premium × regional factor × medical factor × tobacco factor. Round half up to two decimal places.</p><p>Gemini receives this grid and the employee-reviewed case inputs. Its selected rate, factors and proposed premium are checked against the configured calculation. Update the product JSON through policy upload and select that version in a new underwriting run to apply new rates.</p><div className="pipeline-table-scroll"><table className="pipeline-result-table"><thead><tr><th scope="col">Age band</th><th scope="col">Cover</th><th scope="col">Annual base premium</th></tr></thead><tbody>{(config.rate_tables?.annual_base_premiums || []).map((row, index) => <tr key={index}><td>{row.min_age}–{row.max_age}</td><td>₹{Number(row.sum_insured_inr).toLocaleString('en-IN')}</td><td>₹{Number(row.premium).toLocaleString('en-IN')}</td></tr>)}</tbody></table></div><div className="health-factor-grid">{[['Region', config.rate_tables?.zone_multipliers], ['Medical', config.rate_tables?.medical_multipliers], ['Tobacco', config.rate_tables?.tobacco_multipliers]].map(([label, factors]) => <div key={label}><strong>{label} factors</strong>{Object.entries(factors || {}).map(([name, value]) => <p key={name}>{name.replaceAll('_', ' ')}: ×{value}</p>)}</div>)}</div><p>Currency: {config.currency} · Policy term: {config.eligibility?.policy_term_years} year · Entry ages: {config.eligibility?.min_entry_age}–{config.eligibility?.max_entry_age} · Tax is calculated separately.</p></details>
}
