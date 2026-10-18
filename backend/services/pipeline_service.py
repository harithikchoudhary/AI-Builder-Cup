"""Run the saved underwriting sequence until evidence needs an employee.

Every stage is persisted. Automatic completion means processing finished, never
that the application passed underwriting or that an employee approved a policy.
"""
from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock

from backend.repositories import health_underwriting as repository
from backend.services.policy_evidence import review_policy_evidence

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
    if step == "intake":
        submitted = result.get("application", {})
        profile = case.get("health_profile")
        issues = [f"{label} is missing from the application." for key, label in (("applicant", "Applicant name"), ("date_of_birth", "Date of birth"), ("product_name", "Product name")) if not submitted.get(key)]
        if profile:
            checks = case.get("checks", [])
            issues += [f"{check['title']}: {check['detail']}" for check in checks if check.get("state") != "Passed"]
            facts = [{"label": "Applicant", "value": case.get("applicant")},
                     {"label": "Verified", "value": f"{sum(c.get('state') == 'Passed' for c in checks)} of {len(checks)}"},
                     {"label": "Data source", "value": profile.get("data_source") or "Applicant data feed"}]
            title, summary = "Applicant data retrieved", "Yes/no verification and health answers were retrieved from the applicant data record."
        elif case.get("insurance_type", "health") == "health":
            issues.append("No applicant data record is available for this application.")
            facts = [{"label": "Applicant", "value": case.get("applicant")}]
            title, summary = "Applicant data unavailable", "Add the applicant's yes/no data record, then retry this check."
        else:
            facts = [{"label": "Applicant", "value": case.get("applicant")}, {"label": "Product", "value": case.get("plan")}]
            title, summary = "Application details organized", "Applicant and cover details are ready for review."
        attention = bool(issues)
    elif step == "rules":
        review = result.get("evidence_review", {})
        counts = review.get("counts", {})
        total = len(review.get("rules", []))
        title = "Policy rules checked"
        summary = f"Compared the applicant data with {total} regulatory and company rules from {review.get('policy_count', 0)} selected policies. Matches are review aids, not passed checks."
        if review.get("errors"):
            title = "Policy rules need manual review"
            summary = f"Automatic matching was unavailable for part of this review. All {total} selected rules remain listed with their sources."
        facts = [{"label": "Rules", "value": str(total)}, {"label": "Evidence found", "value": str(counts.get("evidence_found", 0))},
                 {"label": "Reference only", "value": str(counts.get("review_needed", 0) + counts.get("evidence_missing", 0))}]
        if not total:
            issues.append("No extracted regulatory or company rules are available to compare.")
        attention = bool(issues)
    elif step == "risk":
        risk = result.get("risk_assessment", {})
        triaged = risk.get("assessment_type") == "policy_based_triage" and risk.get("status") == "triage_completed"
        title = "Product risk triage completed" if triaged else "Medical review needed" if risk.get("score") is None else "Risk evidence collected"
        summary = "Confirm or change the AI-proposed risk classes before pricing."
        facts = [{"label": "Risk rating", "value": risk.get("band") if triaged or risk.get("score") is not None else "Not assessed"}]
        if risk.get("score") is None and not triaged:
            if risk.get("assessment_type") == "policy_based_triage":
                issues.append("Confirm the risk assessment below and refresh the findings.")
            else:
                issues.append("A validated risk assessment is not available. Qualified medical or underwriting review remains required.")
        issues.extend(result.get("open_evidence_gaps", []))
        attention = True
    else:
        premium = result.get("premium_result") or {}
        amount = premium.get("premium")
        title = result.get("recommendation") or "Employee decision needed"
        summary = result.get("rationale") or result.get("summary", "")
        facts = [{"label": "Annual premium before tax", "value": f"{premium.get('currency', 'INR')} {amount:,.2f}" if amount is not None else "Not calculated"}]
        issues = result.get("missing_information", [])
        attention = True
    return {"title": title, "summary": summary, "facts": facts, "issues": list(dict.fromkeys(str(item) for item in issues if item)), "attention": attention}


def open_items(case):
    items = []
    for step, result in case.get("workflow", {}).get("steps", {}).items():
        if step == "decision":
            continue  # The decision repeats earlier gaps; don't count them twice.
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
    started_run = False
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
        workflow["version"] = 6
        if workflow.get("current_step") == "complete":
            return case
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
            started_run = True
            _commit(case, step, pending, note[:2000])
            emit("stage_complete", step, "Employee review recorded. Continuing automatically.")
        elif request.get("command") == "retry":
            if not workflow.get("intervention") or request.get("result_id") != (pending or {}).get("result_id"):
                raise ValueError("Refresh and review the current checkpoint before retrying.")
            for key in ("pending_step", "pending_result", "intervention"):
                workflow.pop(key, None)
        elif workflow.get("intervention"):
            return case
        started_run = True
        workflow["pipeline_status"] = "running"
        case["status"] = "In review"
        repository._save_case_event(case, "Pipeline running", "Employee started or resumed automatic processing.")
        # Saved reviews keep their prior employee notes; only a missing outcome is filled in.
        for saved_step, saved_result in workflow.get("steps", {}).items():
            saved_result.setdefault("outcome", summarize_step(saved_step, saved_result, case))
        for _ in repository.WORKFLOW_STEPS:
            step = workflow.get("current_step")
            if step == "complete":
                break
            emit("stage_running", step, f"Running {step.replace('_', ' ')}…")
            result = workflow.get("pending_result") if workflow.get("pending_step") == step else None
            if not result:
                run = repository.run_workflow_step(application_id, step, _case=case)
                result = run["step_result"]
            if step == "rules" and "evidence_review" not in result:
                emit("stage_running", step, "Comparing regulatory and company rules with the applicant data record…")
                result["evidence_review"] = review_policy_evidence(case, ("regulatory", "company"))
            result["outcome"] = summarize_step(step, result, case)
            if step == "intake" and result["outcome"]["issues"] and not case.get("health_profile"):
                result["can_continue"] = False
            if step == "decision":
                premium = result.get("premium_result") or {}
                priced = premium.get("premium") is not None and premium.get("premium_basis") != "ai_estimate"
                pricing_gaps = [] if priced else (premium.get("findings") or ["A matching product rate configuration and verified pricing inputs are required."])
                gaps = open_items(case)
                result["missing_information"] = list(dict.fromkeys(result.get("missing_information", []) + [item["text"] for item in gaps] + pricing_gaps))
                if (gaps or pricing_gaps) and result.get("recommendation_category") == "approve_consideration":
                    result.update(recommendation="Refer for employee review", recommendation_category="refer_manual_review", rationale="Unresolved evidence or pricing gaps remain in the completed pipeline.")
                    result.pop("llm", None)  # An earlier explanation must not contradict this result.
                result["outcome"] = summarize_step(step, result, case)
            blockers = not result.get("can_continue")
            pause = blockers or step == "risk"
            if pause:
                workflow["pending_result"] = result
                workflow["pending_step"] = step
                workflow["pipeline_status"] = "waiting_for_employee"
                workflow["intervention"] = {
                    "step": step, "result_id": result["result_id"], "blocked": blockers,
                    "title": "Provide missing information" if blockers else "Confirm the risk assessment",
                    "instruction": "Resolve the missing information, then retry this check." if blockers else "Review the AI-proposed risk classes against the applicant data and confirm or change them. Unresolved gaps remain visible in the final dashboard.",
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
        emit("pipeline_complete", "decision", "Processing complete. The application dashboard is ready.")
        return case
    except Exception:
        if started_run and case and case.get("workflow", {}).get("pipeline_status") == "running":
            case["workflow"]["pipeline_status"] = "interrupted"
            try:
                repository._save_case_event(case, "Pipeline interrupted", "Processing stopped before completion; resume from the saved stage.")
            except Exception:
                pass
        raise
    finally:
        lock.release()
