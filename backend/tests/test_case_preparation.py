"""Case preparation invariants; all storage/model calls are mocked."""
import json
import unittest
from copy import deepcopy
from unittest.mock import patch

from backend.repositories import health_underwriting as repo


def case():
    return {"application_id": "HI-TEST", "applicant": "Fictional applicant", "insurance_type": "health",
            "product_code": "IH-ESSENTIAL", "status": "Ready for underwriting", "documents": [],
            "workflow": {"version": 6, "steps": {}, "current_step": "intake"}}


def policy(policy_id="P-COMPANY", kind="company", insurance_type="health"):
    return {"policy_id": policy_id, "policy_name": "Policy", "policy_kind": kind,
            "insurance_type": insurance_type, "status": "active", "version": "1.0",
            "product_code": "IH-ESSENTIAL" if kind == "company" else None,
            "extracted_rules": {"summary": "Source outline", "rules": [{"rule_text": "Original rule"}]}}


class CasePreparationTests(unittest.TestCase):
    def test_rejects_wrong_insurance_type_before_persisting(self):
        with patch.object(repo, "get_case", return_value=case()), patch("backend.repositories.policy_library.get_policy", return_value=policy(insurance_type="life")), patch.object(repo, "_save_case_event") as save:
            with self.assertRaisesRegex(ValueError, "insurance type"):
                repo.save_case_policies("HI-TEST", ["P-COMPANY"])
            save.assert_not_called()

    def test_selection_pins_rule_values_not_mutable_library_reference(self):
        source = policy()
        with patch.object(repo, "get_case", return_value=case()), patch("backend.repositories.policy_library.get_policy", return_value=source), patch.object(repo, "_save_case_event"):
            saved = repo.save_case_policies("HI-TEST", ["P-COMPANY"])
        source["extracted_rules"]["rules"][0]["rule_text"] = "Changed later"
        self.assertEqual(saved["policy_selection"]["policies"][0]["extracted_rules"]["rules"][0]["rule_text"], "Original rule")

    def test_pipeline_requires_both_company_and_regulatory_selection(self):
        application = case()
        application["policy_selection"] = {"policies": [policy()]}
        with patch.object(repo, "get_case", return_value=application), patch.object(repo, "_save_case_event") as save:
            with self.assertRaisesRegex(ValueError, "regulatory"):
                repo.start_pipeline("HI-TEST")
            save.assert_not_called()

    def test_start_moves_received_case_into_review(self):
        application = case()
        application["policy_selection"] = {"policies": [policy(), policy("P-REG", "regulatory")]}
        with patch.object(repo, "get_case", return_value=application), patch.object(repo, "_save_case_event"):
            saved = repo.start_pipeline("HI-TEST")
        self.assertEqual(saved["status"], "In review")
        self.assertTrue(saved["workflow"]["started_at"])

    def test_selection_is_locked_after_pipeline_start(self):
        application = case(); application["workflow"]["started_at"] = "2026-10-16T00:00:00Z"
        with patch.object(repo, "get_case", return_value=application), patch.object(repo, "_save_case_event") as save:
            with self.assertRaisesRegex(ValueError, "locked"):
                repo.save_case_policies("HI-TEST", ["P-COMPANY"])
            save.assert_not_called()

    def test_confirmation_records_exact_reviewed_result_without_model_rerun(self):
        application = case()
        application["workflow"].update(started_at="2026-10-16T00:00:00Z", pending_step="intake", pending_result={"result_id": "RESULT-1", "can_continue": True, "summary": "What employee reviewed", "agent": "Details"})
        with patch.object(repo, "get_case", return_value=application), patch.object(repo, "_save_case_event"), patch("backend.agents.underwriting_agents.run_agent") as run:
            result = repo.run_workflow_step("HI-TEST", "intake", True, "Verified against the source", "RESULT-1")
        run.assert_not_called()
        self.assertEqual(result["workflow"]["steps"]["intake"]["summary"], "What employee reviewed")
        self.assertEqual(result["workflow"]["current_step"], "rules")
        self.assertNotIn("pending_result", result["workflow"])

    def test_stale_confirmation_is_rejected(self):
        application = case()
        application["workflow"].update(started_at="2026-10-16T00:00:00Z", pending_step="intake", pending_result={"result_id": "NEW", "can_continue": True})
        with patch.object(repo, "get_case", return_value=application), patch.object(repo, "_save_case_event") as save:
            with self.assertRaisesRegex(ValueError, "changed"):
                repo.run_workflow_step("HI-TEST", "intake", True, "Reviewed", "OLD")
            save.assert_not_called()

    def test_latest_event_keeps_selected_versions_and_extracted_documents(self):
        application = case()
        application.update(policy_selection={"policies": [policy()]}, selected_policy_id="P-COMPANY", documents=[{"name": "Proposal.pdf", "fields": [{"name": "applicant", "value": "Fictional applicant"}]}])
        state = repo._case_state(application)
        hydrated = repo._hydrate_case(json.dumps(case()), json.dumps(state))
        self.assertEqual(hydrated["policy_selection"], application["policy_selection"])
        self.assertEqual(hydrated["documents"], application["documents"])

    def test_approval_cannot_bypass_pipeline_completion(self):
        with patch.object(repo, "get_case", return_value=case()), patch.object(repo, "_save_case_event") as save:
            with self.assertRaisesRegex(ValueError, "Complete"):
                repo.update_case("HI-TEST", "Approve", "Reviewed")
            save.assert_not_called()

    def test_approval_cannot_bypass_open_requirements(self):
        application = case()
        application["workflow"].update(current_step="complete", open_items=[{"step": "decision", "text": "Premium unavailable"}])
        with patch.object(repo, "get_case", return_value=application), patch.object(repo, "_save_case_event") as save:
            with self.assertRaisesRegex(ValueError, "open requirements"):
                repo.update_case("HI-TEST", "Approve", "Reviewed")
            save.assert_not_called()

    def test_approval_checks_saved_stage_findings(self):
        application = case()
        application["workflow"].update(current_step="complete", steps={"rules": {"outcome": {"issues": ["Premium unavailable"]}}})
        with patch.object(repo, "get_case", return_value=application), patch.object(repo, "_save_case_event") as save:
            with self.assertRaisesRegex(ValueError, "open requirements"):
                repo.update_case("HI-TEST", "Approve", "Reviewed")
            save.assert_not_called()

    def test_clear_completed_case_can_be_approved(self):
        application = case()
        application["workflow"]["current_step"] = "complete"
        with patch.object(repo, "get_case", return_value=application), patch.object(repo, "_save_case_event") as save:
            updated = repo.update_case("HI-TEST", "Approve", "Reviewed")
        self.assertEqual(updated["status"], "Approved")
        save.assert_called_once()

    def test_open_requirements_can_be_referred(self):
        application = case()
        application["workflow"].update(current_step="complete", open_items=[{"step": "risk", "text": "Medical review needed"}])
        with patch.object(repo, "get_case", return_value=application), patch.object(repo, "_save_case_event") as save:
            updated = repo.update_case("HI-TEST", "Refer", "Specialist review needed")
        self.assertEqual(updated["status"], "Referred")
        save.assert_called_once()


if __name__ == "__main__":
    unittest.main()
