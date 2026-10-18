import importlib
import os
import unittest
from unittest.mock import Mock, patch


class ProjectConfigurationTests(unittest.TestCase):
    def test_project_and_credentials_come_from_environment(self):
        credentials = Mock(token="test-token")
        config = {
            "GCP_PROJECT_ID": "example-test-project",
            "GOOGLE_APPLICATION_CREDENTIALS": "C:/private/adc.json",
        }
        with patch.dict(os.environ, {}, clear=True), patch(
            "dotenv.load_dotenv", side_effect=lambda: os.environ.update(config)
        ) as load_env, patch("google.auth.default", return_value=(credentials, None)) as default:
            mcp_tools = importlib.import_module("backend.integrations.mcp_tools")
            load_env.assert_called_once_with()
            self.assertEqual(mcp_tools.PROJECT_ID, "example-test-project")
            self.assertEqual(mcp_tools._get_token(), "test-token")
            default.assert_called_once_with(
                scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
            self.assertEqual(os.environ["GOOGLE_APPLICATION_CREDENTIALS"], "C:/private/adc.json")

    def test_missing_project_is_reported(self):
        with patch.dict(os.environ, {}, clear=True), patch("dotenv.load_dotenv"):
            with self.assertRaisesRegex(RuntimeError, "GCP_PROJECT_ID"):
                importlib.import_module("backend.integrations.mcp_tools")


if __name__ == "__main__":
    unittest.main()