# Deploy Intentra to Cloud Run

The app is configured as one Cloud Run service: FastAPI serves the built React UI and API from the same origin. The service is private by default because its runtime identity can query BigQuery and call the saved agents.

## Prerequisites

- Install the Google Cloud CLI and authenticate with an account allowed to deploy Cloud Run services and act as the runtime service account.
- Confirm billing is enabled for the project.
- Enable the Vertex AI API and grant the Cloud Run runtime identity `roles/aiplatform.user` so the underwriting workflow's Gemini calls can run.
- Grant the runtime service account only the access it needs:
  - `roles/geminidataanalytics.dataAgentUser` on the project or each saved agent.
  - `roles/bigquery.jobUser` and `roles/bigquery.metadataViewer` on the project.
  - `roles/bigquery.dataViewer` on each BigQuery dataset the app should query. The underwriting service uses a dedicated dataset configured by `HEALTH_UNDERWRITING_DATASET` (default `intentra_health_underwriting`).
  - `roles/bigquery.dataEditor` on the dedicated underwriting dataset so application intake, extracted metadata, and reviewer events can be stored.
  - `roles/bigquery.dataEditor` on the dedicated chat history dataset (`CHAT_HISTORY_DATASET`, default `intentra_chat_history`) so the runtime can create its history table and save conversation turns. Dataset read access alone does not allow `insertAll` writes.
  - `roles/storage.objectUser` on both the private application-document and policy-source buckets.
  - `roles/dataplex.catalogViewer` and `roles/mcp.toolUser` on the project if the catalog explorer is enabled.
- Ensure the agent's underlying BigQuery data source also permits queries from the runtime identity.

The app uses Cloud Run Application Default Credentials. Do not copy the local `.env` or a service-account JSON key into the image. The Cloud Run service identity replaces local credentials. Underwriting documents are sensitive personal and health information: keep the Cloud Run service private, use a private bucket with public access prevention, and configure the processor and bucket region to meet the client's residency and retention requirements. Application-level employee roles are not yet enforced; Cloud Run Invoker access alone does not distinguish underwriters from other service callers.

## Build and deploy

Run these commands from the repository root in PowerShell. The project ID below is the one currently configured for this app. Change `us-central1` if you prefer another Cloud Run region.

```powershell
$project = "project-b222a5e1-4bfe-4261-a4e"
$region = "us-central1"
$serviceAccount = "intentra-runtime@$project.iam.gserviceaccount.com"

gcloud auth login
gcloud config set project $project
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com bigquery.googleapis.com geminidataanalytics.googleapis.com dataplex.googleapis.com aiplatform.googleapis.com documentai.googleapis.com storage.googleapis.com

gcloud iam service-accounts create intentra-runtime --project $project --display-name "Intentra Cloud Run runtime"

gcloud projects add-iam-policy-binding $project --member="serviceAccount:$serviceAccount" --role="roles/bigquery.jobUser"
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$serviceAccount" --role="roles/bigquery.metadataViewer"
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$serviceAccount" --role="roles/geminidataanalytics.dataAgentUser"
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$serviceAccount" --role="roles/aiplatform.user"
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$serviceAccount" --role="roles/dataplex.catalogViewer"
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$serviceAccount" --role="roles/mcp.toolUser"

# Grant roles/bigquery.dataViewer on the approved dataset(s) in BigQuery IAM,
# and ensure the deployer can attach the service account (roles/iam.serviceAccountUser).

gcloud run deploy intentra `
  --source . `
  --project $project `
  --region $region `
  --service-account $serviceAccount `
  --set-env-vars "GCP_PROJECT_ID=$project" `
  --memory 1Gi `
  --timeout 900 `
  --no-allow-unauthenticated
```

The deployer also needs permission to deploy Cloud Run and `roles/iam.serviceAccountUser` on `intentra-runtime`. The source deploy command uses this repository's Dockerfile and builds the image with Cloud Build.

Grant the runtime identity write access to the dedicated underwriting and chat history datasets so it can store applications, reviewer events, and conversation turns:

```powershell
bq add-iam-policy-binding --dataset `
  --member="serviceAccount:$serviceAccount" `
  --role="roles/bigquery.dataEditor" `
  "${project}:intentra_health_underwriting"

bq add-iam-policy-binding --dataset `
  --member="serviceAccount:$serviceAccount" `
  --role="roles/bigquery.dataEditor" `
  "${project}:intentra_chat_history"
```

The BigQuery dataset IAM binding command may require project allowlisting. If it reports that requirement, ask the project administrator to enable the approved dataset IAM workflow or grant the equivalent dataset-scoped role through the authorized console process. The runtime also needs `roles/bigquery.jobUser` at project scope to run analytics queries.

Create the history dataset before granting dataset-scoped access (default location `US`, or the location selected in `CHAT_HISTORY_LOCATION`). The runtime can create `conversation_turns` inside an existing dataset with Data Editor access; creating the dataset itself requires additional project permissions. A `403 bigquery.tables.updateData` error while saving history means the identity performing the write needs dataset write access. Cloud Run uses its runtime service account; a local backend uses local Application Default Credentials. IAM changes take effect without redeploying the app.

Before deploying, create a dedicated empty BigQuery schema and private document bucket. Set `$docBucket` to a globally unique name and use a bucket location approved for the client:

```powershell
$docBucket = "<globally-unique-private-bucket-name>"
$policyBucket = "<globally-unique-private-policy-bucket-name>"
$docLocation = "US"

gcloud storage buckets create "gs://$docBucket" `
  --project $project `
  --location $docLocation `
  --uniform-bucket-level-access `
  --public-access-prevention

gcloud storage buckets create "gs://$policyBucket" `
  --project $project `
  --location $docLocation `
  --uniform-bucket-level-access `
  --public-access-prevention

gcloud projects add-iam-policy-binding $project `
  --member="serviceAccount:$serviceAccount" `
  --role="roles/documentai.apiUser"

gcloud storage buckets add-iam-policy-binding "gs://$docBucket" `
  --member="serviceAccount:$serviceAccount" `
  --role="roles/storage.objectUser"

gcloud storage buckets add-iam-policy-binding "gs://$policyBucket" `
  --member="serviceAccount:$serviceAccount" `
  --role="roles/storage.objectUser"

# Configure the project, dataset, and bucket in a local .env before running this once.
python -m backend.health_underwriting_schema
```

Create a Document AI **OCR Processor** in the selected region using the Google Cloud Console, then set `DOCUMENT_AI_PROCESSOR` to its full resource name (`projects/.../locations/.../processors/...`). Grant the Cloud Run runtime service account `roles/documentai.apiUser` on the processor or project. Configure `UNDERWRITING_DOCUMENT_BUCKET` and `UNDERWRITING_POLICY_BUCKET` to their respective private buckets. The policy bucket stores original searchable PDF, TXT, Markdown, or JSON policy sources. Searchable PDFs are extracted by the service; scanned policy PDFs use the configured Document AI processor. The code does not create a processor or bucket automatically. The schema command creates empty BigQuery tables (and adds the nullable insurance type column to an existing applications table); it never seeds application records.

For Cloud Run, include these service environment variables in the deploy command (substitute your chosen processor and bucket):

```powershell
$processor = "projects/$project/locations/us/processors/<processor-id>"
$dataset = "intentra_health_underwriting"

gcloud run deploy intentra `
  --source . `
  --project $project `
  --region $region `
  --service-account $serviceAccount `
  --set-env-vars "GCP_PROJECT_ID=$project,HEALTH_UNDERWRITING_DATASET=$dataset,DOCUMENT_AI_PROCESSOR=$processor,UNDERWRITING_DOCUMENT_BUCKET=$docBucket,UNDERWRITING_POLICY_BUCKET=$policyBucket" `
  --memory 1Gi `
  --timeout 900 `
  --no-allow-unauthenticated
```

The service receives extracted text in memory and stores original files in the private bucket. Verify the configured Vertex AI model and service region against your data-processing requirements before accepting real health information. The intake confirmation explains when document OCR text may be sent to Vertex AI Gemini.

After deployment, get the service URL with:

```powershell
gcloud run services describe intentra --project $project --region $region --format="value(status.url)"
```

The service is private. Grant Cloud Run Invoker access only to the people who should use it. To grant the currently authenticated account access and open a local authenticated proxy:

```powershell
$account = (gcloud auth list --filter=status:ACTIVE --format="value(account)").Trim()
gcloud run services add-iam-policy-binding intentra --project $project --region $region --member="user:$account" --role="roles/run.invoker"
gcloud run services proxy intentra --project $project --region $region --port 8080
```

Then open `http://127.0.0.1:8080`. Do not make the service public unless the app has appropriate user authentication and the data is safe to expose; public access would let anonymous visitors invoke the agents and query data using the service identity.

## Configuration

The saved agent IDs and agent project already have defaults in `backend/conversational_agents.py`. If the agents move, set `CONVERSATIONAL_API_PROJECT_ID`, `SQL_DATA_AGENT_ID`, `VISUALIZATION_DATA_AGENT_ID`, and `KNOWLEDGE_GAP_DATA_AGENT_ID` as Cloud Run environment variables. Do not set `GOOGLE_APPLICATION_CREDENTIALS` on Cloud Run when using the service identity.
