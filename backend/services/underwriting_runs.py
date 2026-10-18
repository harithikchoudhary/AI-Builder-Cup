"""Append-only run snapshots, retained when an employee regenerates a review."""
from copy import deepcopy
from datetime import datetime, timezone
import uuid

from google.cloud import bigquery
from backend.repositories import health_underwriting as repository
from backend.services.pipeline_service import case_lock

ARCHIVE_EVENT = "Underwriting run regenerated"


def regenerate(application_id, reason, expected_run_key):
    if not reason.strip():
        raise ValueError("Explain why you are starting a new underwriting review.")
    lock = case_lock(application_id)
    if not lock.acquire(blocking=False):
        raise ValueError("Wait for the current run to stop before starting another review.")
    try:
        case = repository.get_case(application_id)
        if case is None:
            return None
        workflow = case.get("workflow", {})
        if not workflow.get("started_at"):
            raise ValueError("This application has no started run to regenerate. Start its first review instead.")
        if not expected_run_key or expected_run_key != (workflow.get("run_id") or workflow.get("started_at")):
            raise ValueError("The current review has changed. Refresh before starting a new review.")
        # One event saves both the archived snapshot and fresh active state. A
        # failed insert cannot leave an archive-only or reset-only transition.
        snapshot = deepcopy(case)
        run_id = workflow.get("run_id") or f"RUN-{uuid.uuid4().hex}"
        number = workflow.get("run_number", 1)
        snapshot["workflow"]["run_id"] = run_id
        snapshot["workflow"]["run_number"] = number
        archived = {"run_id": run_id, "run_number": number,
                    "archived_at": datetime.now(timezone.utc).isoformat(),
                    "reason": reason.strip(), "case": snapshot}
        case["workflow"] = {"version": 6, "run_id": f"RUN-{uuid.uuid4().hex}",
                            "run_number": number + 1, "previous_run_id": run_id,
                            "steps": {}, "current_step": "intake"}
        case["status"] = "Ready for underwriting"
        case["decision"] = None
        case["review_note"] = None
        case["suggested_action"] = "Review selected policies and start the new underwriting run"
        case["risk"] = {"score": None, "band": "Not assessed", "basis": "New review has not started."}
        case["premium_calculation"] = None
        case["risk_factors"] = []
        case["health_rating_inputs"] = None
        case["health_triage"] = None
        case["evidence_resolutions"] = {}
        case["health_profile"] = None
        repository._save_case_event(case, ARCHIVE_EVENT, reason.strip(), {"archived_run": archived})
        return case
    finally:
        lock.release()


def list_runs(application_id):
    rows = repository._query(
        f"""SELECT JSON_VALUE(metadata_json, '$.archived_run.run_id') AS run_id,
                   JSON_VALUE(metadata_json, '$.archived_run.run_number') AS run_number,
                   JSON_VALUE(metadata_json, '$.archived_run.case.workflow.started_at') AS started_at,
                   JSON_VALUE(metadata_json, '$.archived_run.case.workflow.completed_at') AS completed_at,
                   JSON_VALUE(metadata_json, '$.archived_run.case.status') AS status,
                   JSON_VALUE(metadata_json, '$.archived_run.reason') AS reason,
                   JSON_VALUE(metadata_json, '$.archived_run.case.workflow.current_step') AS last_step,
                   created_at
            FROM `{repository._table('review_events')}`
            WHERE application_id = @application_id AND event_type = @event_type
            ORDER BY created_at DESC LIMIT 100""",
        [bigquery.ScalarQueryParameter("application_id", "STRING", application_id),
         bigquery.ScalarQueryParameter("event_type", "STRING", ARCHIVE_EVENT)])
    return [dict(row.items()) for row in rows]


def get_run(application_id, run_id):
    rows = repository._query(
        f"""SELECT JSON_QUERY(metadata_json, '$.archived_run') AS archived
            FROM `{repository._table('review_events')}`
            WHERE application_id = @application_id AND event_type = @event_type
              AND JSON_VALUE(metadata_json, '$.archived_run.run_id') = @run_id
            ORDER BY created_at DESC LIMIT 1""",
        [bigquery.ScalarQueryParameter("application_id", "STRING", application_id),
         bigquery.ScalarQueryParameter("event_type", "STRING", ARCHIVE_EVENT),
         bigquery.ScalarQueryParameter("run_id", "STRING", run_id)])
    archived = repository._json_or_empty(rows[0].archived) if rows else None
    workflow = ((archived or {}).get("case") or {}).get("workflow")
    if workflow and workflow.get("version", 1) < 6:
        archived["case"]["workflow"] = repository.migrate_workflow(workflow)
    return archived


def archived_document(application_id, document_id):
    rows = repository._query(
        f"""SELECT doc FROM `{repository._table('review_events')}`,
            UNNEST(JSON_QUERY_ARRAY(metadata_json, '$.archived_run.case.documents')) AS doc
            WHERE application_id = @application_id AND event_type = @event_type
              AND JSON_VALUE(doc, '$.document_id') = @document_id
            ORDER BY created_at DESC LIMIT 1""",
        [bigquery.ScalarQueryParameter("application_id", "STRING", application_id),
         bigquery.ScalarQueryParameter("event_type", "STRING", ARCHIVE_EVENT),
         bigquery.ScalarQueryParameter("document_id", "STRING", document_id)])
    return repository._json_or_empty(rows[0].doc) if rows else None
