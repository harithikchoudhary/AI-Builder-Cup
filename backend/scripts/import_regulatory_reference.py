"""Store the original IRDAI health circular and attach it to fictional cases.

The local PDF must be the original file downloaded from the recorded official
source URL. Original bytes are preserved in GCS; the outline is a source-linked
review aid and does not determine compliance or claim to include later changes.
"""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader

from backend.repositories.health_underwriting import get_case, save_case_policies
from backend.repositories.policy_library import add_policy, list_policies


REFERENCE = "IRDAI/HLT/CIR/PRO/84/5/2024"
ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "samples" / "underwriting" / "irdai-health-master-circular-2024.pdf"
SOURCE_URL = ROOT / "samples" / "underwriting" / "irdai-source-url.txt"


def build_outline(path, source_url):
    reader = PdfReader(path)
    pages = [" ".join((page.extract_text() or "").split()) for page in reader.pages]
    if len(pages) != 30 or REFERENCE not in pages[1] or "29.05.2024" not in pages[1]:
        raise ValueError("PDF metadata does not match the expected original IRDAI circular.")

    def excerpt(page, start, end):
        text = pages[page - 1]
        begin = text.index(start)
        finish = text.index(end, begin) if end else len(text)
        quote = text[begin:finish].strip()
        if not quote or quote not in text:
            raise ValueError("Source quotation could not be verified.")
        return quote

    entries = [
        (25, "Board-approved underwriting policy", "Review the insurer's board-approved underwriting policy and its approach to ages, medical conditions and treatment choices.",
         "Chapter II, A.I(1); insurer underwriting-policy review.", "(1) Have in place board approved underwriting policy", "(2) Have in place"),
        (19, "Product range and applicability", "Review the range of products and benefits available for relevant applicant needs. The circular's product-range provision does not mean that one product must cover every listed category.",
         "Chapter I, 1(a); product-range and applicability review.", "1) a. Insurers are required", None),
        (20, "Customer Information Sheet", "Check that the Customer Information Sheet is provided with the policy in the prescribed format and that relevant coverage and exclusion information is available for review.",
         "Chapter I, 4; policy issue and disclosure review.", "4) Customer Information Sheet (CIS):", "a) be provided"),
        (25, "Proposal forms and acknowledgement", "Review proposal clarity, transparent product information, provision of the Customer Information Sheet and the policyholder acknowledgement.",
         "Chapter II, A.I(3); proposal and disclosure evidence.", "(3) Proposal Forms/ Customer Information Sheet (CIS)", "(4) Claims Handling"),
        (28, "Product approval and UIN", "Verify the relevant Product Management Committee approval and product identification records for the proposed product or modification.",
         "Chapter II, D.I(1)-(2); product filing and identification review.", "1. Any new product or Rider", "3. Insurers shall maintain"),
        (30, "Consent to share medical records", "When sharing medical records or related information, check that express policyholder consent exists for that instance of sharing.",
         "Chapter III, II(3); medical-record sharing, when applicable.", "3. Further, express consent", "III. Submission of Returns:"),
    ]
    rules = [{"topic": topic, "rule_text": text,
              "applies_when": f"PDF page {page}. {applies}",
              "source_quote": excerpt(page, start, end), "source_page": page, "source_url": source_url}
             for page, topic, text, applies, start, end in entries]
    return {"summary": "Official IRDAI Master Circular on Health Insurance Business, dated 29 May 2024. Six source-linked review topics are provided with the original 30-page bilingual PDF. Review applicability, specific effective dates and later amendments before relying on this reference.",
            "rules": rules, "source_url": source_url, "publisher": "Insurance Regulatory and Development Authority of India",
            "document_reference": REFERENCE, "publication_date": "2024-05-29", "page_count": len(pages),
            "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "review_status": "source_reference_requires_applicability_review"}


def main():
    source_url = SOURCE_URL.read_text(encoding="utf-8").strip()
    if not source_url.startswith("https://irdai.gov.in/"):
        raise ValueError("The recorded source URL must be on the official IRDAI domain.")
    outline = build_outline(SOURCE, source_url)
    existing = next((item for item in list_policies("health", "regulatory")
                     if item.get("uin") == REFERENCE and item.get("extracted_rules", {}).get("source_sha256") == outline["source_sha256"]), None)
    if existing:
        regulatory = existing
        print(f"Using existing regulatory reference: {regulatory['policy_id']}")
    else:
        regulatory = add_policy(policy_name="IRDAI Health Insurance Master Circular - 29 May 2024",
                                insurance_type="health", policy_kind="regulatory", filename=SOURCE.name,
                                mime_type="application/pdf", content=SOURCE.read_bytes(), uin=REFERENCE,
                                version="1 (29 May 2024)", extracted_rules_override=outline,
                                extraction_model_override="Source-verified regulatory outline")
        print(f"Added official regulatory PDF: {regulatory['policy_id']}; {outline['page_count']} pages, {len(outline['rules'])} review topics")
    company_policies = list_policies("health", "company")
    for application_id in ("HI-SAMPLE-1001", "HI-SAMPLE-1002"):
        case = get_case(application_id)
        if not case or case.get("workflow", {}).get("started_at"):
            print(f"Skipped unavailable or started case: {application_id}")
            continue
        selected = (case.get("policy_selection") or {}).get("policies", [])
        ids = [item["policy_id"] for item in selected]
        primary = (case.get("policy_selection") or {}).get("primary_policy_id", "")
        if not any(item.get("policy_kind") == "company" for item in selected):
            company = next((item for item in company_policies if item.get("product_code") == case.get("product_code")), None)
            if not company:
                raise ValueError(f"No matching company policy for {application_id}.")
            ids.append(company["policy_id"])
            primary = company["policy_id"]
        if regulatory["policy_id"] not in ids:
            ids.append(regulatory["policy_id"])
            save_case_policies(application_id, ids, primary)
        print(f"Attached regulatory source to {application_id}; pipeline not started.")
    (ROOT / "samples" / "underwriting" / "irdai-reference-metadata.json").write_text(
        json.dumps({"policy_id": regulatory["policy_id"], **outline}, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
