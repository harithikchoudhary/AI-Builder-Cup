"""Employee evidence dispositions and health rating inputs at the risk checkpoint."""
from datetime import datetime, timezone
from backend.repositories import health_underwriting as repository
from backend.services.health_product import product_configuration, triage_health_case
from backend.services.pipeline_service import case_lock, summarize_step


def options(case):
    product = product_configuration(case)
    rules = case.get("workflow", {}).get("steps", {}).get("rules", {}).get("evidence_review", {}).get("rules", [])
    return {"product": product, "inputs": case.get("health_rating_inputs") or {},
            "checks": [{**c, "id": str(i)} for i, c in enumerate(case.get("checks", []))],
            "resolutions": case.get("evidence_resolutions") or {}, "rules": rules,
            "followup_evidence": case.get("followup_evidence") or {},
            "documents": [{"document_id": d.get("document_id"), "name": d.get("name")} for d in case.get("documents", []) if d.get("object_uri")]}


def save_review(application_id, payload):
    lock = case_lock(application_id)
    if not lock.acquire(blocking=False):
        raise ValueError("Wait for the current stage to stop before recording an assessment.")
    try:
        case = repository.get_case(application_id)
        if not case:
            return None
        workflow = case.get("workflow", {})
        pending = workflow.get("pending_result") or {}
        if workflow.get("pending_step") != "risk" or not pending.get("result_id") or pending["result_id"] != payload.get("result_id"):
            raise ValueError("Refresh and review the current medical assessment checkpoint first.")
        product = product_configuration(case)
        if not product:
            raise ValueError("Select a matching health product with a supported health rating configuration before starting this run.")
        note = str(payload.get("review_note") or "").strip()
        profile = case.get("health_profile")
        docs = set(payload.get("evidence_document_ids") or [])
        known = {d.get("document_id") for d in case.get("documents", []) if d.get("object_uri")}
        if profile:
            docs, note = set(), note or "Confirmed against the applicant data record."
        if not note or payload.get("confirmed") is not True or (not profile and (not docs or not docs.issubset(known))):
            raise ValueError("Confirm your assessment, add a note, and select the source documents you reviewed.")
        config = product["config"]
        medical = payload.get("medical_class")
        tobacco = payload.get("tobacco_status")
        if medical not in config.get("triage", {}).get("medical_classes", []) or tobacco not in config.get("rate_tables", {}).get("tobacco_multipliers", {}):
            raise ValueError("Select supported medical and tobacco classifications.")
        submitted = case.get("application_details", {}).get("submitted_application", {})
        state = str(submitted.get("region", {}).get("state", "")).strip().casefold()
        zone = config.get("state_zone_mapping", {}).get(state)
        if not zone:
            raise ValueError("The submitted state has no explicit product zone mapping. Configure it before pricing.")
        inputs = {"sum_insured_inr": case.get("application_details", {}).get("sum_insured_inr"),
                  "zone": zone, "residence_state": submitted.get("region", {}).get("state"),
                  "medical_class": medical, "tobacco_status": tobacco, "review_note": note,
                  "confirmed": True, "evidence_document_ids": sorted(docs),
                  "data_source": profile.get("data_source") if profile else None,
                  "reviewed_at": datetime.now(timezone.utc).isoformat(), "reviewer": "Application reviewer",
                  "policy_id": product["policy_id"], "source_sha256": product["source_sha256"]}
        proposal = pending.get("risk_proposal") or (case.get("health_rating_inputs") or {}).get("ai_proposal")
        if proposal and proposal.get("medical_class"):
            same = (proposal.get("medical_class"), proposal.get("tobacco_status")) == (medical, tobacco)
            inputs["ai_proposal"] = {**proposal, "employee_action": "accepted" if same else "changed"}
        resolutions = dict(case.get("evidence_resolutions") or {})
        for item in payload.get("resolutions", []):
            key = str(item.get("id", ""))
            if not key.isdigit() or int(key) >= len(case.get("checks", [])):
                raise ValueError("A verification item has changed; refresh this application.")
            disposition = item.get("disposition")
            if disposition not in {"verified", "not_applicable", "pending"}:
                raise ValueError("Choose a supported verification disposition.")
            detail = str(item.get("note") or "").strip()
            reference = str(item.get("reference") or "").strip()
            if disposition != "pending" and (not detail or not reference):
                raise ValueError("Resolved verification items require an employee rationale and evidence or verification reference.")
            resolutions[key] = {"disposition": disposition, "note": detail, "reference": reference,
                                "reviewed_at": inputs["reviewed_at"], "source": "Employee-recorded assessment; no external verification API was called"}
        available = {r["id"]: r for r in workflow.get("steps", {}).get("rules", {}).get("evidence_review", {}).get("rules", [])}
        for item in payload.get("rule_reviews", []):
            rule = available.get(item.get("id"))
            if not rule or item.get("disposition") not in {"satisfied", "not_applicable", "more_information"}:
                raise ValueError("Select a valid saved rule and employee disposition.")
            rationale = str(item.get("note") or "").strip()
            if not rationale:
                raise ValueError("Every employee rule disposition needs a rationale.")
            rule["employee_review"] = {"disposition": item["disposition"], "note": rationale,
                                       "evidence_document_ids": sorted(docs), "reviewed_at": inputs["reviewed_at"]}
        case["health_rating_inputs"] = inputs
        case["evidence_resolutions"] = resolutions
        # No employee declaration changes the original supplied case or source files.
        for stage in ("rules",):
            result = workflow.get("steps", {}).get(stage)
            if result:
                result["outcome"] = summarize_step(stage, result, case)
        case["health_triage"] = triage_health_case(case, product)
        repository._save_case_event(case, "Health rating and evidence review recorded", note)
        return case
    finally:
        lock.release()


def outstanding_checks(case):
    resolved = case.get("evidence_resolutions") or {}
    return [f"{check.get('title', 'Evidence verification')}: {check.get('detail') or 'employee evidence review required'}"
            for i, check in enumerate(case.get("checks", []))
            if check.get("state") not in {"Passed", "Not applicable"}
            and resolved.get(str(i), {}).get("disposition") not in {"verified", "not_applicable"}]
