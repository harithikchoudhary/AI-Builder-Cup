import json
import os
from pathlib import Path
from queue import Empty, Queue
from threading import Thread

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .conversational_agents import call_data_agent
from .mcp_tools import PROJECT_ID, search_entries, extract_entry_info
from .chat_history import HISTORY_DATASET, get_conversation, list_conversations, save_turn
from . import health_underwriting
from . import policy_library
from . import pipeline_service
from .document_intake import ALLOWED_MIME_TYPES, MAX_DOCUMENT_BYTES
from google.cloud import bigquery

app = FastAPI(title="Knowledge Catalog SQL Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class QueryRequest(BaseModel):
    question: str
    dataset_id: str | None = None
    session_id: str | None = Field(default=None, max_length=80)
    conversation_id: str | None = Field(default=None, max_length=80)
    turn_id: str | None = Field(default=None, max_length=80)
    turn_index: int = Field(default=0, ge=0)

class SearchRequest(BaseModel):
    query: str
    page_size: int = 10
    dataset_id: str | None = None

class KnowledgeCatalogRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    dataset_id: str | None = None
    session_id: str | None = Field(default=None, max_length=80)
    conversation_id: str | None = Field(default=None, max_length=80)
    turn_id: str | None = Field(default=None, max_length=80)
    turn_index: int = Field(default=0, ge=0)

class VisualizationRequest(BaseModel):
    question: str = Field(max_length=1000)
    columns: list[str] = Field(max_length=50)
    rows: list[dict] = Field(max_length=200)

class UnderwritingActionRequest(BaseModel):
    action: str = Field(min_length=1, max_length=40)
    reason: str = Field(default="", max_length=2000)


class UnderwritingStepRequest(BaseModel):
    confirm: bool = False
    attestation: str = Field(default="", max_length=1000)
    result_id: str = Field(default="", max_length=80)


class PipelineRunRequest(BaseModel):
    command: str = Field(default="run", pattern="^(run|resume|retry)$")
    result_id: str = Field(default="", max_length=80)
    note: str = Field(default="", max_length=2000)
    confirmed: bool = False


class CasePolicySelectionRequest(BaseModel):
    policy_ids: list[str] = Field(min_length=1, max_length=40)
    primary_policy_id: str = Field(default="", max_length=80)


class PolicyDeleteRequest(BaseModel):
    policy_ids: list[str] = Field(min_length=1, max_length=500)


def _progress(on_progress, agent: str, kind: str, message: str):
    if on_progress:
        on_progress({"agent": agent, "kind": kind, "message": message})


def _sse_response(runner, request):
    events = Queue()

    def execute():
        try:
            result = runner(request, lambda event: events.put({"type": "progress", **event}))
            events.put({"type": "result", "result": result})
        except HTTPException as exc:
            events.put({"type": "error", "message": str(exc.detail), "status_code": exc.status_code})
        except Exception as exc:
            events.put({"type": "error", "message": str(exc), "status_code": 500})
        finally:
            events.put(None)

    Thread(target=execute, daemon=True).start()

    def stream():
        while True:
            try:
                event = events.get(timeout=15)
            except Empty:
                yield ": keep-alive\n\n"
                continue
            if event is None:
                break
            yield f"data: {json.dumps(event, default=str)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

def _agent_json(result: dict, agent_name: str) -> dict:
    parsed = result.get("agent_json")
    if isinstance(parsed, dict):
        parsed.setdefault("agent", agent_name)
        parsed.setdefault("status", "success")
        parsed.setdefault("message", result.get("text") or "")
        parsed.setdefault("data", {})
        return parsed
    return {
        "agent": agent_name,
        "status": "success" if result.get("text") else "needs_information",
        "message": result.get("text") or "The agent returned no final response.",
        "data": {},
    }


def _visualization_result(raw: dict, columns: list[str], rows: list[dict]) -> dict:
    reply = _agent_json(raw, "visualization")
    data = reply.get("data") if isinstance(reply.get("data"), dict) else {}
    recommendation = data.get("recommendation") if isinstance(data.get("recommendation"), dict) else data
    numeric_columns = [
        column for column in columns
        if any(
            isinstance(row.get(column), (int, float))
            and not isinstance(row.get(column), bool)
            for row in rows
        )
    ]
    x_columns = [column for column in columns if column not in numeric_columns]
    available_chart_types = []
    if x_columns and numeric_columns:
        available_chart_types = ["bar", "line", "area"]
        if len(rows) <= 12:
            available_chart_types.append("pie")
        if len(numeric_columns) >= 2:
            available_chart_types.extend(["scatter", "radar"])
    elif len(numeric_columns) >= 2:
        available_chart_types = ["scatter", "bar"]

    chart_types = {"bar", "line", "area", "pie", "scatter", "radar"}
    proposed = data.get("charts") or data.get("recommendations") or [recommendation]
    if isinstance(proposed, dict):
        proposed = [proposed]
    charts = []
    for item in proposed if isinstance(proposed, list) else []:
        if not isinstance(item, dict):
            continue
        chart_type = item.get("chart_type")
        x_key = item.get("x_key")
        y_keys = item.get("y_keys", [])
        if chart_type not in chart_types or x_key not in columns or not isinstance(y_keys, list):
            continue
        y_keys = [key for key in y_keys if key in numeric_columns]
        if not y_keys:
            continue
        charts.append({
            "chart_type": chart_type, "x_key": x_key, "y_keys": y_keys[:4],
            "title": item.get("title") or f"{chart_type.title()} chart",
            "rationale": item.get("rationale") or "",
        })
    if x_columns and numeric_columns:
        x_key, y_key = x_columns[0], numeric_columns[0]
        fallback_types = ["bar", "line", "area"] + (["pie"] if len(rows) <= 12 else [])
        existing_types = {chart["chart_type"] for chart in charts}
        charts.extend({"chart_type": kind, "x_key": x_key, "y_keys": [y_key],
                       "title": f"{kind.title()} · {y_key.replace('_', ' ')} by {x_key.replace('_', ' ')}",
                       "rationale": "Alternative view of the same query results."}
                      for kind in fallback_types if kind not in existing_types)
    charts = charts[:4]
    primary = charts[0] if charts else {"chart_type": None, "x_key": None, "y_keys": [], "title": None, "rationale": reply.get("message", "")}
    return {
        "agent": "visualization",
        "status": reply.get("status", "success"),
        "message": reply.get("message", ""),
        "recommendation": primary,
        "charts": charts,
        "available_chart_types": data.get("available_chart_types") or available_chart_types,
        "x_columns": x_columns,
        "numeric_columns": numeric_columns,
        "agent_response": reply,
    }


def _supervisor_intent(question: str) -> str:
    """Choose a safe deterministic route before invoking the specialist agents."""
    text = " ".join(question.lower().split())
    underwriting_terms = ("underwriting", "health insurance", "insurance application", "insurance policy", "policies received", "pending policies")
    analytics_terms = ("how many", "count", "pending", "received", "problems", "issues", "trend", "volume", "status", "applications", "policies")
    if any(term in text for term in underwriting_terms) and any(term in text for term in analytics_terms):
        return "underwriting_analytics"
    catalog_terms = ("catalog", "metadata", "descriptions", "data dictionary", "knowledge gap")
    if any(term in text for term in catalog_terms) and any(
        term in text for term in ("update", "improve", "missing", "gap", "review", "fix", "document", "catalog")
    ):
        return "catalog"
    overview_phrases = (
        "what data can you provide", "what data do you have", "what data is available",
        "what tables", "list tables", "show tables", "list datasets", "what datasets",
        "show schema", "list columns", "what columns", "dataset overview",
    )
    if any(phrase in text for phrase in overview_phrases):
        return "dataset_overview"
    help_phrases = ("what can you do", "how can you help", "help me", "hello", "hi", "good morning", "good afternoon")
    if text in help_phrases or any(phrase in text for phrase in help_phrases[:2]):
        return "help"
    return "analytics"


def _supervisor_result(req: QueryRequest, intent: str, on_progress=None):
    """Return help or BigQuery metadata responses without sending them to SQL generation."""
    if intent == "underwriting_analytics":
        metrics = health_underwriting.portfolio_metrics()
        text = req.question.lower()
        if "problem" in text or "issue" in text or "missing" in text:
            rows = [{"issue": key, "application_count": value} for key, value in metrics["issues"].items()]
            rows.sort(key=lambda row: row["application_count"], reverse=True)
            summary = "The most common review issues across submitted applications are " + "; ".join(f"{row['issue'].lower()} ({row['application_count']})" for row in rows) + "." if rows else "No open review issues are currently flagged."
            columns = ["issue", "application_count"]
            x_key = "issue"
        else:
            rows = [{"status": key, "application_count": value} for key, value in metrics["statuses"].items()]
            rows.sort(key=lambda row: row["application_count"], reverse=True)
            summary = f"There are {metrics['total']} applications: {metrics['pending']} pending review and {metrics['received_today']} received today."
            columns = ["status", "application_count"]
            x_key = "status"
        numeric = ["application_count"]
        chart = {"chart_type": "bar", "x_key": x_key, "y_keys": numeric, "title": "Applications by " + x_key, "rationale": "Counts from submitted applications."}
        return {
            "agent": "portfolio_analytics", "status": "success", "response_type": "analysis",
            "question": req.question, "dataset_id": health_underwriting.DATASET_ID,
            "summary": summary, "key_findings": [summary], "data": {"summary": summary},
            "columns": columns, "rows": rows, "row_count": len(rows), "sql": None,
            "analysis": {"question_understanding": req.question.strip(), "approach": "Aggregated submitted application records by status or flagged issue.", "data_scope": "Applications recorded in the underwriting workspace.", "transformations": ["Grouped applications by status or issue", "Counted applications in each group"], "assumptions_and_limitations": []},
            "visualization": {"agent": "visualization", "status": "success", "message": "Chart built from submitted application counts.", "recommendation": chart, "charts": [chart], "available_chart_types": ["bar", "pie"], "x_columns": [x_key], "numeric_columns": numeric},
            "catalog_entries": [], "error": None,
        }
    if intent == "help":
        summary = (
            "I can answer questions about your selected BigQuery dataset, analyze its data with SQL, "
            "create charts from query results, and review catalog metadata. Try asking what tables are "
            "available, requesting a data analysis, or asking me to review missing catalog descriptions."
        )
        rows, columns = [], []
        analysis = {"question_understanding": req.question.strip(), "approach": "Intentra handled this as a general capability question."}
    else:
        client = bigquery.Client(project=PROJECT_ID)
        if req.dataset_id:
            dataset = client.get_dataset(req.dataset_id)
            table_rows = []
            for table in client.list_tables(dataset, page_size=100, timeout=15):
                table_info = client.get_table(table.reference)
                field_names = [field.name for field in table_info.schema]
                table_rows.append({
                    "table_name": table.table_id,
                    "description": table_info.description or "",
                    "columns": ", ".join(field_names),
                })
            rows = table_rows
            columns = ["table_name", "description", "columns"]
            summary = f"The {req.dataset_id} dataset has {len(rows)} tables. Here are the available tables, descriptions, and columns."
            scope = req.dataset_id
        else:
            datasets = list(client.list_datasets(page_size=100, timeout=15))
            rows = [{"dataset_id": item.dataset_id} for item in datasets]
            columns = ["dataset_id"]
            summary = f"I can see {len(rows)} BigQuery datasets in project {client.project}. Select a dataset to inspect its tables and columns."
            scope = client.project
        analysis = {"question_understanding": req.question.strip(), "approach": "Read BigQuery dataset and table metadata; no data query was run.", "data_scope": scope}
    _progress(on_progress, "supervisor", "agent_complete", "Prepared a response without running an analytical SQL query.")
    return {
        "agent": "supervisor", "status": "success", "response_type": intent,
        "question": req.question, "dataset_id": req.dataset_id, "summary": summary,
        "data": {}, "columns": columns, "rows": rows, "row_count": len(rows),
        "analysis": analysis, "sql": None, "visualization": None, "catalog_entries": [],
        "error": None, "agent_response": {"agent": "supervisor", "status": "success", "message": summary, "data": {}},
    }


def _run_ask(req: QueryRequest, on_progress=None):
    """Route analysis through the saved SQL agent and resolve catalog gaps when reported."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    intent = _supervisor_intent(req.question)
    _progress(on_progress, "supervisor", "agent_start", "Classifying the request and selecting the right specialist.")
    if intent in ("help", "dataset_overview"):
        try:
            return _supervisor_result(req, intent, on_progress)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Intentra could not inspect BigQuery metadata: {exc}") from exc
    if intent == "catalog":
        _progress(on_progress, "supervisor", "agent_complete", "Routing this catalog request to the Knowledge Catalog agent.")
        catalog = _run_catalog_agent(KnowledgeCatalogRequest(
            question=req.question, dataset_id=req.dataset_id, session_id=req.session_id,
            conversation_id=req.conversation_id, turn_id=req.turn_id, turn_index=req.turn_index,
        ), on_progress)
        summary = catalog.get("message") or "The Knowledge Catalog agent completed its review."
        return {
            **catalog, "response_type": "catalog", "summary": summary,
            "columns": [], "rows": [], "row_count": 0, "sql": None,
            "analysis": {"question_understanding": req.question.strip(), "approach": "Routed to the Knowledge Catalog agent for metadata review."},
            "visualization": None, "catalog_entries": [], "error": None,
        }
    _progress(on_progress, "supervisor", "agent_complete", "Routing this analytical request to the SQL generation agent.")
    prior_turns = []
    if req.session_id and req.conversation_id:
        try:
            prior_turns = get_conversation(req.session_id, req.conversation_id)[-8:]
        except Exception as exc:
            _progress(on_progress, "supervisor", "agent_step", f"Could not load saved conversation context: {exc}")
    prompt = (
        "Answer the user's data question using the configured JSON response format. "
        "Include a data.analysis object with question_understanding, approach, data_scope, "
        "transformations, result_interpretation, and assumptions_and_limitations. Also include "
        "data.summary as a concise user-facing summary and data.key_findings as a list of 2 to 4 "
        "important factual findings grounded in the returned rows. Give a concise, "
        "auditable explanation of the method and findings grounded in the executed SQL and returned "
        "rows; do not provide private chain-of-thought or unsupported claims. Keep SQL, columns, and "
        "rows in their existing data fields.\n\nUser question: " + req.question.strip()
    )
    if prior_turns:
        context = [
            {"question": turn["question"], "answer": turn["result"].get("summary", "")}
            for turn in prior_turns
        ]
        prompt += "\n\nRecent turns in this conversation for context (treat the latest user question as the request to answer):\n" + json.dumps(context, ensure_ascii=False)
    if req.dataset_id:
        prompt += f"\n\nSelected BigQuery dataset: {req.dataset_id}. Restrict analysis to this dataset."
    try:
        _progress(on_progress, "data_analyst", "agent_start", "Calling the SQL generation agent.")
        raw = call_data_agent("data_analyst", prompt, on_progress=on_progress)
        reply = _agent_json(raw, "data_analyst")
        _progress(on_progress, "data_analyst", "agent_complete", "SQL agent returned its analysis and query results.")
        status = reply.get("status", "success")
        data = reply.get("data") if isinstance(reply.get("data"), dict) else {}
        summary = data.get("summary") or reply.get("message") or raw.get("text") or ""
        key_findings = data.get("key_findings") or []
        if isinstance(key_findings, str):
            key_findings = [key_findings]
        sql = data.get("sql") or raw.get("sql")
        columns = data.get("columns") or raw.get("columns") or []
        rows = data.get("rows") or raw.get("rows") or []
        agent_analysis = data.get("analysis") or data.get("detailed_analysis") or reply.get("analysis")
        if isinstance(agent_analysis, str):
            agent_analysis = {"approach": agent_analysis}
        if not isinstance(agent_analysis, dict):
            agent_analysis = {}
        analysis = {
            "question_understanding": agent_analysis.get("question_understanding") or req.question.strip(),
            "approach": agent_analysis.get("approach") or agent_analysis.get("method") or "The Data Analyst agent generated and executed the SQL shown below against the selected BigQuery dataset.",
            "data_scope": agent_analysis.get("data_scope") or agent_analysis.get("tables_and_columns") or data.get("tables_used") or ([req.dataset_id] if req.dataset_id else []),
            "transformations": agent_analysis.get("transformations") or agent_analysis.get("sql_logic") or [],
            "result_interpretation": agent_analysis.get("result_interpretation") or agent_analysis.get("findings") or summary,
            "assumptions_and_limitations": agent_analysis.get("assumptions_and_limitations") or agent_analysis.get("limitations") or [],
        }
        visualization = None
        gap_reply = None
        if status == "needs_information":
            gap_prompt = (
                "Review this analysis gap. Update Knowledge Catalog metadata only when supported "
                "by a trusted source. Return the configured JSON response format.\n\n"
                + "Original question: " + req.question.strip()
                + "\nSelected dataset: " + (req.dataset_id or "none")
                + "\nSQL agent response: " + json.dumps(reply, default=str)
            )
            try:
                _progress(on_progress, "knowledge_gap", "agent_start", "Calling the Knowledge Catalog agent to review the gap.")
                gap_raw = call_data_agent("knowledge_gap", gap_prompt, on_progress=on_progress)
                gap_reply = _agent_json(gap_raw, "knowledge_gap")
                _progress(on_progress, "knowledge_gap", "agent_complete", "Knowledge Catalog agent returned its review.")
            except Exception as gap_exc:
                gap_reply = {
                    "agent": "knowledge_gap",
                    "status": "error",
                    "message": f"Knowledge Gap Agent request failed: {gap_exc}",
                    "data": {},
                }

        if status == "success" and columns and rows:
            visualization_context = {
                "question": req.question.strip(),
                "sql_agent_response": reply,
                "sql": sql,
                "columns": columns,
                "rows": rows,
            }
            visualization_prompt = (
                "Generate 3 or 4 distinct chart configurations in JSON under data.charts. "
                "Each item must include chart_type, x_key, y_keys, title, rationale. "
                "Use only supplied columns and rows; do not query or invent data. Choose chart types "
                "from bar, line, area, pie, scatter, radar, and only use valid fields.\n"
                + json.dumps(visualization_context, default=str)
            )
            try:
                _progress(on_progress, "visualization", "agent_start", "Passing the SQL results to the Visualization agent.")
                visualization_raw = call_data_agent("visualization", visualization_prompt, on_progress=on_progress)
                visualization = _visualization_result(visualization_raw, columns, rows)
                _progress(on_progress, "visualization", "agent_complete", "Visualization agent prepared the chart options.")
            except Exception as visualization_exc:
                visualization = {
                    "agent": "visualization",
                    "status": "error",
                    "message": f"Visualization Agent request failed: {visualization_exc}",
                    "recommendation": {
                        "chart_type": None,
                        "x_key": None,
                        "y_keys": [],
                        "title": None,
                        "rationale": "",
                    },
                    "available_chart_types": [],
                    "x_columns": [],
                    "numeric_columns": [],
                }

        catalog_assets = data.get("catalog_assets") or []
        catalog_entries = [
            {
                "name": asset.get("name") or asset.get("fully_qualified_name") or str(index),
                "displayName": asset.get("display_name"),
                "fqn": asset.get("fully_qualified_name"),
                "system": "BigQuery",
                "location": asset.get("location"),
            }
            for index, asset in enumerate(catalog_assets)
            if isinstance(asset, dict)
        ]
        if gap_reply:
            data["knowledge_gap_agent"] = gap_reply
        error = summary if status in ("needs_information", "error") else None
        return {
            **reply,
            "response_type": "analysis",
            "question": req.question,
            "dataset_id": req.dataset_id,
            "data": data,
            "sql": sql,
            "columns": columns,
            "rows": rows,
            "row_count": data.get("row_count", len(rows)),
            "summary": summary,
            "key_findings": key_findings,
            "analysis": analysis,
            "catalog_entries": catalog_entries,
            "error": error,
            "agent_response": reply,
            "knowledge_gap_response": gap_reply,
            "visualization": visualization,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Conversational Analytics request failed: {exc}",
        ) from exc


@app.post("/ask")
def ask_question(req: QueryRequest):
    return _run_ask_and_persist(req)


def _run_ask_and_persist(req: QueryRequest, on_progress=None):
    result = _run_ask(req, on_progress=on_progress)
    if req.session_id and req.conversation_id and req.turn_id:
        try:
            save_turn(req.session_id, req.conversation_id, req.turn_id, req.turn_index, req.dataset_id, req.question, result)
            result["history_saved"] = True
        except Exception as exc:
            result["history_saved"] = False
            result["history_warning"] = f"The answer completed, but saving chat history failed: {exc}"
    return result


@app.post("/ask/stream")
def ask_question_stream(req: QueryRequest):
    return _sse_response(_run_ask_and_persist, req)


@app.get("/history")
def history_list(session_id: str, limit: int = 50):
    try:
        conversations = list_conversations(session_id, min(max(limit, 1), 100))
        return {"conversations": conversations}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not load chat history: {exc}") from exc


@app.get("/history/{conversation_id}")
def history_conversation(conversation_id: str, session_id: str):
    try:
        return {"conversation_id": conversation_id, "turns": get_conversation(session_id, conversation_id)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not load this conversation: {exc}") from exc


def _run_catalog_agent(req: KnowledgeCatalogRequest, on_progress=None):
    """Route catalog metadata questions and gap reviews through the saved Knowledge Gap agent."""
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    prompt = (
        "Act as the Knowledge Catalog Agent. Review the user's request for the selected dataset, "
        "identify metadata gaps or requested catalog improvements, and ground every conclusion in "
        "trusted source information available to you. If connected catalog write tools are available, "
        "apply only supported metadata updates requested by the user. If no write tool is available "
        "or a source is missing, return a proposed update and clearly state that it was not applied. "
        "Never claim an update succeeded unless the tool confirms it. Do not invent asset details. "
        "Return the configured JSON response format with status, message, and structured data such as "
        "gaps_found, affected_assets, updates_applied, proposed_updates, evidence, and follow_up.\n\n"
        "User request: " + question
    )
    if req.dataset_id:
        prompt += f"\nSelected BigQuery dataset: {req.dataset_id}. Keep the review scoped to this dataset."
    if req.session_id and req.conversation_id:
        try:
            previous = get_conversation(req.session_id, req.conversation_id)[-8:]
            if previous:
                context = [{"question": turn["question"], "answer": turn["result"].get("summary", "")} for turn in previous]
                prompt += "\n\nRecent turns in this conversation for context:\n" + json.dumps(context, ensure_ascii=False)
        except Exception as exc:
            _progress(on_progress, "supervisor", "agent_step", f"Could not load saved conversation context: {exc}")
    try:
        _progress(on_progress, "knowledge_gap", "agent_start", "Calling the Knowledge Catalog agent.")
        raw = call_data_agent("knowledge_gap", prompt, on_progress=on_progress)
        reply = _agent_json(raw, "knowledge_gap")
        _progress(on_progress, "knowledge_gap", "agent_complete", "Knowledge Catalog agent completed its review.")
        return {
            **reply,
            "question": question,
            "dataset_id": req.dataset_id,
            "data": reply.get("data") if isinstance(reply.get("data"), dict) else {},
            "agent_response": reply,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Knowledge Catalog Agent request failed: {exc}",
        ) from exc


@app.post("/catalog-agent")
def knowledge_catalog_agent(req: KnowledgeCatalogRequest):
    return _run_catalog_agent_and_persist(req)


@app.post("/catalog-agent/stream")
def knowledge_catalog_agent_stream(req: KnowledgeCatalogRequest):
    return _sse_response(_run_catalog_agent_and_persist, req)


def _run_catalog_agent_and_persist(req: KnowledgeCatalogRequest, on_progress=None):
    result = _run_catalog_agent(req, on_progress=on_progress)
    if req.session_id and req.conversation_id and req.turn_id:
        saved_result = {
            **result,
            "response_type": "catalog",
            "summary": result.get("message") or "The Knowledge Catalog agent completed its review.",
            "columns": [], "rows": [], "row_count": 0, "sql": None,
            "analysis": {"question_understanding": req.question, "approach": "Routed to the Knowledge Catalog agent for metadata review."},
            "visualization": None,
        }
        try:
            save_turn(req.session_id, req.conversation_id, req.turn_id, req.turn_index, req.dataset_id, req.question, saved_result)
            result["history_saved"] = True
        except Exception as exc:
            result["history_saved"] = False
            result["history_warning"] = f"The catalog review completed, but saving chat history failed: {exc}"
    return result

@app.get("/datasets")
def list_datasets():
    """List datasets visible to the configured BigQuery project credentials."""
    try:
        client = bigquery.Client(project=PROJECT_ID)
        datasets = [
            {"dataset_id": dataset.dataset_id}
            for dataset in client.list_datasets(page_size=100, timeout=10)
            if dataset.dataset_id != HISTORY_DATASET
        ]
        return {"project_id": client.project, "datasets": datasets}
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not list BigQuery datasets for project {PROJECT_ID}: {exc}",
        ) from exc

@app.get("/underwriting/intake-status")
def underwriting_intake_status():
    processor_configured = bool(os.getenv("DOCUMENT_AI_PROCESSOR", "").strip())
    bucket_configured = bool(os.getenv("UNDERWRITING_DOCUMENT_BUCKET", "").strip())
    return {
        "ready": processor_configured and bucket_configured,
        "document_ai_configured": processor_configured,
        "private_document_bucket_configured": bucket_configured,
        "product_rules_configured": False,
        "approved_risk_model_configured": False,
        "approved_rate_table_configured": False,
    }


@app.get("/underwriting/cases/{application_id}/documents/{document_id}/source")
def underwriting_document_source(application_id: str, document_id: str):
    """Read a source file through the authenticated Cloud Run service."""
    case = health_underwriting.get_case(application_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    document = next((item for item in case.get("documents", []) if item.get("document_id") == document_id), None)
    if not document:
        raise HTTPException(status_code=404, detail="Source document not found.")
    bucket_name = os.getenv("UNDERWRITING_DOCUMENT_BUCKET", "").strip()
    uri = document.get("object_uri", "")
    prefix = f"gs://{bucket_name}/applications/{application_id}/" if bucket_name else ""
    if not prefix or not uri.startswith(prefix):
        raise HTTPException(status_code=404, detail="Source document is unavailable.")
    object_name = uri[len(f"gs://{bucket_name}/"):]
    try:
        from google.cloud import storage
        content = storage.Client().bucket(bucket_name).blob(object_name).download_as_bytes()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not retrieve the source document: {exc}") from exc
    filename = os.path.basename(str(document.get("name", "application-document")).replace("\\", "/"))
    filename = "".join(char for char in filename if char not in "\r\n\"" and ord(char) >= 32)[:180] or "application-document"
    mime_type = document.get("mime_type") if document.get("mime_type") in ALLOWED_MIME_TYPES else "application/octet-stream"
    return Response(content=content, media_type=mime_type, headers={
        "Content-Disposition": f'inline; filename="{filename}"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    })


@app.post("/underwriting/applications")
async def create_underwriting_application(
    applicant_name: str = Form(..., min_length=2, max_length=200),
    date_of_birth: str = Form(...),
    product_code: str = Form(..., min_length=1, max_length=80),
    product_name: str = Form(..., min_length=1, max_length=200),
    insurance_type: str = Form(default="health"),
    selected_policy_id: str = Form(default=""),
    sum_assured_inr: str = Form(default=""),
    term_years: str = Form(default=""),
    tobacco_status: str = Form(default="UNKNOWN"),
    medical_class: str = Form(default="PENDING"),
    occupation_class: str = Form(default="SPECIALIST_REVIEW"),
    payment_frequency: str = Form(default="ANNUAL"),
    email: str = Form(default="", max_length=320),
    consent_confirmed: bool = Form(default=False),
    files: list[UploadFile] = File(...),
):
    if not consent_confirmed:
        raise HTTPException(status_code=400, detail="Confirm that the applicant has authorized processing of the submitted documents.")
    try:
        insurance_type = policy_library.normalize_type(insurance_type)
        if selected_policy_id:
            selected_policy = policy_library.get_policy(selected_policy_id)
            if not selected_policy or selected_policy.get("policy_kind") != "company" or selected_policy.get("status") not in {"active", "illustrative"}:
                raise ValueError("Choose an active or explicitly illustrative company policy.")
            if selected_policy.get("insurance_type") != insurance_type:
                raise ValueError("The selected policy must match the application's insurance type.")
            policy_product_code = (selected_policy.get("product_code") or "").strip().upper()
            if policy_product_code and policy_product_code != product_code.strip().upper():
                raise ValueError("The selected policy must match the application's product code.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not validate the selected company policy: {exc}") from exc
    if not files or len(files) > 10:
        raise HTTPException(status_code=400, detail="Upload between one and ten application documents.")
    prepared = []
    for upload in files:
        mime_type = upload.content_type or "application/octet-stream"
        if mime_type not in ALLOWED_MIME_TYPES:
            raise HTTPException(status_code=415, detail=f"Unsupported file type for {upload.filename}. Use PDF, JPEG, PNG, or TIFF.")
        content = await upload.read(MAX_DOCUMENT_BYTES + 1)
        if len(content) > MAX_DOCUMENT_BYTES:
            raise HTTPException(status_code=413, detail=f"{upload.filename} exceeds the 20 MB per-file limit.")
        prepared.append({"filename": upload.filename or "application document", "mime_type": mime_type, "content": content})
    try:
        premium_inputs = {
            "sum_assured_inr": sum_assured_inr,
            "term_years": term_years,
            "tobacco_status": tobacco_status,
            "medical_class": medical_class,
            "occupation_class": occupation_class,
            "payment_frequency": payment_frequency,
        } if insurance_type == "life" else None
        case = health_underwriting.create_application_case(applicant_name, date_of_birth, product_code, product_name, email, prepared, consent_confirmed=consent_confirmed, insurance_type=insurance_type, selected_policy_id=selected_policy_id, premium_inputs=premium_inputs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        message = str(exc)
        code = 503 if "Configure" in message or "Set GCP_PROJECT" in message else 502
        raise HTTPException(status_code=code, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not process and save the application: {exc}") from exc
    return case


@app.get("/underwriting/policies")
def underwriting_policies(insurance_type: str | None = None, policy_kind: str | None = None):
    try:
        return {"policies": policy_library.list_policies(insurance_type, policy_kind)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not load policy library: {exc}") from exc


@app.post("/underwriting/policies/analyze")
async def analyze_underwriting_policy_source(
    insurance_type: str = Form(...),
    file: UploadFile = File(...),
):
    content = await file.read(policy_library.MAX_POLICY_BYTES + 1)
    try:
        return await run_in_threadpool(policy_library.analyze_policy_source,
            filename=file.filename or "policy-source.txt",
            mime_type=file.content_type or "application/octet-stream",
            content=content,
            insurance_type=insurance_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not analyze policy source: {exc}") from exc


@app.post("/underwriting/policies/delete")
def delete_underwriting_policies(req: PolicyDeleteRequest):
    try:
        return policy_library.delete_policies(req.policy_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Could not delete the selected policies. Refresh the library and retry.") from exc


@app.post("/underwriting/policies")
async def add_underwriting_policy(
    policy_name: str = Form(..., min_length=2, max_length=200),
    insurance_type: str = Form(...),
    policy_kind: str = Form(...),
    insurer_name: str = Form(default="", max_length=200),
    product_name: str = Form(default="", max_length=200),
    product_code: str = Form(default="", max_length=80),
    uin: str = Form(default="", max_length=100),
    version: str = Form(default="", max_length=80),
    effective_from: str = Form(default=""),
    effective_to: str = Form(default=""),
    extracted_rules_json: str = Form(default=""),
    extraction_model: str = Form(default=""),
    file: UploadFile = File(...),
):
    content = await file.read(policy_library.MAX_POLICY_BYTES + 1)
    try:
        extracted_rules = json.loads(extracted_rules_json) if extracted_rules_json else None
        if extracted_rules is not None and not isinstance(extracted_rules, dict):
            raise ValueError("Suggested policy analysis must be a JSON object.")
        return await run_in_threadpool(policy_library.add_policy,
            policy_name=policy_name, insurance_type=insurance_type, policy_kind=policy_kind,
            filename=file.filename or "policy.txt", mime_type=file.content_type or "application/octet-stream",
            content=content, insurer_name=insurer_name, product_name=product_name,
            product_code=product_code, uin=uin, version=version,
            effective_from=effective_from or None, effective_to=effective_to or None,
            extracted_rules_override=extracted_rules,
            extraction_model_override=extraction_model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not store or extract policy: {exc}") from exc


@app.get("/underwriting/policies/{policy_id}/source")
def underwriting_policy_source(policy_id: str):
    try:
        result = policy_library.read_policy_source(policy_id)
        if not result:
            raise HTTPException(status_code=404, detail="Policy source not found.")
        policy, content = result
        filename = "".join(char for char in policy.get("source_filename", "policy-source.txt") if char not in '\r\n"')
        return Response(
            content=content,
            media_type=policy.get("source_mime_type") or "application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename or "policy-source.txt"}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not retrieve the policy source: {exc}") from exc


@app.get("/underwriting/cases")
def underwriting_cases():
    try:
        return {"storage_mode": "bigquery", "dataset_id": health_underwriting.DATASET_ID, "cases": health_underwriting.list_cases()}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not load the underwriting dataset {health_underwriting.DATASET_ID}: {exc}") from exc

@app.get("/underwriting/cases/{application_id}")
def underwriting_case(application_id: str):
    try:
        case = health_underwriting.get_case(application_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not read the underwriting case: {exc}") from exc
    if case is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    return case

@app.post("/underwriting/cases/{application_id}/actions")
def underwriting_action(application_id: str, req: UnderwritingActionRequest):
    lock = pipeline_service.case_lock(application_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Wait for the running pipeline to reach a checkpoint before recording an action.")
    try:
        case = health_underwriting.update_case(application_id, req.action, req.reason)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not record the review action in BigQuery: {exc}") from exc
    finally:
        lock.release()
    if case is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    return case


@app.post("/underwriting/cases/{application_id}/pipeline/run/stream")
def run_application_pipeline(application_id: str, req: PipelineRunRequest):
    def run(payload, on_progress):
        try:
            return pipeline_service.execute_pipeline(application_id, payload.model_dump(), on_progress)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _sse_response(run, req)

@app.post("/underwriting/cases/{application_id}/workflow/{step_id}")
def underwriting_workflow_step(application_id: str, step_id: str, req: UnderwritingStepRequest):
    try:
        result = health_underwriting.run_workflow_step(application_id, step_id, req.confirm, req.attestation, req.result_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Underwriting review agent could not complete this step: {exc}") from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    return result


@app.put("/underwriting/cases/{application_id}/policies")
def select_application_policies(application_id: str, req: CasePolicySelectionRequest):
    try:
        case = health_underwriting.save_case_policies(application_id, req.policy_ids, req.primary_policy_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not save application policies: {exc}") from exc
    if case is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    return case


@app.post("/underwriting/cases/{application_id}/pipeline/start")
def start_underwriting_pipeline(application_id: str):
    try:
        case = health_underwriting.start_pipeline(application_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not start underwriting: {exc}") from exc
    if case is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    return case

@app.get("/underwriting/metrics")
def underwriting_metrics():
    try:
        return {"dataset_id": health_underwriting.DATASET_ID, **health_underwriting.portfolio_metrics()}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not read BigQuery portfolio metrics: {exc}") from exc

@app.get("/datasets/{dataset_id}/context")
def dataset_context(dataset_id: str):
    """Return real BigQuery table metadata and schema-based starter questions."""
    try:
        client = bigquery.Client(project=PROJECT_ID)
        dataset = client.get_dataset(f"{client.project}.{dataset_id}")
        tables = list(client.list_tables(dataset.reference, timeout=15))
        schemas = []
        for table_ref in tables[:40]:
            try:
                table = client.get_table(table_ref.reference)
            except Exception:
                continue
            fields = [
                {"name": field.name, "type": field.field_type}
                for field in table.schema
                if field.field_type.upper() not in {"RECORD", "STRUCT"}
            ]
            schemas.append({"name": table.table_id, "fields": fields})

        def readable(value: str) -> str:
            return value.replace("_", " ").strip()

        questions = []
        seen = set()

        def add_question(label: str, description: str, question: str, kind: str):
            if question not in seen and len(questions) < 3:
                seen.add(question)
                questions.append({"label": label, "description": description, "question": question, "kind": kind})

        for table in schemas:
            fields = table["fields"]
            numeric = [field["name"] for field in fields if field["type"].upper() in {"INTEGER", "INT64", "FLOAT", "FLOAT64", "NUMERIC", "BIGNUMERIC"}]
            temporal = [field["name"] for field in fields if field["type"].upper() in {"DATE", "DATETIME", "TIMESTAMP"} or any(word in field["name"].lower() for word in ("date", "time", "month", "year"))]
            categorical = [field["name"] for field in fields if field["name"] not in numeric and field["name"] not in temporal and field["type"].upper() not in {"BOOLEAN", "BOOL"}]
            table_name = readable(table["name"])
            if temporal and numeric:
                add_question(
                    f"Trend in {readable(numeric[0])}",
                    "See how a metric changes over time.",
                    f"How has {readable(numeric[0])} changed over {readable(temporal[0])} in {table_name}?",
                    "trend",
                )
            if categorical and numeric:
                add_question(
                    f"Compare by {readable(categorical[0])}",
                    "Compare a measure across real data groups.",
                    f"Compare {readable(numeric[0])} across {readable(categorical[0])} in {table_name}.",
                    "compare",
                )
            if categorical:
                add_question(
                    f"Break down {readable(categorical[0])}",
                    "Find the most common category values.",
                    f"What are the most common {readable(categorical[0])} values in {table_name}?",
                    "breakdown",
                )
            if numeric:
                add_question(
                    f"Explore {readable(numeric[0])}",
                    "Surface the records with the largest values.",
                    f"Which records in {table_name} have the highest {readable(numeric[0])}?",
                    "explore",
                )
            add_question(
                f"Explore {table_name}",
                "Get a quick count of the records.",
                f"How many records are in {table_name}?",
                "count",
            )
            add_question(
                f"Preview {table_name}",
                "Inspect a small sample of the data.",
                f"Show a sample of 10 records from {table_name}.",
                "preview",
            )
            add_question(
                f"Review {table_name}",
                "Explore the real fields and their data types.",
                f"What fields and data types are available in {table_name}?",
                "schema",
            )
            if len(questions) == 3:
                break

        return {
            "project_id": client.project,
            "dataset_id": dataset.dataset_id,
            "table_count": len(tables),
            "tables_scanned": len(schemas),
            "suggested_questions": questions,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not read BigQuery metadata for {PROJECT_ID}.{dataset_id}: {exc}",
        ) from exc

@app.post("/search")
def search_catalog(req: SearchRequest):
    """Search the Knowledge Catalog for data assets."""
    entries = search_entries(
        req.query,
        req.page_size,
        dataset_id=req.dataset_id,
    )
    entry_info = extract_entry_info(entries)
    if req.dataset_id:
        entry_info = [
            entry
            for entry in entry_info
            if entry["fqn"].startswith(f"bigquery:{PROJECT_ID}.{req.dataset_id}.")
        ]
    return {"entries": entry_info}

@app.post("/visualize")
def visualize_results(req: VisualizationRequest):
    """Route chart recommendations through the saved visualization agent."""
    if not req.columns or not req.rows:
        raise HTTPException(status_code=400, detail="Columns and result rows are required.")
    prompt = (
        "Return the configured JSON chart recommendation. Use only these query results.\n"
        + "Question: " + req.question
        + "\nColumns: " + json.dumps(req.columns)
        + "\nRows: " + json.dumps(req.rows, default=str)
    )
    try:
        raw = call_data_agent("visualization", prompt)
        reply = _agent_json(raw, "visualization")
        data = reply.get("data") if isinstance(reply.get("data"), dict) else {}
        recommendation = data.get("recommendation") if isinstance(data.get("recommendation"), dict) else data
        numeric_columns = [
            column for column in req.columns
            if any(isinstance(row.get(column), (int, float)) and not isinstance(row.get(column), bool) for row in req.rows)
        ]
        x_columns = [column for column in req.columns if column not in numeric_columns]
        chart_type = recommendation.get("chart_type")
        x_key = recommendation.get("x_key")
        y_keys = recommendation.get("y_keys", [])
        if chart_type not in {"bar", "line", "area", "pie", "scatter", "radar"}:
            chart_type = None
        if x_key not in req.columns:
            x_key = None
        if not isinstance(y_keys, list):
            y_keys = []
        y_keys = [key for key in y_keys if key in numeric_columns]
        normalized = {
            "chart_type": chart_type,
            "x_key": x_key,
            "y_keys": y_keys,
            "title": recommendation.get("title"),
            "rationale": recommendation.get("rationale") or reply.get("message", ""),
        }
        available_chart_types = []
        if x_columns and numeric_columns:
            available_chart_types = ["bar", "line", "area"]
            if len(req.rows) <= 12:
                available_chart_types.append("pie")
            if len(numeric_columns) >= 2:
                available_chart_types.extend(["scatter", "radar"])
        elif len(numeric_columns) >= 2:
            available_chart_types = ["scatter", "bar"]
        return {
            "agent": "visualization",
            "status": reply.get("status", "success"),
            "message": reply.get("message", ""),
            "recommendation": normalized,
            "available_chart_types": data.get("available_chart_types") or available_chart_types,
            "x_columns": x_columns,
            "numeric_columns": numeric_columns,
            "agent_response": reply,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Visualization agent request failed: {exc}",
        ) from exc

@app.get("/health")
def health():
    return {"status": "ok"}


# In production the frontend is built into the same container and served by
# FastAPI. Local development continues to use Vite's dev server and proxy.
_frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
