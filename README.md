# Insurance Knowledge Catalog SQL Agent

## Employee application inbox and policy setup

The employee workspace opens on Applications, where each case shows an outcome chip (for example Refer to specialist or Information needed). Open a case to land on its **Case brief**: the recommendation, annual premium, the reasons behind it, a risk-driver chart, a price build-up chart and a what-if price table, followed by the employee decision. Stage logs, rule findings, policy tables, previous runs and the technical record live under the **Audit trail** tab. The policy library keeps the application's insurance type fixed and offers company policies matching its product code plus regulatory sources for its insurance type. Policies can be uploaded and reviewed from the same screen.

### AI risk assessment

At the risk checkpoint, `backend/agents/risk_proposal.py` asks Gemini to propose the product's medical and tobacco classes from numbered evidence (the yes/no answers in the applicant data record). The response is schema-constrained and verified in code: classes must exist in the product configuration, every driver must cite known evidence ids, a declared condition cannot be rated STANDARD, and conditions outside the product's permitted list require specialist review. A validated proposal can be confirmed in one click, which saves the rating, prices the case and continues the pipeline; a proposal that fails a check, or an unavailable model, falls back to choosing the classes manually. The proposal and whether the employee accepted or changed it are saved with the rating inputs. Run `python -m unittest backend.tests.test_risk_proposal backend.tests.test_health_profile` for the validation tests.

### Applicant data feed (no document checking)

Health applications are underwritten from a BigQuery table, `applicant_health_profile`, instead of reading documents. It holds one row per application with yes/no flags: verification (identity, address, phone, consent, medical provider, prior policy) and health (tobacco, alcohol, diabetes, hypertension, heart disease, thyroid, asthma, cancer history, hospitalisation, surgery, family history), plus BMI and a `synthetic` marker. The rows in this prototype are synthetic stand-ins for a real data feed. Create the table with `python -m backend.scripts.health_underwriting_schema` and load the demo rows with `python -m backend.scripts.seed_health_profiles`. This also adds three demo cases with different outcomes: SLH-HI-2026-0148 (clean record, approval consideration), SLH-HI-2026-0149 (diabetes and hypertension, specialist referral) and SLH-HI-2026-0150 (tobacco use and unconfirmed consent, information needed). An application without a profile row, including a document-upload application, stops at the first step and asks for the data record.

### Automatic underwriting pipeline

The review has four steps: **Retrieve applicant data**, **Check policy rules**, **Assess health risk** and **Price & recommend**. Start the pipeline once to run them automatically. It pauses once for the employee to confirm or change the AI-proposed risk class, or earlier if required data is missing. Request-information and specialist-referral actions are available at checkpoints. Stage results, review notes, policy versions and workflow progress are saved in BigQuery review events; the browser receives live progress over the pipeline SSE endpoint. Reopening an active run refreshes its saved progress. Runs saved with the earlier seven-step flow are migrated to the four steps when opened.

The final decision dashboard brings together application and health details, selected policy versions, rule-by-rule evidence observations, risk evidence, pricing output, unresolved requirements and the recommendation. Evidence matches are not compliance passes. Missing risk models or supported product rate configurations stay unresolved; the application never invents a score or premium. Approval and decline require an employee action and rationale after the pipeline finishes. Approval is blocked while saved requirements or evidence gaps remain open; the employee can request information or refer the case instead. Pipeline completion alone is not approval. Existing saved step reviews are preserved when continuing with the automatic flow.

### Regenerating underwriting and viewing previous runs

Open an application and choose **Regenerate underwriting**. Enter a reason and confirm that the current review should be preserved. The backend appends one BigQuery review event containing both the archived full case snapshot and the fresh active state; no new table is required. Completed and partial runs retain their policy versions, findings, document references, employee confirmations and decision. The application keeps its ID, returns to preparation, and has no active decision or carried-over confirmations. Existing policies remain selected but may be changed before starting. Source documents are not reprocessed; the applicant data is retrieved again. Reopening a previously approved or declined case retains that decision only in its historical run.

**View previous runs** lists the most recent 100 archived runs for that application. Each opens read-only, including saved stage findings and the earlier decision dashboard. Document source lookup also resolves archived document IDs. Regeneration cannot interrupt a run holding the application processing lock and rejects stale run references. The active review remains separate from the history viewer.

### Health product rates and employee assessment

The primary health product JSON can configure `annual_health_premium`: an exact age-and-cover base rate multiplied by regional, medical and tobacco factors, rounded HALF_UP to two decimals. The product and application codes must match. At the medical checkpoint an employee records classifications, reviewed document IDs, verification references and individual policy dispositions. Unknown classes, unsupported rates or specialist referrals do not produce an automatic premium. The rate grid is visible in both the policy library and the medical review form; a new policy version can be uploaded through the existing source-review flow.

Gemini receives the case, full rate grid and rating conditions and returns its own proposed base, multipliers, age, cover and premium. The backend independently reconciles those values before displaying an AI-verified calculation. A mismatching proposal is rejected, and the configured calculation remains authoritative. Tax is not invented. Product-based medical triage remains separate from a validated predictive medical model and an employee decision.

The prepared Pooja case and 3-4 minute recording sequence are documented in [the walkthrough](docs/POOJA_WALKTHROUGH.md). Original records remain intact; follow-up fixture provenance is stored privately, and no preparation script signs off employee reviews or records an approval.

Policy import follows **Upload & analyze → Review & edit → Add to policy library**. PDF, TXT, Markdown, and JSON uploads all use Gemini analysis. Structured JSON bundles preserve every policy and original rule, including conditions, actions, evidence requirements, and source pointers; Gemini supplies explanations and review questions. The review table supports editing metadata and rules, adding missing entries, removing rules, and excluding policies. Nothing is saved during analysis. Adding selected drafts stores the reviewed content and original source without regenerating it. Fictional catalogs retain their illustrative status. If Gemini is unavailable or a source exceeds the analysis limit, the upload reports an error rather than presenting a completed analysis.

In the policy library, select rows (or all visible rows) and choose **Delete selected**. Confirm the named entries to remove them from future library listings and selections. Deletion records are appended in BigQuery so newly uploaded policies can be removed immediately without streaming-buffer DML restrictions. Original policy records, source documents, and application snapshots remain available for previously applied versions.

The library separates **Customer policies** (company underwriting and product rules) from **Regulatory policies** (regulator sources and circulars). Each category has its own count, table, and bulk-delete selection. Application selections are retained across category switches so both groups can be applied together; clearing or deleting a selection affects only the visible category.

The frontend opens in light mode with a teal sidebar and white workspace. The header has an icon-only theme switch and Settings → Manage connections for BigQuery dataset selection. Dark mode applies during the current visit; reopening or refreshing starts in light mode. Desktop and mobile use normal browser scaling with responsive layouts. Shared color tokens in `frontend/src/theme.css` cover navigation, chat, charts, underwriting, forms, policy tables, and dialogs.

**Apply policies & return** saves policy snapshots, rules, versions, and the primary product policy to the application's BigQuery review events. Both company and regulatory selections are required before starting. Policy versions are locked for the active review. Case URLs preserve the application and selected panel through policy-library visits, refresh, and browser navigation. Step confirmation records the saved result ID rather than regenerating the agent response.

To populate the prototype inbox with two explicitly fictional applications and their PDF source packets:

```powershell
python -m backend.scripts.health_underwriting_schema
python -m backend.scripts.import_sample_applications --document-bucket YOUR_PRIVATE_DOCUMENT_BUCKET --include-health-policy
```

The importer is idempotent, never replaces existing applications, and keeps these records marked `synthetic=True` with `record_origin=sample_application`. The inbox intentionally includes this specific sample origin alongside received applications. The older bulk seed generator remains isolated to its separate demo dataset. Sample PDFs are stored privately in GCS and OCR runs when the employee reaches the document step; extracted results are not fabricated. One packet deliberately lacks its supporting medical report. The optional fictional health product policy is illustrative; it does not supply regulatory authority or an approved rate table. Upload an applicable regulatory source through Policies before starting its pipeline.

`UNDERWRITING_DOCUMENT_BUCKET` must be set separately from `UNDERWRITING_POLICY_BUCKET`. The runtime needs Document AI API User access and object access to the private document bucket. Public prototype access should use fictional records; employee authentication is still required before using real applicant data.

The regulatory reference importer, `python -m backend.scripts.import_regulatory_reference`, stores the unchanged 30-page IRDAI Master Circular on Health Insurance Business dated 29 May 2024 and attaches it to the two sample cases that have not started their pipelines. Its original official URL, circular number, publication date, SHA-256 digest, page references and six source-linked review topics are preserved in the policy outline. The local source PDF and provenance files are in `samples/underwriting/`. This is a dated source reference; it does not claim to include subsequent amendments or establish an application's compliance. Re-running the importer reuses the same source hash and preserves existing application selections.

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

- backend/agents/: conversational, underwriting, visualization, SQL, and model-backed reasoning agents.
- backend/api/app.py: FastAPI routes for analysis, catalog search, visualization, dataset listing, and health.
- backend/integrations/: authenticated Google Knowledge Catalog MCP client and other external integrations.
- backend/repositories/: BigQuery-backed application, profile, policy, and chat-history data access.
- backend/services/: underwriting workflow, document intake, pricing, product, and evidence services.
- backend/config/: shared backend configuration.
- backend/scripts/: schema, seed, import, and maintenance commands.
- backend/tests/: backend unit tests.
- frontend/: Vite and React UI with Tailwind CSS, Lucide icons, and Recharts.
- backend/repositories/health_underwriting.py, backend/repositories/policy_library.py, and the Employee Underwriting / Policies views: an insurance-type-scoped application review and policy library backed by BigQuery, Document AI, private Cloud Storage, LangGraph, and Vertex AI.
- .env: project configuration and optional ADC credential path; keep private and out of source control.

## Health Underwriting

The **Employee underwriting** workspace accepts an application and source files, sends each file to a configured Google Cloud Document AI processor, stores originals in a private Cloud Storage bucket, and saves the resulting case and review events in BigQuery. An employee can reopen each source document from the review step. Extracted values must be checked against the source; applicant name and date of birth entered at intake are shown alongside extraction output for comparison. A consent confirmation is required before processing.

The four gated LangGraph steps retrieve the applicant data record, match regulatory and company policy rules, propose and confirm risk classes, and calculate the premium with an evidence-based recommendation. The Policies view accepts UTF-8 TXT, Markdown, and JSON sources, saves originals to a private Cloud Storage bucket, and stores metadata plus Gemini's source-quoted outline in BigQuery. Company policies shown in application intake are filtered by insurance type. A JSON policy may include a deterministic premium calculation configuration; the life workflow applies its rate bands to employee-entered, document-verified inputs and displays a full breakdown. Files marked SAMPLE_NOT_APPROVED are stored as illustrative policies and any resulting premium is labeled not an approved quote; missing or specialist-review factors stop calculation. Tax remains pending when the policy does not supply verified tax treatment. Gemini explains supplied evidence but cannot establish legal compliance, infer diagnoses, calculate or alter a premium, or decide an application.

**Required setup:** create a dedicated BigQuery dataset using `HEALTH_UNDERWRITING_DATASET` (defaults to `intentra_health_underwriting`), run `python -m backend.scripts.health_underwriting_schema` to create tables and safely add the new `insurance_type` column, create a Document AI OCR processor, and configure `DOCUMENT_AI_PROCESSOR`, `UNDERWRITING_DOCUMENT_BUCKET`, and `UNDERWRITING_POLICY_BUCKET`. Policy uploads accept searchable PDF, text, Markdown, and JSON files. Searchable PDFs are extracted locally by the service; scanned PDFs use the configured Document AI OCR processor. See [CLOUD_RUN.md](CLOUD_RUN.md) for API, IAM, private bucket, and Cloud Run settings. The seed generator is isolated to `intentra_health_underwriting_demo`; do not point it at the live application dataset.

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
Keep `.env` at the project root. Import the FastAPI app as `backend.api.app:app`.

### FastAPI backend

```powershell
$env:NO_PROXY = "127.0.0.1,localhost"
.\.venv\Scripts\python.exe -m uvicorn backend.api.app:app --host 127.0.0.1 --port 8002
python -m uvicorn backend.api.app:app --host 127.0.0.1 --port 8002
```

If your terminal is already in `backend` with `.venv` activated, run:

```cmd
uvicorn backend.api.app:app --app-dir .. --host 127.0.0.1 --port 8002
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
