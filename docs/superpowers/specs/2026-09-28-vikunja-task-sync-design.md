# Spaces ↔ Vikunja task sync

**Status:** proposed, awaiting review · 2026-09-28

## Goal

Tasks on a Space's resources (the back of the card) stay in step with Vikunja at
`https://tasks.bhag.dev`, so they also appear in BusyCal through Vikunja's CalDAV
(one BusyCal calendar per Vikunja project). Checking a task off anywhere (Spaces,
Vikunja, BusyCal) checks it off everywhere.

Verified on 2026-09-28: Vikunja's CalDAV round-trips completion both ways, and an
API token works as the CalDAV password for user `bhag`.

## What syncs

| Spaces | Vikunja |
|---|---|
| A Space that has at least one task | A project named after the Space, inside a parent project **Spaces** |
| A task item (`text`, `done`) | A task (`title`, `done`) |
| Renaming the Space | Renames the project |
| Deleting the Space | **Archives** the project (nothing is deleted in Vikunja) |

- Only task items sync. Notes and links stay in Spaces.
- Tasks from every resource section of a Space go to that Space's project.
- A task created in Vikunja or BusyCal appears in Spaces in a section titled
  **Tasks**, which is created if the Space doesn't have one yet.
- Existing Vikunja projects (Inbox, OakstoneOne, Frontend, Backend) are never touched.

## Identity and state

- **Stored on the synced documents,** so every device agrees:
  - `Space.vikunjaProjectId?: number`
  - task item `vikunjaId?: number` and `updatedAt?: number`
- **Stored locally,** per device, in `chrome.storage.local`:
  - the Vikunja URL and API token. The token is never synced to the Spaces server.
  - for each project, the set of Vikunja task IDs seen at the last sync. That's how a
    deleted task is told apart from a new one.

## The sync pass

The pass runs in the service worker for each Space that has tasks or a project. It
runs every 2 minutes, 5 seconds after any resources edit (debounced), and from **Sync
now** in Settings.

1. **Project:** create the parent **Spaces** project and this Space's project if
   they're missing, and rename the project if the Space was renamed.
2. **Fetch** the project's tasks, including done ones.
3. **Match** tasks by `vikunjaId`:
   - **Local task with no `vikunjaId`:** create it in Vikunja and record the id.
   - **In both, and one side changed since the last sync:** copy that change across.
   - **In both, and both sides changed:** the newer timestamp wins (local `updatedAt`
     against Vikunja's `updated`).
   - **In Vikunja only, and new since the last sync:** add it to Spaces.
   - **In Vikunja only, but seen before:** it was deleted in Spaces, so delete it in
     Vikunja.
   - **In Spaces only, but seen before:** it was deleted in Vikunja or BusyCal, so
     remove it from Spaces.
4. Save the set of IDs seen, and write the resources document once.

Writes go through the existing storage provider, with its revision check and retry,
so this can't clobber a concurrent edit from the panel or from the Spaces server.

## Settings

A new **Vikunja tasks** section:
- server URL (default `https://tasks.bhag.dev`)
- API token
- Connect / Disconnect
- status: last synced, or the error

Disconnecting stops syncing but leaves both sides as they are.

## Failure handling

- **Offline or 5xx errors:** skip this pass and try again next time. Nothing is lost,
  because Spaces keeps working locally.
- **401 (bad or expired token):** stop syncing, show "Token rejected" in Settings, and
  set a badge dot on the Today view.
- **A project deleted in Vikunja:** clear `vikunjaProjectId`, so the next pass creates
  it again.

## Testing

- Unit tests for the matching logic against a fake Vikunja (in-memory HTTP handler),
  covering create, both-changed conflicts, delete on each side, rename, and archive.
- An end-to-end run against a local Vikunja in Docker: check off in Spaces, confirm
  `done` in Vikunja, then change it over CalDAV and confirm it in Spaces.

## Out of scope for now

- Due dates, priorities, labels and subtasks. Vikunja has them but Spaces tasks don't.
- Syncing notes or links.
- Choosing a different Vikunja project per section.

## Open questions for the reviewer

1. Is **"Spaces" parent → one project per Space** the right shape? The alternative is
   top-level projects named "Spaces · <name>".
2. Should deleting a Space **archive** its project (proposed), or leave it active?
