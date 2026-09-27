#!/usr/bin/env bash
# Deploy the Spaces server to Cloud Run, backed by Firestore.
#   PROJECT=my-project [REGION=us-central1] [SERVICE=spaces] ./deploy.sh
set -euo pipefail
PROJECT="${PROJECT:?set PROJECT}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-spaces}"
SA="spaces-server@${PROJECT}.iam.gserviceaccount.com"
cd "$(dirname "$0")"

gcloud services enable run.googleapis.com firestore.googleapis.com artifactregistry.googleapis.com --project "$PROJECT"

if ! gcloud firestore databases describe --database='(default)' --project "$PROJECT" >/dev/null 2>&1; then
  gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native --project "$PROJECT"
fi

# The service runs as its own account with Firestore access only.
if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create spaces-server --display-name "Spaces server" --project "$PROJECT"
fi
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${SA}" --role roles/datastore.user --condition=None --quiet >/dev/null

# Build locally and push, rather than --source: Cloud Build needs extra IAM grants on the
# project's default compute service account, which new projects don't have.
REPO="${REGION}-docker.pkg.dev/${PROJECT}/spaces"
if ! gcloud artifacts repositories describe spaces --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud artifacts repositories create spaces --repository-format docker --location "$REGION" --project "$PROJECT"
fi
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet >/dev/null
IMAGE="${REPO}/server:$(date +%Y%m%d-%H%M%S)"
docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"

# --allow-unauthenticated: the extension can't do Google IAM auth; every route checks its own bearer token.
# --max-instances 1: presence and realtime fan-out live in memory, so all sockets must reach one instance.
# --timeout 3600: WebSockets are cut at the request timeout; the extension reconnects automatically.
gcloud run deploy "$SERVICE" --image "$IMAGE" --project "$PROJECT" --region "$REGION" \
  --service-account "$SA" --allow-unauthenticated \
  --min-instances 0 --max-instances 1 --cpu 1 --memory 512Mi \
  --concurrency 80 --timeout 3600 --session-affinity \
  --set-env-vars STORE=firestore --quiet

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo
echo "Deployed: $URL"
echo "Create your token:  cd server && STORE=firestore GOOGLE_CLOUD_PROJECT=$PROJECT npm run admin add-user <name>"
