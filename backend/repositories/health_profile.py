"""Yes/no applicant verification and health answers served from BigQuery instead of document review.

The record is a data-feed snapshot (synthetic in this prototype). Every flag is a
plain yes/no so rules and the risk assistant can cite it exactly.
"""
from google.cloud import bigquery

TABLE_NAME = "applicant_health_profile"

VERIFICATION_FLAGS = {
    "identity_verified": "Identity verified",
    "address_verified": "Address verified",
    "phone_verified": "Phone number verified",
    "consent_recorded": "Consent recorded",
    "medical_provider_verified": "Medical provider verified",
    "prior_policy_confirmed": "Prior policy confirmed",
}
HEALTH_FLAGS = {
    "tobacco_user": "Uses tobacco",
    "alcohol_regular": "Regular alcohol use",
    "diabetes": "Diabetes",
    "hypertension": "Hypertension",
    "heart_disease": "Heart disease",
    "thyroid_disorder": "Thyroid disorder",
    "asthma": "Asthma",
    "cancer_history": "Cancer history",
    "hospitalised_5y": "Hospitalised in the last 5 years",
    "surgery_5y": "Surgery in the last 5 years",
    "family_history_critical": "Family history of critical illness",
}
# Names must match how the selected product lists its permitted conditions.
CONDITION_NAMES = {"diabetes": "Type 2 diabetes", "hypertension": "Hypertension", "heart_disease": "Heart disease",
                   "thyroid_disorder": "Hypothyroidism", "asthma": "Asthma", "cancer_history": "Cancer history"}


def profile_schema():
    return ([bigquery.SchemaField("application_id", "STRING", mode="REQUIRED")]
            + [bigquery.SchemaField(key, "BOOL") for key in {**VERIFICATION_FLAGS, **HEALTH_FLAGS}]
            + [bigquery.SchemaField("bmi", "FLOAT64"), bigquery.SchemaField("data_source", "STRING"),
               bigquery.SchemaField("retrieved_at", "TIMESTAMP"), bigquery.SchemaField("synthetic", "BOOL", mode="REQUIRED")])


def _answer(value):
    return "Not recorded" if value is None else "Yes" if value else "No"


def profile_facts(profile):
    """Ordered labelled answers for display and for citing as evidence."""
    facts = [{"key": key, "label": label, "value": _answer(profile.get(key)), "group": "verification"} for key, label in VERIFICATION_FLAGS.items()]
    facts += [{"key": key, "label": label, "value": _answer(profile.get(key)), "group": "health"} for key, label in HEALTH_FLAGS.items()]
    if profile.get("bmi") is not None:
        facts.append({"key": "bmi", "label": "Body mass index", "value": f"{profile['bmi']:.1f}", "group": "health"})
    return facts


def profile_checks(profile):
    """Verification flags shaped like the case checks; only a confirmed flag counts as passed."""
    return [{"title": label, "state": "Passed" if profile.get(key) is True else "Review required",
             "detail": "Confirmed in the applicant data record." if profile.get(key) is True
             else "Not confirmed in the applicant data record. Request it from the applicant."}
            for key, label in VERIFICATION_FLAGS.items()]


def profile_declaration(profile):
    return {"declared_conditions": [name for key, name in CONDITION_NAMES.items() if profile.get(key)],
            "current_medications": [], "prior_hospitalisation": bool(profile.get("hospitalised_5y")),
            "tobacco_use": _answer(profile.get("tobacco_user")),
            "declaration_summary": f"Yes/no answers from the applicant data record ({profile.get('data_source') or 'data feed'})."}


def apply_profile(case, profile):
    """Make the data-feed record the case's source for verification checks and declared health answers."""
    case["health_profile"] = profile
    case["checks"] = profile_checks(profile)
    declaration = profile_declaration(profile)
    keys = ("declared_conditions", "prior_hospitalisation", "tobacco_use", "declaration_summary")
    case["medical_declaration"] = {**(case.get("medical_declaration") or {}), **{key: declaration[key] for key in keys}}


def load_profile(application_id):
    from backend.repositories import health_underwriting as repository
    rows = repository._query(
        f"SELECT * FROM `{repository._table('applicant_health_profile')}` WHERE application_id = @application_id LIMIT 1",
        [bigquery.ScalarQueryParameter("application_id", "STRING", application_id)])
    if not rows:
        return None
    profile = dict(rows[0].items())
    profile["retrieved_at"] = profile["retrieved_at"].isoformat() if profile.get("retrieved_at") else None
    return profile
