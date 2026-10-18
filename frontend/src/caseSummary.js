const recommendationOutcomes = {
  approve_consideration: { label: 'Ready for approval review', tone: 'good' },
  request_information: { label: 'Information needed', tone: 'warn' },
  refer_manual_review: { label: 'Refer to specialist', tone: 'warn' },
  decline_consideration: { label: 'Decline consideration', tone: 'bad' },
}

export function caseOutcome(application) {
  const workflow = application.workflow || {}
  if (application.status === 'Approved') return { label: 'Approved', tone: 'good' }
  if (application.status === 'Declined') return { label: 'Declined', tone: 'bad' }
  if (application.status === 'Referred') return { label: 'Referred', tone: 'warn' }
  if (application.status === 'Needs information') return { label: 'Information requested', tone: 'warn' }
  const category = workflow.steps?.decision?.recommendation_category
  if (recommendationOutcomes[category]) return recommendationOutcomes[category]
  if (workflow.intervention) return { label: 'Needs your review', tone: 'warn' }
  if (workflow.started_at) return { label: 'Analysis in progress', tone: 'info' }
  return { label: 'Ready to analyze', tone: 'neutral' }
}

export const readableClass = (value) => String(value ?? '').replaceAll('_', ' ')

// The AI proposal saved with the employee's rating inputs outlives the pipeline checkpoint.
export function riskProposal(application, pending) {
  return pending?.risk_proposal || application.health_rating_inputs?.ai_proposal || application.workflow?.steps?.risk?.risk_proposal || null
}

// Each pricing factor becomes one step of the build-up, so the chart mirrors the stored formula.
export function priceBuildUp(calculation) {
  const estimate = calculation?.premium == null ? calculation?.ai_estimate : null
  if (estimate) {
    return [{ label: 'Standard-rate premium', detail: 'Rate table, standard class', offset: 0, delta: estimate.base_premium, total: estimate.base_premium },
      { label: 'AI medical loading', detail: `+${estimate.loading_pct}%`, offset: estimate.base_premium, delta: estimate.premium - estimate.base_premium, signed: estimate.premium - estimate.base_premium, total: estimate.premium },
      { label: 'Estimated premium', detail: 'Before tax', offset: 0, delta: estimate.premium, total: estimate.premium, final: true }]
  }
  if (calculation?.premium == null || calculation.annual_base_premium == null) return []
  const factors = [['Zone', calculation.zone_multiplier, calculation.zone], ['Medical class', calculation.medical_multiplier, calculation.medical_class], ['Tobacco', calculation.tobacco_multiplier, calculation.tobacco_status]]
  let running = calculation.annual_base_premium
  const steps = [{ label: 'Base premium', detail: `Age ${calculation.age_band}`, offset: 0, delta: running, total: running }]
  for (const [label, multiplier, detail] of factors) {
    const next = running * multiplier
    steps.push({ label, detail: readableClass(detail), offset: Math.min(running, next), delta: Math.abs(next - running), signed: next - running, total: next })
    running = next
  }
  steps.push({ label: 'Annual premium', detail: 'Before tax', offset: 0, delta: calculation.premium, total: calculation.premium, final: true })
  return steps
}

// What the premium would be under every medical and tobacco class the product defines.
export function priceScenarios(calculation, tables) {
  const medical = tables?.medical_multipliers || {}
  const tobacco = tables?.tobacco_multipliers || {}
  if (calculation?.premium == null || !Object.keys(medical).length) return null
  const base = calculation.annual_base_premium * calculation.zone_multiplier
  return { medical: Object.keys(medical), tobacco: Object.keys(tobacco), price: (m, t) => Math.round(base * medical[m] * tobacco[t] * 100) / 100 }
}

export function reasonsFor(proposal) {
  return [...(proposal?.drivers || [])].sort((a, b) => b.weight - a.weight).slice(0, 4).map((driver) => ({ title: driver.factor, text: driver.explanation, effect: driver.effect, evidence: driver.evidence }))
}
