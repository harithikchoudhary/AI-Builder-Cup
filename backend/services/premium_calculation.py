"""Deterministic premium calculation for explicitly illustrative product configs."""

from datetime import date
from decimal import Decimal, ROUND_HALF_UP


def _age_on(birth_date, as_of):
    years = as_of.year - birth_date.year
    if (as_of.month, as_of.day) < (birth_date.month, birth_date.day):
        years -= 1
    return years


def _round_money(value, places=2):
    quantum = Decimal("1").scaleb(-places)
    return Decimal(value).quantize(quantum, rounding=ROUND_HALF_UP)


def calculate_premium(config, date_of_birth, inputs, as_of=None):
    """Calculate only when all configured illustrative rating factors are known."""
    as_of = as_of or date.today()
    method = config.get("calculation_method", {})
    supported_formula = "round_half_up((sum_assured_inr / 1000) * base_rate_per_1000 * term_multiplier * tobacco_multiplier * medical_multiplier * occupation_multiplier, 2)"
    if method.get("name") != "annual_term_premium" or method.get("formula") != supported_formula or method.get("rounding") != "HALF_UP" or int(method.get("decimal_places", 2)) != 2:
        return {"status": "configuration_error", "premium": None, "currency": config.get("currency", "INR"),
                "findings": ["This premium formula is not supported by the deterministic calculator; no premium was calculated."]}
    birth_date = date.fromisoformat(date_of_birth)
    age = _age_on(birth_date, as_of)
    findings = []
    try:
        sum_assured = Decimal(str(inputs["sum_assured_inr"]))
        term_years = int(inputs["term_years"])
    except (KeyError, TypeError, ValueError, ArithmeticError):
        return {"status": "pending_information", "premium": None, "currency": config.get("currency", "INR"),
                "findings": ["Enter a valid sum assured and policy term before calculating."]}

    eligibility = config.get("eligibility", {})
    if age < int(eligibility.get("min_entry_age", 0)) or age > int(eligibility.get("max_entry_age", 200)):
        return {"status": "manual_review", "premium": None, "currency": config.get("currency", "INR"), "age": age,
                "findings": ["Applicant age is outside this sample product's configured entry range; refer for human review."]}
    if age + term_years > int(eligibility.get("max_maturity_age", 200)):
        return {"status": "manual_review", "premium": None, "currency": config.get("currency", "INR"), "age": age,
                "findings": ["Policy term exceeds this sample product's maturity-age limit; refer for human review."]}
    if sum_assured < int(eligibility.get("min_sum_assured_inr", 0)) or term_years < 1 or term_years > int(eligibility.get("max_policy_term_years", 100)):
        return {"status": "manual_review", "premium": None, "currency": config.get("currency", "INR"), "age": age,
                "findings": ["Sum assured or policy term is outside the configured sample limits; refer for human review."]}
    if sum_assured > int(eligibility.get("max_standard_sum_assured_inr", sum_assured)):
        return {"status": "manual_review", "premium": None, "currency": config.get("currency", "INR"), "age": age,
                "findings": ["Sum assured exceeds the sample standard limit and requires senior review; no premium was calculated."]}

    tables = config.get("rate_tables", {})
    age_rows = [row for row in tables.get("base_rate_per_1000_sum_assured_per_year", [])
                if int(row["min_age"]) <= age <= int(row["max_age"])]
    term_rows = [row for row in tables.get("term_multipliers", [])
                 if int(row["min_years"]) <= term_years <= int(row["max_years"])]
    if len(age_rows) != 1 or len(term_rows) != 1:
        return {"status": "configuration_error", "premium": None, "currency": config.get("currency", "INR"), "age": age,
                "findings": ["The sample rate configuration does not select exactly one age band and one term band."]}

    tobacco = str(inputs.get("tobacco_status", "UNKNOWN")).upper()
    medical = str(inputs.get("medical_class", "PENDING")).upper()
    occupation = str(inputs.get("occupation_class", "SPECIALIST_REVIEW")).upper()
    frequency = str(inputs.get("payment_frequency", "ANNUAL")).upper()
    multiplier_tables = (tables.get("tobacco_multipliers", {}), tables.get("medical_multipliers", {}), tables.get("occupation_multipliers", {}))
    keys = (tobacco, medical, occupation)
    multipliers = [table.get(key) for table, key in zip(multiplier_tables, keys)]
    if any(value is None for value in multipliers):
        return {"status": "manual_review", "premium": None, "currency": config.get("currency", "INR"), "age": age,
                "findings": ["A tobacco, medical, or occupation rating factor is unknown or requires specialist review; no premium was calculated."]}
    frequency_config = config.get("payment_frequency", {}).get(frequency)
    if not frequency_config:
        return {"status": "pending_information", "premium": None, "currency": config.get("currency", "INR"), "age": age,
                "findings": ["Select a supported payment frequency."]}

    rate = Decimal(str(age_rows[0]["rate"]))
    term_multiplier = Decimal(str(term_rows[0]["multiplier"]))
    tobacco_multiplier, medical_multiplier, occupation_multiplier = [Decimal(str(value)) for value in multipliers]
    annual = _round_money((sum_assured / Decimal(1000)) * rate * term_multiplier * tobacco_multiplier * medical_multiplier * occupation_multiplier)
    installments = int(frequency_config["installments_per_year"])
    frequency_factor = Decimal(str(frequency_config["factor"]))
    installment = _round_money(annual * frequency_factor / installments)
    tax_config = config.get("tax_configuration", {})
    findings.extend([
        "This is an illustrative calculation using the selected sample product rate table.",
        "Tax is not included because the policy configuration requires current tax treatment to be verified.",
        "This result is not an approved quote; an authorized underwriter must verify the inputs and applicable pricing.",
    ])
    return {
        "status": "illustrative_only", "premium": float(annual), "currency": config.get("currency", "INR"),
        "age": age, "sum_assured": float(sum_assured), "term_years": term_years,
        "base_rate_per_1000": float(rate), "age_band": f"{age_rows[0]['min_age']}-{age_rows[0]['max_age']}",
        "term_multiplier": float(term_multiplier), "tobacco_status": tobacco,
        "tobacco_multiplier": float(tobacco_multiplier), "medical_class": medical,
        "medical_multiplier": float(medical_multiplier), "occupation_class": occupation,
        "occupation_multiplier": float(occupation_multiplier), "payment_frequency": frequency,
        "frequency_factor": float(frequency_factor), "installments_per_year": installments,
        "annual_premium_before_tax": float(annual), "installment_before_tax": float(installment),
        "tax_rate": tax_config.get("rate"), "tax": None, "total_payable": None,
        "quote_status": "ILLUSTRATIVE_TAX_PENDING", "findings": findings,
    }
