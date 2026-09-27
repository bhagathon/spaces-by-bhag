#!/usr/bin/env bash
# Publish the current build as the latest update:
#   PROJECT=<gcp-project> npm run publish-update
# Uploads release/spaces-extension-<version>.zip and latest.json to the bucket in
# installer/update.conf. Installed copies pick it up within 6 hours.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PROJECT:?set PROJECT to the GCP project id}"
. installer/update.conf
VERSION=$(node -p "require('./package.json').version")
ZIP="release/spaces-extension-${VERSION}.zip"

npm run -s build
mkdir -p release
rm -f "$ZIP"
(cd dist && zip -qr "../$ZIP" .)
SHA=$(shasum -a 256 "$ZIP" | cut -d' ' -f1)

if ! gcloud storage buckets describe "gs://${BUCKET}" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" --project "$PROJECT" --location us-central1 --uniform-bucket-level-access
  # Updaters fetch anonymously, so objects are world-readable (the extension build only; no data).
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member allUsers --role roles/storage.objectViewer --project "$PROJECT" >/dev/null
fi

# Versioned zips never change, so they can be cached; latest.json must not be.
gcloud storage cp "$ZIP" "gs://${BUCKET}/spaces-extension-${VERSION}.zip" --cache-control "public, max-age=31536000, immutable"
printf '{"version":"%s","url":"https://storage.googleapis.com/%s/spaces-extension-%s.zip","sha256":"%s","publishedAt":"%s"}\n' \
  "$VERSION" "$BUCKET" "$VERSION" "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > release/latest.json
gcloud storage cp release/latest.json "gs://${BUCKET}/latest.json" --cache-control "no-cache, max-age=0" --content-type application/json
echo "Published ${VERSION} (sha256 ${SHA})"
