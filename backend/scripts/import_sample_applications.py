"""Import explicitly fictional application packets into the prototype inbox.

Run after creating the schema:
  python -m backend.scripts.import_sample_applications --document-bucket BUCKET

The importer is idempotent and never overwrites existing cases. Sample rows
retain synthetic=True and record_origin=sample_application. Documents remain
unprocessed until the employee reaches the document step in the pipeline.
"""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from google.cloud import storage

from backend.repositories.health_underwriting import DATASET_ID, PROJECT_ID, _client, _table, get_case


def import_samples(manifest_path, bucket_name):
    if not bucket_name:
        raise ValueError("Provide --document-bucket or configure UNDERWRITING_DOCUMENT_BUCKET.")
    manifest = Path(manifest_path).resolve()
    packets = json.loads(manifest.read_text(encoding="utf-8"))
    bucket = storage.Client(project=PROJECT_ID).bucket(bucket_name)
    imported = []
    for packet in packets:
        application_id = packet["application_id"]
        if get_case(application_id):
            print(f"Already present: {application_id}")
            continue
        now = datetime.now(timezone.utc).isoformat()
        # Validate the entire packet before uploading or inserting any rows.
        for source in packet.get("documents", []):
            if source.get("file"):
                path = (manifest.parent / source["file"]).resolve()
                if not path.is_file() or path.suffix.lower() != ".pdf":
                    raise ValueError(f"Missing or unsupported application document: {path.name}")
        documents = []
        for index, source in enumerate(packet.get("documents", [])):
            object_uri = ""
            if source.get("file"):
                source_path = (manifest.parent / source["file"]).resolve()
                object_name = f"applications/{application_id}/received/{source_path.name}"
                bucket.blob(object_name).upload_from_filename(str(source_path), content_type="application/pdf")
                object_uri = f"gs://{bucket_name}/{object_name}"
            documents.append({"document_id": f"DOC-{application_id}-{index + 1}",
                              "name": source.get("name") or (source_path.name if object_uri else "Required document"),
                              "document_type": source.get("document_type"),
                              "state": "Received" if object_uri else "Missing", "mime_type": "application/pdf",
                              "object_uri": object_uri, "fields": [], "page_count": None, "processor": None,
                              "source_sha256": hashlib.sha256(source_path.read_bytes()).hexdigest() if object_uri else None})
        case = {"application_id": application_id, "applicant": packet["applicant"],
                "date_of_birth": packet["date_of_birth"], "received_at": now,
                "status": "Ready for underwriting", "insurance_type": "health",
                "product_code": packet.get("product_code", ""), "plan": packet["product_name"],
                "submission_channel": "Sample application feed", "record_origin": "sample_application",
                "application_details": packet.get("application_details", {}),
                "documents": documents, "issues": packet.get("issues", []), "checks": packet.get("checks", []),
                "medical_declaration": packet.get("medical_declaration", {}),
                "intake_source": packet.get("intake_source", {}),
                "risk": {"score": None, "band": "Not assessed", "basis": "Underwriting has not started."},
                "evidence": [doc["name"] for doc in documents if doc["object_uri"]],
                "policy_selection": None, "selected_policy_id": None,
                "suggested_action": "Review application and select applicable policies",
                "workflow": {"version": 4, "steps": {}, "current_step": "application_details"}}
        applicant_id = f"AP-{application_id}"
        applicant = {"applicant_id": applicant_id, "full_name": packet["applicant"],
                     "date_of_birth": packet["date_of_birth"], "email": packet.get("email"), "synthetic": True}
        application = {"application_id": application_id, "applicant_id": applicant_id,
                       "submitted_at": now, "insurance_type": "health", "product_code": packet.get("product_code") or None,
                       "product_name": packet["product_name"], "application_status": case["status"],
                       "submission_channel": case["submission_channel"], "risk_band": "Not assessed",
                       "case_json": json.dumps(case, ensure_ascii=False), "synthetic": True, "updated_at": now}
        doc_rows = [{"document_id": doc["document_id"], "application_id": application_id,
                     "document_type": doc["name"], "received_at": now, "document_status": doc["state"],
                     "object_uri": doc["object_uri"] or None, "extracted_fields_json": "[]", "synthetic": True}
                    for doc in documents]
        rows_to_save = [("applicants", [applicant]), ("supporting_documents", doc_rows)]
        if packet.get("medical_declaration"):
            declaration = {key: packet["medical_declaration"].get(key) for key in (
                "declared_conditions", "current_medications", "prior_hospitalisation", "tobacco_use", "declaration_summary")}
            rows_to_save.append(("medical_declarations", [{"application_id": application_id, **declaration, "synthetic": True}]))
        rows_to_save.append(("applications", [application]))
        for table, rows in rows_to_save:
            errors = _client().insert_rows_json(_table(table), rows, row_ids=[row.get("application_id", row.get("applicant_id")) if table != "supporting_documents" else row["document_id"] for row in rows])
            if errors:
                raise RuntimeError(f"Could not insert sample {application_id} into {table}: {errors[:2]}")
        imported.append(application_id)
        print(f"Imported {application_id}: {packet['applicant']} - {case['status']}")
    print(f"Inbox: {PROJECT_ID}.{DATASET_ID}; imported {len(imported)} applications.")
    return imported


def main():
    import os
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default="samples/underwriting/applications.json")
    parser.add_argument("--document-bucket", default=os.getenv("UNDERWRITING_DOCUMENT_BUCKET", ""))
    parser.add_argument("--include-health-policy", action="store_true", help="Also add the clearly marked fictional health product policy, if absent.")
    args = parser.parse_args()
    import_samples(args.manifest, args.document_bucket)
    if args.include_health_policy:
        from backend.repositories.policy_library import add_policy, list_policies
        path = Path(args.manifest).parent / "health_product_policy.json"
        source = json.loads(path.read_text(encoding="utf-8"))
        if not any(item.get("product_code") == source["product_code"] for item in list_policies("health", "company")):
            rules = [{**rule, "source_quote": rule["rule_text"]} for rule in source["rules"]]
            policy = add_policy(policy_name=source["policy_name"], insurance_type="health", policy_kind="company",
                                filename=path.name, mime_type="application/json", content=path.read_bytes(),
                                insurer_name=source["company"], product_name=source["product"], product_code=source["product_code"],
                                version=source["version"], extracted_rules_override={"summary": source["purpose"], "rules": rules},
                                extraction_model_override="Structured source rules")
            print(f"Added fictional health policy: {policy['policy_id']}")


if __name__ == "__main__":
    main()
