# Insurance Knowledge Catalog SQL Agent

This application routes natural-language analysis, visualization, and catalog-gap requests to three saved Google Cloud Conversational Analytics Data Agents. The backend invokes the agents through the Gemini Data Analytics API using Application Default Credentials.

## Architecture

The React/Vite UI sends questions to FastAPI. FastAPI invokes saved Data Agents through the Gemini Data Analytics API: SQL analysis uses the first agent, chart recommendations use the second, and catalog gaps use the third. The catalog explorer still searches Google Knowledge Catalog through the Dataplex MCP endpoint.

## Request Flow

1. The UI sends a natural-language question to POST /ask, including the selected dataset when available.
2. FastAPI calls the saved SQL/Data Analyst agent using Application Default Credentials.
3. FastAPI passes the SQL agent's structured response, SQL, columns, and result rows to the Visualization agent.
4. If the SQL agent reports a catalog or schema gap, FastAPI calls the Knowledge Gap agent instead of charting missing results.
5. The UI displays the result table followed by up to four chart cards together on the same page; it does not switch to a separate chart tab.

GET /datasets still lists BigQuery datasets for the project configured in GCP_PROJECT_ID. The selected dataset is included in the SQL agent prompt; the configured agent must have access to that dataset and follow the scope instruction.

## Components

- backend/conversational_agents.py: authenticated Conversational Analytics SDK client and saved agent configuration.
- backend/api.py: FastAPI routes for analysis, catalog search, visualization, dataset listing, and health.
- backend/mcp_tools.py: authenticated Google Knowledge Catalog MCP client used by the catalog explorer.
- backend/sql_agent.py and backend/visualization_agent.py: legacy local agent implementations, no longer used by the ask and visualize routes.
- frontend/: Vite and React UI with Tailwind CSS, Lucide icons, and Recharts.
- .env: project configuration and optional ADC credential path; keep private and out of source control.

## Requirements

- Python 3.12+
- Google Cloud Application Default Credentials with access to the Conversational Analytics agents and their configured BigQuery sources.
- The Google Gemini Data Analytics API enabled in the agent project.
- GCP_PROJECT_ID set for the BigQuery dataset picker and catalog explorer.
- CONVERSATIONAL_API_PROJECT_ID set if the saved agents are in a different project than the default configured in the backend.

Install packages in the project's virtual environment:

```powershell
cd "C:\Deloitte-Project\GCP-Knowledge catalog"
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Set `.env`:

```text
GCP_PROJECT_ID=your-gcp-project-id
```

For local user credentials, install the Google Cloud CLI and run `gcloud auth application-default login`. Set the quota project with `gcloud auth application-default set-quota-project YOUR_GCP_PROJECT_ID` if required for API billing. Changing the active `gcloud` project alone does not change ADC credentials or this app's project ID.

Alternatively, for a service account, add `GOOGLE_APPLICATION_CREDENTIALS=C:/path/outside/repository/service-account.json` to the root `.env`. Use an absolute path to a credential file outside this repository; never commit credential JSON. Grant the chosen identity access to Knowledge Catalog and BigQuery in the target project. Restart the backend after changing `.env` or ADC credentials.

## Run Locally

Start the backend and frontend in separate terminals.
Keep `.env` at the project root. Import the API as `backend.api`, not `api`, so its package-relative imports work.

### FastAPI backend

```powershell
$env:NO_PROXY = "127.0.0.1,localhost"
.\.venv\Scripts\python.exe -m uvicorn backend.api:app --host 127.0.0.1 --port 8002
```

If your terminal is already in `backend` with `.venv` activated, run:

```cmd
uvicorn backend.api:app --app-dir .. --host 127.0.0.1 --port 8002
```

API documentation: `http://127.0.0.1:8002/docs`.

### React frontend

```cmd
cd frontend
npm.cmd install
npm.cmd run dev
```

Open the Vite URL printed in the terminal, usually `http://127.0.0.1:5173`.


## Saved Conversational Analytics Agents

The configured agent resource IDs are:

- Data Analyst / SQL: agent_a5c56f7c-56a2-4fab-a88e-ff7aa98decae
- Visualization / Chart: agent_39ff0a49-d5bf-497b-8787-5c0884f45a55
- Knowledge Gap: agent_047d8eb3-e02c-44f3-bf69-bb06b883796f

The agent project defaults to project-b222a5e1-4bfe-4261-a4e. Override the defaults with CONVERSATIONAL_API_PROJECT_ID, SQL_DATA_AGENT_ID, VISUALIZATION_DATA_AGENT_ID, and KNOWLEDGE_GAP_DATA_AGENT_ID if needed.

The runtime identity needs access to all three agents and their configured BigQuery sources. Enable the Gemini Data Analytics API in the Conversational Analytics project, configure Google Application Default Credentials, and restart the backend after changing the environment.
