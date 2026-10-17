"""Attach the generated follow-up fixture records and prepare the case for review.

Requires --regenerate-existing before archiving a started review. Never records
employee verification, medical classifications, rule dispositions or a decision.
"""
import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from google.cloud import storage
from . import health_underwriting as repository
from .policy_library import list_policies
from .underwriting_runs import regenerate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regenerate-existing", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / "output/pdf/pooja_followups"
    manifest = json.loads((root / "provenance.json").read_text(encoding="utf-8"))
    application_id = manifest["application_id"]
    case = repository.get_case(application_id)
    if not case or case.get("record_origin") != "sample_application":
        raise ValueError("This preparation command is limited to the supplied fictional application.")
    wf = case.get("workflow", {})
    if wf.get("pipeline_status") == "running":
        raise ValueError("The pipeline is processing. Wait for an employee checkpoint first.")
    if wf.get("started_at"):
        if not args.regenerate_existing:
            raise ValueError("Use --regenerate-existing to preserve and archive the current run before preparation.")
        case = regenerate(application_id, "Prepare the health product rate grid and follow-up evidence for a fresh review; preserve the previous run.", wf.get("run_id") or wf["started_at"])
    policies = list_policies("health")
    configured_version = json.loads((Path(__file__).resolve().parents[1] / "samples/underwriting/securelife_health_shield_plus.json").read_text(encoding="utf-8"))["version"]
    primary = next((p for p in policies if p.get("product_code") == case.get("product_code") and p.get("version") == configured_version and p.get("source_filename") == "securelife_health_shield_plus.json"), None)
    regulatory = next((p for p in policies if p.get("policy_kind") == "regulatory" and p.get("source_filename") == "irdai-health-master-circular-2024.pdf"), None)
    if not primary or not regulatory:
        raise ValueError("Register the health product configuration and regulatory source first.")
    case = repository.save_case_policies(application_id, [primary["policy_id"], regulatory["policy_id"]], primary["policy_id"])
    import os
    bucket_name = os.environ["UNDERWRITING_DOCUMENT_BUCKET"]
    bucket = storage.Client(project=repository.PROJECT_ID).bucket(bucket_name)
    for item in manifest["documents"]:
        path = root / item["name"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("A follow-up PDF differs from its provenance manifest.")
    existing = {d["name"] for d in case.get("documents", [])}
    now = datetime.now(timezone.utc).isoformat()
    def upload(item):
        name = item["name"]
        key = f"applications/{application_id}/followups/{item['sha256'][:12]}-{name}"
        blob = bucket.blob(key)
        if not blob.exists():
            blob.upload_from_filename(str(root / name), content_type="application/pdf", if_generation_match=0)
        return {"document_id": f"DOC-{application_id}-FOLLOWUP-{name[:2]}", "name": name,
                "document_type": "Case follow-up record", "state": "Received", "mime_type": "application/pdf",
                "object_uri": f"gs://{bucket_name}/{key}", "fields": [], "processor": None, "page_count": None,
                "source_sha256": item["sha256"], "generated_fixture": True,
                "independent_authentication_performed": False}
    with ThreadPoolExecutor(max_workers=4) as pool:
        documents = list(pool.map(upload, [d for d in manifest["documents"] if d["name"] not in existing]))
    if documents:
        rows = [{"document_id": d["document_id"], "application_id": application_id,
                 "document_type": d["name"], "received_at": now, "document_status": "Received",
                 "object_uri": d["object_uri"], "extracted_fields_json": "[]", "synthetic": True} for d in documents]
        errors = repository._client().insert_rows_json(repository._table("supporting_documents"), rows, row_ids=[r["document_id"] for r in rows])
        if errors:
            raise RuntimeError(f"Could not save the follow-up document references: {errors[:2]}")
        case["documents"] = case.get("documents", []) + documents
    provenance_name = f"applications/{application_id}/followups/provenance-{hashlib.sha256((root / 'provenance.json').read_bytes()).hexdigest()[:12]}.json"
    blob = bucket.blob(provenance_name)
    if not blob.exists():
        blob.upload_from_filename(str(root / "provenance.json"), content_type="application/json", if_generation_match=0)
    case["followup_provenance"] = {"object_uri": f"gs://{bucket_name}/{provenance_name}", "generated_fixture": True,
                                   "independent_authentication_performed": False}
    case["followup_evidence"] = {
        "0": {"reference": "IAV-20261018-0147", "filename": "15_identity_address_review.pdf"},
        "1": {"reference": "ADDR-20261018-0147", "filename": "15_identity_address_review.pdf"},
        "2": {"reference": "MEDCONF-20261018-0147", "filename": "17_medical_record_confirmation.pdf"},
        "3": {"reference": "CONT-20261018-0147", "filename": "18_prior_cover_confirmation.pdf"},
        "4": {"reference": "CONSENT-20261018-0147", "filename": "19_processing_consent_record.pdf"},
        "5": {"reference": "CONTACT-20261018-0147", "filename": "16_contact_confirmation.pdf"}}
    repository._save_case_event(case, "Follow-up case evidence attached", "Original documents preserved; follow-up records await employee review.")
    print(f"Prepared {application_id}: {len(case['documents'])} source documents; run {case['workflow'].get('run_number', 1)} ready.")
    print("Primary health product:", primary["policy_id"])
    print("Regulatory source:", regulatory["policy_id"])
    print("Employee verification, rating classification and rule dispositions remain unrecorded.")


if __name__ == "__main__":
    main()
