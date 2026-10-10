import json
import os
import re

from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()
genai.configure(api_key=os.environ["GEMINI_API_KEY"])

CHART_TYPES = {"bar", "line", "area", "pie", "scatter", "radar"}


def _eligible_charts(rows: list[dict], columns: list[str]) -> tuple[list[str], list[str], list[str]]:
    numeric_columns = [
        column
        for column in columns
        if any(isinstance(row.get(column), (int, float)) and not isinstance(row.get(column), bool) for row in rows)
    ]
    category_columns = [column for column in columns if column not in numeric_columns]
    charts = []
    if category_columns and numeric_columns:
        charts.extend(["bar", "line", "area"])
        if len(rows) <= 12:
            charts.append("pie")
        if len(numeric_columns) >= 2:
            charts.append("scatter")
            charts.append("radar")
    elif len(numeric_columns) >= 2:
        charts.extend(["scatter", "bar"])
    return charts, category_columns, numeric_columns


def _fallback(rows: list[dict], charts: list[str], categories: list[str], numerics: list[str]) -> dict:
    x_key = categories[0] if categories else (numerics[0] if numerics else "")
    y_keys = numerics[:2] if "radar" in charts else numerics[:1]
    return {
        "chart_type": "bar" if "bar" in charts else (charts[0] if charts else "bar"),
        "x_key": x_key,
        "y_keys": y_keys,
        "title": "Query results",
        "rationale": "A bar chart clearly compares the numeric result across categories.",
    }


def recommend_visualization(question: str, columns: list[str], rows: list[dict]) -> dict:
    """Recommend a validated chart configuration for query results."""
    chart_types, category_columns, numeric_columns = _eligible_charts(rows, columns)
    fallback = _fallback(rows, chart_types, category_columns, numeric_columns)
    recommendation = fallback

    if rows and chart_types:
        model = genai.GenerativeModel("gemini-3.6-flash")
        prompt = f"""Choose the most useful chart for these query results. Return only JSON with keys chart_type, x_key, y_keys, title, rationale.

Allowed chart_type values: {json.dumps(chart_types)}
Available columns: {json.dumps(columns)}
Categorical columns: {json.dumps(category_columns)}
Numeric columns: {json.dumps(numeric_columns)}
User question: {question}
Sample result rows: {json.dumps(rows[:40], default=str)}

Use a line chart for chronological trends, bar chart for category comparisons, pie chart only for a small part-to-whole breakdown, scatter for numeric relationships, and radar for several numeric measures across categories. x_key must be a column name. y_keys must be a list of numeric column names. Do not invent data or column names. Keep title and rationale concise."""
        try:
            response = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            candidate = json.loads(response.text)
            chart_type = candidate.get("chart_type")
            x_key = candidate.get("x_key")
            y_keys = candidate.get("y_keys")
            if (
                chart_type in chart_types
                and x_key in columns
                and isinstance(y_keys, list)
                and y_keys
                and all(key in numeric_columns for key in y_keys)
            ):
                recommendation = {
                    "chart_type": chart_type,
                    "x_key": x_key,
                    "y_keys": y_keys,
                    "title": str(candidate.get("title") or "Query results")[:120],
                    "rationale": str(candidate.get("rationale") or "")[:400],
                }
        except Exception:
            pass

    return {
        "agent": "visualization_agent",
        "recommendation": recommendation,
        "available_chart_types": chart_types,
        "x_columns": category_columns,
        "numeric_columns": numeric_columns,
    }