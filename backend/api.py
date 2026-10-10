import json
from pathlib import Path
from queue import Empty, Queue
from threading import Thread

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .conversational_agents import call_data_agent
from .mcp_tools import PROJECT_ID, search_entries, extract_entry_info
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

class SearchRequest(BaseModel):
    query: str
    page_size: int = 10
    dataset_id: str | None = None

class KnowledgeCatalogRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    dataset_id: str | None = None

class VisualizationRequest(BaseModel):
    question: str = Field(max_length=1000)
    columns: list[str] = Field(max_length=50)
    rows: list[dict] = Field(max_length=200)


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


def _run_ask(req: QueryRequest, on_progress=None):
    """Route analysis through the saved SQL agent and resolve catalog gaps when reported."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    prompt = (
        "Answer the user's data question using the configured JSON response format. "
        "Include a data.analysis object with question_understanding, approach, data_scope, "
        "transformations, result_interpretation, and assumptions_and_limitations. Give a concise, "
        "auditable explanation of the method and findings grounded in the executed SQL and returned "
        "rows; do not provide private chain-of-thought or unsupported claims. Keep SQL, columns, and "
        "rows in their existing data fields.\n\nUser question: " + req.question.strip()
    )
    if req.dataset_id:
        prompt += f"\n\nSelected BigQuery dataset: {req.dataset_id}. Restrict analysis to this dataset."
    try:
        _progress(on_progress, "data_analyst", "agent_start", "Calling the SQL generation agent.")
        raw = call_data_agent("data_analyst", prompt, on_progress=on_progress)
        reply = _agent_json(raw, "data_analyst")
        _progress(on_progress, "data_analyst", "agent_complete", "SQL agent returned its analysis and query results.")
        status = reply.get("status", "success")
        data = reply.get("data") if isinstance(reply.get("data"), dict) else {}
        summary = reply.get("message") or raw.get("text") or ""
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
            "question": req.question,
            "dataset_id": req.dataset_id,
            "data": data,
            "sql": sql,
            "columns": columns,
            "rows": rows,
            "row_count": data.get("row_count", len(rows)),
            "summary": summary,
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
    return _run_ask(req)


@app.post("/ask/stream")
def ask_question_stream(req: QueryRequest):
    return _sse_response(_run_ask, req)


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
    return _run_catalog_agent(req)


@app.post("/catalog-agent/stream")
def knowledge_catalog_agent_stream(req: KnowledgeCatalogRequest):
    return _sse_response(_run_catalog_agent, req)

@app.get("/datasets")
def list_datasets():
    """List datasets visible to the configured BigQuery project credentials."""
    try:
        client = bigquery.Client(project=PROJECT_ID)
        datasets = [
            {"dataset_id": dataset.dataset_id}
            for dataset in client.list_datasets(page_size=100, timeout=10)
        ]
        return {"project_id": client.project, "datasets": datasets}
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not list BigQuery datasets for project {PROJECT_ID}: {exc}",
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
