"""BigQuery-backed health-insurance application and review repository."""

import json
import os
import uuid
from copy import deepcopy
from datetime import datetime, timezone

from google.api_core.exceptions import NotFound
from google.cloud import bigquery

from backend.repositories.health_profile import apply_profile
from backend.integrations.mcp_tools import PROJECT_ID


DATASET_ID = os.environ.get("HEALTH_UNDERWRITING_DATASET", "intentra_health_underwriting").strip()
LOCATION = os.environ.get("HEALTH_UNDERWRITING_LOCATION", "US").strip()
_TABLES = {
    "applicants": "applicants",
    "applications": "applications",
    "medical_declarations": "medical_declarations",
    "supporting_documents": "supporting_documents",
    "validation_findings": "validation_findings",
    "policy_rules": "policy_rules",
    "risk_assessments": "risk_assessments",
    "review_events": "review_events",
    "applicant_health_profile": "applicant_health_profile",
}


def _client():
    return bigquery.Client(project=PROJECT_ID)


def _table(name):
    if name not in _TABLES:
        raise ValueError("Unknown underwriting table.")
    return f"{PROJECT_ID}.{DATASET_ID}.{_TABLES[name]}"


def _query(sql, params=()):
    config = bigquery.QueryJobConfig(query_parameters=list(params))
    return list(_client().query(sql, job_config=config, location=LOCATION).result())


def _json_or_empty(value):
    if not value:
        return {}
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return {}


def _latest_state_cte():
    return f"""WITH latest_state AS (
      SELECT application_id, metadata_json
      FROM `{_table('review_events')}`
      WHERE synthetic = FALSE OR JSON_VALUE(metadata_json, '$.record_origin') = 'sample_application'
      QUALIFY ROW_NUMBER() OVER (PARTITION BY application_id ORDER BY created_at DESC, event_id DESC) = 1
    )"""


def _hydrate_case(case_json, metadata_json):
    case = _json_or_empty(case_json)
    state = _json_or_empty(metadata_json)
    for key in ("policy_selection", "selected_policy_id", "documents", "risk", "risk_factors", "premium_calculation", "health_rating_inputs", "evidence_resolutions", "health_triage", "followup_provenance", "followup_evidence"):
        if key in state:
            case[key] = state[key]
    if state.get("health_profile"):
        apply_profile(case, state["health_profile"])
    if state.get("resulting_status"):
        case["status"] = state["resulting_status"]
    if "decision" in state:
        case["decision"] = state["decision"]
    if "review_note" in state:
        case["review_note"] = state["review_note"]
    if state.get("recommendation"):
        case["suggested_action"] = state["recommendation"]
    if state.get("workflow"):
        workflow = state["workflow"]
        # Preserve existing review history while moving active demo workflows
        # from the earlier four-step order to the five-step underwriting flow.
        if workflow.get("version", 1) < 2:
            steps = workflow.setdefault("steps", {})
            is_legacy_flow = (
                workflow.get("current_step") in {"company_rules", "premium", "complete"}
                or "company_rules" in steps
                or "premium" in steps
            )
            if "company_rules" in steps:
                steps["legacy_company_rules"] = steps.pop("company_rules")
            if "premium" in steps:
                steps["legacy_premium"] = steps.pop("premium")
            if is_legacy_flow:
                workflow["current_step"] = "risk"
                workflow.pop("pending_step", None)
                workflow.pop("pending_result", None)
            else:
                workflow.setdefault("current_step", "documents")
            workflow["version"] = 2
        if workflow.get("version", 1) < 3:
            steps = workflow.setdefault("steps", {})
            if workflow.get("current_step") == "documents" and not steps:
                workflow["current_step"] = "application_details"
            elif workflow.get("current_step") == "documents" and "documents" in steps:
                workflow["current_step"] = "irdai"
            elif workflow.get("current_step") == "risk" and "irdai" in steps:
                workflow["current_step"] = "company_policy"
            workflow["version"] = 3
        if workflow.get("version", 1) < 6:
            workflow = migrate_workflow(workflow)
        case["workflow"] = workflow
    return case


WORKFLOW_STEPS = ("intake", "rules", "risk", "decision")
_LEGACY_PARTS = {"intake": ("application_details", "documents"), "rules": ("irdai", "company_policy"),
                 "risk": ("risk",), "decision": ("premium", "recommendation")}


def _merge_rule_reviews(*results):
    reviews = [(result.get("evidence_review"), kind) for result, kind in results if result.get("evidence_review")]
    rules = [{**rule, "kind": kind} for review, kind in reviews for rule in review.get("rules", [])]
    counts = {name: sum(rule["status"] == name for rule in rules) for name in ("evidence_found", "evidence_missing", "review_needed")}
    return {"rules": rules, "counts": counts, "policy_count": sum(review.get("policy_count", 0) for review, _ in reviews),
            "errors": [error for review, _ in reviews for error in review.get("errors", [])],
            "meaning": "Evidence matching assists source review. Evidence found is not a compliance pass or an eligibility decision."}


def migrate_workflow(workflow):
    """Fold the earlier seven-stage record into four stages; partly finished stages are re-run."""
    old = workflow.get("steps", {})
    steps = {}
    for name, parts in _LEGACY_PARTS.items():
        if not all(part in old for part in parts):
            continue
        if name == "intake":
            steps[name] = {**old["application_details"], **old["documents"]}
        elif name == "rules":
            outcome = {**old["company_policy"].get("outcome", {}), "issues": []}
            steps[name] = {**old["company_policy"], "outcome": outcome, "evidence_review": _merge_rule_reviews((old["irdai"], "regulatory"), (old["company_policy"], "company"))}
        elif name == "decision":
            steps[name] = {**old["recommendation"], "premium_result": old["premium"]}
        else:
            steps[name] = old[name]
    done = next((name for name in WORKFLOW_STEPS if name not in steps), "complete")
    if workflow.get("current_step") != "complete" or done != "complete":
        workflow["current_step"] = done
    keep_pending = done == "risk" and workflow.get("pending_step") == "risk"
    if not keep_pending:
        for key in ("pending_step", "pending_result", "intervention"):
            workflow.pop(key, None)
        if workflow.get("pipeline_status") == "waiting_for_employee":
            workflow["pipeline_status"] = "interrupted"
    return {**workflow, "steps": steps, "version": 6}


def _case_state(case):
    """Every event carries current case state so the latest event is sufficient."""
    return {"record_origin": case.get("record_origin"),
            "resulting_status": case.get("status"), "workflow": case.get("workflow"),
            "policy_selection": case.get("policy_selection"),
            "selected_policy_id": case.get("selected_policy_id"),
            "documents": case.get("documents", []),
            "decision": case.get("decision"), "review_note": case.get("review_note"),
            "recommendation": case.get("suggested_action"),
            "risk": case.get("risk"), "risk_factors": case.get("risk_factors", []),
            "premium_calculation": case.get("premium_calculation"),
            "health_rating_inputs": case.get("health_rating_inputs"), "health_profile": case.get("health_profile"),
            "evidence_resolutions": case.get("evidence_resolutions", {}), "health_triage": case.get("health_triage"),
            "followup_provenance": case.get("followup_provenance"), "followup_evidence": case.get("followup_evidence", {})}


def _save_case_event(case, event_type, reason, extra=None):
    state = {**_case_state(case), **(extra or {})}
    event = {"event_id": f"EVT-{uuid.uuid4().hex}", "application_id": case["application_id"],
             "event_type": event_type, "actor": "Application reviewer", "reason": reason,
             "created_at": datetime.now(timezone.utc).isoformat(),
             "metadata_json": json.dumps(state, ensure_ascii=False),
             "synthetic": case.get("record_origin") == "sample_application"}
    errors = _client().insert_rows_json(_table("review_events"), [event], row_ids=[event["event_id"]])
    if errors:
        raise RuntimeError(f"BigQuery rejected the case event: {errors[:2]}")


def save_case_policies(application_id, policy_ids, primary_policy_id=""):
    """Pin selected policy versions and source-quoted rules to this case."""
    from backend.repositories.policy_library import get_policy
    case = get_case(application_id)
    if case is None:
        return None
    if case.get("status") in {"Approved", "Declined"}:
        raise ValueError("A decided application cannot be assigned a new policy selection.")
    if case.get("workflow", {}).get("started_at"):
        raise ValueError("Policies are locked once the pipeline starts. Finish this review with the recorded policy versions.")
    ids = list(dict.fromkeys(policy_ids))
    if not ids or len(ids) > 40:
        raise ValueError("Select between one and forty policies.")
    snapshots = []
    for policy_id in ids:
        policy = get_policy(policy_id)
        if not policy or policy.get("status") not in {"active", "illustrative"}:
            raise ValueError("A selected policy is unavailable or inactive. Refresh the policy library.")
        if policy.get("insurance_type") != case.get("insurance_type", "health"):
            raise ValueError("Every selected policy must match the application's insurance type.")
        if policy.get("policy_kind") == "company" and policy.get("product_code") and policy["product_code"].upper() != case.get("product_code", "").upper():
            raise ValueError(f"{policy['policy_name']} belongs to a different product code.")
        snapshots.append({key: deepcopy(policy.get(key)) for key in (
            "policy_id", "policy_name", "policy_kind", "insurance_type", "insurer_name",
            "product_name", "product_code", "uin", "version", "status", "effective_from",
            "effective_to", "source_filename", "object_uri", "extracted_rules", "extraction_model")})
    company = [item for item in snapshots if item["policy_kind"] == "company"]
    if not company:
        raise ValueError("Select at least one matching company policy.")
    primary = primary_policy_id or company[0]["policy_id"]
    if primary not in {item["policy_id"] for item in company}:
        raise ValueError("Choose a selected company policy as the primary product policy.")
    case["policy_selection"] = {"policies": snapshots, "primary_policy_id": primary,
                                "saved_at": datetime.now(timezone.utc).isoformat()}
    case["selected_policy_id"] = primary
    _save_case_event(case, "Application policies selected", f"Selected {len(snapshots)} policy versions for underwriting.")
    return case


def start_pipeline(application_id):
    case = get_case(application_id)
    if case is None:
        return None
    if case.get("status") in {"Approved", "Declined"}:
        raise ValueError("A decided application cannot start a new pipeline.")
    if case.get("workflow", {}).get("started_at"):
        return case
    policies = (case.get("policy_selection") or {}).get("policies", [])
    if not any(item.get("policy_kind") == "company" for item in policies):
        raise ValueError("Apply at least one company policy before starting the pipeline.")
    if not any(item.get("policy_kind") == "regulatory" for item in policies):
        raise ValueError("Apply at least one regulatory policy before starting the pipeline.")
    previous_workflow = case.get("workflow", {})
    case["workflow"] = {"version": 6, "steps": {}, "current_step": "intake",
                        "run_id": previous_workflow.get("run_id") or f"RUN-{uuid.uuid4().hex}",
                        "run_number": previous_workflow.get("run_number", 1),
                        "previous_run_id": previous_workflow.get("previous_run_id"),
                        "started_at": datetime.now(timezone.utc).isoformat()}
    case["status"] = "In review"
    _save_case_event(case, "Underwriting pipeline started", "Employee started review using the saved policy selection.")
    return case


def create_application_case(applicant_name, date_of_birth, product_code, product_name, email, files, consent_confirmed=False, insurance_type="health", selected_policy_id="", premium_inputs=None):
    """Create a real application from user-submitted documents processed by Document AI."""
    from backend.services.document_intake import process_and_store_documents

    applicant_name = applicant_name.strip()
    product_code = product_code.strip().upper()
    product_name = product_name.strip()
    if not applicant_name or not product_code or not product_name:
        raise ValueError("Applicant name, product code, and product name are required.")
    if consent_confirmed is not True:
        raise ValueError("Applicant document-processing authorization must be confirmed before intake.")
    try:
        birth_date = datetime.fromisoformat(date_of_birth).date()
    except (TypeError, ValueError) as exc:
        raise ValueError("Enter the applicant's date of birth in YYYY-MM-DD format.") from exc
    if not files:
        raise ValueError("Upload at least one supporting application document.")

    insurance_type = (insurance_type or "health").strip().lower()
    if insurance_type not in {"health", "travel", "motor", "life", "other"}:
        raise ValueError("Choose a supported insurance type.")
    if insurance_type == "life":
        premium_inputs = premium_inputs or {}
        try:
            premium_inputs = {
                "sum_assured_inr": int(premium_inputs.get("sum_assured_inr", "")),
                "term_years": int(premium_inputs.get("term_years", "")),
                "tobacco_status": str(premium_inputs.get("tobacco_status", "UNKNOWN")).upper(),
                "medical_class": str(premium_inputs.get("medical_class", "PENDING")).upper(),
                "occupation_class": str(premium_inputs.get("occupation_class", "SPECIALIST_REVIEW")).upper(),
                "payment_frequency": str(premium_inputs.get("payment_frequency", "ANNUAL")).upper(),
            }
        except (TypeError, ValueError) as exc:
            raise ValueError("Enter a whole-number INR sum assured and policy term.") from exc
        allowed_values = {
            "tobacco_status": {"NON_SMOKER", "SMOKER", "UNKNOWN"},
            "medical_class": {"STANDARD", "MODERATE_RISK", "HIGH_RISK", "PENDING"},
            "occupation_class": {"STANDARD", "ELEVATED", "SPECIALIST_REVIEW"},
            "payment_frequency": {"ANNUAL", "SEMI_ANNUAL", "QUARTERLY", "MONTHLY"},
        }
        if premium_inputs["sum_assured_inr"] <= 0 or premium_inputs["term_years"] <= 0:
            raise ValueError("Life pricing inputs require positive coverage and policy term values.")
        for field, values in allowed_values.items():
            if premium_inputs[field] not in values:
                raise ValueError(f"Unsupported life pricing value for {field}.")
    application_id = f"{insurance_type[:2].upper()}-{uuid.uuid4().hex[:12].upper()}"
    applicant_id = f"AP-{uuid.uuid4().hex[:12].upper()}"
    received_at = datetime.now(timezone.utc)
    documents = process_and_store_documents(application_id, files)

    issues = []
    case = {
        "application_id": application_id,
        "applicant": applicant_name,
        "date_of_birth": birth_date.isoformat(),
        "received_at": received_at.isoformat(),
        "status": "Ready for underwriting",
        "plan": product_name,
        "product_code": product_code,
        "insurance_type": insurance_type,
        "selected_policy_id": selected_policy_id or None,
        "premium_inputs": premium_inputs if insurance_type == "life" else None,
        "risk": {"band": "Not assessed", "score": None, "basis": "No approved risk model is configured for this product."},
        "documents": [{key: doc[key] for key in ("document_id", "name", "state", "fields", "object_uri", "page_count", "processor", "mime_type")} for doc in documents],
        "checks": [{"title": "Source document verification", "state": "Review required", "detail": "Compare Document AI extractions with the original source files."}],
        "evidence": [doc["name"] for doc in documents],
        "issues": issues,
        "suggested_action": "Complete employee review",
        "workflow": {"version": 6, "steps": {}, "current_step": "intake"},
        "record_origin": "customer_submitted_application",
    }
    declarations = {
        "application_id": application_id,
        "declared_conditions": [],
        "current_medications": [],
        "prior_hospitalisation": None,
        "tobacco_use": None,
        "declaration_summary": ("Document AI extracted fields from the submitted documents. An employee must verify and classify health declarations before assessment."
                                if insurance_type == "health" else "No health declaration was created for this non-health application."),
        "synthetic": False,
    }
    applicant = {
        "applicant_id": applicant_id,
        "full_name": applicant_name,
        "date_of_birth": birth_date.isoformat(),
        "email": email.strip() or None,
        "contact_reference": None,
        "residency_status": None,
        "residence_country": None,
        "synthetic": False,
    }
    application = {
        "application_id": application_id,
        "applicant_id": applicant_id,
        "submitted_at": received_at.isoformat(),
        "coverage_start_date": None,
        "product_code": product_code,
        "product_name": product_name,
        "insurance_type": insurance_type,
        "coverage_limit_sgd": None,
        "illustrative_annual_premium_sgd": None,
        "application_status": "Ready for underwriting",
        "submission_channel": "Employee intake",
        "assigned_reviewer": None,
        "risk_score": None,
        "risk_band": "Not assessed",
        "recommendation": "Employee review required",
        "last_review_note": None,
        "decision_json": None,
        "case_json": json.dumps(case, ensure_ascii=False),
        "synthetic": False,
        "updated_at": received_at.isoformat(),
    }
    doc_rows = [{
        "document_id": doc["document_id"], "application_id": application_id,
        "document_type": doc["name"], "received_at": received_at.isoformat(),
        "document_status": doc["state"], "object_uri": doc["object_uri"],
        "extracted_fields_json": json.dumps(doc.get("fields", []), ensure_ascii=False),
        "extraction_confidence": min((field.get("confidence") for field in doc.get("fields", []) if field.get("confidence") is not None), default=None),
        "synthetic": False,
    } for doc in documents]
    event = {
        "event_id": f"EVT-{uuid.uuid4().hex}", "application_id": application_id,
        "event_type": "Application received", "actor": "Application intake",
        "reason": "Documents were processed by the configured Document AI processor; employee verification is required.",
        "created_at": received_at.isoformat(),
        "metadata_json": json.dumps({"workflow": case["workflow"], "document_count": len(documents), "document_processing_consent": True}, ensure_ascii=False),
        "synthetic": False,
    }
    rows_to_insert = [("applicants", [applicant]), ("supporting_documents", doc_rows), ("applications", [application]), ("review_events", [event])]
    if insurance_type == "health":
        rows_to_insert.append(("medical_declarations", [declarations]))
    for table_name, rows in rows_to_insert:
        errors = _client().insert_rows_json(_table(table_name), rows)
        if errors:
            raise RuntimeError(f"BigQuery rejected application intake rows for {table_name}: {errors[:2]}")
    return case


def run_workflow_step(application_id, step_id, confirm=False, attestation="", result_id="", *, _case=None):
    """Run one gated, auditable review step for a customer application."""
    if step_id not in WORKFLOW_STEPS:
        raise ValueError("Choose a supported underwriting workflow step.")
    if confirm and not attestation.strip():
        raise ValueError("Record the required reviewer confirmation before continuing.")
    case = _case if _case is not None else get_case(application_id)
    if case is None:
        return None
    workflow = case.get("workflow") or {"steps": {}, "version": 6}
    if not workflow.get("started_at"):
        raise ValueError("Select the application's policies and start its underwriting pipeline first.")
    workflow["version"] = max(workflow.get("version", 6), 6)
    steps = workflow.setdefault("steps", {})
    index = WORKFLOW_STEPS.index(step_id)
    if index and WORKFLOW_STEPS[index - 1] not in steps:
        raise ValueError("Complete the previous review step before continuing.")
    if workflow.get("current_step") != step_id:
        raise ValueError("This is not the current pipeline step. Refresh the application.")
    if confirm:
        pending = workflow.get("pending_result")
        if workflow.get("pending_step") != step_id or not isinstance(pending, dict):
            raise ValueError("Run this step and review its findings before confirming.")
        if not result_id or result_id != pending.get("result_id"):
            raise ValueError("The reviewed result has changed. Refresh and review the current result.")
        if not pending.get("can_continue"):
            raise ValueError("Resolve the required information before confirming this step.")
        result = deepcopy(pending)
        result["reviewer_confirmed"] = True
        steps[step_id] = {**result, "completed_at": datetime.now(timezone.utc).isoformat(),
                          "reviewer_attestation": attestation.strip()[:1000]}
        workflow["current_step"] = WORKFLOW_STEPS[index + 1] if index + 1 < len(WORKFLOW_STEPS) else "complete"
        workflow.pop("pending_result", None)
        workflow.pop("pending_step", None)
        case["workflow"] = workflow
        _save_case_event(case, f"Underwriting step confirmed: {step_id}", "Employee confirmed the saved result.")
        return {"application_id": application_id, "workflow": workflow, "step_result": result, "status": case["status"]}

    selected_policies = (case.get("policy_selection") or {}).get("policies", [])
    primary_policy = next((item for item in selected_policies if item.get("policy_id") == case.get("selected_policy_id")), None)
    from backend.agents.underwriting_agents import run_agent
    premium = None
    health = case.get("insurance_type", "health") == "health"
    if step_id == "intake" and health:
        from backend.repositories.health_profile import load_profile
        try:
            profile = load_profile(application_id)
        except NotFound:
            profile = None
        if profile:
            apply_profile(case, profile)
        else:
            case["health_profile"] = None
    if step_id == "rules":
        case["regulatory_policies"] = [item for item in selected_policies if item.get("policy_kind") == "regulatory"]
        case["selected_company_policies"] = [item for item in selected_policies if item.get("policy_kind") == "company"]
        selected_policy = primary_policy
        compatible = (selected_policy and selected_policy.get("insurance_type") == case.get("insurance_type", "health")
                      and (not selected_policy.get("product_code") or selected_policy.get("product_code") == case.get("product_code")))
        case["selected_company_policy"] = selected_policy if compatible else None
        case["configured_policy_rules"] = _configured_rules(application_id) if health else []
    prior_rules = steps.get("rules", {})
    if step_id in {"risk", "decision"}:
        case["configured_policy_rules"] = prior_rules.get("configured_policy_rules", [])
        case["selected_company_policy"] = prior_rules.get("policy")
        case["selected_company_policy_outline"] = prior_rules.get("policy_outline", {})
    if step_id in {"risk", "decision"} and health:
        from backend.services.health_product import product_configuration, triage_health_case
        health_product = product_configuration(case)
        if health_product:
            case["health_triage"] = triage_health_case(case, health_product)
    if step_id == "decision":
        _price_case(case, primary_policy)
        prior_risk = steps.get("risk", {})
        if prior_risk.get("risk_assessment"):
            case["risk"] = prior_risk["risk_assessment"]
        if prior_risk.get("medical_declaration"):
            case["medical_declaration"] = prior_risk["medical_declaration"]
    case["completed_review_steps"] = steps
    result = run_agent(case, step_id, premium=premium, currency=case.get("currency") or ("INR" if case.get("application_details", {}).get("sum_insured_inr") else "SGD"))

    result["result_id"] = f"RESULT-{uuid.uuid4().hex}"
    workflow["current_step"] = step_id
    workflow["pending_step"] = step_id
    workflow["pending_result"] = result
    case["workflow"] = workflow
    _save_case_event(case, f"LangGraph agent run: {result['agent']}",
                     f"{step_id} findings generated and saved for pipeline processing")
    return {"application_id": application_id, "workflow": workflow,
            "step_result": result, "status": case["status"], "documents": case.get("documents", [])}


def _configured_rules(application_id):
    rows = _query(
        f"""SELECT r.rule_id, r.product_code, r.jurisdiction, r.category, r.rule_text,
                   r.handling, r.effective_from, r.rule_source, r.example_only
            FROM `{_table('policy_rules')}` r
            JOIN `{_table('applications')}` a
              ON (r.product_code = a.product_code OR r.product_code = 'All')
            WHERE a.application_id = @application_id AND a.synthetic = FALSE
              AND r.example_only = FALSE
              AND (r.effective_from IS NULL OR r.effective_from <= CURRENT_DATE())
            ORDER BY r.category, r.rule_id""",
        [bigquery.ScalarQueryParameter("application_id", "STRING", application_id)],
    )
    return [{**dict(row.items()), "effective_from": row.effective_from.isoformat() if row.effective_from else None} for row in rows]


def _price_case(case, primary_policy):
    """Attach the premium calculation for the case's selected product or policy."""
    if case.get("insurance_type", "health") == "health":
        from backend.services.health_product import product_configuration, calculate_health_premium
        health_product = product_configuration(case)
        if not health_product:
            return
        case["health_pricing_configuration"] = health_product
        calculation = calculate_health_premium(health_product["config"], case.get("date_of_birth"), case.get("health_rating_inputs") or {})
        if (case.get("health_triage") or {}).get("status") != "triage_completed":
            calculation.update(premium=None, status="manual_review", findings=(case.get("health_triage") or {}).get("findings", []))
        case["premium_calculation"] = {**calculation, **{key: value for key, value in health_product.items() if key != "config"}}
        return
    from backend.repositories.policy_library import read_policy_source
    source = read_policy_source(case.get("selected_policy_id")) if primary_policy else None
    config = None
    if source:
        try:
            config = json.loads(source[1].decode("utf-8-sig")).get("premium_calculation_config")
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            config = None
    if config:
        from backend.services.premium_calculation import calculate_premium
        case["premium_calculation"] = {**calculate_premium(config, case.get("date_of_birth"), case.get("premium_inputs") or {}),
                                       "policy_name": primary_policy.get("policy_name"),
                                       "source_filename": primary_policy.get("source_filename"),
                                       "policy_status": primary_policy.get("status")}


def list_cases():
    rows = _query(
        _latest_state_cte() + f"""
        SELECT a.case_json, s.metadata_json
        FROM `{_table('applications')}` a LEFT JOIN latest_state s USING (application_id)
        WHERE (a.synthetic = FALSE OR JSON_VALUE(a.case_json, '$.record_origin') = 'sample_application') ORDER BY a.submitted_at DESC LIMIT 500"""
    )
    return [_hydrate_case(row.case_json, row.metadata_json) for row in rows]


def get_case(application_id):
    rows = _query(
        _latest_state_cte() + f"""
        SELECT a.case_json, s.metadata_json FROM `{_table('applications')}` a
        LEFT JOIN latest_state s USING (application_id)
        WHERE a.application_id = @application_id AND (a.synthetic = FALSE OR JSON_VALUE(a.case_json, '$.record_origin') = 'sample_application') LIMIT 1""",
        [bigquery.ScalarQueryParameter("application_id", "STRING", application_id)],
    )
    return _hydrate_case(rows[0].case_json, rows[0].metadata_json) if rows else None


def update_case(application_id, action, note):
    status_by_action = {
        "Start review": "In review",
        "Request information": "Needs information",
        "Refer": "Referred",
        "Approve": "Approved",
        "Decline": "Declined",
    }
    if action not in status_by_action:
        raise ValueError("Choose a supported review action.")
    case = get_case(application_id)
    if case is None:
        return None
    if case.get("status") in {"Approved", "Declined"}:
        raise ValueError("A final employee decision is already recorded for this application.")
    if action in {"Approve", "Decline", "Refer", "Request information"} and not note.strip():
        raise ValueError("Record a reason for this employee action.")
    if action in {"Approve", "Decline"} and case.get("workflow", {}).get("current_step") != "complete":
        raise ValueError("Complete the underwriting pipeline before recording an approval or decline.")
    workflow = case.get("workflow") or {}
    has_profile = bool(case.get("health_profile"))
    if action == "Approve" and (
        workflow.get("open_items")
        or any(result.get("outcome", {}).get("issues") for step, result in workflow.get("steps", {}).items() if step != "decision")
        or workflow.get("steps", {}).get("decision", {}).get("missing_information")
        or (not has_profile and case.get("issues"))
        or (not has_profile and any(doc.get("state") == "Missing" for doc in case.get("documents", [])))
    ):
        raise ValueError("Resolve open requirements before recording approval; request information or refer the case instead.")
    now = datetime.now(timezone.utc)
    status = status_by_action[action]
    decision = {"action": action, "reviewer": "Application reviewer", "recorded_at": now.isoformat(), "reason": note.strip()}
    case["status"] = status
    case["review_note"] = note.strip()
    case["decision"] = decision
    case["suggested_action"] = {
        "Start review": "Complete employee review",
        "Request information": "Await requested information",
        "Refer": "Specialist review required",
        "Approve": "Employee decision recorded",
        "Decline": "Employee decision recorded",
    }[action]
    _save_case_event(case, action, note.strip())
    return case


def portfolio_metrics():
    status_rows = _query(_latest_state_cte() + f"""
        SELECT COALESCE(JSON_VALUE(s.metadata_json, '$.resulting_status'), a.application_status) AS status,
          COUNT(*) AS count,
          COUNTIF(DATE(a.submitted_at, 'Asia/Singapore') = CURRENT_DATE('Asia/Singapore')) AS received_today
        FROM `{_table('applications')}` a LEFT JOIN latest_state s USING (application_id)
        WHERE (a.synthetic = FALSE OR JSON_VALUE(a.case_json, '$.record_origin') = 'sample_application') GROUP BY status""")
    issue_rows = _query(
        f"""SELECT description AS issue, COUNT(DISTINCT application_id) AS count
        FROM `{_table('validation_findings')}`
        WHERE synthetic = FALSE AND finding_status = 'Open'
        GROUP BY issue ORDER BY count DESC"""
    )
    statuses = {row.status: int(row.count) for row in status_rows}
    total = sum(statuses.values())
    pending = sum(count for status, count in statuses.items() if status in {"New", "Ready for underwriting", "In review", "Needs information", "Referred"})
    return {
        "total": total,
        "received_today": sum(int(row.received_today) for row in status_rows),
        "pending": pending,
        "statuses": statuses,
        "issues": {row.issue: int(row.count) for row in issue_rows},
    }
