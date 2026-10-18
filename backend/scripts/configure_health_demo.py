"""Register the fictional health product; prepare an unstarted sample case only."""
import argparse
import json
from pathlib import Path
from backend.repositories.policy_library import add_policy, list_policies
from backend.repositories.health_underwriting import get_case, save_case_policies


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application-id", default="SLH-HI-2026-0147")
    args = parser.parse_args()
    path = Path(__file__).resolve().parents[2] / "samples/underwriting/securelife_health_shield_plus.json"
    source = json.loads(path.read_text(encoding="utf-8"))
    policies = list_policies("health")
    policy = next((p for p in policies if p.get("product_code") == source["product_code"] and p.get("version") == source["version"] and p.get("source_filename") == path.name), None)
    if not policy:
        policy = add_policy(policy_name="SecureLife Health Shield Plus · Product, medical triage & pricing",
                            insurance_type="health", policy_kind="company", filename=path.name,
                            mime_type="application/json", content=path.read_bytes(),
                            insurer_name=source["company"], product_name=source["product"],
                            product_code=source["product_code"], version=source["version"],
                            extracted_rules_override={"summary": source["purpose"], "rules": source["rules"]},
                            extraction_model_override="Versioned structured prototype product configuration")
    print("Health product:", policy["policy_id"], policy["policy_name"])
    case = get_case(args.application_id)
    if not case:
        print("Application not found; product was registered without changing a case.")
        return
    if case.get("record_origin") != "sample_application":
        raise ValueError("This setup command only configures sample applications.")
    if case.get("workflow", {}).get("started_at") or case.get("status") in {"Approved", "Declined"}:
        print("Existing review preserved. Regenerate underwriting, then select the new health product as primary.")
        return
    regulatory = [p["policy_id"] for p in policies if p.get("policy_kind") == "regulatory" and p.get("source_filename") == "irdai-health-master-circular-2024.pdf"]
    if not regulatory:
        print("Select the regulatory sources manually; no matching source is registered.")
        return
    save_case_policies(args.application_id, [policy["policy_id"], regulatory[0]], policy["policy_id"])
    print("Prepared application with the health product as primary and the dated IRDAI source.")
    print("No source documents, verification results or employee decisions were changed.")


if __name__ == "__main__":
    main()
