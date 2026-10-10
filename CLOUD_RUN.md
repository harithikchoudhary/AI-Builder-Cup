# Deploy Intentra to Cloud Run

The app is configured as one Cloud Run service: FastAPI serves the built React UI and API from the same origin. The service is private by default because its runtime identity can query BigQuery and call the saved agents.

## Prerequisites

- Install the Google Cloud CLI and authenticate with an account allowed to deploy Cloud Run services and act as the runtime service account.
- Confirm billing is enabled for the project.
- Grant the runtime service account only the access it needs:
  - `roles/geminidataanalytics.dataAgentUser` on the project or each saved agent.
  - `roles/bigquery.jobUser` and `roles/bigquery.metadataViewer` on the project.
  - `roles/bigquery.dataViewer` on each BigQuery dataset the app should query. The project's current dataset picker shows `bsfi_synthetic`, `civicpulse`, `civicpulse_karnataka`, `parakh`, `parakh_underwriting`, and `synthgauntlet`.
  - `roles/dataplex.catalogViewer` and `roles/mcp.toolUser` on the project if the catalog explorer is enabled.
- Ensure the agent's underlying BigQuery data source also permits queries from the runtime identity.

The app uses Cloud Run Application Default Credentials. Do not copy the local `.env` or a service-account JSON key into the image. The Cloud Run service identity replaces local credentials.

## Build and deploy

Run these commands from the repository root in PowerShell. The project ID below is the one currently configured for this app. Change `us-central1` if you prefer another Cloud Run region.

```powershell
$project = "project-b222a5e1-4bfe-4261-a4e"
$region = "us-central1"
$serviceAccount = "intentra-runtime@$project.iam.gserviceaccount.com"

gcloud auth login
gcloud config set project $project
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com bigquery.googleapis.com geminidataanalytics.googleapis.com dataplex.googleapis.com

gcloud iam service-accounts create intentra-runtime --project $project --display-name "Intentra Cloud Run runtime"

gcloud projects add-iam-policy-binding $project --member="serviceAccount:$serviceAccount" --role="roles/bigquery.jobUser"
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$serviceAccount" --role="roles/bigquery.metadataViewer"
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$serviceAccount" --role="roles/geminidataanalytics.dataAgentUser"
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
