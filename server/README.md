# Spaces server

Sync backend for the Spaces extension: REST + WebSocket, token auth, owner/editor/viewer roles.
The full API contract is at the top of `../src/storage/RemoteStorageProvider.ts`.

Node runs the TypeScript directly (no build step). Two stores:

| `STORE`            | Use                      | Notes                                         |
|--------------------|--------------------------|-----------------------------------------------|
| `sqlite` (default) | local dev, tests         | `SQLITE_PATH` (default `spaces.db`)           |
| `firestore`        | Cloud Run                | project from the environment / ADC            |

## Run locally

```bash
npm install
npm start                                   # :8080, SQLite
npm run admin add-user me                   # prints a token (shown once)
```

In the extension, go to Settings → Sync, enter `http://localhost:8080` and the token.

## Deploy to GCP

```bash
PROJECT=your-project ./deploy.sh
gcloud auth application-default login       # once, so the admin CLI can reach Firestore
STORE=firestore GOOGLE_CLOUD_PROJECT=your-project npm run admin add-user me
```

`deploy.sh` needs Docker running locally. It enables Cloud Run, Firestore and Artifact Registry, then creates the `(default)` Firestore database and a service account that only has Firestore access. It builds the image locally, pushes it, and deploys the Cloud Run service.

**Cost.** With live updates off (the extension's default), the extension polls once a minute, so the instance scales to zero between polls. That normally fits inside the free tier.
With live updates on, the open WebSocket keeps one instance billed while Chrome is running: about $0.09 an hour at 1 vCPU / 512 MiB once you're past the ~50 free hours a month.

## Admin

```bash
npm run admin list-users
npm run admin create-team acme "Acme" me
npm run admin set-role acme alice editor     # owner | editor | viewer | none
```

## Tests

From the repo root, `npm test` runs the server against SQLite. To run the store and sync suites against Firestore, start the emulator first:

```bash
docker run -d --rm -p 8681:8681 gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators \
  gcloud emulators firestore start --host-port=0.0.0.0:8681
FIRESTORE_EMULATOR_HOST=localhost:8681 TEST_STORE=firestore npx vitest run tests/server.test.ts tests/sync.test.ts tests/serverStore.test.ts
```
