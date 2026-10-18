"""Source-configured health rating and employee-reviewed prototype triage."""
import hashlib
import json
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


def product_configuration(case):
    from backend.repositories.policy_library import read_policy_source
    primary = case.get("selected_policy_id")
    policy = next((p for p in (case.get("policy_selection") or {}).get("policies", [])
                   if p.get("policy_id") == primary and p.get("policy_kind") == "company"), None)
    if not policy or case.get("insurance_type", "health") != "health":
        return None
    source = read_policy_source(primary)
    if not source:
        return None
    try:
        document = json.loads(source[1].decode("utf-8-sig"))
        config = document.get("premium_calculation_config", {})
    except (ValueError, UnicodeError, AttributeError):
        return None
    if config.get("insurance_type") != "health" or config.get("product_id") != case.get("product_code"):
        return None
    return {"config": config, "policy_name": policy.get("policy_name"),
            "policy_id": primary, "policy_status": policy.get("status"),
            "source_filename": policy.get("source_filename"),
            "source_sha256": hashlib.sha256(source[1]).hexdigest()}


def _positive(value):
    number = Decimal(str(value))
    if not number.is_finite() or number <= 0:
        raise ValueError("Rating factors and amounts must be finite positive numbers.")
    return number


def calculate_health_premium(config, birth_date, inputs, as_of=None):
    result = {"premium": None, "currency": "INR", "insurance_type": "health",
              "status": "pending_information", "findings": []}
    try:
        if config.get("currency") != "INR" or config.get("calculation_method") != {"name": "annual_health_premium", "rounding": "HALF_UP", "decimal_places": 2}:
            raise ValueError("Unsupported health pricing method or currency.")
        if inputs.get("confirmed") is not True or not inputs.get("review_note", "").strip() or not (inputs.get("evidence_document_ids") or inputs.get("data_source")):
            raise ValueError("An employee must review the rating inputs and record the supporting documents or data source first.")
        day = as_of or date.today()
        dob = date.fromisoformat(birth_date)
        age = day.year - dob.year - ((day.month, day.day) < (dob.month, dob.day))
        eligibility = config["eligibility"]
        if not int(eligibility["min_entry_age"]) <= age <= int(eligibility["max_entry_age"]) or int(eligibility["policy_term_years"]) != 1:
            raise ValueError("Age or policy term is outside the selected health product rules.")
        cover = _positive(inputs.get("sum_insured_inr"))
        tables = config["rate_tables"]
        rows = [r for r in tables["annual_base_premiums"] if int(r["min_age"]) <= age <= int(r["max_age"]) and _positive(r["sum_insured_inr"]) == cover]
        if len(rows) != 1:
            raise ValueError("The health rate table must select exactly one age-and-cover rate.")
        base = _positive(rows[0]["premium"])
        zone = _positive(tables["zone_multipliers"][inputs["zone"]])
        medical = _positive(tables["medical_multipliers"][inputs["medical_class"]])
        tobacco = _positive(tables["tobacco_multipliers"][inputs["tobacco_status"]])
        annual = (base * zone * medical * tobacco).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        result.update(status="illustrative_only", premium=float(annual), age=age,
                      age_band=f"{rows[0]['min_age']}-{rows[0]['max_age']}", sum_assured=float(cover),
                      annual_base_premium=float(base), zone=inputs["zone"], zone_multiplier=float(zone),
                      medical_class=inputs["medical_class"], medical_multiplier=float(medical),
                      tobacco_status=inputs["tobacco_status"], tobacco_multiplier=float(tobacco),
                      term_years=1, payment_frequency="ANNUAL", annual_premium_before_tax=float(annual),
                      installment_before_tax=float(annual), tax=None, total_payable=None,
                      rating_date=day.isoformat(), calculation_version=config.get("version"),
                      formula=f"{base} × {zone} × {medical} × {tobacco} = {annual}",
                      quote_status="INDICATIVE_BEFORE_TAX", findings=[
                          "Calculated from the selected health product rate table and employee-reviewed inputs.",
                          "This is an annual indication before tax, not an issued quote. Verification requirements and the employee decision remain separate."])
    except (KeyError, ValueError, TypeError, InvalidOperation, OverflowError) as exc:
        result["findings"] = [f"Health pricing needs review: {exc}"]
    return result


def triage_health_case(case, product):
    inputs = case.get("health_rating_inputs") or {}
    config = product["config"]
    declaration = case.get("medical_declaration") or {}
    conditions = [str(c).strip() for c in declaration.get("declared_conditions", [])]
    allowed = {str(c).casefold() for c in config.get("triage", {}).get("permitted_conditions", [])}
    unknown = [c for c in conditions if c.casefold() not in allowed]
    pricing = calculate_health_premium(config, case.get("date_of_birth"), inputs)
    issues = []
    if unknown:
        issues.append("Conditions outside the selected product's configured triage: " + ", ".join(unknown))
    if conditions and inputs.get("medical_class") == "STANDARD":
        issues.append("A declared condition cannot use the no-declared-condition STANDARD class in this product.")
    if inputs.get("medical_class") == "SPECIALIST_REVIEW":
        issues.append("The employee selected specialist medical review; automatic pricing is unavailable.")
    if pricing.get("premium") is None:
        issues.extend(pricing["findings"])
    ready = not issues
    return {"score": None, "band": "Controlled-condition review" if ready and conditions else "Standard review" if ready else "Specialist / input review",
            "assessment_type": "policy_based_triage", "status": "triage_completed" if ready else "review_required",
            "basis": f"Selected product {config.get('product_id')} · {config.get('version')}; employee classification with source references. No predictive medical score.",
            "medical_class": inputs.get("medical_class"), "employee_review": inputs,
            "findings": issues, "product_policy_id": product["policy_id"]}
