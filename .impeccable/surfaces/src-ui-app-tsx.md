---
version: 1
slug: "src-ui-app-tsx"
primary_target: "src/ui/App.tsx"
related_targets: ["src/ui/app.css","static/panel.html","static/dashboard.html"]
---

---
version: 1
slug: "src-ui-app-tsx"
primary_target: "src/ui/App.tsx"
related_targets: ["src/ui/app.css","static/panel.html","static/dashboard.html"]
---

# Spaces UI: side panel + dashboard

Mode: Operate. Scope: the whole extension UI (panel is primary, dashboard secondary; same app, `data-view`).
Audience/job: one person, panel docked all day beside real work; glance to know which Space this window holds, switch fast, often by keyboard.
Constraints: keyboard-first; dense, not sparse; never loud or generic-SaaS; light + dark; bundled fonts only.
Adaptations (cited): the dashboard lays the opened card flat on the desk, recto and verso side by side, instead of flipping it; its verso card takes a plain stock-edge top rule so red stays on the one pulled card. The find field is the drawer's own label holder, sitting at the top of the drawer.
Unresolved: none.

## Direction contract

THESIS: Every Space is an index card in one drawer. This window's Space is the card pulled up and read; the rest are card tops you flick to. Refuses the rounded-card SaaS sidebar with a highlighted row and purple accent.

OWN-WORLD: Steel-cabinet grey-green drawer ground; white card stock with faint blue ruling; typed ink entries in a typewriter face; workspace guide cards with protruding tabs; rubber-stamp state marks in a fixed right cell (HERE, OPEN, device, PENDING, VIEW ONLY). Red is spent only on the pulled card's top rule and the act of pulling. Raises: one accent for one action (cape); distinct stamped states (tensegrity); rank = how far a card is pulled, no shadows/badges (cracktro); absence drawn as typed blank cards (seven-segment).

STORY: Glance: the pulled card names where you are and what's in it. Act: type or press a call number, a card rises, the old one files down.

FIRST VIEWPORT: Panel top: the pulled card at full width, typed name, call-number corner, tab entries with group headings, stamp cell. Below, one-line card tops under guide cards. Filter field is the drawer label.

FORM: Card Catalog, candidate 6 of 7, seed d2dd74d0. Signature interaction: the card pull (FLIP rise/file-down, reduced-motion safe). Resources = the card's verso.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
