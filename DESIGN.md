---
name: Spaces
description: The panel is the Space's own light; everything else is glass laid on it.
colors:
  space-accent: "oklch(0.5 0.17 250)"
  space-accent-soft: "oklch(0.5 0.17 250 / 0.14)"
  on-accent: "#ffffff"
  ground: "oklch(0.935 0.0455 250)"
  blob-a: "oklch(0.84 0.07 250)"
  blob-b: "oklch(0.89 0.07 30)"
  blob-c: "oklch(0.86 0.07 166)"
  ink: "oklch(0.24 0.02 250)"
  ink-2: "oklch(0.4 0.02 250)"
  ink-3: "oklch(0.5 0.018 250)"
  pill: "#ffffff"
  glass: "rgb(255 255 255 / 0.5)"
  glass-hover: "rgb(255 255 255 / 0.62)"
  glass-strong: "rgb(255 255 255 / 0.78)"
  glass-sheet: "rgb(255 255 255 / 0.4)"
  edge: "rgb(255 255 255 / 0.7)"
  hairline: "oklch(0.3 0.02 250 / 0.1)"
  pending: "oklch(0.52 0.13 70)"
  danger: "oklch(0.52 0.19 25)"
  gc-grey: "#5f6368"
  gc-blue: "#1a73e8"
  gc-cyan: "#007b83"
  gc-green: "#188038"
  gc-yellow: "#f9ab00"
  gc-orange: "#fa903e"
  gc-pink: "#d01884"
  gc-purple: "#a142f4"
  gc-red: "#d93025"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "calc(17px * var(--scale))"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "calc(15px * var(--scale))"
    fontWeight: 650
    lineHeight: 1.25
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "calc(13px * var(--scale))"
    fontWeight: 400
    lineHeight: 1.4
  body-strong:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "calc(13px * var(--scale))"
    fontWeight: 550
    lineHeight: 1.25
  control:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "calc(12px * var(--scale))"
    fontWeight: 550
    lineHeight: 1
  note:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "calc(12px * var(--scale))"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "calc(11px * var(--scale))"
    fontWeight: 600
    lineHeight: 1
  key:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "calc(10.5px * var(--scale))"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  swatch: "3px"
  key: "5px"
  badge: "6px"
  control-sm: "7px"
  control: "8px"
  row: "9px"
  pill-bar: "10px"
  track: "11px"
  slip: "12px"
  sheet: "14px"
  command: "16px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "16px"
  3xl: "24px"
  row: "calc(32px * var(--scale))"
  row-tall: "calc(36px * var(--scale))"
components:
  command-pill:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink-3}"
    typography: "{typography.body}"
    rounded: "{rounded.pill-bar}"
    padding: "0 8px 0 10px"
    height: "34px"
  command-pill-hover:
    backgroundColor: "{colors.glass-hover}"
  view-tabs:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.track}"
    padding: "3px"
  view-tab:
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 6px"
    height: "26px"
  view-tab-active:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.ink}"
  space-sheet:
    backgroundColor: "{colors.glass-sheet}"
    rounded: "{rounded.sheet}"
    padding: "10px 8px 8px"
  tab-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.row}"
    padding: "0 8px"
    height: "{spacing.row}"
  tab-row-hover:
    backgroundColor: "{colors.glass-hover}"
  tab-row-active:
    backgroundColor: "{colors.pill}"
    typography: "{typography.body-strong}"
  space-row:
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill-bar}"
    padding: "0 8px 0 10px"
    height: "{spacing.row-tall}"
  space-row-current:
    backgroundColor: "{colors.pill}"
  space-row-switching:
    backgroundColor: "{colors.space-accent-soft}"
  text-button:
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 9px"
    height: "28px"
  text-button-hover:
    backgroundColor: "{colors.glass-hover}"
    textColor: "{colors.ink}"
  text-button-switch:
    textColor: "{colors.space-accent}"
  plate-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.pill}"
    rounded: "{rounded.row}"
    padding: "0 12px"
    height: "30px"
  plate-button-switch:
    backgroundColor: "{colors.space-accent}"
    textColor: "{colors.on-accent}"
  plate-button-outline:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.ink}"
  icon-button:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.row}"
    size: "32px"
  icon-button-pressed:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.ink}"
  typed-input:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  badge:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.badge}"
    padding: "0 7px"
    height: "20px"
  badge-here:
    backgroundColor: "{colors.space-accent-soft}"
    textColor: "{colors.space-accent}"
  command-bar:
    backgroundColor: "{colors.glass-strong}"
    rounded: "{rounded.command}"
    width: "min(600px, 100%)"
  command-item:
    typography: "{typography.body-strong}"
    rounded: "{rounded.row}"
    padding: "0 10px"
    height: "{spacing.row-tall}"
  command-item-selected:
    backgroundColor: "{colors.space-accent}"
    textColor: "{colors.on-accent}"
  slip:
    backgroundColor: "{colors.glass-strong}"
    rounded: "{rounded.slip}"
    padding: "8px 8px 8px 12px"
  settings-sheet:
    backgroundColor: "{colors.glass-strong}"
    rounded: "{rounded.sheet}"
    padding: "12px 14px 14px"
  color-chip:
    rounded: "{rounded.full}"
    size: "20px"
---

# Design System: Spaces

## Overview

**Creative North Star: "The Space's Own Light"**

Spaces is a Chrome side panel (320px and up) and a dashboard tab, drawn in the language of Arc's sidebar. Each Space has a colour, and that colour is not a label on a row: it floods the whole ground as a soft pastel mesh of three blurred OKLCH blobs. Everything the user touches sits on that light as frosted white glass. Switching Spaces is the light changing: the hue sweeps across the ground over 700ms while the sheet in front of it pulls to the next Space.

Density is Arc-quiet: 32px tab rows, favicon plus title in the system sans, hairline section breaks with one quiet trailing action, and a single opaque white pill marking the current tab. Colour is spent almost entirely on one field, the ground; controls stay neutral glass, and the Space hue returns only where the user is choosing (selection, focus, the switch action). Ink itself is tinted by the Space hue, so even type belongs to the Space it sits in. A Space is never identified by colour alone: its name, colour dot, and number key always travel together.

The system is fully parametric. Three registered custom properties (`--space-h`, `--space-c`, `--space-spread`) drive every tinted token, so the frontmatter values are the resolved defaults for a Space with no colour (hue 250, chroma 0.07, spread 140). Dark mode re-derives the same formulas at low lightness rather than swapping to a separate palette.

**Key Characteristics:**
- One coloured field per screen: the ground mesh, in the current Space's hue.
- Frosted glass sheets (backdrop saturate 1.6, blur 24px) with a 0.5px white inner edge.
- The active item is an opaque white pill with a soft lifted shadow.
- Tinted ink: every text grey carries the Space hue at low chroma.
- The light glides between Spaces; reduced motion makes it instant.
- Space colours come from Chrome's tab-group palette, minus red.

## Colors

A single variable hue, applied as light on the ground and as ink tint everywhere, with neutral white glass between.

### Primary
- **Space Accent** (space-accent; `oklch(0.5 0.17 var(--space-h))`, dark `oklch(0.56 0.15 var(--space-h))`): the Space's hue at full strength. Used for the selected command-bar result, focus rings, the text caret and checkboxes, the switch action (the filled switch plate button and the accent text button), the "Here" and device badges, and the next-up time. Never a row or container fill at rest.
- **Accent Wash** (space-accent-soft; the accent at 14% alpha, dark 18%): text selection, search-match highlights, the input focus halo, the "Here" badge ground, and the Space row mid-switch.
- **On Accent** (on-accent): white text on the accent fill.

### Secondary
- **Tab-group colours** (gc-grey through gc-purple; lighter dark-mode variants `#dadce0`, `#8ab4f8`, `#78d9ec`, `#81c995`, `#fdd663`, `#fcad70`, `#ff8bcb`, `#c58af9`): Chrome's own tab-group colours, used only as identity swatches: the round Space dot beside a Space name, the rounded-square group swatch in a tab list, the edit-mode colour chips, and command-bar dots. Each Space colour maps to a light setting (hue, chroma, spread) that tints the ground; grey is near-achromatic (chroma 0.018), no colour is a wide-spread neutral mesh.
- **Tab-group red** (gc-red): exists because Chrome tab groups the user made can be red; it is never offered as a Space colour.

### Neutral
- **Ground** (ground; `oklch(0.935 calc(var(--space-c) * 0.65) var(--space-h))`, dark L 0.2): the page base under the mesh.
- **Light Blobs** (blob-a at the Space hue, blob-b at hue + spread, blob-c at hue − 0.6 × spread; L 0.84 / 0.89 / 0.86, dark 0.36 / 0.3 / 0.28): three radial gradients fixed to the viewport (top-left, right, bottom) that make the light.
- **Ink** (ink / ink-2 / ink-3; L 0.24 / 0.4 / 0.5 at chroma 0.02 in the Space hue, dark L 0.96 / 0.83 / 0.72): primary text, secondary text and idle controls, and tertiary meta, placeholders and section labels. ink-3 is held at 4.5:1 or better on glass.
- **Pill** (pill; white, dark `oklch(0.36 0.02 var(--space-h))`): the one opaque surface; see the rule below.
- **Glass** (glass 50%, glass-hover 62%, glass-strong 78%, glass-sheet 40% white; dark 6% / 10% white and tinted 72% / 42% translucents): glass is the command pill and view-tab track, glass-hover is every row and button hover, glass-strong is floating layers (slips, command bar, settings sheets, next-up), and glass-sheet is the Space sheet, kept thin on purpose.
- **Edge and Hairline** (edge: 70% white 0.5px inset highlight on glass; hairline: ink at 10%): glass rims, and 0.5px dividers, badge grounds and the segmented track inside sheets.
- **Pending** (pending, amber `oklch(0.52 0.13 70)`, dark L 0.8) and **Danger** (danger, `oklch(0.52 0.19 25)`, dark L 0.76 chroma 0.13): a pending-sync badge, and destructive text buttons (Delete). Text only, never fills.

### Named Rules
**The Ground Light Rule.** Colour is spent on the ground. Row and control fills stay neutral glass; the Space hue comes forward only for selection, focus, state badges tied to this Space, and the switch action. Identity swatches (the colour dot, group squares) are the only other colour on a row.

**The Tinted Ink Rule.** Every text grey, hairline and shadow is mixed with `--space-h`. Never use a pure neutral grey for ink; it would read as a different Space.

**The Tab-Group Palette Rule.** A Space's colour is one of Chrome's tab-group colours minus red (blue, cyan, green, yellow, orange, pink, purple, grey), or none. Red stays reserved for danger.

## Typography

**UI Font:** the platform system sans (`-apple-system`, SF Pro Text, Segoe UI Variable, system-ui)
**Key Font:** the platform monospace (`ui-monospace`, SF Mono, Menlo), for key caps and number keys only

**Character:** Browser-chrome type. The panel sits beside Chrome's own UI, so it speaks the OS face at small sizes and carries hierarchy through weight (400 / 550 / 600 / 650) rather than size. There is no display face; the largest step is the 17px Space name.

### Hierarchy
- **Headline** (650, 17px, 1.25, −0.01em): the current Space's name on its sheet.
- **Title** (650, 15px, 1.25): sheet titles on Resources, History, Suspended, Today and settings pages.
- **Body** (400, 13px, 1.4): tab titles, fields, notes in rows. The command-bar input steps up to 15px.
- **Body Strong** (550, 13px): the active tab, Space names in the list, command results.
- **Control** (550, 12px): view tabs, segments, text buttons.
- **Note** (400, 12px, 1.5 to 1.55): hints and empty-state lines, capped at 70ch.
- **Label** (600, 11px): section breaks ("Other Spaces"), group headers, command-bar groups, field labels, meta, counts. Sentence case, no tracking.
- **Key** (600 mono, 10.5px, tabular): key caps (⌘K, 1 to 9) and number keys on Space rows.

All steps multiply by `--scale` (the user's text-size setting).

### Named Rules
**The Four-Fit Rule.** The view tabs are capped at the default size (`12px × min(--scale, 1)`) so all four (Spaces, Today, History, Suspended) fit a 320px panel at any text size. The in-sheet segmented control may grow to 1.15×.

**The Weight-Not-Size Rule.** Emphasis is a weight step (550 for current, 650 for titles), not a bigger size. Counts, times and keys use tabular numerals.

## Layout

The side panel is a single column with 10px outer padding: a header row (command pill plus two 32px icon buttons, 6px apart), the view-tab track (12px below), the current Space sheet (16px below), then a hairline divider and the list of other Spaces, then a key-hint line. Tab rows are 32px (`--row`); Space rows and command results are 36px. Row insets are 8px horizontal, and rows inside a sheet sit flush to 8px sheet padding so the white pill nearly meets the glass edge.

The dashboard (home tab) centres at max 1320px with 22px / 28px padding: a sidebar column of 280 to 340px and a main column, 24px apart; Space sheets tile at min 320px with 16px gaps. With Today present, the agenda takes a third column (300 to 380px) at 1360px and up (max width 1680px) and sits above the sidebar below that. Under 760px everything stacks to one column. Sidebar and agenda columns are sticky at 16px.

Spacing is a tight 2 / 4 / 6 / 8 / 10 / 12 / 16 / 24px ladder; 2px separates segments and buttons in a row, 8px is the default gap.

## Elevation & Depth

Depth is glass over light plus two soft, hue-tinted shadows. Layers stack as: the fixed ground mesh; glass sheets (backdrop blur 24px, saturate 1.6) with a 0.5px white inner edge; the opaque white pill; and, on top, the command bar with a heavier blur (30px, saturate 1.8) over a faintly tinted scrim. Shadows are ambient and tinted with the Space hue in light mode, pure black at higher alpha in dark mode. There are no hard or offset shadows.

### Shadow Vocabulary
- **Pill lift** (`0 1px 1px oklch(0.2 0.02 h / 0.06), 0 2px 6px -1px oklch(0.2 0.02 h / 0.12)`): the active tab, selected segment, pressed icon button, current Space row, live agenda row, plate buttons, next-up bar.
- **Sheet float** (`0 1px 2px oklch(0.2 0.03 h / 0.05), 0 12px 32px -12px oklch(0.25 0.05 h / 0.28)`): the Space sheet, settings sheets, slips.
- **Command float** (`0 24px 60px -16px oklch(0.2 0.05 h / 0.45)`): the command bar only.

### Named Rules
**The One Opaque Pill Rule.** Opaque white means "this one": the current tab, the selected segment, the pressed toggle, the current Space row, the live agenda row, and fields you type into. Containers are always translucent; the Space sheet is kept at 40% so the active tab's pill is the brightest thing on it.

**The Gliding Light Rule.** Switching Spaces transitions the registered `--space-h` over 700ms (`cubic-bezier(0.22, 1, 0.36, 1)`), with chroma and spread easing alongside, so the whole ground, ink and shadows sweep to the new hue together. Under reduced motion the change is instant.

## Shapes

Soft, continuous rounding that grows with the surface: 3px group swatches, 5px key caps, 6px badges, 7 to 8px controls and fields, 9px rows and buttons, 10px command pill and Space rows, 11px view-tab track, 12px slips, 14px sheets, 16px command bar. Inner radii sit 2 to 3px under their container so nested pills read concentric. Space identity dots and colour chips are circles; group swatches are rounded squares, so the two never get confused. Borders are almost absent: glass gets a 0.5px inset edge, dividers are 0.5px hairlines, and icons are one authored 16px set at 1.5 stroke with round joins in `currentColor`.

## Components

### Buttons
- **Shape:** 9px for plate and icon buttons, 8px for text buttons.
- **Plate (primary):** ink fill with pill-coloured text, 30px tall, 12px padding, 600 at 12.5px, pill lift. Hover brightens 12%.
- **Plate, switch:** the accent fill with white text. Switching Spaces is the one control that carries the hue.
- **Plate, outline:** a white pill with ink text and a hairline ring; hover drops to strong glass.
- **Text button:** transparent, ink-2, 28px, control type; hover gains glass and ink. The switch variant is accent text; the danger variant is danger text.
- **Icon button:** 32px square (24px small), transparent, ink-2 icon; hover glass; pressed (`aria-pressed`) becomes the white pill.
- **Focus:** a 2px accent outline, 2px offset, on every focusable element.

### Badges
- **Style:** 20px, 6px radius, hairline ground, 600 at 10.5px, ink-2. "Here" uses the accent wash with accent text; device names use accent text; pending uses amber; offline is an outline; error inverts to ink. A new badge scales in over 220ms.

### Cards / Containers
- **Space sheet:** 14px radius, 40% glass, sheet float plus white edge, 10 / 8 / 8px padding. Head row: number key, colour dot, 17px name, badges; meta in 11px ink-3 below.
- **Settings sheet:** a fieldset as a 78% glass sheet, 14px radius, 12 to 14px padding, its legend as a 13px 650 title inside it.
- **Slip:** a floating 78% glass strip (12px radius) for prompts and undo, sliding in over 260ms; the error slip inverts to ink.

### Inputs / Fields
- **Style:** a white pill field, 32px, 8px radius, a hairline inset ring and a faint inner top shadow; labels in 11px 600 ink-2 above.
- **Focus:** a 1px accent inset ring plus a 2px accent-wash halo.
- **Inline rename:** the Space name becomes a 30px pill field with an accent ring, in headline type.

### Navigation
- **Command pill:** a 34px glass bar at the top of the panel ("Search Spaces and tabs", ⌘K key cap), ink-3 placeholder, hover to glass-hover.
- **View tabs:** a glass segmented track (3px padding, 11px radius, 2px gaps); segments are 26px, sized to their label, ink-2; the selected view is the white pill. The same control, on a hairline track, chooses options inside sheets.
- **Tab rows:** favicon (16px, 4px radius) plus title, 32px, 9px radius; hover glass; the active tab is the white pill at 550. Grouped tabs indent 26px under an 11px group header with its square swatch.
- **Section divider:** an 11px ink-3 label, a 0.5px hairline filling the row, and one quiet trailing text action (for example "Suspend tabs").
- **Space rows:** 36px rows of name, count, badges and number key; hover glass; the current Space is the white pill; the row being switched to takes the accent wash.

### Command Bar
A centred 600px glass layer (78%, 30px blur, 16px radius, command float) that drops in over 180ms under a lightly tinted scrim, 48px from the top in the panel and 14vh on the dashboard. A 48px input row at 15px sits above grouped results (11px group labels); each result is a 36px row with a colour dot, label and trailing meta. The selected result is filled with the Space accent in white text: the one place a row takes the hue.

### Edit Mode
The Space sheet gains a colour row of 20px round chips (Chrome's colours minus red, plus a "none" chip struck through on white); the chosen chip gets a 2px ink ring at 2px offset. Rows grow to 34px and show move and remove icon buttons at the right; the action row becomes Rename, Delete (danger), and Done as an outline plate.

### Today
An agenda sheet of 32px rows (time column 5.4em in tabular 11px 600 ink-3, name, marks). The live event is the white pill; past events drop to ink-3. A next-up bar (34px, strong glass, pill lift) sits above with its time in accent.
### Tasks
Below the Space sheet, a divider ("Tasks", refresh icon, "Open in Vikunja") over 32px rows: a 16px round check (1.5px ink-3 ring) and the title. Checking off is the section's one authored moment. The ring fills with ink with a brief press, and the tick draws in pill colour (180ms). A 1px strike then sweeps across the words only (260ms, after 160ms), the title fades to ink-3, and the row folds shut (260ms) at 440ms. A task added here rises 8px out of the add field below it. One that arrives from Vikunja or BusyCal on a refresh rises the same way, then its strong-glass glow fades over 1.4s. One finished elsewhere folds away. The list's first appearance staggers 30ms per row, capped at 6 rows. Under reduced motion there is no movement: rows fade in and out, and the check, strike and glow change instantly or by colour.

## Do's and Don'ts

### Do:
- **Do** derive every tinted value from `--space-h`, `--space-c` and `--space-spread`, so a Space switch re-tints ground, ink, hairlines and shadows together.
- **Do** keep the Space sheet at 40% glass and floating layers at 78%, so the opaque pill stays the brightest surface.
- **Do** mark the current item with the white pill and pill lift (current tab, view, Space, live event, pressed toggle).
- **Do** pair every Space colour with its name and number key; colour is never the only cue.
- **Do** transition `--space-h` over 700ms on switch and make it instant under `prefers-reduced-motion`.
- **Do** cap the view tabs at 12px × min(scale, 1) so four fit a 320px panel.
- **Do** use 0.5px hairlines with a single trailing text action for section breaks.

### Don't:
- **Don't** fill rows, buttons or containers with the Space hue at rest; the accent fill is reserved for the selected command result and the switch plate button.
- **Don't** offer red as a Space colour; it is reserved for destructive actions.
- **Don't** use neutral, untinted greys for ink or hairlines.
- **Don't** make a container opaque, or give the Space sheet more than 40% white.
- **Don't** use hard or offset shadows; depth is blur, translucency and soft tinted lift.
- **Don't** introduce a display face or grow the type ramp past the 17px Space name; hierarchy is weight.
