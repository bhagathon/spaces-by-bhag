---
name: Spaces
description: A steel card-catalog drawer for tab contexts; this window's Space is the card pulled up and read.
colors:
  drawer: "#d4dad2"
  drawer-deep: "#c5ccc3"
  pressboard: "#b7c2ba"
  pressboard-ink: "#2f3b35"
  card: "#fbfaf6"
  card-edge: "#cdc9bc"
  ruling: "#d9e3ec"
  ink: "#23211d"
  ink-2: "#57534b"
  ink-3: "#6f6a60"
  red: "#b3301c"
  on-red: "#ffffff"
  stamp-blue: "#2b4968"
  stamp-amber: "#7f5310"
typography:
  display:
    fontFamily: "'Courier Prime', 'Courier New', monospace"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'Courier Prime', 'Courier New', monospace"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "'Courier Prime', 'Courier New', monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  meta:
    fontFamily: "'Courier Prime', 'Courier New', monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  callno:
    fontFamily: "'Courier Prime', 'Courier New', monospace"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: "16px"
    fontFeature: "tnum"
  ui:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  stamp:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Segoe UI', sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: "14px"
    letterSpacing: "0.1em"
rounded:
  swatch: "1px"
  stock: "2px"
  holder: "3px"
  tab: "4px 4px 0 0"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  line: "20px"
  lg: "24px"
components:
  plate-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card}"
    typography: "{typography.label}"
    rounded: "{rounded.stock}"
    padding: "0 12px"
    height: "30px"
  plate-button-pull:
    backgroundColor: "{colors.red}"
    textColor: "{colors.on-red}"
    typography: "{typography.label}"
    rounded: "{rounded.stock}"
    padding: "0 12px"
    height: "30px"
  plate-button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.stock}"
    padding: "0 12px"
    height: "30px"
  text-button:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    padding: "2px 0"
  text-button-hover:
    textColor: "{colors.ink}"
  text-button-pull:
    textColor: "{colors.red}"
  stamp:
    textColor: "{colors.ink-2}"
    typography: "{typography.stamp}"
    rounded: "{rounded.stock}"
    padding: "1px 5px 0"
  stamp-here:
    textColor: "{colors.ink}"
  stamp-device:
    textColor: "{colors.stamp-blue}"
  stamp-pending:
    textColor: "{colors.stamp-amber}"
  callno:
    textColor: "{colors.ink-2}"
    typography: "{typography.callno}"
    rounded: "{rounded.stock}"
    padding: "1px 4px 0"
  pulled-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.stock}"
    padding: "12px 14px"
  card-top:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "6px 8px 6px 6px"
    height: "36px"
  drawer:
    backgroundColor: "{colors.drawer-deep}"
    rounded: "{rounded.holder}"
    padding: "8px 8px 12px"
  guide-name:
    backgroundColor: "{colors.pressboard}"
    textColor: "{colors.pressboard-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.tab}"
    padding: "3px 10px 2px"
  guide-tab-active:
    backgroundColor: "{colors.pressboard}"
    textColor: "{colors.pressboard-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.tab}"
    padding: "5px 10px 4px"
  label-holder:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.holder}"
    padding: "0 8px"
    height: "32px"
  typed-input:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "4px 0 3px"
---

# Design System: Spaces

## Overview

**Creative North Star: "The Card Catalog"**

Spaces is a steel card cabinet docked beside real work. The grey-green drawer is the ground; every Space is a typed index card standing in it; workspaces are pressboard guide cards with protruding tabs. The window's own Space is the card pulled up and read in full, sitting above the drawer with a red top rule. Every other Space is a one-line card top you flick to by call number. Rank is physical: how far a card is pulled up, never a badge or a highlighted row.

The system is dense and quiet, built to be read at a glance at 320 to 480px and to stay out of the page's way all day. Entries are typed in a typewriter face on faint blue ruling at a fixed 20px pitch. State is rubber-stamped in a fixed right-hand cell (HERE, OPEN, device name, PENDING, VIEW ONLY) in ink colours that are never red. Absence is drawn as a blank card waiting to be typed, never as an illustration. The world explicitly refuses the rounded-card SaaS sidebar with a highlighted row and a purple accent.

Light and dark are the same cabinet under different light: in dark the steel goes deep green-black, the stock goes charcoal, the ink goes to warm paper white, and red lightens to a coral so the pulled card's rule still reads.

**Key Characteristics:**
- Typed ink (Courier Prime, self-hosted) for everything a card says; a small uppercase system sans only for guide tabs, stamps, field labels and actions.
- One accent, red, spent only on the pulled card's top rule and the act of pulling.
- State marks are stamped, bordered in their own ink, in a fixed cell.
- Rank and focus expressed as lift (translateY), not colour.
- Corners are cut stock: 2px on cards, 3px on the drawer and label holder, 4px top-only on guide tabs.
- The card pull is the signature motion: a view transition carries the card top into the pulled slot and files the old card down.

## Colors

A muted steel-and-stock palette of greys, greens and warm off-whites, with one red and two stamp inks.

### Primary
- **Pulled-Card Red** (`red`): the 3px top rule of the pulled card, the transient 2px top rule on a card top while it is being pulled, the "Switch this window" plate, and the pull text action. Nowhere else. Dark scheme: #ee7c65, with `on-red` becoming #1b1a17 so the plate's label stays legible.

### Secondary
- **Device Stamp Blue** (`stamp-blue`): the stamp naming another device that has the Space open, and (at 22% mix) the find-match highlight behind matched characters in card tops. Dark: #93b3d4.
- **Pending Stamp Amber** (`stamp-amber`): the PENDING sync stamp only. Dark: #d9a95a.

### Neutral
- **Steel Drawer** (`drawer`): the page ground behind everything. Dark: #172019.
- **Drawer Interior** (`drawer-deep`): inside the drawer, behind the standing card tops; carries an inset shadow. Dark: #101812.
- **Pressboard** (`pressboard`) with **Pressboard Ink** (`pressboard-ink`): guide-card tabs (workspace names), the active view tab, and settings fieldset legends. Dark: #2c3530 / #c9d3cc.
- **Card Stock** (`card`): every card, the label holder, slips, keycaps. Dark: #262825.
- **Cut Edge** (`card-edge`): 1px borders of stock, dashed action dividers, the plain top rule of blank and verso cards. Dark: #3a3d38.
- **Blue Ruling** (`ruling`): the 1px ruled lines under typed entries and list rows. Dark: #2f3841.
- **Typed Ink** (`ink`): primary text, the ink plate button, focus rings, checkbox accent, error slips (reversed). Dark: #ebe7dc.
- **Light Strike** (`ink-2`): secondary text, idle actions, default stamps, call numbers. Dark: #bcb7aa.
- **Faint Strike** (`ink-3`): meta lines, placeholders, field labels; held at 4.5:1 or better on stock. Dark: #a19c90.

### Named Rules
**The One Red Rule.** Red belongs to one card and one act: the pulled card's top rule and pulling. The dashboard's verso card, blank cards, selected tabs and focus rings take stock edge or ink, never red.

**The Space Colour Rule.** A Space may carry one of Chrome's tab-group colours (never red), shown only as a small square swatch (9px on card tops, 11px on the pulled card) beside its name, with a hairline ink edge so pale inks still read. It matches the Space's tab group in the tab strip. Colour is an identifier, never a fill, row tint or border: rank is still pull height. Tokens `--gc-*` hold Chrome's light values and its dark-theme set.

**The Stamp Ink Rule.** State is stamped in ink, blue, or amber, bordered in its own colour (1.5px). Errors reverse to an ink plate. No state is ever red.

## Typography

**Display Font:** Courier Prime (with Courier New, monospace), self-hosted woff2, 400 / 400 italic / 700.
**Label Font:** the system sans stack (-apple-system, BlinkMacSystemFont, Helvetica Neue, Segoe UI).

**Character:** A typewriter face for everything written on a card, and a small, tracked, uppercase sans for the cabinet's printed furniture (tab labels, stamps, button legends). The sans never names a Space.

### Hierarchy
- **Display** (700, 18px, 1.2, -0.01em): the pulled card's Space name, and its rename input.
- **Headline** (700, 15px, 1.2): the wordmark, verso title, page-card titles (History, Suspended, Settings).
- **Body** (400, 13px, 20px line): typed entries, resources, find field, typed inputs. Line height equals the ruling pitch so text sits on the lines. Active tab entry and card-top names go to 700.
- **Meta** (400, 11px, 1.4): card meta line, card-top sub line, tab counts, log rows.
- **Call number** (700, 11px, 16px, tabular numerals): the boxed key number on each card.
- **UI** (400, 13px, 1.45, sans): body default for checkboxes and settings controls.
- **Note** (400, 12px, 1.55, sans, ink-3): hints and explanatory prose. Sentences are read, not scanned, so they sit a step above the 11px label size.
- **Label** (600 to 700, 11px, 0.06 to 0.1em, uppercase, sans): guide tabs, view tabs, tab-group headings, field labels, text and plate buttons.
- **Stamp** (700, 10px, 14px, 0.1em, uppercase, sans): state marks only.

### Named Rules
**The Typed Card Rule.** Anything a user wrote or a card records (names, tab titles, notes, counts) is set in Courier Prime. Sans is only for printed cabinet furniture.

**The Ruling Pitch Rule.** Body line height on a card is the ruling pitch (20px); ruled backgrounds and list rows are built from the same value so type and lines never drift.

## Layout

The panel is a single column at 320 to 480px: padding 10px 12px 28px. Top to bottom: the drawer front (wordmark, sync stamp, 32px icon buttons), the guide-tab view switcher, any slips, the pulled card at full width, then the drawer with its find field (the label holder) at the top, guide cards per workspace, and one-line card tops. A keyboard hint strip of keycaps closes the drawer.

A card top is a four-column grid: 24px call number, flexible name and sub line, a 4.6em count cell, and a 4.8em stamp cell. The stamp cell is fixed so stamps align down the drawer.

The dashboard centres at max 1240px with 24px padding. It sets the drawer in a sticky 300 to 380px column beside the opened card, and lays the card flat with recto and verso side by side (auto-fit, min 320px, 16px gap) instead of flipping it. Page cards cap at 720px; hint prose at 70ch. Below 760px the dashboard collapses to the single column.

Spacing moves in small steps: 2, 4, 8, 12 and 24px, with 10px and 14px used inside cards and the 20px ruling pitch for typed rows.

## Elevation & Depth

Depth is physical and shallow: cards are stock resting in or above a steel drawer. Shadows exist only as the consequence of that material, never as a decoration or a rank badge. The drawer is recessed (an inset shadow); card stock rests with a thin contact shadow; a card top lifts on hover, focus or keyboard "next", and the opened card on the dashboard stands higher. How far a card is lifted is the only elevation signal.

### Shadow Vocabulary
- **Resting stock** (`box-shadow: 0 1px 1px color-mix(in srgb, var(--ink) 10%, transparent), 0 6px 14px -8px color-mix(in srgb, var(--ink) 28%, transparent)`): pulled card, page cards.
- **Drawer recess** (`box-shadow: inset 0 2px 5px color-mix(in srgb, var(--ink) 14%, transparent)`): the drawer interior.
- **Label holder** (`box-shadow: inset 0 1px 0 color-mix(in srgb, var(--ink) 6%, transparent)`): the find field.
- **Lifted card top** (`transform: translateY(-3px); box-shadow: 0 4px 6px -4px color-mix(in srgb, var(--ink) 35%, transparent)`): hover, focus-visible, next.
- **Opened card top** (`translateY(-6px); box-shadow: 0 6px 8px -5px color-mix(in srgb, var(--ink) 40%, transparent)`): the dashboard's opened Space.
- **Pulling** (`translateY(-8px)` with a 2px red top border): the card mid-pull.

### Named Rules
**The Pull-Height Rule.** Rank is how far a card is pulled: 0, -3px, -6px, -8px. Never a fill colour, badge, or accent bar on a row.

## Shapes

Cut stock and pressed metal. Cards take 2px corners (2px 2px 3px 3px on a full card, 2px 2px 0 0 on a card top, since its bottom is hidden in the drawer). The drawer, label holder, keycaps and icon buttons take 3px. Guide tabs and legends are 4px top-only tabs with no bottom border, so they join what sits beneath them. Stamps and call numbers are 2px bordered boxes. Typed inputs have no box at all: a 1.5px underline, like a blank on a form. Dashed 1px stock-edge lines divide a card's actions from its entries and mark empty-drawer notes.

## Components

### Buttons
Tactile but quiet: typed actions on the card and one ink plate.
- **Shape:** squared stock (2px), 30px tall, 0 12px padding, uppercase tracked sans label.
- **Ink plate:** ink fill with stock-coloured label; hover mixes 14% stock into the ink. Disabled at 40% opacity.
- **Pull plate:** the only red fill in the system, reserved for switching this window to a Space.
- **Outline plate:** stock fill, ink label and border; hover tints 6% ink.
- **Text button:** no box, ink-2 uppercase label, underline appears on hover (3px offset). The pull variant is red; the confirm-delete variant is ink and underlined at rest.
- **Icon button:** 32px square, transparent border that becomes a stock edge on hover. Icons are one authored set: 16px grid, 1.5 stroke, round joins, currentColor.
- **Focus:** 2px solid ink outline, 2px offset, everywhere.

### Stamps
- **Style:** 1.5px border in the stamp's own colour, 2px corners, 10px uppercase sans at 0.1em.
- **States:** HERE in ink; OPEN and VIEW ONLY in ink-2; device name in blue (truncated at 12ch); PENDING in amber; offline dashed; error reversed to an ink plate; quiet (no border) for passive sync text.

### Cards / Containers
- **Pulled card:** stock, cut-edge border, 3px red top rule, 12px 14px padding, resting shadow. Head: call number, display name, stamp cell. Then the meta line, ruled typed entries with tab-group headings (colour swatch plus uppercase label), and a dashed-rule action footer.
- **Blank card:** a pulled card whose top rule is cut edge, with a typed lede and underline fields; this is how an unfiled window is drawn.
- **Verso:** the card's back, holding resources. In the panel the card turns over (rotateY 88deg out in 130ms, in in 170ms). On the dashboard it sits flat beside the recto with a stock-edge top rule.
- **Page card:** History, Suspended and Settings are filed as cards (12px 14px padding); settings groups are stock fieldsets under pressboard legends.
- **Slip:** a notice on stock with a 2px corner; an error slip reverses to an ink plate.

### Inputs / Fields
- **Label holder (find):** a 32px stock plate with a 3px corner, inset top shadow, search icon, typed placeholder and a `/` keycap. Focus puts a 2px ink ring on the whole holder.
- **Typed input:** no box; 1.5px underline at 55% ink, typed text. Focus darkens the underline to full ink and doubles it with a 1.5px shadow line.
- **Labels:** uppercase 11px sans in ink-3 above the field.
- **Checkbox:** native, 14px, ink accent. Done tasks strike through in ink-3.

### Navigation
- **Guide tabs:** the view switcher (Spaces, History, Suspended, Settings) is a row of uppercase sans tabs on a 22% ink baseline. The active tab becomes a pressboard guide card that joins the baseline; idle tabs are ink-2 and go to ink on hover.
- **Keyboard hints:** keycaps (stock, 1px edge with a 2px bottom, 3px corner, 11px bold typed) name each shortcut in the drawer's hint strip.

### The Drawer (signature)
The recessed drawer holds guide cards (pressboard tabs with a rule running out to the right) and, under each, card tops that overlap by 1px like stacked stock. Pressing a call number or Enter pulls a card: a view transition (260ms, cubic-bezier(0.2, 0.8, 0.2, 1)) carries it up into the pulled slot while the old card files down. All motion is removed under reduced motion.

### Added since 1.3.1 (same cabinet)
The Arc redesign (1.4–1.5.14) was rolled back to this world in 1.5.15; features added meanwhile are drawn here:
- **Find field → command bar.** The label-holder field in the drawer front opens ⌘K (or /): a card pulled over the drawer (red top rule, card stock, a 1.5px ink rule under a Type Step-1 input), results typed on its ruling, groups as small uppercase sans labels, and the picked line typed over in ink (ink ground, card-coloured type). The ⌘K window is the same card, full-window.
- **Dividers.** A section title (small uppercase sans, ink-2), a dashed card-edge rule, and quiet uppercase text actions: "In the drawer … Suspend tabs", "Tasks … ↻ Open in Vikunja".
- **Tasks card.** A card below the drawer with its tasks typed on the ruling. The check is a 13px typed box that inks in and gets a tick in card colour. The strike is typed across the words only, and the row fades away. The add line is a ruled entry led by a drawn plus.
- **Tab lines are buttons.** A tab's line on a card goes to that tab. Hover underlines its title in card-edge.
- **Animations** (Settings → Display) are off by default. Off, `:root[data-motion='off']` removes every animation and transition, and switches skip the view transition. Card tops still stand up on hover (a static lift).

## Do's and Don'ts

### Do:
- **Do** set every name, entry, note and count in Courier Prime on the 20px ruling pitch.
- **Do** keep red to the pulled card's 3px top rule, the pull plate and the pulling card top.
- **Do** express state as a bordered stamp in the fixed right cell, in ink, blue or amber.
- **Do** show rank and focus by lifting a card (-3, -6, -8px), not by filling a row.
- **Do** draw empty states as blank or dashed stock with a typed sentence.
- **Do** use the 2px ink focus ring on every interactive element and keep every core action on a key.
- **Do** join the active guide tab to the surface below it with pressboard fill and no bottom border.

### Don't:
- **Don't** use red for state, errors, focus, selection or a second card; errors reverse to ink.
- **Don't** highlight the current row with a fill or accent bar, or add rank badges.
- **Don't** round corners beyond 4px or use pill shapes; this is cut stock.
- **Don't** set a Space name or typed content in the sans; the sans is for printed labels only.
- **Don't** add shadows that aren't the consequence of stock resting, lifting or sitting in the drawer.
- **Don't** use remote fonts or icon packages; fonts ship in static/fonts and icons come from the one authored 16px set.
