# Insurance Knowledge Catalog SQL Agent

## Employee application inbox and policy setup

The employee workspace opens on Applications. Received records are marked **Ready for underwriting**. Open a record to inspect its details and source documents, switch to Underwriting pipeline, and select policies before starting. The policy library keeps the application's insurance type fixed and offers company policies matching its product code plus regulatory sources for its insurance type. Policies can be uploaded and reviewed from the same screen.

### Automatic underwriting pipeline

Start the pipeline once to run the saved stages automatically. It pauses for employee verification of source-document values, a combined review of policy evidence and medical findings, or a blocking information gap. A checkpoint requires a review note and confirmation before resuming. Request-information and specialist-referral actions are available at checkpoints. Stage results, review notes, policy versions and workflow progress are saved in BigQuery review events; the browser receives live progress over the pipeline SSE endpoint. Reopening an active run refreshes its saved progress.

The final decision dashboard brings together application and health details, selected policy versions, rule-by-rule evidence observations, risk evidence, pricing output, unresolved requirements and the recommendation. Evidence matches are not compliance passes. Missing risk models or supported product rate configurations stay unresolved; the application never invents a score or premium. Approval and decline require an employee action and rationale after the pipeline finishes. Existing saved step reviews are preserved when continuing with the automatic flow.

Policy import follows **Upload & analyze → Review & edit → Add to policy library**. PDF, TXT, Markdown, and JSON uploads all use Gemini analysis. Structured JSON bundles preserve every policy and original rule, including conditions, actions, evidence requirements, and source pointers; Gemini supplies explanations and review questions. The review table supports editing metadata and rules, adding missing entries, removing rules, and excluding policies. Nothing is saved during analysis. Adding selected drafts stores the reviewed content and original source without regenerating it. Fictional catalogs retain their illustrative status. If Gemini is unavailable or a source exceeds the analysis limit, the upload reports an error rather than presenting a completed analysis.

In the policy library, select rows (or all visible rows) and choose **Delete selected**. Confirm the named entries to remove them from future library listings and selections. Deletion records are appended in BigQuery so newly uploaded policies can be removed immediately without streaming-buffer DML restrictions. Original policy records, source documents, and application snapshots remain available for previously applied versions.

The library separates **Customer policies** (company underwriting and product rules) from **Regulatory policies** (regulator sources and circulars). Each category has its own count, table, and bulk-delete selection. Application selections are retained across category switches so both groups can be applied together; clearing or deleting a selection affects only the visible category.

The frontend opens in light mode with a teal sidebar and white workspace. The header has an icon-only theme switch and Settings → Manage connections for BigQuery dataset selection. Dark mode applies during the current visit; reopening or refreshing starts in light mode. Desktop layout uses an 80% application scale, while mobile retains normal-size controls. Shared color tokens in `frontend/src/theme.css` cover navigation, chat, charts, underwriting, forms, policy tables, and dialogs.

**Apply policies & return** saves policy snapshots, rules, versions, and the primary product policy to the application's BigQuery review events. Both company and regulatory selections are required before starting. Policy versions are locked for the active review. Case URLs preserve the application and selected panel through policy-library visits, refresh, and browser navigation. Step confirmation records the saved result ID rather than regenerating the agent response.

To populate the prototype inbox with two explicitly fictional applications and their PDF source packets:

```powershell
python -m backend.health_underwriting_schema
python -m backend.import_sample_applications --document-bucket YOUR_PRIVATE_DOCUMENT_BUCKET --include-health-policy
```

The importer is idempotent, never replaces existing applications, and keeps these records marked `synthetic=True` with `record_origin=sample_application`. The inbox intentionally includes this specific sample origin alongside received applications. The older bulk seed generator remains isolated to its separate demo dataset. Sample PDFs are stored privately in GCS and OCR runs when the employee reaches the document step; extracted results are not fabricated. One packet deliberately lacks its supporting medical report. The optional fictional health product policy is illustrative; it does not supply regulatory authority or an approved rate table. Upload an applicable regulatory source through Policies before starting its pipeline.

`UNDERWRITING_DOCUMENT_BUCKET` must be set separately from `UNDERWRITING_POLICY_BUCKET`. The runtime needs Document AI API User access and object access to the private document bucket. Public prototype access should use fictional records; employee authentication is still required before using real applicant data.

The regulatory reference importer, `python -m backend.import_regulatory_reference`, stores the unchanged 30-page IRDAI Master Circular on Health Insurance Business dated 29 May 2024 and attaches it to the two sample cases that have not started their pipelines. Its original official URL, circular number, publication date, SHA-256 digest, page references and six source-linked review topics are preserved in the policy outline. The local source PDF and provenance files are in `samples/underwriting/`. This is a dated source reference; it does not claim to include subsequent amendments or establish an application's compliance. Re-running the importer reuses the same source hash and preserves existing application selections.

This application routes natural-language analysis and visualization requests to two saved Google Cloud Conversational Analytics Data Agents. The backend invokes the agents through the Gemini Data Analytics API using Application Default Credentials.

## Architecture

The React/Vite UI sends questions to FastAPI. FastAPI invokes saved Data Agents through the Gemini Data Analytics API: SQL analysis uses the first agent and chart recommendations use the second. Chat turns are persisted to BigQuery and grouped by browser session and conversation ID.

## Request Flow

1. The UI sends a natural-language question to POST /ask, including the selected dataset when available.
2. FastAPI calls the saved SQL/Data Analyst agent using Application Default Credentials.
3. FastAPI passes the SQL agent's structured response, SQL, columns, and result rows to the Visualization agent.
4. The UI displays the result table followed by up to four chart cards together on the same page; it does not switch to a separate chart tab.

GET /datasets still lists BigQuery datasets for the project configured in GCP_PROJECT_ID. The selected dataset is included in the SQL agent prompt; the configured agent must have access to that dataset and follow the scope instruction.

## Components

- backend/conversational_agents.py: authenticated Conversational Analytics SDK client and saved agent configuration.
- backend/api.py: FastAPI routes for analysis, catalog search, visualization, dataset listing, and health.
- backend/mcp_tools.py: authenticated Google Knowledge Catalog MCP client used by the catalog explorer.
- backend/sql_agent.py and backend/visualization_agent.py: legacy local agent implementations, no longer used by the ask and visualize routes.
- frontend/: Vite and React UI with Tailwind CSS, Lucide icons, and Recharts.
- backend/health_underwriting.py, backend/policy_library.py, and the Employee Underwriting / Policies views: an insurance-type-scoped application review and policy library backed by BigQuery, Document AI, private Cloud Storage, LangGraph, and Vertex AI.
- .env: project configuration and optional ADC credential path; keep private and out of source control.

## Health Underwriting

The **Employee underwriting** workspace accepts an application and source files, sends each file to a configured Google Cloud Document AI processor, stores originals in a private Cloud Storage bucket, and saves the resulting case and review events in BigQuery. An employee can reopen each source document from the review step. Extracted values must be checked against the source; applicant name and date of birth entered at intake are shown alongside extraction output for comparison. A consent confirmation is required before processing.

The seven gated LangGraph steps analyze application details, extract and verify documents, review regulatory sources, validate the selected company policy, assess risk, calculate or refer premium inputs, and prepare an evidence-based recommendation. The Policies view accepts UTF-8 TXT, Markdown, and JSON sources, saves originals to a private Cloud Storage bucket, and stores metadata plus Gemini's source-quoted outline in BigQuery. Company policies shown in application intake are filtered by insurance type. A JSON policy may include a deterministic premium calculation configuration; the life workflow applies its rate bands to employee-entered, document-verified inputs and displays a full breakdown. Files marked SAMPLE_NOT_APPROVED are stored as illustrative policies and any resulting premium is labeled not an approved quote; missing or specialist-review factors stop calculation. Tax remains pending when the policy does not supply verified tax treatment. Gemini explains supplied evidence but cannot establish legal compliance, infer diagnoses, calculate or alter a premium, or decide an application.

**Required setup:** create a dedicated BigQuery dataset using `HEALTH_UNDERWRITING_DATASET` (defaults to `intentra_health_underwriting`), run `python -m backend.health_underwriting_schema` to create tables and safely add the new `insurance_type` column, create a Document AI OCR processor, and configure `DOCUMENT_AI_PROCESSOR`, `UNDERWRITING_DOCUMENT_BUCKET`, and `UNDERWRITING_POLICY_BUCKET`. Policy uploads accept searchable PDF, text, Markdown, and JSON files. Searchable PDFs are extracted locally by the service; scanned PDFs use the configured Document AI OCR processor. See [CLOUD_RUN.md](CLOUD_RUN.md) for API, IAM, private bucket, and Cloud Run settings. The seed generator is isolated to `intentra_health_underwriting_demo`; do not point it at the live application dataset.

**Access and governance:** keep Cloud Run private and the source bucket private. Cloud Run Invoker access protects the service boundary, but application-level employee identity and underwriting-role authorization are not yet implemented. Do not use this as a production underwriting decision system until the client configures employee authentication/authorization, data retention and residency controls, current compliance materials, approved product rules, a validated risk model, and actuarially approved rates.

The Document AI processor must be active and accept the uploaded file types; consult [Google Cloud's Form Parser processing guide](https://docs.cloud.google.com/document-ai/docs/samples/documentai-process-form-document). If OCR text requires additional structuring, the backend can send it to the configured Vertex AI Gemini model; the intake UI discloses this.

## Requirements

- Python 3.12+
- Google Cloud Application Default Credentials with access to the Conversational Analytics agents and their configured BigQuery sources.
- The Google Gemini Data Analytics API enabled in the agent project.
- GCP_PROJECT_ID set for the BigQuery dataset picker and catalog explorer.
- A dedicated BigQuery history dataset (defaults to `intentra_chat_history`) in the project configured by GCP_PROJECT_ID. The backend creates the dataset and `conversation_turns` table on first use; the default location is US.
- CONVERSATIONAL_API_PROJECT_ID set if the saved agents are in a different project than the default configured in the backend.

Install packages in the project's virtual environment:

```powershell
cd "C:\Deloitte-Project\GCP-Knowledge catalog"
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Set `.env`:

```text
GCP_PROJECT_ID=your-gcp-project-id
CHAT_HISTORY_DATASET=intentra_chat_history
CHAT_HISTORY_TABLE=conversation_turns
CHAT_HISTORY_LOCATION=US
```

Pre-create the dedicated history dataset and grant the Cloud Run runtime identity `roles/bigquery.dataEditor` on that dataset, plus `roles/bigquery.jobUser` on the project. These permissions allow the backend to create the history table, insert turns, and query history without project-wide data write access. Creating the dataset automatically requires additional project permissions. Local runs use local Application Default Credentials instead of the Cloud Run identity. Set `CHAT_HISTORY_LOCATION` to a supported location appropriate for your data before first use; once BigQuery creates the dataset, its location cannot be changed. History uses a browser-generated session ID and does not require sign-in; clearing browser storage starts a new history view. The saved turn includes the user's question and the agent's JSON response, including returned query rows.

For local user credentials, install the Google Cloud CLI and run `gcloud auth application-default login`. Set the quota project with `gcloud auth application-default set-quota-project YOUR_GCP_PROJECT_ID` if required for API billing. Changing the active `gcloud` project alone does not change ADC credentials or this app's project ID.

Alternatively, for a service account, add `GOOGLE_APPLICATION_CREDENTIALS=C:/path/outside/repository/service-account.json` to the root `.env`. Use an absolute path to a credential file outside this repository; never commit credential JSON. Grant the chosen identity access to Knowledge Catalog and BigQuery in the target project. Restart the backend after changing `.env` or ADC credentials.

## Run Locally

Start the backend and frontend in separate terminals.
Keep `.env` at the project root. Import the API as `backend.api`, not `api`, so its package-relative imports work.

### FastAPI backend

```powershell
$env:NO_PROXY = "127.0.0.1,localhost"
.\.venv\Scripts\python.exe -m uvicorn backend.api:app --host 127.0.0.1 --port 8002
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8002
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

The agent project defaults to project-b222a5e1-4bfe-4261-a4e. Override the defaults with CONVERSATIONAL_API_PROJECT_ID, SQL_DATA_AGENT_ID, and VISUALIZATION_DATA_AGENT_ID if needed.

The runtime identity needs access to both agents and their configured BigQuery sources. Enable the Gemini Data Analytics API in the Conversational Analytics project, configure Google Application Default Credentials, and restart the backend after changing the environment.
