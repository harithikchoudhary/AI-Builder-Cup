"""Single place that names the Gemini model used by every agent."""
import os

DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"


def gemini_model() -> str:
    return os.getenv("UNDERWRITING_GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
