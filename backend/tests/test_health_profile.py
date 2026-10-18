"""Data-feed profile, workflow migration and step summaries; no storage or model calls."""
import unittest

from backend.repositories import health_profile as hp
from backend.repositories.health_underwriting import migrate_workflow
from backend.services.pipeline_service import summarize_step


def profile(**override):
    base = {**{key: True for key in hp.VERIFICATION_FLAGS}, **{key: False for key in hp.HEALTH_FLAGS},
            "bmi": 25.5, "data_source": "Synthetic applicant data feed"}
    return {**base, **override}


class ProfileTests(unittest.TestCase):
    def test_only_confirmed_flags_pass(self):
        checks = hp.profile_checks(profile(consent_recorded=False, phone_verified=None))
        states = {check["title"]: check["state"] for check in checks}
        self.assertEqual(states["Consent recorded"], "Review required")
        self.assertEqual(states["Phone number verified"], "Review required")
        self.assertEqual(states["Identity verified"], "Passed")

    def test_declaration_maps_flags_to_product_condition_names(self):
        declaration = hp.profile_declaration(profile(thyroid_disorder=True, diabetes=True, tobacco_user=True))
        self.assertEqual(declaration["declared_conditions"], ["Type 2 diabetes", "Hypothyroidism"])
        self.assertEqual(declaration["tobacco_use"], "Yes")

    def test_apply_profile_keeps_existing_medications(self):
        case = {"medical_declaration": {"current_medications": ["Levothyroxine"]}}
        hp.apply_profile(case, profile(thyroid_disorder=True))
        self.assertEqual(case["medical_declaration"]["current_medications"], ["Levothyroxine"])
        self.assertEqual(case["medical_declaration"]["declared_conditions"], ["Hypothyroidism"])
        self.assertEqual(len(case["checks"]), len(hp.VERIFICATION_FLAGS))

    def test_facts_label_every_flag_and_bmi(self):
        facts = hp.profile_facts(profile(hospitalised_5y=True))
        self.assertEqual(len(facts), len(hp.VERIFICATION_FLAGS) + len(hp.HEALTH_FLAGS) + 1)
        self.assertEqual(next(f for f in facts if f["key"] == "hospitalised_5y")["value"], "Yes")


class MigrationTests(unittest.TestCase):
    def legacy(self, **steps):
        return {"version": 5, "steps": {name: {"title": name, "outcome": {"issues": [f"{name} issue"]}, "can_continue": True} for name in steps},
                "current_step": "premium", "pending_step": "risk", "pending_result": {"result_id": "R"}, "intervention": {"step": "risk"}}

    def test_complete_legacy_run_collapses_to_four_stages(self):
        old = self.legacy(application_details=1, documents=1, irdai=1, company_policy=1, risk=1, premium=1, recommendation=1)
        old["current_step"] = "complete"
        migrated = migrate_workflow(old)
        self.assertEqual(list(migrated["steps"]), ["intake", "rules", "risk", "decision"])
        self.assertEqual(migrated["current_step"], "complete")
        self.assertEqual(migrated["version"], 6)
        self.assertEqual(migrated["steps"]["decision"]["premium_result"]["title"], "premium")
        self.assertEqual(migrated["steps"]["rules"]["outcome"]["issues"], [])

    def test_partial_stage_is_rerun_and_stale_checkpoint_dropped(self):
        migrated = migrate_workflow(self.legacy(application_details=1, documents=1, irdai=1))
        self.assertEqual(list(migrated["steps"]), ["intake"])
        self.assertEqual(migrated["current_step"], "rules")
        self.assertNotIn("pending_result", migrated)
        self.assertNotIn("intervention", migrated)

    def test_risk_checkpoint_is_kept_when_earlier_stages_are_complete(self):
        migrated = migrate_workflow(self.legacy(application_details=1, documents=1, irdai=1, company_policy=1))
        self.assertEqual(migrated["current_step"], "risk")
        self.assertEqual(migrated["pending_result"], {"result_id": "R"})


class SummaryTests(unittest.TestCase):
    def test_intake_lists_unconfirmed_flags_as_issues(self):
        case = {"applicant": "A", "health_profile": profile(consent_recorded=False)}
        hp.apply_profile(case, case["health_profile"])
        outcome = summarize_step("intake", {"application": {"applicant": "A", "date_of_birth": "1990-01-01", "product_name": "P"}}, case)
        self.assertEqual(len(outcome["issues"]), 1)
        self.assertIn("Consent recorded", outcome["issues"][0])
        self.assertEqual(next(f for f in outcome["facts"] if f["label"] == "Verified")["value"], "5 of 6")

    def test_intake_without_profile_is_unavailable(self):
        outcome = summarize_step("intake", {"application": {"applicant": "A", "date_of_birth": "x", "product_name": "P"}}, {"insurance_type": "health"})
        self.assertEqual(outcome["title"], "Applicant data unavailable")
        self.assertTrue(outcome["issues"])

    def test_rules_report_facts_without_issues(self):
        review = {"rules": [{"status": "review_needed"}, {"status": "evidence_found"}], "policy_count": 2,
                  "counts": {"evidence_found": 1, "review_needed": 1, "evidence_missing": 0}, "errors": []}
        outcome = summarize_step("rules", {"evidence_review": review}, {})
        self.assertEqual(outcome["issues"], [])
        self.assertEqual({f["label"]: f["value"] for f in outcome["facts"]}["Reference only"], "1")

    def test_decision_shows_premium_fact(self):
        result = {"recommendation": "Ready", "rationale": "why", "missing_information": [], "premium_result": {"premium": 1234.5, "currency": "INR"}}
        outcome = summarize_step("decision", result, {})
        self.assertEqual(outcome["title"], "Ready")
        self.assertEqual(outcome["facts"][0]["value"], "INR 1,234.50")


if __name__ == "__main__":
    unittest.main()
