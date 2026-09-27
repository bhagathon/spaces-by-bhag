# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the author, working in Chrome. The side panel stays open most of the working day, next to whatever page is active. They glance at it and switch between work contexts (Spaces) many times a day. The full-page dashboard is secondary, used for history, suspension logs and settings.

## Product Purpose

Spaces is a personal Chrome extension (Manifest V3) for keeping separate tab contexts ("Spaces") and switching between them, in the style of Workona. It has four jobs:
- Save a window's tabs and tab groups as a named Space.
- Replace a window's tabs with another Space in one action, without losing anything.
- Keep memory low by suspending background tabs.
- Keep notes, tasks and links (resources) next to each Space.

Success means switching contexts feels instant and safe, and nothing is ever lost.

## Positioning

A private, self-hosted equivalent of Workona Pro/Team. It works fully offline from local IndexedDB, and can sync through the user's own server on Google Cloud (Cloud Run + Firestore). No third-party service holds the data.

## Operating Context

- **Surfaces:**
  - The Chrome side panel is narrow (roughly 320–480px) and sits beside the page being worked on.
  - The dashboard is a full browser tab (⌘⇧S), opened occasionally.
- **In use:** switching Spaces replaces the tabs in the current window. The panel reflects which Space the current window holds.
- **Multi-device:** sync runs on a one-minute poll by default, or over an optional live connection. The live connection also shows presence ("open on another device").
- **Team workspaces:** supported, with owner, editor and viewer roles enforced by the server. Day-to-day use is personal.

## Capabilities and Constraints

- **Spaces:**
  - Save the current window as a Space in a chosen workspace.
  - Switch, rename, delete and search (by Space name and tab titles/URLs).
  - Show tab and group counts and favicons, and which Space is in this window or another window.
- **Resources:** per-Space sections containing notes, tasks (checkable) and links. Links can be added from the current tab or a pasted URL. Items can be reordered, and edits autosave.
- **History:**
  - A snapshot of each window every minute, taken only when its tabs changed, kept for 30 days.
  - Restoring a snapshot opens it as a new Space.
- **Suspension:**
  - Automatic discarding of idle background tabs, with a configurable threshold.
  - Exceptions for pinned, audible and grouped tabs, plus a never-suspend site list. A lower threshold applies under memory pressure.
  - A "suspend now" action and a log of suspended tabs.
- **Settings:**
  - Switching: keep pinned tabs across Spaces, lazy-load tabs.
  - Suspension options, and opt-in protection for tabs with unsaved form text.
  - Sync: server URL, token, device name, live updates.
- **Status the UI must surface:**
  - Sync state (off, connecting, synced, offline with pending count, error).
  - View-only workspaces.
  - Presence of other devices.
  - Errors from failed switches.
- **Constraints:**
  - Chrome only, Chrome 121+.
  - Extension pages allow no remote scripts; fonts must be bundled or system fonts.
  - The UI is React 19 + Jotai, built with esbuild.
  - The panel and dashboard are the same app, distinguished by `data-view`.
- **Terminology:** Space, Workspace (Personal or team), Resources, History/Snapshot, Suspend.

## Brand Commitments

The name is "Spaces". There are no other brand assets. The extension is never published, so there is no marketing surface.

## Evidence on Hand

Only real, local data: the user's own Spaces, tabs and resources. There are no testimonials, metrics or users beyond the author. Nothing may be invented.

## Product Principles

1. **Switching is the core act.** Getting from one context to another must be the fastest, most obvious thing on screen.
2. **Never lose anything.** Every destructive or state-changing action is reversible or clearly confirmed, and sync or save state is always visible.
3. **Glanceable beside real work.** The panel lives next to other content all day; it must be readable at a glance and must not compete with the page.
4. **Keyboard-first.** Every core action (find, switch, create, navigate tabs of the UI) works without a mouse.
5. **Local first, private by default.** Nothing leaves the device unless the user configures their own server.

## Accessibility & Inclusion

- Keyboard-first operation is a confirmed requirement: full keyboard navigation, visible focus, and shortcuts for switching.
- No other specific needs were stated. WCAG 2.2 AA is assumed as the floor.
