"""Import a supplied fictional health application JSON and its original PDFs.

Example:
  python -m backend.scripts.import_application_packet --source-directory PATH

This is intake only: it does not run the pipeline, verify declarations, select
company rules, produce a risk score, or record an employee decision.
"""

import argparse
import hashlib
import json
import os
import re
from datetime import date
from pathlib import Path

from google.cloud import storage
from pypdf import PdfReader

from backend.repositories.health_underwriting import PROJECT_ID, get_case
from backend.scripts.import_sample_applications import import_samples


def normalize_packet(source, root):
    application_id = source["application_id"]
    if not re.fullmatch(r"[A-Za-z0-9-]{1,100}", application_id):
        raise ValueError("Application ID must contain only letters, numbers, and hyphens.")
    applicant = source["applicant"]
    date.fromisoformat(applicant["date_of_birth"])
    if not applicant.get("full_name") or not source.get("product"):
        raise ValueError("Applicant name and product name are required.")
    documents = []
    source_text = {}
    for item in source.get("documents", []):
        filename = item["file"]
        path = (root / filename).resolve()
        if path.parent != root or path.suffix.lower() != ".pdf" or not path.is_file():
            raise ValueError(f"Document must be a PDF inside the supplied packet: {filename}")
        reader = PdfReader(path)
        if not reader.pages or reader.is_encrypted:
            raise ValueError(f"Document is empty or encrypted: {filename}")
        source_text[filename] = " ".join(" ".join(page.extract_text() or "" for page in reader.pages).split()).lower()
        documents.append({"name": filename, "file": str(path), "document_type": item.get("document_type")})
    if not documents:
        raise ValueError("The application packet contains no PDFs.")
    declaration = source.get("health_declaration", {})
    coverage = source.get("coverage", {})
    summary = "; ".join(f"{key.replace('_', ' ')}: {value}" for key, value in declaration.items())
    checks = []
    for phrase, title, detail in (
        ("verification pending independent source confirmation", "Identity verification", "Independent identity confirmation is pending in the supplied record."),
        ("not independently verified", "Income verification", "The supplied declaration has not been independently verified."),
        ("prior insurer confirmation pending", "Previous coverage verification", "Prior insurer confirmation is pending in the supplied declaration."),
    ):
        for filename, text in source_text.items():
            if phrase in text:
                checks.append({"title": title, "state": "Review required", "detail": f"{detail} Source: {filename}."})
    if declaration:
        checks.append({"title": "Medical evidence review", "state": "Review required", "detail": "Compare the applicant declarations with the submitted medical records. No clinical or risk conclusion has been made."})
    if not source.get("product_code"):
        checks.append({"title": "Product identification", "state": "Review required", "detail": "No insurer product code or UIN was supplied. Confirm the matching product policy before underwriting."})
    return {
        "application_id": application_id, "applicant": applicant["full_name"],
        "date_of_birth": applicant["date_of_birth"], "email": applicant.get("email"),
        "product_name": source["product"], "product_code": source.get("product_code", ""),
        "application_details": {"sum_insured_inr": coverage.get("sum_insured_inr"),
                                "declaration_summary": f"Applicant-declared, not independently verified. {summary}",
                                "submitted_application": source},
        "medical_declaration": {
            "declared_conditions": [declaration["diagnosis"]] if declaration.get("diagnosis") else [],
            "current_medications": [declaration["medication"]] if declaration.get("medication") else [],
            "prior_hospitalisation": False if str(declaration.get("hospitalizations_last_5_years", "")).lower() in {"none", "no", "none declared"} else None,
            "tobacco_use": declaration.get("tobacco"),
            "declaration_summary": "Applicant-declared values from the supplied application.json; not OCR extractions or independently verified medical findings.",
        },
        "checks": checks, "documents": documents,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-directory", required=True)
    parser.add_argument("--document-bucket", default=os.getenv("UNDERWRITING_DOCUMENT_BUCKET", ""))
    args = parser.parse_args()
    if not args.document_bucket:
        raise ValueError("Configure UNDERWRITING_DOCUMENT_BUCKET or provide --document-bucket.")
    root = Path(args.source_directory).resolve()
    json_path = root / "application.json"
    source = json.loads(json_path.read_text(encoding="utf-8-sig"))
    packet = normalize_packet(source, root)
    existing = get_case(packet["application_id"])
    if existing:
        print(f"Application already exists: {packet['application_id']}. Nothing was overwritten.")
        return
    # Preserve the original metadata and test-data provenance beside the PDFs.
    bucket = storage.Client(project=PROJECT_ID).bucket(args.document_bucket)
    source_records = []
    for path in (json_path, root / "README.txt"):
        if not path.is_file():
            continue
        content = path.read_bytes()
        object_name = f"applications/{packet['application_id']}/intake/{path.name}"
        bucket.blob(object_name).upload_from_string(content, content_type="application/json" if path.suffix == ".json" else "text/plain")
        source_records.append({"name": path.name, "object_uri": f"gs://{args.document_bucket}/{object_name}",
                               "sha256": hashlib.sha256(content).hexdigest()})
    packet["intake_source"] = {"files": source_records, "classification": "fictional_test_application",
                              "verification_status": "employee_review_required"}
    manifest = Path(__file__).resolve().parents[2] / "tmp" / "imports" / f"{packet['application_id']}.json"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps([packet], ensure_ascii=False, indent=2), encoding="utf-8")
    import_samples(manifest, args.document_bucket)
    print(f"Attached {len(packet['documents'])} original PDFs. Extraction will run in the document step.")
    print("No company policy selected; employee review and product-rule selection are pending.")


if __name__ == "__main__":
    main()
