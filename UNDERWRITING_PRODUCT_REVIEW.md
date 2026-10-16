# Intentra underwriting product review

Follow-up implementation: the inbox and case preparation changes were deployed as revision `intentra-00009-swv`. Two labeled fictional applications are now in BigQuery with private PDF sources in GCS. The OCR processor was enabled and a source-packet check produced one OCR page and 10 source-supported Gemini fields. Case-specific policy snapshots, product/type validation, saved case routes, pipeline start gates, exact-result confirmation, and backend completion gates for approval/decline have been added. Nine targeted workflow tests pass. A matching illustrative health product policy is available. The original 30-page IRDAI health master circular dated 29 May 2024 has since been added, with six source-linked review topics, and attached to both unstarted sample cases. Pipeline setup now permits starting those cases; applicability and later amendments require review. Health-specific rule evaluation, verified declaration editing, risk assessment, health pricing, and employee authentication remain incomplete. Findings below record the state before these follow-up changes.

Reviewed 16 October 2026. Scope: the deployed Cloud Run UI and the current local frontend and backend source. Read-only browser inspection covered the default chat, employee application queue, application intake, and company policy library at desktop and narrow viewport sizes. No applicant documents were uploaded, no employee decision was recorded, and no full case was processed during this review.

## Assessment

The platform has useful infrastructure and a recognizable visual foundation, but the health-insurance underwriting journey is not ready for a judged end-to-end demonstration. Completing one evidence-backed health case matters more than adding further screens or agents. No ranking prediction can be established from this review.

The deployed UI and local source also differ: the new policy table, selection checkboxes, and rules dropdown exist locally but are not present in the deployed UI after a fresh reload.

## What is implemented

- A public Cloud Run application with application, policy, chat, and catalog routes.
- Document AI intake code with regional processor support, private GCS persistence, and Gemini structuring of OCR text with source quotations.
- PDF/text/JSON policy ingestion, reviewed candidate metadata, original-source storage, and BigQuery policy records.
- Seven named review steps dispatched through LangGraph, with Gemini explanations of supplied results.
- BigQuery workflow events and employee outcome records.
- A deterministic calculator for a specific configured term-life formula.
- A consistent purple accent, structured application queue, searchable application list, and basic responsive layout.

These are implemented components, not evidence that a complete health application has successfully passed through them.

## Priority 0: complete and trustworthy behavior

| Finding | Evidence | Consequence | Required correction |
|---|---|---|---|
| Live application intake is blocked. | The refreshed New application form reports document processing is not configured and disables Submit and process. Intake readiness requires both `DOCUMENT_AI_PROCESSOR` and `UNDERWRITING_DOCUMENT_BUCKET` in `backend/api.py`. The previous runtime environment inspection showed the processor and policy bucket, but no applicant document bucket. | A user cannot demonstrate a new application from the live UI. | Verify the runtime configuration, provision/configure the separate private applicant-document bucket, grant the runtime access, and process an authorized sample document. |
| The visible queue contains no applications. | The live queue finished loading with 0 applications. | There is no existing case to use as a fallback during judging. | Prepare an explicitly consented or fictional representative health application, plus a second case with a missing document or conflicting field. Keep sample provenance clear without repeating prototype notices in every panel. |
| Health underwriting and pricing are not connected end to end. | `backend/premium_calculation.py` supports `annual_term_premium`; intake populates premium inputs only for `insurance_type == 'life'`. The live policy library includes a term-protection product; health-tagged sections of that same source also exist. | The health journey lacks matching health rating inputs and a supported health pricing configuration. Product categories may be misleading. | Use one coherent health product with matching policy metadata, health-specific inputs, risk/referral rules, and a versioned rating configuration. Review existing term-protection records rather than silently treating them as health products. |
| Policy selection does not apply a selected rule set. | `frontend/src/App.jsx` saves checkbox IDs in localStorage and preselects the first matching company policy at intake. `backend/api.py` accepts one `selected_policy_id`; the regulatory workflow loads all sources for the insurance type. | Multiple checked policies do not become the set evaluated for that case. | Persist the selected product and regulatory policy versions on each application. Show that exact set in the case workspace and pass it to the evaluation steps. |
| Company rules are displayed rather than evaluated. | `company_policy_agent` checks insurance-type matching and returns the extracted outline. Gemini is instructed to explain the outline and not determine eligibility. | A matching policy can appear reviewed without any applicant-versus-rule results. | Return a rule matrix with rule ID, applicant fact, comparator, threshold, result, missing evidence, and source clause. Use explicit pass, review, missing evidence, and not applicable states. |
| Extracted information does not become verified medical input. | `create_application_case` initializes health declarations as empty arrays/nulls, initializes `issues = []`, and marks risk as Not assessed. There is no corresponding verification/edit endpoint in the reviewed API. | OCR output cannot reliably drive the health risk step. | Provide an editable verification screen, retain original extracted values and source evidence, and persist verified declarations and discrepancies before risk assessment. |
| Document completeness checks are insufficient. | Intake requires at least one file. `document_agent` blocks on documents explicitly marked Missing and on existing issues, but OCR records are Processed/Needs review; a result with no structured fields may still continue. | A single unrelated or unreadable file can satisfy the basic intake requirement. | Classify document purpose, evaluate product-specific required document types, detect unreadable/missing evidence, and require explicit resolution of mandatory gaps. |
| Confirmation regenerates the result. | `run_workflow_step` invokes `run_agent` before branching on `confirm`. | The result recorded as confirmed may differ from the result the employee inspected; latency and model calls are duplicated. | Confirm the persisted pending result by result ID/version. Rerun only through an explicit action, and invalidate dependent results when evidence changes. |
| Selected company policy is lost downstream. | `backend/health_underwriting.py` assigns `prior_company.get('policy')`, then overwrites it with `prior_company.get('selected_company_policy')`. The company agent returns `policy`. | Risk/recommendation context can lose the reviewed policy. | Preserve the actual policy field and policy version consistently across every step. |
| Final decision restrictions live mainly in the UI. | `update_case` accepts Approve/Decline without checking workflow completion. It records reviewer as the literal Application reviewer. The reviewed application routes have no app-level identity/role checks; the deployment is intentionally public for the demo. | The backend does not enforce the same gate or employee attribution that the UI implies. | Enforce permitted state transitions server-side and record an authenticated reviewer. Keep public demo operation restricted to appropriate sample data. |

## Priority 1: make the interface serve the underwriter

### Product entry and navigation

The application opens on a general data chatbot. Dataset selection, catalog exploration, and catalog maintenance occupy the same hierarchy as underwriting. A judge looking for the insurance use case must discover it.

Make Applications the default employee workspace. Use a short navigation: Applications, Portfolio analytics, Policies & rules, and Settings. Keep catalog tools within an administration area. The analytics context should be the underwriting dataset rather than an arbitrary active catalog dataset.

The current Ask analytics chatbot shortcut only changes the chat text and view. It does not switch `datasetId` to the underwriting dataset. On the inspected page the selected source was `bsfi_synthetic`; the underwriting source is configured separately.

### Case workspace

Use a stable case header with applicant, product, received date, current step, owner, and unresolved items. Keep the seven-step progression, but make earlier completed results inspectable. The current step navigation consists of noninteractive divs, and most output is presented as a long stack of explanation panels.

The central workspace should show actionable findings alongside evidence:

| Step | Main content | Employee action |
|---|---|---|
| Analyze application | Applicant and cover details; discrepancies | Correct/verify fields |
| Verify documents | Required-document checklist and extraction table beside the source document | Confirm evidence or request a missing item |
| Regulatory review | Applicable requirements with evidence and clause references | Resolve applicability and open requirements |
| Company rules | Applicant-versus-rule matrix | Review exceptions and required referrals |
| Medical and risk | Verified conditions and rule-based referral reasons | Verify classifications or refer to specialist |
| Premium | Versioned rating inputs, formula, components, and total or missing-input state | Confirm inputs and calculation basis |
| Recommendation | Suggested action, reasons, unresolved items, and evidence references | Prepare the employee decision |

Use a compact decision panel following these checks. Show the reason and impact of each blocker next to its resolution action. Keep essential limitations visible, but remove repeated caution paragraphs that bury the task.

### Policies and rules

Put the searchable library before the upload workflow. Make Add policy an explicit action that opens upload/review. Group policy sections and rules under their source product/version rather than presenting governance, privacy, medical, and pricing sections as unrelated products.

Expand a policy into a full-width rule table or side panel. The current local implementation nests a 560px minimum-width rules table inside a 520px panel inside another table cell. This guarantees inner horizontal scrolling and can widen the outer table. Some `.policy-table td` styles also cascade into the nested table. Use independent table styling and sufficient readable width.

### Readability and states

- A large amount of underwriting and rule text is defined at 8–11px. Use readable body and table text, with stronger contrast; reserve small metadata for genuinely secondary details.
- Keep one clear primary action per step, near the result and blocker summary.
- Show loading placeholders for metrics instead of temporary zero counts while the application query runs.
- Replace the generic API connected badge with contextual readiness details. `/health` returns a basic OK and does not establish OCR, document storage, policy, pricing, or model readiness.
- `intake-status` hardcodes policy/risk/rate readiness to false; derive those flags from actual configuration and selected product data.
- On narrow screens, use a drawer for progression/evidence and a readable stacked layout. Alerts and summary cards currently consume most of the first screen before the application list.
- Persist the active case/step in a URL so refreshing or reopening the page returns to the same work.

## Priority 2: evidence and analytics

- Add a timeline of extraction, verified changes, rule evaluations, requests, recommendation, and employee decision.
- Let the employee reopen original documents from a finding, ideally at its page or quote.
- Make the application portfolio and chat use the same underlying case data and definitions for pending, referred, and open issues.
- Add a downloadable decision record only after the underlying case evidence and policy versions are reliable.
- Add real agent progress events during OCR and review so progress reflects completed work rather than decorative animation.

## Implementation order

1. Unblock intake and establish one coherent health product, document set, risk/referral rules, and rating inputs.
2. Implement saved case-specific policy selection, field verification, per-rule evaluation, and correct workflow confirmations.
3. Build the focused application workspace, evidence panel, completed-step review, and employee decision gate.
4. Connect portfolio analytics to the underwriting source and reconcile counts with the application queue.
5. Validate the full path, then deploy the same reviewed build and check it at desktop and narrow widths.

## Demonstration acceptance criteria

- Starting at the public demo entry, a reviewer can immediately find Applications and understand the product's health-underwriting purpose.
- A representative application can be submitted, OCR can extract real source text, and every verified field can be traced to its document.
- A deliberate discrepancy or missing document produces a specific finding and a resolution path.
- The case retains its exact selected policy and regulatory versions. Each evaluated rule shows its facts and evidence.
- Medical/referral findings and premium calculations use the verified health inputs and configured product rules. No model-invented score or price is shown.
- Confirming a step records the exact reviewed result. Refreshing preserves the case and progress.
- A recommendation shows reasons and unresolved evidence; an authorized reviewer records the outcome with an audit entry.
- The portfolio count and scoped analytics chat reflect that recorded outcome.
- The deployed UI matches the reviewed local build. Relevant text, source evidence, and actions remain readable at desktop and narrow widths.

## Review limitations

No full application could be exercised because live intake was unavailable and the queue was empty. OCR execution, document storage access, model response quality on a submitted case, pricing on a health product, and persisted end-to-end outcomes therefore remain unverified. Some findings above are demonstrated code defects; others are observed UI behavior or explicit missing configuration. This review did not validate the legal interpretation or current applicability of any regulatory source.
