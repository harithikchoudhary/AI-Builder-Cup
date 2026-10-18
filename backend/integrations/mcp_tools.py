import json
import os
import requests
import google.auth
from dotenv import load_dotenv
from google.auth.transport.requests import Request as AuthRequest

load_dotenv()
PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "").strip()
if not PROJECT_ID:
    raise RuntimeError("Set GCP_PROJECT_ID in the project root .env or environment.")
MCP_ENDPOINT = "https://dataplex.googleapis.com/mcp"

_cached_token = None

def _get_token():
    global _cached_token
    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    credentials.refresh(AuthRequest())
    _cached_token = credentials.token
    return _cached_token

def _call_mcp(method: str, params: dict = None):
    token = _get_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Goog-User-Project": PROJECT_ID,
    }
    payload = {"jsonrpc": "2.0", "method": method, "params": params or {}, "id": 1}
    resp = requests.post(MCP_ENDPOINT, json=payload, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()

def search_entries(
    query: str, page_size: int = 10, dataset_id: str | None = None
) -> list[dict]:
    """Search Knowledge Catalog for data assets matching the query."""
    scoped_query = f"{dataset_id} {query}" if dataset_id else query
    result = _call_mcp("tools/call", {
        "name": "search_entries",
        "arguments": {
            "query": scoped_query,
            "projectId": PROJECT_ID,
            "pageSize": min(max(page_size, 1), 1000),
        },
    })
    content = result.get("result", {}).get("content", [])
    entries = []
    for item in content:
        try:
            parsed = json.loads(item.get("text", "{}"))
            entries.extend(parsed.get("results", []))
        except json.JSONDecodeError:
            pass
    # Also check structuredContent
    structured = result.get("result", {}).get("structuredContent", {})
    if structured and not entries:
        entries = structured.get("results", [])
    return entries

def lookup_context(entry_names: list[str], location: str = "us") -> str:
    """Get LLM-ready schema context for the given catalog entry names."""
    result = _call_mcp("tools/call", {
        "name": "lookup_context",
        "arguments": {
            "projectId": PROJECT_ID,
            "location": location,
            "resources": entry_names[:10],
        },
    })
    content = result.get("result", {}).get("content", [])
    parts = []
    for item in content:
        text = item.get("text", "")
        try:
            parsed = json.loads(text)
            parts.append(parsed.get("context", text))
        except json.JSONDecodeError:
            parts.append(text)
    return "\n".join(parts)

def extract_entry_info(entries: list[dict]) -> list[dict]:
    """Extract name, display name, FQN, and location from search results."""
    info = []
    for entry in entries:
        dp = entry.get("dataplexEntry", {})
        src = dp.get("entrySource", {})
        name = dp.get("name", "")
        # Derive location from entry name
        loc = "us"
        parts = name.split("/")
        if "locations" in parts:
            idx = parts.index("locations") + 1
            if idx < len(parts):
                loc = parts[idx]
        info.append({
            "name": name,
            "displayName": src.get("displayName", ""),
            "fqn": dp.get("fullyQualifiedName", ""),
            "resource": src.get("resource", ""),
            "location": loc,
            "system": src.get("system", ""),
        })
    return info
