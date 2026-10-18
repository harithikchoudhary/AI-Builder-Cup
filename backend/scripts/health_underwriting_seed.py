"""Create a realistic, fictional Singapore health-underwriting demo in BigQuery.

Safe to re-run: this script never deletes or replaces data. It creates the
dedicated dataset and tables if absent, and seeds only when applications is
empty. Every row is explicitly marked synthetic.
"""

import argparse
import json
import random
from datetime import date, datetime, time, timedelta, timezone

from google.api_core.exceptions import NotFound
from google.cloud import bigquery

from backend.integrations.mcp_tools import PROJECT_ID
from backend.repositories.health_underwriting import LOCATION

# Fictional sample data must stay isolated from the real intake dataset.
DATASET_ID = "intentra_health_underwriting_demo"


FIRST_NAMES = [
    "Aisha", "Amir", "Aminah", "Ananya", "Arjun", "Cheryl", "Darren", "Deepa",
    "Ethan", "Farah", "Hannah", "Irfan", "Jia Wei", "Jia Hui", "Kavitha", "Kelvin",
    "Li Wei", "Lim Mei", "Marcus", "Mei Lin", "Mohamed", "Nur Aisyah", "Prakash",
    "Priya", "Rachel", "Ravi", "Siti", "Sofia", "Wei Ming", "Yong Han",
]
LAST_NAMES = [
    "Abdullah", "Chan", "Chua", "Devi", "Goh", "Hassan", "Ho", "Ibrahim", "Kaur",
    "Koh", "Kumar", "Lim", "Ling", "Loh", "Menon", "Mohamed", "Nair", "Ng",
    "Ong", "Pillai", "Raman", "Rao", "Santos", "Sharma", "Singh", "Tan", "Teo",
    "Wong", "Yap", "Yeo",
]
PRODUCTS = [
    ("IH-ESSENTIAL", "Intentra Health Essential", 150000),
    ("IH-PLUS", "Intentra Health Plus", 300000),
    ("IH-PRIME", "Intentra Health Prime", 500000),
]
CONDITIONS = [
    "No condition declared", "Asthma (controlled)", "Hypertension (controlled)",
    "Type 2 diabetes (managed)", "High cholesterol (managed)",
    "Thyroid condition (managed)", "Previous surgery (fully recovered)",
]
MEDICATIONS = {
    "No condition declared": [], "Asthma (controlled)": ["Inhaled medication (declared)"],
    "Hypertension (controlled)": ["Antihypertensive medication (declared)"],
    "Type 2 diabetes (managed)": ["Prescribed medication (declared)"],
    "High cholesterol (managed)": ["Lipid-lowering medication (declared)"],
    "Thyroid condition (managed)": ["Thyroid medication (declared)"],
    "Previous surgery (fully recovered)": [],
}
STATUSES = ["New", "In review", "Needs information", "Referred", "Approved", "Declined"]
STATUS_WEIGHTS = [18, 22, 20, 12, 23, 5]
REVIEWERS = ["Underwriter A", "Underwriter B", "Medical Review Team"]
CHANNELS = ["Direct web", "Insurance broker", "Financial adviser"]


def _schema():
    return {
        "applicants": [
            bigquery.SchemaField("applicant_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("full_name", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("date_of_birth", "DATE", mode="REQUIRED"),
            bigquery.SchemaField("email", "STRING"),
            bigquery.SchemaField("contact_reference", "STRING"),
            bigquery.SchemaField("residency_status", "STRING"),
            bigquery.SchemaField("residence_country", "STRING"),
            bigquery.SchemaField("synthetic", "BOOL", mode="REQUIRED"),
        ],
        "applications": [
            bigquery.SchemaField("application_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("applicant_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("submitted_at", "TIMESTAMP", mode="REQUIRED"),
            bigquery.SchemaField("coverage_start_date", "DATE"),
            bigquery.SchemaField("product_code", "STRING"),
            bigquery.SchemaField("product_name", "STRING"),
            bigquery.SchemaField("insurance_type", "STRING"),
            bigquery.SchemaField("coverage_limit_sgd", "INT64"),
            bigquery.SchemaField("illustrative_annual_premium_sgd", "NUMERIC"),
            bigquery.SchemaField("application_status", "STRING"),
            bigquery.SchemaField("submission_channel", "STRING"),
            bigquery.SchemaField("assigned_reviewer", "STRING"),
            bigquery.SchemaField("risk_score", "INT64"),
            bigquery.SchemaField("risk_band", "STRING"),
            bigquery.SchemaField("recommendation", "STRING"),
            bigquery.SchemaField("last_review_note", "STRING"),
            bigquery.SchemaField("decision_json", "STRING"),
            bigquery.SchemaField("case_json", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("synthetic", "BOOL", mode="REQUIRED"),
            bigquery.SchemaField("updated_at", "TIMESTAMP"),
        ],
        "medical_declarations": [
            bigquery.SchemaField("application_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("declared_conditions", "STRING", mode="REPEATED"),
            bigquery.SchemaField("current_medications", "STRING", mode="REPEATED"),
            bigquery.SchemaField("prior_hospitalisation", "BOOL"),
            bigquery.SchemaField("tobacco_use", "STRING"),
            bigquery.SchemaField("declaration_summary", "STRING"),
            bigquery.SchemaField("synthetic", "BOOL", mode="REQUIRED"),
        ],
        "supporting_documents": [
            bigquery.SchemaField("document_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("application_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("document_type", "STRING"),
            bigquery.SchemaField("received_at", "TIMESTAMP"),
            bigquery.SchemaField("document_status", "STRING"),
            bigquery.SchemaField("object_uri", "STRING"),
            bigquery.SchemaField("extracted_fields_json", "STRING"),
            bigquery.SchemaField("extraction_confidence", "FLOAT64"),
            bigquery.SchemaField("synthetic", "BOOL", mode="REQUIRED"),
        ],
        "validation_findings": [
            bigquery.SchemaField("finding_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("application_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("check_category", "STRING"),
            bigquery.SchemaField("severity", "STRING"),
            bigquery.SchemaField("description", "STRING"),
            bigquery.SchemaField("source_document_id", "STRING"),
            bigquery.SchemaField("finding_status", "STRING"),
            bigquery.SchemaField("created_at", "TIMESTAMP"),
            bigquery.SchemaField("synthetic", "BOOL", mode="REQUIRED"),
        ],
        "policy_rules": [
            bigquery.SchemaField("rule_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("product_code", "STRING"),
            bigquery.SchemaField("jurisdiction", "STRING"),
            bigquery.SchemaField("category", "STRING"),
            bigquery.SchemaField("rule_text", "STRING"),
            bigquery.SchemaField("handling", "STRING"),
            bigquery.SchemaField("effective_from", "DATE"),
            bigquery.SchemaField("rule_source", "STRING"),
            bigquery.SchemaField("example_only", "BOOL", mode="REQUIRED"),
        ],
        "underwriting_policies": [
            bigquery.SchemaField("policy_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("policy_name", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("insurance_type", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("policy_kind", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("insurer_name", "STRING"),
            bigquery.SchemaField("product_name", "STRING"),
            bigquery.SchemaField("product_code", "STRING"),
            bigquery.SchemaField("uin", "STRING"),
            bigquery.SchemaField("version", "STRING"),
            bigquery.SchemaField("effective_from", "DATE"),
            bigquery.SchemaField("effective_to", "DATE"),
            bigquery.SchemaField("status", "STRING"),
            bigquery.SchemaField("source_filename", "STRING"),
            bigquery.SchemaField("source_mime_type", "STRING"),
            bigquery.SchemaField("object_uri", "STRING"),
            bigquery.SchemaField("policy_text", "STRING"),
            bigquery.SchemaField("extracted_rules_json", "STRING"),
            bigquery.SchemaField("extraction_model", "STRING"),
            bigquery.SchemaField("created_at", "TIMESTAMP"),
            bigquery.SchemaField("created_by", "STRING"),
            bigquery.SchemaField("synthetic", "BOOL", mode="REQUIRED"),
        ],
        "risk_assessments": [
            bigquery.SchemaField("assessment_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("application_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("model_name", "STRING"),
            bigquery.SchemaField("model_version", "STRING"),
            bigquery.SchemaField("assessed_at", "TIMESTAMP"),
            bigquery.SchemaField("risk_score", "INT64"),
            bigquery.SchemaField("risk_band", "STRING"),
            bigquery.SchemaField("contributing_factors_json", "STRING"),
            bigquery.SchemaField("recommendation", "STRING"),
            bigquery.SchemaField("explanation", "STRING"),
            bigquery.SchemaField("synthetic", "BOOL", mode="REQUIRED"),
        ],
        "review_events": [
            bigquery.SchemaField("event_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("application_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("event_type", "STRING"),
            bigquery.SchemaField("actor", "STRING"),
            bigquery.SchemaField("reason", "STRING"),
            bigquery.SchemaField("created_at", "TIMESTAMP"),
            bigquery.SchemaField("metadata_json", "STRING"),
            bigquery.SchemaField("synthetic", "BOOL", mode="REQUIRED"),
        ],
    }


def _rules():
    effective = date(2026, 1, 1).isoformat()
    rules = [
        ("DOC-01", "All", "Completeness", "A signed application and health declaration are needed before assessment.", "Request missing information; do not infer an answer."),
        ("DOC-02", "All", "Evidence", "A supporting report may be requested when the declaration indicates further review is needed.", "Refer for employee review; no automatic outcome."),
        ("VAL-01", "All", "Consistency", "Conflicting values between the form and supporting documents require verification.", "Pause assessment and ask the applicant or reviewer to resolve the conflict."),
        ("UW-01", "All", "Underwriting", "Declared medical information is reviewed under the selected product's approved underwriting guide.", "Show the applicable source rule and route uncertain cases to a qualified reviewer."),
        ("UW-02", "All", "Human oversight", "A model or automated rule may support triage but cannot record the final underwriting outcome.", "Require an employee decision and reason."),
        ("PRIV-01", "All", "Privacy", "Only information required for the selected product and review purpose should be presented.", "Mask unnecessary identifiers and restrict access."),
    ]
    return [{
        "rule_id": rule_id, "product_code": product, "jurisdiction": "SG-DEMO",
        "category": category, "rule_text": text, "handling": handling,
        "effective_from": effective, "rule_source": "Intentra fictional demonstration rule; not legal or insurer guidance.",
        "example_only": True,
    } for rule_id, product, category, text, handling in rules]


def _make_data(size=120):
    rng = random.Random(611341)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    applicants, applications, declarations, documents = [], [], [], []
    findings, assessments, events = [], [], []
    for index in range(1, size + 1):
        applicant_id = f"SYN-PER-{index:05d}"
        application_id = f"SYN-HI-2026-{index:05d}"
        name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
        age = rng.randint(23, 66)
        born = date(now.year - age, rng.randint(1, 12), 1)
        submitted = now - timedelta(days=rng.randint(0, 59), hours=rng.randint(0, 23))
        product_code, product_name, coverage = rng.choice(PRODUCTS)
        condition = rng.choices(CONDITIONS, weights=[35, 13, 14, 11, 10, 7, 10])[0]
        hospitalised = rng.random() < (0.25 if condition != "No condition declared" else 0.06)
        issue_types = []
        if rng.random() < 0.13:
            issue_types.append("Supporting medical report missing")
        if rng.random() < 0.07:
            issue_types.append("Applicant detail needs verification")
        if rng.random() < 0.06:
            issue_types.append("Declaration requires clarification")
        status = rng.choices(STATUSES, weights=STATUS_WEIGHTS)[0]
        if issue_types and status in {"New", "In review"} and rng.random() < 0.68:
            status = "Needs information"
        if issue_types and status in {"Approved", "Declined"}:
            status = "Needs information" if any("missing" in issue.lower() for issue in issue_types) else "Referred"
        if status == "Declined" and not issue_types:
            pass  # A declined status below is paired with a fictional employee decision event.
        base = 18 + (14 if condition not in {"No condition declared", "Previous surgery (fully recovered)"} else 0)
        base += (11 if condition in {"Type 2 diabetes (managed)", "Hypertension (controlled)"} else 0)
        base += 9 if hospitalised else 0
        base += 7 if "Declaration requires clarification" in issue_types else 0
        score = min(84, max(8, base + rng.randint(-8, 9)))
        band = "Low" if score < 35 else "Moderate" if score < 60 else "Elevated"
        if issue_types:
            recommendation = "Request information" if "Supporting medical report missing" in issue_types else "Employee review required"
        elif band == "Elevated":
            recommendation = "Refer to medical underwriter"
        else:
            recommendation = "Continue standard employee review"
        plan_factor = {"IH-ESSENTIAL": 1.0, "IH-PLUS": 1.27, "IH-PRIME": 1.62}[product_code]
        premium = round((420 + age * 19 + score * 8) * plan_factor, 2)
        decision = None
        review_note = ""
        reviewed_at = min(now, submitted + timedelta(hours=rng.randint(2, 48)))
        if status in {"Approved", "Declined"}:
            decision = {
                "action": "Approve" if status == "Approved" else "Decline",
                "reviewer": REVIEWERS[0], "recorded_at": reviewed_at.isoformat(),
                "reason": "Fictional historical employee outcome for demonstrating the review workflow.",
            }
            review_note = decision["reason"]
        docs = []
        doc_specs = [
            ("Application form", "Received", ["Applicant name", "Selected plan", "Coverage start date"]),
            ("Health declaration", "Received", ["Declared conditions", "Medication declaration", "Consent"]),
            ("Identity verification reference", "Verified", ["Name match", "Reference token (masked)"]),
        ]
        if condition != "No condition declared" or hospitalised:
            doc_specs.append(("Supporting medical report", "Missing" if "Supporting medical report missing" in issue_types else "Received", ["Provider name", "Report date", "Relevant findings"]))
        for doc_index, (doc_type, doc_status, extracted) in enumerate(doc_specs, 1):
            doc_id = f"SYN-DOC-{index:05d}-{doc_index:02d}"
            docs.append({"document_id": doc_id, "name": doc_type, "state": doc_status, "fields": extracted if doc_status != "Missing" else []})
            documents.append({
                "document_id": doc_id, "application_id": application_id,
                "document_type": doc_type, "received_at": submitted.isoformat(),
                "document_status": doc_status, "object_uri": None,
                "extracted_fields_json": json.dumps({field: "Synthetic value; verify against source" for field in extracted}) if doc_status != "Missing" else "{}",
                "extraction_confidence": round(rng.uniform(0.91, 0.995), 3) if doc_status != "Missing" else None,
                "synthetic": True,
            })
        for issue_index, issue in enumerate(issue_types, 1):
            finding_category = "Document completeness" if "missing" in issue.lower() else "Data validation"
            findings.append({
                "finding_id": f"SYN-FND-{index:05d}-{issue_index:02d}",
                "application_id": application_id, "check_category": finding_category,
                "severity": "Moderate", "description": issue,
                "source_document_id": docs[0]["document_id"],
                "finding_status": "Open", "created_at": submitted.isoformat(), "synthetic": True,
            })
        checks = [
            {"title": "Application completeness", "state": "Needs attention" if issue_types else "Passed", "detail": "; ".join(issue_types) if issue_types else "Required demo application fields and submitted documents are present."},
            {"title": "Product eligibility", "state": "Review required" if band == "Elevated" else "Passed", "detail": "Illustrative product checks only; consult the insurer's approved guide."},
            {"title": "Information consistency", "state": "Needs attention" if any("verification" in issue.lower() or "clarification" in issue.lower() for issue in issue_types) else "Passed", "detail": "Cross-document values are synthetic and must be verified by an employee."},
        ]
        factors = [{"factor": condition, "direction": "review" if condition != "No condition declared" else "neutral", "source": "Synthetic health declaration"}]
        if hospitalised:
            factors.append({"factor": "Prior hospitalisation declared", "direction": "review", "source": "Synthetic health declaration"})
        if issue_types:
            factors.append({"factor": "Open application information issue", "direction": "incomplete", "source": "Synthetic validation check"})
        case = {
            "application_id": application_id, "applicant": name,
            "plan": product_name, "received_at": submitted.isoformat(), "status": status,
            "risk": {"band": band, "score": score, "basis": "Synthetic illustrative rules v1; not a validated or approved underwriting model."},
            "documents": [{"name": item["name"], "state": item["state"], "fields": item["fields"]} for item in docs],
            "checks": checks,
            "evidence": [f"{doc['name']} · synthetic extraction" for doc in docs if doc["state"] != "Missing"],
            "issues": issue_types, "suggested_action": recommendation,
            "review_note": review_note, "decision": decision, "synthetic": True,
        }
        applicants.append({
            "applicant_id": applicant_id, "full_name": name,
            "date_of_birth": born.isoformat(),
            "email": f"synthetic.applicant.{index:05d}@example.invalid",
            "contact_reference": f"SYNTHETIC-CONTACT-{index:05d}",
            "residency_status": rng.choice(["Singapore Citizen", "Singapore Permanent Resident", "Employment Pass holder"]),
            "residence_country": "Singapore", "synthetic": True,
        })
        applications.append({
            "application_id": application_id, "applicant_id": applicant_id,
            "submitted_at": submitted.isoformat(), "coverage_start_date": (submitted.date() + timedelta(days=30)).isoformat(),
            "product_code": product_code, "product_name": product_name,
            "coverage_limit_sgd": coverage, "illustrative_annual_premium_sgd": premium,
            "application_status": status, "submission_channel": rng.choice(CHANNELS),
            "assigned_reviewer": rng.choice(REVIEWERS), "risk_score": score,
            "risk_band": band, "recommendation": recommendation,
            "last_review_note": review_note, "decision_json": json.dumps(decision, ensure_ascii=False) if decision else None,
            "case_json": json.dumps(case, ensure_ascii=False), "synthetic": True,
            "updated_at": now.isoformat(),
        })
        declarations.append({
            "application_id": application_id,
            "declared_conditions": [condition] if condition != "No condition declared" else [],
            "current_medications": MEDICATIONS[condition],
            "prior_hospitalisation": hospitalised,
            "tobacco_use": rng.choice(["No", "No", "Yes", "Prefer not to say"]),
            "declaration_summary": "Synthetic applicant declaration; no real medical record is represented.",
            "synthetic": True,
        })
        assessments.append({
            "assessment_id": f"SYN-ASMT-{index:05d}", "application_id": application_id,
            "model_name": "intentra_synthetic_triage_rules", "model_version": "demo-1.0",
            "assessed_at": submitted.isoformat(), "risk_score": score, "risk_band": band,
            "contributing_factors_json": json.dumps(factors, ensure_ascii=False),
            "recommendation": recommendation,
            "explanation": "Illustrative deterministic triage from synthetic declarations and open information issues. Not trained, validated, or approved for underwriting decisions.",
            "synthetic": True,
        })
        events.append({
            "event_id": f"SYN-EVT-{index:05d}-01", "application_id": application_id,
            "event_type": "Application received", "actor": "Synthetic demo intake",
            "reason": "Synthetic application generated for demonstration.",
            "created_at": submitted.isoformat(),
            "metadata_json": json.dumps({"initial_status": status}), "synthetic": True,
        })
        if status != "New":
            event_type = f"Decision recorded: {status}" if decision else {
                "In review": "Review started", "Needs information": "Information requested", "Referred": "Referred to specialist",
            }.get(status, f"Status changed: {status}")
            events.append({
                "event_id": f"SYN-EVT-{index:05d}-02", "application_id": application_id,
                "event_type": event_type,
                "actor": decision["reviewer"] if decision else "Demo employee",
                "reason": decision["reason"] if decision else "Fictional workflow history for demonstration.",
                "created_at": reviewed_at.isoformat(),
                "metadata_json": json.dumps({"resulting_status": status, "synthetic": True}), "synthetic": True,
            })
    return {
        "applicants": applicants, "applications": applications,
        "medical_declarations": declarations, "supporting_documents": documents,
        "validation_findings": findings, "policy_rules": _rules(),
        "risk_assessments": assessments, "review_events": events,
    }


def _ensure_views(client, dataset_ref):
    view_id = f"{dataset_ref}.application_current_state"
    try:
        client.get_table(view_id)
        return
    except NotFound:
        pass
    tick = chr(96)
    apps = f"{tick}{dataset_ref}.applications{tick}"
    events = f"{tick}{dataset_ref}.review_events{tick}"
    view = bigquery.Table(view_id)
    view.view_query = f"""WITH latest_state AS (
      SELECT application_id, metadata_json, created_at
      FROM {events} WHERE synthetic = TRUE
      QUALIFY ROW_NUMBER() OVER (PARTITION BY application_id ORDER BY created_at DESC, event_id DESC) = 1
    )
    SELECT a.* EXCEPT(application_status, decision_json, last_review_note, case_json),
      COALESCE(JSON_VALUE(e.metadata_json, '$.resulting_status'), a.application_status) AS current_status,
      COALESCE(JSON_QUERY(e.metadata_json, '$.decision'), a.decision_json) AS current_decision_json,
      COALESCE(JSON_VALUE(e.metadata_json, '$.review_note'), a.last_review_note) AS current_review_note,
      e.created_at AS latest_event_at
    FROM {apps} a LEFT JOIN latest_state e USING (application_id)"""
    view.description = "Current synthetic application state derived from immutable intake plus the latest append-only review event."
    client.create_table(view)
    print(f"Created {view_id} view.")


def seed(project_id=PROJECT_ID, dataset_id=DATASET_ID, location=LOCATION, size=120):
    client = bigquery.Client(project=project_id)
    dataset_ref = f"{project_id}.{dataset_id}"
    try:
        dataset = client.get_dataset(dataset_ref)
        if dataset.location.upper() != location.upper():
            raise RuntimeError(f"Dataset exists in {dataset.location}; requested location is {location}. Refusing to move or replace it.")
    except NotFound:
        dataset = bigquery.Dataset(dataset_ref)
        dataset.location = location
        dataset.description = "Fictional health-insurance underwriting demo records. All records and rules are synthetic; not for real underwriting decisions."
        dataset.labels = {"purpose": "demo", "data": "synthetic", "domain": "health-underwriting"}
        client.create_dataset(dataset)
        print(f"Created BigQuery dataset {dataset_ref} ({location}).")

    schemas = _schema()
    for name, fields in schemas.items():
        table_ref = f"{dataset_ref}.{name}"
        try:
            client.get_table(table_ref)
        except NotFound:
            table = bigquery.Table(table_ref, schema=fields)
            table.description = f"Synthetic health-insurance underwriting demo table: {name}. No real applicant data."
            client.create_table(table)
            print(f"Created {table_ref}.")

    _ensure_views(client, dataset_ref)

    counts = {
        name: int(next(iter(client.query(f"SELECT COUNT(*) AS n FROM `{dataset_ref}.{name}`").result())).n)
        for name in schemas
    }
    existing_count = counts["applications"]
    if existing_count:
        print(f"Found {existing_count} application rows; left all existing data unchanged and skipped seeding.")
        return
    partial = {name: count for name, count in counts.items() if count}
    if partial:
        raise RuntimeError(f"Found partial seed data with no applications table rows: {partial}. Nothing was changed; inspect before retrying.")

    payload = _make_data(size=size)
    order = ["applicants", "medical_declarations", "supporting_documents", "validation_findings", "policy_rules", "risk_assessments", "review_events", "applications"]
    for table_name in order:
        rows = payload[table_name]
        if not rows:
            continue
        errors = client.insert_rows_json(f"{dataset_ref}.{table_name}", rows)
        if errors:
            raise RuntimeError(f"BigQuery insert errors for {table_name}: {errors[:3]}")
        print(f"Loaded {len(rows)} synthetic rows into {dataset_ref}.{table_name}.")
    print(f"Seeded {len(payload['applications'])} synthetic applications in {dataset_ref}.")


def repair_review_history(project_id=PROJECT_ID, dataset_id=DATASET_ID, location=LOCATION):
    """Backfill synthetic reviewer events and prevent outcomes on open findings."""
    client = bigquery.Client(project=project_id)
    base = f"{project_id}.{dataset_id}"
    tick = chr(96)
    apps = list(client.query(
        f"SELECT application_id, submitted_at, application_status, assigned_reviewer, recommendation, decision_json, case_json "
        f"FROM {tick}{base}.applications{tick} WHERE synthetic = TRUE", location=location
    ).result())
    open_findings = {}
    for row in client.query(
        f"SELECT application_id, ARRAY_AGG(description) AS issues FROM {tick}{base}.validation_findings{tick} "
        "WHERE synthetic = TRUE AND finding_status = 'Open' GROUP BY application_id", location=location
    ).result():
        open_findings[row.application_id] = list(row.issues or [])
    existing_events = set()
    for row in client.query(
        f"SELECT application_id, event_type FROM {tick}{base}.review_events{tick} WHERE synthetic = TRUE", location=location
    ).result():
        existing_events.add((row.application_id, row.event_type))
    applications_with_history = {app_id for app_id, event_type in existing_events if event_type != "Application received"}

    events = []
    now = datetime.now(timezone.utc)
    for row in apps:
        status = row.application_status
        reviewed_at = min(now, row.submitted_at + timedelta(hours=18))
        issues = open_findings.get(row.application_id, [])
        recommendation = row.recommendation
        decision = json.loads(row.decision_json) if row.decision_json else None
        note = ""
        if status in {"Approved", "Declined"} and issues:
            status = "Needs information" if any("missing" in issue.lower() for issue in issues) else "Referred"
            recommendation = "Request missing supporting information" if status == "Needs information" else "Refer to medical underwriter"
            decision, note = None, ""
        if status in {"Approved", "Declined"} and decision is None:
            action = "Approve" if status == "Approved" else "Decline"
            note = "Fictional historical employee outcome for demonstrating the review workflow."
            decision = {"action": action, "reviewer": row.assigned_reviewer, "recorded_at": reviewed_at.isoformat(), "reason": note}
        event_type = f"Decision recorded: {status}" if decision else {
            "In review": "Review started", "Needs information": "Information requested",
            "Referred": "Referred to specialist",
        }.get(status)
        if event_type and row.application_id not in applications_with_history:
            events.append({
                "event_id": f"SYN-REVIEW-{row.application_id}", "application_id": row.application_id,
                "event_type": event_type,
                "actor": decision["reviewer"] if decision else row.assigned_reviewer,
                "reason": note or "Fictional workflow history for demonstration.",
                "created_at": reviewed_at.isoformat(),
                "metadata_json": json.dumps({
                    "resulting_status": status, "decision": decision,
                    "review_note": note, "recommendation": recommendation,
                    "synthetic": True,
                }, ensure_ascii=False),
                "synthetic": True,
            })

    if events:
        errors = client.insert_rows_json(f"{base}.review_events", events)
        if errors:
            raise RuntimeError(f"Review history insert errors: {errors[:3]}")
    print(f"Added {len(events)} synthetic review-state events without modifying application intake rows.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default=PROJECT_ID)
    parser.add_argument("--dataset", default=DATASET_ID)
    parser.add_argument("--location", default=LOCATION)
    parser.add_argument("--applications", type=int, default=120)
    parser.add_argument("--repair-review-history", action="store_true", help="Backfill fictional employee review events in an existing synthetic dataset.")
    args = parser.parse_args()
    if not 1 <= args.applications <= 1000:
        parser.error("--applications must be between 1 and 1000")
    if args.repair_review_history:
        repair_review_history(args.project, args.dataset, args.location)
    else:
        seed(args.project, args.dataset, args.location, args.applications)


if __name__ == "__main__":
    main()
