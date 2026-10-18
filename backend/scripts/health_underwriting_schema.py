"""Create the empty BigQuery schema required by employee application intake.

Run with: python -m backend.scripts.health_underwriting_schema
This creates tables only; it does not insert or seed any application records.
"""

from google.api_core.exceptions import NotFound
from google.cloud import bigquery

from backend.repositories.health_underwriting import DATASET_ID, LOCATION
from backend.repositories.health_profile import TABLE_NAME, profile_schema
from backend.integrations.mcp_tools import PROJECT_ID
from backend.scripts.health_underwriting_seed import _schema


def main():
    client = bigquery.Client(project=PROJECT_ID)
    dataset_ref = f"{PROJECT_ID}.{DATASET_ID}"
    try:
        dataset = client.get_dataset(dataset_ref)
    except NotFound:
        dataset = bigquery.Dataset(dataset_ref)
        dataset.location = LOCATION
        dataset.description = "Health insurance application processing and employee review records."
        client.create_dataset(dataset)
    created = []
    for table_name, schema in {**_schema(), TABLE_NAME: profile_schema()}.items():
        table_ref = f"{dataset_ref}.{table_name}"
        table = client.create_table(bigquery.Table(table_ref, schema=schema), exists_ok=True)
        # Add new nullable columns to existing application tables without
        # replacing any existing underwriting records.
        if table_name == "applications":
            existing = {field.name for field in table.schema}
            if "insurance_type" not in existing:
                client.query(
                    f"ALTER TABLE `{table_ref}` ADD COLUMN insurance_type STRING",
                    location=LOCATION,
                ).result()
        created.append(table_name)
    print(f"Ready: {dataset_ref} ({dataset.location})")
    print("Tables: " + ", ".join(created))
    print("No application records were inserted.")


if __name__ == "__main__":
    main()
