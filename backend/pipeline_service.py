"""Run the saved underwriting sequence until evidence needs an employee.

Every stage is persisted. Automatic completion means processing finished, never
that the application passed underwriting or that an employee approved a policy.
"""
from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock

from . import health_underwriting as repository
from .policy_evidence import review_policy_evidence

_locks = {}
_locks_guard = Lock()


def case_lock(application_id):
    with _locks_guard:
        return _locks.setdefault(application_id, Lock())


def _now():
    return datetime.now(timezone.utc).isoformat()


def summarize_step(step, result, case):
    facts, issues = [], []
    attention = False
    if step == "application_details":
        submitted = result.get("application", {})
        issues = [f"{label} is missing from the application." for key, label in (("applicant", "Applicant name"), ("date_of_birth", "Date of birth"), ("product_name", "Product name")) if not submitted.get(key)]
        facts = [{"label": "Applicant", "value": case.get("applicant")}, {"label": "Product", "value": case.get("plan")}]
        title = "Application details organized" if not issues else "Application information is missing"
        summary = "Applicant and cover details are ready for the document comparison." if not issues else "The application record needs the missing details below."
        attention = bool(issues)
    elif step == "documents":
        docs = case.get("documents", [])
        count = len(result.get("extracted_fields", []))
        facts = [{"label": "Documents", "value": str(len(docs))}, {"label": "Extracted fields", "value": str(count)}]
        issues = [f"Missing document: {doc.get('name')}" for doc in docs if doc.get("state") == "Missing"]
        if not count:
            issues.append("No structured document fields are available; review the originals.")
        title = "Verify the document details" if result.get("can_continue") else "Required information is missing"
        summary = f"Read {len(docs)} document records and collected {count} fields. Compare the key values with the originals before the pipeline continues."
        attention = True
    elif step in {"irdai", "company_policy"}:
        review = result.get("evidence_review", {})
        counts = review.get("counts", {})
        label = "Regulatory" if step == "irdai" else "Company"
        title = f"{label} evidence compared"
        total = len(review.get("rules", []))
        summary = f"Compared the available evidence with {total} rules from {review.get('policy_count', 0)} selected policies. Evidence matches are review aids, not passed checks."
        facts = [{"label": "Rules", "value": str(total)}, {"label": "Evidence found", "value": str(counts.get("evidence_found", 0))}, {"label": "Needs review", "value": str(counts.get("review_needed", 0) + counts.get("evidence_missing", 0))}]
        if not total:
            issues.append(f"No extracted {label.lower()} rules are available to compare.")
        if counts.get("evidence_missing"):
            issues.append(f"{counts['evidence_missing']} {label.lower()} rules need additional evidence.")
        if counts.get("review_needed"):
            issues.append(f"{counts['review_needed']} {label.lower()} rules need employee interpretation.")
        issues.extend(review.get("errors", []))
        attention = bool(issues)
    elif step == "risk":
        risk = result.get("risk_assessment", {})
        title = "Medical review needed" if risk.get("score") is None else "Risk evidence collected"
        summary = "Review the health declarations, rule findings and evidence gaps together before pricing."
        facts = [{"label": "Risk rating", "value": risk.get("band") if risk.get("score") is not None else "Not assessed"}]
        if risk.get("score") is None:
            issues.append("A validated risk assessment is not available. Qualified medical or underwriting review remains required.")
        issues.extend(result.get("open_evidence_gaps", []))
        attention = True
    elif step == "premium":
        amount = result.get("premium")
        title = "Premium calculated" if amount is not None else "Premium unavailable"
        summary = result.get("summary", "")
        facts = [{"label": "Annual premium before tax", "value": f"{result.get('currency', 'INR')} {amount:,.2f}" if amount is not None else "Not calculated"}]
        if amount is None:
            issues = result.get("findings") or ["A matching product rate configuration and verified pricing inputs are required."]
        attention = amount is None
    else:
        title = result.get("recommendation") or "Employee decision needed"
        summary = result.get("rationale") or result.get("summary", "")
        issues = result.get("missing_information", [])
        attention = True
    return {"title": title, "summary": summary, "facts": facts, "issues": list(dict.fromkeys(str(item) for item in issues if item)), "attention": attention}


def open_items(case):
    items = []
    for step, result in case.get("workflow", {}).get("steps", {}).items():
        for index, text in enumerate(result.get("outcome", {}).get("issues", [])):
            items.append({"id": f"{step}:{index}", "step": step, "text": text})
    return items


def _commit(case, step, result, employee_note=None):
    workflow = case["workflow"]
    saved = deepcopy(result)
    saved["completed_at"] = _now()
    saved["completion_mode"] = "employee_review" if employee_note else "automatic"
    if employee_note:
        saved["reviewer_confirmed"] = True
        saved["reviewer_attestation"] = employee_note
    else:
        saved["reviewer_confirmed"] = False
    workflow.setdefault("steps", {})[step] = saved
    index = repository.WORKFLOW_STEPS.index(step)
    workflow["current_step"] = repository.WORKFLOW_STEPS[index + 1] if index + 1 < len(repository.WORKFLOW_STEPS) else "complete"
    for key in ("pending_step", "pending_result", "intervention"):
        workflow.pop(key, None)
    workflow["pipeline_status"] = "running"
    repository._save_case_event(case, f"Pipeline stage completed: {step}", employee_note or "Automatic processing completed; this is not an employee verification or underwriting pass.")


def execute_pipeline(application_id, request, on_progress=None):
    lock = case_lock(application_id)
    if not lock.acquire(blocking=False):
        raise ValueError("This application's pipeline is already running. Wait for its current run to finish.")
    case = None
    def emit(kind, step, message):
        if on_progress:
            on_progress({"agent": step, "kind": kind, "message": message, "application": deepcopy(case)})
    try:
        case = repository.get_case(application_id)
        if case is None:
            raise ValueError("Application not found.")
        if case.get("status") in {"Approved", "Declined"}:
            raise ValueError("A decision is already recorded for this application.")
        if not case.get("workflow", {}).get("started_at"):
            case = repository.start_pipeline(application_id)
        workflow = case["workflow"]
        workflow["version"] = 5
        pending = workflow.get("pending_result")
        step = workflow.get("current_step")
        if request.get("command") == "resume":
            if not pending or not workflow.get("intervention") or request.get("result_id") != pending.get("result_id"):
                raise ValueError("The review has changed. Refresh the application and review the current checkpoint.")
            note = str(request.get("note") or "").strip()
            if request.get("confirmed") is not True or not note:
                raise ValueError("Confirm the checkpoint and add your review note before resuming.")
            if not pending.get("can_continue"):
                raise ValueError("Required information is still missing. Resolve it and run this check again.")
            _commit(case, step, pending, note[:2000])
            emit("stage_complete", step, "Employee review recorded. Continuing automatically.")
        elif request.get("command") == "retry":
            if not workflow.get("intervention") or request.get("result_id") != (pending or {}).get("result_id"):
                raise ValueError("Refresh and review the current checkpoint before retrying.")
            for key in ("pending_step", "pending_result", "intervention"):
                workflow.pop(key, None)
        elif workflow.get("intervention"):
            return case
        workflow["pipeline_status"] = "running"
        repository._save_case_event(case, "Pipeline running", "Employee started or resumed automatic processing.")
        for _ in repository.WORKFLOW_STEPS:
            step = workflow.get("current_step")
            if step == "complete":
                break
            emit("stage_running", step, f"Running {step.replace('_', ' ')}…")
            result = workflow.get("pending_result") if workflow.get("pending_step") == step else None
            if not result:
                run = repository.run_workflow_step(application_id, step, _case=case)
                result = run["step_result"]
            if step in {"irdai", "company_policy"} and "evidence_review" not in result:
                emit("stage_running", step, "Comparing selected policy rules with the recorded application evidence…")
                result["evidence_review"] = review_policy_evidence(case, "regulatory" if step == "irdai" else "company")
            result["outcome"] = summarize_step(step, result, case)
            if step == "recommendation":
                gaps = open_items(case)
                result["missing_information"] = list(dict.fromkeys(result.get("missing_information", []) + [item["text"] for item in gaps]))
                if gaps and result.get("recommendation_category") == "approve_consideration":
                    result.update(recommendation="Refer for employee review", recommendation_category="refer_manual_review", rationale="Unresolved evidence or pricing gaps remain in the completed pipeline.")
                result["outcome"] = summarize_step(step, result, case)
            blockers = not result.get("can_continue")
            pause = blockers or step in {"documents", "risk"} or (step == "application_details" and result["outcome"]["issues"])
            if pause:
                workflow["pending_result"] = result
                workflow["pending_step"] = step
                workflow["pipeline_status"] = "waiting_for_employee"
                workflow["intervention"] = {
                    "step": step, "result_id": result["result_id"], "blocked": blockers,
                    "title": "Provide missing information" if blockers else "Verify extracted application details" if step == "documents" else "Review findings before pricing" if step == "risk" else "Resolve application details",
                    "instruction": "Resolve the missing information, then retry this check." if blockers else "Compare the extracted values with the original documents and record any discrepancies." if step == "documents" else "Review the policy evidence and medical findings below. Record your assessment or refer the application. Unresolved gaps remain visible in the final dashboard." if step == "risk" else "Check the missing application details before continuing.",
                    "created_at": _now()}
                repository._save_case_event(case, "Pipeline paused for employee", workflow["intervention"]["title"])
                emit("employee_required", step, workflow["intervention"]["title"])
                return case
            _commit(case, step, result)
            emit("stage_complete", step, result["outcome"]["title"])
        workflow["pipeline_status"] = "complete"
        workflow["completed_at"] = _now()
        workflow["open_items"] = open_items(case)
        repository._save_case_event(case, "Pipeline completed", "Application dashboard prepared. An authorized employee must record the final decision.")
        emit("pipeline_complete", "recommendation", "Processing complete. The application dashboard is ready.")
        return case
    except Exception:
        if case and case.get("workflow", {}).get("pipeline_status") == "running":
            case["workflow"]["pipeline_status"] = "interrupted"
            try:
                repository._save_case_event(case, "Pipeline interrupted", "Processing stopped before completion; resume from the saved stage.")
            except Exception:
                pass
        raise
    finally:
        lock.release()
