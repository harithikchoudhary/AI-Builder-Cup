"""BigQuery persistence for browser-scoped Intentra conversations."""

import json
import os
from datetime import datetime, timezone
from functools import lru_cache
from threading import Lock

from google.api_core.exceptions import NotFound
from google.cloud import bigquery

from backend.integrations.mcp_tools import PROJECT_ID


HISTORY_DATASET = os.environ.get("CHAT_HISTORY_DATASET", "intentra_chat_history").strip()
HISTORY_TABLE = os.environ.get("CHAT_HISTORY_TABLE", "conversation_turns").strip()
HISTORY_LOCATION = os.environ.get("CHAT_HISTORY_LOCATION", "US").strip()
_table_lock = Lock()


@lru_cache(maxsize=1)
def _client():
    return bigquery.Client(project=PROJECT_ID)


def _table(create=True):
    client = _client()
    table_id = f"{client.project}.{HISTORY_DATASET}.{HISTORY_TABLE}"
    try:
        client.get_dataset(HISTORY_DATASET)
    except NotFound:
        if not create:
            return None
        with _table_lock:
            try:
                client.get_dataset(HISTORY_DATASET)
            except NotFound:
                dataset = bigquery.Dataset(f"{client.project}.{HISTORY_DATASET}")
                dataset.location = HISTORY_LOCATION
                client.create_dataset(dataset, exists_ok=True)
    try:
        return client.get_table(table_id)
    except NotFound:
        if not create:
            return None
    with _table_lock:
        try:
            return client.get_table(table_id)
        except NotFound:
            schema = [
                bigquery.SchemaField("session_id", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("conversation_id", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("turn_id", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("turn_index", "INT64", mode="REQUIRED"),
                bigquery.SchemaField("dataset_id", "STRING"),
                bigquery.SchemaField("question", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("response_json", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED"),
            ]
            table = bigquery.Table(table_id, schema=schema)
            table.time_partitioning = bigquery.TimePartitioning(
                type_=bigquery.TimePartitioningType.DAY,
                field="created_at",
            )
            table.clustering_fields = ["session_id", "conversation_id"]
            return client.create_table(table, exists_ok=True)


def save_turn(session_id, conversation_id, turn_id, turn_index, dataset_id, question, response):
    table = _table()
    errors = _client().insert_rows_json(table, [{
        "session_id": session_id,
        "conversation_id": conversation_id,
        "turn_id": turn_id,
        "turn_index": turn_index,
        "dataset_id": dataset_id,
        "question": question,
        "response_json": json.dumps(response, default=str, ensure_ascii=False),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }], row_ids=[turn_id])
    if errors:
        raise RuntimeError(f"BigQuery rejected chat history row: {errors}")


def list_conversations(session_id, limit=50):
    _table()
    query = f"""
        SELECT conversation_id,
               ARRAY_AGG(STRUCT(turn_index, question, created_at) ORDER BY turn_index DESC LIMIT 1)[OFFSET(0)] AS latest,
               COUNT(*) AS turn_count,
               MAX(created_at) AS updated_at,
               ANY_VALUE(dataset_id) AS dataset_id
        FROM `{PROJECT_ID}.{HISTORY_DATASET}.{HISTORY_TABLE}`
        WHERE session_id = @session_id
        GROUP BY conversation_id
        ORDER BY updated_at DESC
        LIMIT {int(limit)}
    """
    config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("session_id", "STRING", session_id),
    ])
    conversations = []
    for row in _client().query(query, job_config=config).result():
        latest = row.latest
        conversations.append({
            "conversation_id": row.conversation_id,
            "question": latest.question,
            "turn_index": latest.turn_index,
            "turn_count": row.turn_count,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "dataset_id": row.dataset_id,
        })
    return conversations


def get_conversation(session_id, conversation_id):
    _table()
    query = f"""
        SELECT turn_id, turn_index, dataset_id, question, response_json, created_at
        FROM `{PROJECT_ID}.{HISTORY_DATASET}.{HISTORY_TABLE}`
        WHERE session_id = @session_id AND conversation_id = @conversation_id
        ORDER BY turn_index
    """
    config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("session_id", "STRING", session_id),
        bigquery.ScalarQueryParameter("conversation_id", "STRING", conversation_id),
    ])
    turns = []
    for row in _client().query(query, job_config=config).result():
        turns.append({
            "id": row.turn_id,
            "turn_index": row.turn_index,
            "dataset_id": row.dataset_id,
            "question": row.question,
            "result": json.loads(row.response_json),
            "created_at": row.created_at.isoformat() if row.created_at else None,
        })
    return turns

