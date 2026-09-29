---
version: 1
slug: "src-ui-app-tsx"
primary_target: "src/ui/App.tsx"
related_targets: ["src/ui/app.css","static/panel.html","static/dashboard.html"]
---

# Spaces UI: side panel + dashboard

Mode: Operate. Scope: the whole extension UI (panel primary, dashboard/home tab secondary; same app, `data-view`), including Today, History, Suspended and Settings.
Audience/job: one person, panel docked all day beside real work; glance to know which Space this window holds, switch fast, often by keyboard.
Brief (pinned by the user, 2026-09-28): rebuild in the Arc Browser language from the saasui.design Arc screenshots. A Space's colour tints the whole panel. Keep: number keys 1–9 to switch, the flip to Resources (V). Add: an Arc-style command bar.
Constraints: keyboard-first; light + dark; no remote fonts or scripts (system stack is Arc's own face); reduced motion honoured; 320–480px panel.
Unresolved: none.

## Direction contract

THESIS: The panel is the Space's own light. Each Space has a colour; it floods the sidebar as a soft gradient and everything else is glass laid on that light. Switching Spaces is the light changing. Refuses a flat grey sidebar with a coloured highlight row.

OWN-WORLD: Pastel mesh ground in the Space's hue (OKLCH, low chroma, three blurred blobs), frosted white glass sheets (translucent, 12px radius, soft shadow), tab rows as quiet 36px rows whose active one is a white pill with a lifted shadow, favicon + title in the system sans, hairline dividers with a quiet trailing action, a centred command bar with the Space colour as its selection. No colour on rows or controls except the Space hue in selection and focus. Raises: cyclorama (light is the structure; each Space a discrete named phase, colour never the only cue); civic prospectus (all colour spent on one field, the ground; controls stay neutral glass).

STORY: Glance: the light and the name say which Space this is; its tabs sit on one sheet. Act: ⌘K or /, type, Enter, and the light shifts to the next Space. 1–9 still switch.

FIRST VIEWPORT: Panel top: a translucent command pill ("Search Spaces and tabs", ⌘K) with settings and catalog icons; a glass segmented control (Spaces · Today · History · Suspended); the current Space sheet: colour dot, name, meta, its tabs as Arc rows with the active white pill, a quiet action row (Resources · Edit · Detach). Below the sheet, other Spaces as rows with colour dot, count and number key.

FORM: Arc sidebar language, user-pinned (overrides seed 3b449510's assignment). Code-led; Arc screenshots are the critique reference. Signature interaction: the light change, a registered --space-h hue transition across the whole ground on switch (reduced motion: instant), with the card-pull view transition kept.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
