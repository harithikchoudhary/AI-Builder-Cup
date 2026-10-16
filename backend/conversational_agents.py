import os
from dotenv import load_dotenv
from functools import lru_cache

from google.api_core import client_options
from google.cloud import geminidataanalytics


load_dotenv()

LOCATION = "global"
AGENT_PROJECT_ID = os.environ.get("CONVERSATIONAL_API_PROJECT_ID", "project-b222a5e1-4bfe-4261-a4e").strip()
AGENTS = {
    "data_analyst": os.environ.get("SQL_DATA_AGENT_ID", "agent_a5c56f7c-56a2-4fab-a88e-ff7aa98decae").strip(),
    "visualization": os.environ.get("VISUALIZATION_DATA_AGENT_ID", "agent_39ff0a49-d5bf-497b-8787-5c0884f45a55").strip(),
}


@lru_cache(maxsize=1)
def _data_chat_client():
    options = client_options.ClientOptions(api_endpoint="geminidataanalytics.googleapis.com")
    return geminidataanalytics.DataChatServiceClient(client_options=options)


def _message_text(text_message):
    return "".join(str(part) for part in getattr(text_message, "parts", []))


def _json_from_text(text):
    import json
    if not text:
        return None
    candidate = text.strip()
    try:
        value = json.loads(candidate)
        return value if isinstance(value, dict) else None
    except ValueError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start >= 0 and end > start:
            try:
                value = json.loads(candidate[start:end + 1])
                return value if isinstance(value, dict) else None
            except ValueError:
                return None
    return None


def call_data_agent(agent_key, prompt, on_progress=None):
    agent_id = AGENTS.get(agent_key)
    if not agent_id:
        raise ValueError(f"No agent ID is configured for {agent_key}.")

    parent = f"projects/{AGENT_PROJECT_ID}/locations/{LOCATION}"
    message = geminidataanalytics.Message()
    message.user_message.text = prompt
    agent_context = geminidataanalytics.DataAgentContext()
    agent_context.data_agent = f"{parent}/dataAgents/{agent_id}"
    request = geminidataanalytics.ChatRequest(
        parent=parent,
        messages=[message],
        data_agent_context=agent_context,
    )

    final_texts = []
    generated_sql = None
    columns = []
    rows = []
    for response in _data_chat_client().chat(request=request, timeout=300):
        system_message = response.system_message
        if "analysis" in system_message:
            event = system_message.analysis.progress_event
            progress_steps = (
                ("planner_reasoning", "Analyzing the request and planning the next step."),
                ("coder_instruction", "Preparing the query instructions."),
                ("code", "Building the query."),
                ("execution_output", "Running the query against BigQuery."),
                ("execution_error", "Reviewing a query execution issue."),
                ("result_csv_data", "Processing the returned rows."),
                ("result_natural_language", "Summarizing the results."),
                ("result_reference_data", "Checking the result data."),
                ("error", "The agent reported an execution issue."),
            )
            for field_name, message_text in progress_steps:
                if getattr(event, field_name, "") and on_progress:
                    on_progress({"agent": agent_key, "kind": "agent_step", "message": message_text})
                    break
        elif "text" in system_message:
            text_message = system_message.text
            text_type = getattr(text_message, "text_type", None)
            try:
                type_name = geminidataanalytics.TextMessage.TextType(text_type).name
            except (AttributeError, TypeError, ValueError):
                type_name = str(text_type)
            if type_name.endswith("FINAL_RESPONSE"):
                final_texts.append(_message_text(text_message))
        elif "data" in system_message:
            data_message = system_message.data
            if "generated_sql" in data_message:
                generated_sql = data_message.generated_sql
                if generated_sql and on_progress:
                    on_progress({"agent": agent_key, "kind": "tool_step", "message": "SQL generated; preparing BigQuery execution."})
            if "result" in data_message:
                result = data_message.result
                columns = [field.name for field in result.schema.fields]
                rows = [dict(row) for row in result.data]
                if on_progress:
                    on_progress({"agent": agent_key, "kind": "tool_step", "message": f"BigQuery returned {len(rows)} rows."})
        elif "chart" in system_message and on_progress:
            on_progress({"agent": agent_key, "kind": "agent_step", "message": "Preparing chart recommendations."})
        elif "schema" in system_message and on_progress:
            on_progress({"agent": agent_key, "kind": "tool_step", "message": "Inspecting available data fields."})

    answer_text = "\n".join(text for text in final_texts if text).strip()
    return {
        "agent": agent_key,
        "agent_id": agent_id,
        "text": answer_text,
        "agent_json": _json_from_text(answer_text),
        "sql": generated_sql,
        "columns": columns,
        "rows": rows,
    }
