"""AI referral-premium estimate; the model call is stubbed."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.agents import pricing_reasoning
from backend.config.llm_config import gemini_model
from backend.agents.underwriting_agents import _add_referral_estimate, _generate_with_retry

PRODUCT = {"config": {"rate_tables": {"medical_multipliers": {"STANDARD": 1.0, "SPECIALIST_REVIEW": None}}}}
BASE = {"premium": 10000.0, "age": 41, "sum_assured": 1500000}
CASE = {"medical_declaration": {"declared_conditions": ["Type 2 diabetes"]}, "health_profile": {"diabetes": True}}


def fake_client(payload):
    models = SimpleNamespace(generate_content=lambda **_: SimpleNamespace(text=json.dumps(payload)))
    return lambda: SimpleNamespace(models=models)


def estimate(payload):
    with patch("backend.agents.underwriting_agents._vertex_client", fake_client(payload)):
        return pricing_reasoning.gemini_referral_estimate(CASE, PRODUCT, BASE)


class ReferralEstimateTests(unittest.TestCase):
    def test_premium_is_calculated_in_code_from_the_proposed_loading(self):
        result = estimate({"medical_loading_pct": 45.5, "rationale": "Diabetes and hypertension.", "factors": ["Diabetes"]})
        self.assertEqual(result["status"], "estimated")
        self.assertEqual(result["premium"], 14550.0)
        self.assertIn("10000.0 x (1 + 45.5%) = 14550.00", result["formula"])

    def test_loading_outside_the_allowed_range_is_rejected(self):
        for loading in (-5, pricing_reasoning.MAX_LOADING_PCT + 1, True):
            result = estimate({"medical_loading_pct": loading, "rationale": "x", "factors": []})
            self.assertEqual(result["status"], "unavailable")
            self.assertNotIn("premium", result)

    def test_estimate_is_attached_to_the_premium_calculation(self):
        result = {"findings": ["manual review"], "premium_calculation": {"premium": None, "status": "manual_review"}}
        case = {**CASE, "date_of_birth": "1985-01-01", "health_rating_inputs": {"medical_class": "SPECIALIST_REVIEW"},
                "health_pricing_configuration": PRODUCT}
        proposed = {"status": "estimated", "premium": 14550.0, "loading_pct": 45.5, "model": "m", "rationale": "why", "factors": ["f"]}
        with patch("backend.services.health_product.calculate_health_premium", return_value=BASE), \
                patch("backend.agents.pricing_reasoning.gemini_referral_estimate", return_value=proposed):
            _add_referral_estimate(result, case)
        self.assertEqual(result["premium"], 14550.0)
        self.assertEqual(result["premium_calculation"]["ai_estimate"], proposed)
        self.assertIsNone(result["premium_calculation"]["premium"])


class RetryTests(unittest.TestCase):
    def client(self, outcomes):
        calls = iter(outcomes)

        def generate_content(**_):
            outcome = next(calls)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome
        return lambda: SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    def test_rate_limit_is_retried_then_succeeds(self):
        limited = type("Limited", (Exception,), {"code": 429})()
        with patch("backend.agents.underwriting_agents._vertex_client", self.client([limited, "done"])), patch("backend.agents.underwriting_agents.time.sleep") as sleep:
            self.assertEqual(_generate_with_retry(model="m"), "done")
        sleep.assert_called_once_with(3)

    def test_other_client_errors_are_not_retried(self):
        denied = type("Denied", (Exception,), {"code": 403})()
        with patch("backend.agents.underwriting_agents._vertex_client", self.client([denied, "never"])), patch("backend.agents.underwriting_agents.time.sleep") as sleep:
            with self.assertRaises(Exception):
                _generate_with_retry(model="m")
        sleep.assert_not_called()


class ModelConfigTests(unittest.TestCase):
    def test_default_model_and_env_override(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(gemini_model(), "gemini-3.5-flash-lite")
        with patch.dict("os.environ", {"UNDERWRITING_GEMINI_MODEL": "custom"}):
            self.assertEqual(gemini_model(), "custom")


if __name__ == "__main__":
    unittest.main()
