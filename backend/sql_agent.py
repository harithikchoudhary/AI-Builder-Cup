import json
import os
import re
from dotenv import load_dotenv
from google.cloud import bigquery
import google.generativeai as genai

from .mcp_tools import search_entries, lookup_context, extract_entry_info, PROJECT_ID

load_dotenv()
genai.configure(api_key=os.environ["GEMINI_API_KEY"])

bq_client = bigquery.Client(project=PROJECT_ID)

SYSTEM_PROMPT = """You are a SQL expert agent. Given a user question and schema context from Google Cloud Knowledge Catalog, generate a BigQuery-compatible SQL query.

Rules:
- Use only the tables and columns present in the schema context provided.
- Use fully qualified table names (project.dataset.table).
- Return ONLY a valid SQL query inside a ```sql ... ``` block. No explanations outside the block.
- Generate read-only SELECT or WITH queries only.
- If the question cannot be answered with the available schema, return ```sql\n-- UNABLE TO GENERATE: <reason>\n```
"""

def _generate_sql(question: str, schema_context: str, dataset_id: str | None = None) -> str:
    """Use Gemini API to generate SQL from the question and schema context."""
    model = genai.GenerativeModel("gemini-3.6-flash")
    prompt = f"""{SYSTEM_PROMPT}

## Schema Context
{schema_context}

## User Question
{question}

## Dataset Scope
{f"Use only tables in BigQuery project {PROJECT_ID}, dataset {dataset_id}." if dataset_id else "Use only the datasets represented in the supplied schema context."}
"""
    response = model.generate_content(prompt)
    text = response.text
    match = re.search(r"```sql\s*(.*?)```", text, re.DOTALL)
    return match.group(1).strip() if match else text.strip()


def _generate_summary(question: str, sql: str, rows: list[dict], columns: list[str]) -> str:
    """Use Gemini to generate a natural language summary of the query results."""
    model = genai.GenerativeModel("gemini-3.6-flash")
    # Limit rows sent to LLM to avoid token overflow
    sample = rows[:50]
    prompt = f"""You are a data analyst. Given the user's question, the SQL query that was run, and the results, provide a concise, insightful summary in 3-5 sentences. Highlight key trends, outliers, or notable findings. Use actual numbers from the results.

## User Question
{question}

## SQL Query
{sql}

## Columns
{columns}

## Results ({len(rows)} rows total, showing up to 50)
{json.dumps(sample, indent=2)}
"""
    response = model.generate_content(prompt)
    return response.text.strip()

def _run_bigquery(sql: str, dataset_id: str | None = None) -> list[dict]:
    """Execute SQL on BigQuery and return rows as dicts."""
    if not sql.lstrip().upper().startswith(("SELECT", "WITH")):
        raise ValueError("Only read-only SELECT queries are allowed.")

    if dataset_id:
        dry_run_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
        dry_run_job = bq_client.query(sql, job_config=dry_run_config)
        referenced_tables = dry_run_job.referenced_tables or []
        if not referenced_tables:
            raise ValueError("Could not verify that this query reads from the selected dataset.")
        outside_scope = [
            table.full_table_id
            for table in referenced_tables
            if table.project != PROJECT_ID or table.dataset_id != dataset_id
        ]
        if outside_scope:
            raise ValueError(
                f"Query references tables outside the selected dataset '{dataset_id}': "
                + ", ".join(outside_scope)
            )

    query_job = bq_client.query(sql)
    results = query_job.result()
    schema = [field.name for field in results.schema]
    rows = []
    for row in results:
        rows.append({col: row[col] for col in schema})
    return rows, schema

def _serialize_rows(rows: list[dict]) -> list[dict]:
    """Convert BigQuery row values to JSON-serializable types."""
    import datetime
    from decimal import Decimal
    serialized = []
    for row in rows:
        new_row = {}
        for k, v in row.items():
            if isinstance(v, (datetime.date, datetime.datetime)):
                new_row[k] = v.isoformat()
            elif isinstance(v, Decimal):
                new_row[k] = float(v)
            else:
                new_row[k] = v
        serialized.append(new_row)
    return serialized

def run_agent(question: str, dataset_id: str | None = None) -> dict:
    """
    Full SQL agent pipeline:
    1. Search Google Knowledge Catalog for relevant assets
    2. Look up schema context from Google Knowledge Catalog
    3. Generate SQL with Gemini
    4. Execute on BigQuery
    5. Return results
    """
    # Step 1: Search Google Knowledge Catalog for relevant data assets.
    try:
        entries = search_entries(
            question.lower(), page_size=1000, dataset_id=dataset_id
        )
    except Exception as exc:
        return {
            "question": question,
            "error": f"Knowledge Catalog search failed: {exc}",
            "steps": [{"step": "search_entries", "error": str(exc)}],
        }

    if not entries:
        return {
            "question": question,
            "error": "No relevant tables found in Google Knowledge Catalog.",
            "steps": [{"step": "search_entries", "detail": "No results"}],
        }

    entry_info = extract_entry_info(entries)
    if dataset_id:
        entry_info = [
            entry
            for entry in entry_info
            if entry["fqn"].startswith(f"bigquery:{PROJECT_ID}.{dataset_id}.")
        ]
        if not entry_info:
            return {
                "question": question,
                "dataset_id": dataset_id,
                "error": f"No matching catalog tables were found in dataset '{dataset_id}'. Try a more specific search or another dataset.",
                "steps": [{"step": "search_entries", "detail": "No results in selected dataset"}],
            }

    steps = [{"step": "search_entries", "tables_found": [entry["fqn"] for entry in entry_info]}]

    # Step 2: Look up schema context, grouped by catalog location.
    entries_by_location = {}
    for entry in entry_info:
        entries_by_location.setdefault(entry["location"], []).append(entry["name"])

    context_parts = []
    try:
        for location, names in entries_by_location.items():
            context_parts.append(lookup_context(names, location=location))
    except Exception as exc:
        return {
            "question": question,
            "error": f"Knowledge Catalog context lookup failed: {exc}",
            "steps": steps + [{"step": "lookup_context", "error": str(exc)}],
        }

    schema_context = "\n---\n".join(context_parts)
    steps.append({"step": "lookup_context", "preview": schema_context[:500]})

    # Step 3: Generate SQL
    sql = _generate_sql(question, schema_context, dataset_id=dataset_id)
    steps.append({"step": "generate_sql", "sql": sql})

    if sql.startswith("-- UNABLE"):
        return {"question": question, "sql": sql, "error": sql, "steps": steps}

    # Step 4: Execute on BigQuery
    try:
        rows, columns = _run_bigquery(sql, dataset_id=dataset_id)
        rows = _serialize_rows(rows)
        steps.append({"step": "execute", "row_count": len(rows)})

        # Step 5: Generate natural language summary
        try:
            summary = _generate_summary(question, sql, rows, columns)
            steps.append({"step": "summarize"})
        except Exception:
            summary = None

        return {
            "question": question,
            "dataset_id": dataset_id,
            "sql": sql,
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "summary": summary,
            "catalog_entries": entry_info,
            "steps": steps,
        }
    except Exception as exc:
        steps.append({"step": "execute", "error": str(exc)})
        return {"question": question, "sql": sql, "error": str(exc), "steps": steps}
