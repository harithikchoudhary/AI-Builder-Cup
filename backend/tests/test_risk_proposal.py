"""Risk proposal validation; no model or storage calls."""
import unittest

from backend.agents.risk_proposal import evidence_items, validate_proposal

CONFIG = {"triage": {"medical_classes": ["STANDARD", "CONTROLLED_CONDITION", "SPECIALIST_REVIEW"], "permitted_conditions": ["Thyroid condition"]},
          "rate_tables": {"tobacco_multipliers": {"NON_TOBACCO": 1.0, "TOBACCO": 1.3}}}


def case(conditions=("Thyroid condition",)):
    return {"documents": [{"name": "lab.pdf", "document_id": "DOC-1", "state": "Processed",
                           "fields": [{"name": "TSH", "value": "6.1", "source_quote": "TSH 6.1 mIU/L"}]},
                          {"name": "missing.pdf", "document_id": "DOC-2", "state": "Missing", "fields": []}],
            "medical_declaration": {"declared_conditions": list(conditions)}}


def proposal(**override):
    base = {"medical_class": "CONTROLLED_CONDITION", "tobacco_status": "NON_TOBACCO", "summary": "ok", "confidence": 0.8,
            "drivers": [{"factor": "Thyroid", "effect": "increases", "weight": 4, "explanation": "x", "evidence_ids": ["E1"]}]}
    return {**base, **override}


class RiskProposalTests(unittest.TestCase):
    def test_evidence_skips_missing_documents_and_numbers_items(self):
        items = evidence_items(case())
        self.assertEqual([i["id"] for i in items], ["E1", "E2"])
        self.assertEqual(items[0]["quote"], "TSH 6.1 mIU/L")

    def test_profile_flags_become_numbered_evidence(self):
        profiled = {**case(), "documents": [], "health_profile": {"diabetes": True, "tobacco_user": False, "bmi": 27.0}}
        items = evidence_items(profiled)
        self.assertIn("Yes", [i["value"] for i in items if i["field"] == "Diabetes"])
        self.assertEqual(items[0]["source"], "Applicant data record")

    def test_tobacco_class_must_match_the_data_record(self):
        config = {**CONFIG, "rate_tables": {"tobacco_multipliers": {"NON_SMOKER": 1.0, "SMOKER": 1.2}}}
        smoker = {**case(), "health_profile": {"tobacco_user": True}}
        wrong = validate_proposal(proposal(tobacco_status="NON_SMOKER"), config, evidence_items(smoker), smoker, "m")
        right = validate_proposal(proposal(tobacco_status="SMOKER"), config, evidence_items(smoker), smoker, "m")
        self.assertEqual(wrong["status"], "needs_review")
        self.assertEqual(right["status"], "validated")

    def test_supported_proposal_is_validated(self):
        result = validate_proposal(proposal(), CONFIG, evidence_items(case()), case(), "m")
        self.assertEqual(result["status"], "validated")
        self.assertEqual(result["drivers"][0]["evidence"][0]["document_id"], "DOC-1")

    def test_driver_without_known_evidence_needs_review(self):
        raw = proposal(drivers=[{"factor": "Invented", "effect": "increases", "weight": 9, "explanation": "x", "evidence_ids": ["E99"]}])
        result = validate_proposal(raw, CONFIG, evidence_items(case()), case(), "m")
        self.assertEqual(result["status"], "needs_review")
        self.assertFalse(result["drivers"][0]["supported"])

    def test_unknown_class_needs_review(self):
        result = validate_proposal(proposal(medical_class="GOLD"), CONFIG, evidence_items(case()), case(), "m")
        self.assertEqual(result["status"], "needs_review")

    def test_declared_condition_cannot_be_standard(self):
        result = validate_proposal(proposal(medical_class="STANDARD"), CONFIG, evidence_items(case()), case(), "m")
        self.assertEqual(result["status"], "needs_review")

    def test_unlisted_condition_requires_specialist_review(self):
        unlisted = case(("Rare disorder",))
        self.assertEqual(validate_proposal(proposal(), CONFIG, evidence_items(unlisted), unlisted, "m")["status"], "needs_review")
        referred = proposal(medical_class="SPECIALIST_REVIEW")
        self.assertEqual(validate_proposal(referred, CONFIG, evidence_items(unlisted), unlisted, "m")["status"], "validated")


if __name__ == "__main__":
    unittest.main()
