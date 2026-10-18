"""Seed the synthetic applicant data feed and three demo applications with different outcomes.

Run after creating the schema:
  python -m backend.scripts.seed_health_profiles

Idempotent: existing profiles and applications are never overwritten. Every
record is explicitly synthetic; the yes/no values stand in for a live data feed.
"""
import json
from datetime import datetime, timezone

from google.cloud import bigquery

from backend.repositories import health_underwriting as repository
from backend.repositories.health_profile import HEALTH_FLAGS, TABLE_NAME, VERIFICATION_FLAGS, load_profile, profile_schema
from backend.repositories.policy_library import list_policies

DATA_SOURCE = "Synthetic applicant data feed"
PRODUCT_CODE = "SLH-HSP-IND-01"
PRODUCT_NAME = "SecureLife Health Shield Plus"
_VERIFIED = {key: True for key in VERIFICATION_FLAGS}
_NONE = {key: False for key in HEALTH_FLAGS}

# Pooja's case already exists; it only needs its data-feed record.
EXISTING_PROFILES = {"SLH-HI-2026-0147": {**_VERIFIED, **_NONE, "thyroid_disorder": True, "family_history_critical": True, "bmi": 25.5}}

DEMO_CASES = [
    {"application_id": "SLH-HI-2026-0148", "applicant": "Arun Nair", "date_of_birth": "1990-03-12", "sum_insured_inr": 500000,
     "city": "Bengaluru", "email": "arun.nair@example.com",
     "profile": {**_VERIFIED, **_NONE, "bmi": 22.4}},
    {"application_id": "SLH-HI-2026-0149", "applicant": "Meera Iyer", "date_of_birth": "1978-11-02", "sum_insured_inr": 1500000,
     "city": "Mysuru", "email": "meera.iyer@example.com",
     "profile": {**_VERIFIED, **_NONE, "diabetes": True, "hypertension": True, "hospitalised_5y": True, "bmi": 29.8}},
    {"application_id": "SLH-HI-2026-0150", "applicant": "Vikram Desai", "date_of_birth": "1987-06-25", "sum_insured_inr": 1000000,
     "city": "Bengaluru", "email": "vikram.desai@example.com",
     "profile": {**_VERIFIED, **_NONE, "thyroid_disorder": True, "tobacco_user": True, "consent_recorded": False,
                 "prior_policy_confirmed": False, "bmi": 27.1}},
]


def profile_row(application_id, values, now):
    return {"application_id": application_id, **values, "data_source": DATA_SOURCE, "retrieved_at": now, "synthetic": True}


def case_record(spec, now):
    details = {"sum_insured_inr": spec["sum_insured_inr"],
               "declaration_summary": "Synthetic applicant record; yes/no answers are held in the applicant data feed.",
               "submitted_application": {"region": {"country": "India", "state": "Karnataka", "city": spec["city"]},
                                         "coverage": {"sum_insured_inr": spec["sum_insured_inr"]}, "product_code": PRODUCT_CODE}}
    return {"application_id": spec["application_id"], "applicant": spec["applicant"], "date_of_birth": spec["date_of_birth"],
            "received_at": now, "status": "Ready for underwriting", "insurance_type": "health", "product_code": PRODUCT_CODE,
            "plan": PRODUCT_NAME, "submission_channel": "Applicant data feed", "record_origin": "sample_application",
            "application_details": details, "documents": [], "issues": [], "checks": [], "medical_declaration": {},
            "risk": {"score": None, "band": "Not assessed", "basis": "Underwriting has not started."}, "evidence": [],
            "policy_selection": None, "selected_policy_id": None,
            "suggested_action": "Review application and start underwriting",
            "workflow": {"version": 6, "steps": {}, "current_step": "intake"}}


def insert_case(spec, now):
    applicant_id = f"AP-{spec['application_id']}"
    case = case_record(spec, now)
    rows = [("applicants", {"applicant_id": applicant_id, "full_name": spec["applicant"], "date_of_birth": spec["date_of_birth"],
                            "email": spec["email"], "synthetic": True}),
            ("applications", {"application_id": spec["application_id"], "applicant_id": applicant_id, "submitted_at": now,
                              "insurance_type": "health", "product_code": PRODUCT_CODE, "product_name": PRODUCT_NAME,
                              "application_status": case["status"], "submission_channel": case["submission_channel"],
                              "risk_band": "Not assessed", "case_json": json.dumps(case), "synthetic": True, "updated_at": now})]
    for table, row in rows:
        errors = repository._client().insert_rows_json(repository._table(table), [row], row_ids=[row.get("application_id", row.get("applicant_id"))])
        if errors:
            raise RuntimeError(f"Could not insert {spec['application_id']} into {table}: {errors[:2]}")


def select_policies(application_id):
    policies = list_policies("health")
    primary = next((p for p in policies if p.get("product_code") == PRODUCT_CODE and p.get("policy_kind") == "company"), None)
    regulatory = next((p for p in policies if p.get("policy_kind") == "regulatory"), None)
    if not primary:
        raise ValueError("Register the SecureLife Health Shield Plus product configuration first.")
    repository.save_case_policies(application_id, [primary["policy_id"]] + ([regulatory["policy_id"]] if regulatory else []), primary["policy_id"])


def save_profile(application_id, values, now):
    if load_profile(application_id):
        print(f"Profile already present: {application_id}")
        return
    errors = repository._client().insert_rows_json(repository._table(TABLE_NAME), [profile_row(application_id, values, now)], row_ids=[application_id])
    if errors:
        raise RuntimeError(f"Could not save the data record for {application_id}: {errors[:2]}")
    print(f"Saved data record: {application_id}")


def main():
    now = datetime.now(timezone.utc).isoformat()
    client = repository._client()
    client.create_table(bigquery.Table(repository._table(TABLE_NAME), schema=profile_schema()), exists_ok=True)
    for application_id, values in EXISTING_PROFILES.items():
        if repository.get_case(application_id):
            save_profile(application_id, values, now)
    for spec in DEMO_CASES:
        if not repository.get_case(spec["application_id"]):
            insert_case(spec, now)
            select_policies(spec["application_id"])
            print(f"Imported {spec['application_id']}: {spec['applicant']}")
        save_profile(spec["application_id"], spec["profile"], now)


if __name__ == "__main__":
    main()
