# Design gaps

The shell follows the handoff in the agent store (`tokens.json`, `tailwind.config.cjs`, and `sources/*.html`) for Figma file `SQTyJdMUAGvbk08UMuAdlC`, nodes `1:2` through `1:20`. Those files match `SHA256SUMS.json`. The checksum file also lists `evidence/` and `png/`, and those paths were not in the store. The comparison PNGs already in `web/design/references/` are the earlier frame exports.

## Tokens now in use

`web/tailwind.config.cjs` merges the handoff snippet. Accent colors are the handoff hex values. Page, card, text, muted, border, and inactive colors are the same hex values, stored as CSS variables so Finance home can use the dark set.

DM Sans is the handoff file `DM-Sans-variable.ttf` (SHA-256 `8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d`), self-hosted with `next/font/local`. The license is `web/fonts/OFL.txt`. `next/font/local` serves that file and sets `font-display: block`. Global CSS sets `font-optical-sizing: auto` and `font-variation-settings: normal`, as `sources/dm-sans.css` does. It is not the Google font download used before.

Earlier text colors were darkened so small labels cleared WCAG AA. Those overrides are gone. The handoff uses the same hex for fills and for small accent text. On white, `#2E8B6A` is 4.19:1, `#3A86C8` is 3.87:1, `#E07A5F` is 2.95:1, `#E9B949` is 1.83:1, and `#8E7CC3` is 3.61:1. White on `#2E8B6A` is 4.19:1, on `#3A86C8` is 3.87:1, and on `#C2577A` is 4.25:1. Muted `#6B746E` on `#F5F6F4` is 4.45:1. Dark muted `#8C978F` on `#0E1310` is 6.20:1. The short pairs are the approved literals, not a new palette.

## Slice 1 — Finance and navigation

Built from Figma file `SQTyJdMUAGvbk08UMuAdlC`, page `joehub Mobile v1` (`0:1`). The frames checked on 7 Nov 2026 are still flattened images. Geometry comes from the handoff HTML, which matches `SHA256SUMS.json` (`HANDOFF.md` `8a7eab4d8f70fe06f431a181b0942977caad49b767489624724feb811eae1665`).

Frames used: `1:4` Finance home, `1:6` Finance home dark, `1:8` Finance goals, `1:10` Finance category and sheet, and the bottom tab bar drawn on those frames (the same marks as `1:2`). Jobs (`1:12`, `1:14`), Journal (`1:16`, `1:18`), More (`1:20`), and the Home body (`1:2`) are later slices.

The 390px column stays centered past the phone width.

## Artie's answers

Recorded 7 Nov 2026. READY FOR BUILD unless the line says EXPLORATORY.

- READY FOR BUILD. The range chevron sits to the right of the chart-period pills. Only the YTD series is drawn.
- READY FOR BUILD. Edit caps sits beside the Weekly caps header. It opens one editor for all six caps. That editor is not designed yet, so `/finance/caps` is a placeholder and does not save.
- READY FOR BUILD. A goal chevron opens a read-only goal detail inside Finance. That detail is not designed yet, so the page is a placeholder and does not save.
- READY FOR BUILD. Accounts is a Finance sub-view, never a sixth app tab. The accounts screen is not designed yet, so `/finance/accounts` is a placeholder and does not save.
- READY FOR BUILD. Goal rows have no swipe. The swipe hint belongs to the Finance subtab strip and stays outside the scrolling tabs.
- EXPLORATORY. A two-column layout at 1024px and up is not built. Desktop keeps the 390px column centered.

## Still unspecified

- The category pencil, "Edit name", and the `$80` cap chip have no editing result. Save does not write anything.
- "Categories" opens the only designed category screen, Dining Out. A category index is not drawn.
- "New goal" does not create a goal.
- What the $4,204 plan, the pace marker, and the weekly caps mean as live figures is not in the handoff. The numbers on screen are the HTML examples.

## What the handoff still does not specify

- Frames and the HTML mock are one 390 by 844 viewport. The HTML continues below that (Finance recent rows and the extra weekly caps). Those rows are on the page because they are in the HTML. The raster clips them.
- The status bar, time, and home indicator are device chrome and are not part of the page.
- Dark mode exists only for Finance home. The sun control on More sets that preference and does not darken More.
- Tab and Finance marks use the HTML paths. The More sun control is still a stand-in. The generator called the paths lucide-style. They are not a verified Lucide export.
- Names, amounts, and dates are the HTML example copy. They are not mapped from the API or from SQLite.
- The sparkline paths are the HTML series. They are not a read from the API.
- Finance home does not show the section tabs. Those tabs are on the Finance sub-views. Accounts has no designed frame, so the page is a placeholder.
- The More HTML draws an "Amount < 0" chip and also a positive payroll row. The chip starts off so the pictured rows stay visible.
- Sheets add Escape and a Tab loop. The HTML shows a close mark and does not specify keyboard behavior. Opening the category sheet moves focus to that close control, so the focus outline is visible. The frame does not draw that outline.
- Controls that look tappable stay on the page and do not call the API.

## API

Fixture route handlers in Next.js remain the synthetic path. The FastAPI service is still optional and has no host config.

## Slice 2 — Jobs pipeline and job detail

Design version v2. Local handoff only. `v2/PUBLICATION-BLOCKED.md` says the Figma page was not created, so these frames have no Figma node ids. The zip at `/workspace/joehub-design/joehub-v2-designs.zip` was not on the box, and the uploaded zip has no `v2-jobs/README.md`. This slice is built from `v2/sources/J01` through `J09` and `v2/manifest.json`.

Frames built, all marked READY FOR BUILD:

- `J01-pipeline-full`
- `J02-pipeline-loading`
- `J03-pipeline-empty`
- `J04-pipeline-error`
- `J05-detail-full`
- `J06-stage-01-applied`
- `J07-stage-02-choose`
- `J08-stage-03-saved`
- `J09-stage-04-failed`

Filled job actions use `#2C6CA6`. Loading, empty, and error are fixture views at `/jobs?view=loading`, `/jobs?view=empty`, and `/jobs?view=error`. The stage screens are `/jobs/globex/stage`, with `?sheet=open`, `?notice=saved`, and `?notice=failed`. Nothing is written. A stage change, note edit, save, dismiss, filter, or add-role control shows "Demo only. Nothing was saved."

The board row scrolls on its own. The jobs section links scroll on their own, and the swipe hint sits outside that scroller. The page stays the centered 390px column. No jobs frame draws a wider layout.

Empty and error cards follow Artie's round-2 tokens: left-aligned text, the shared 20px card radius, 16px page inset and padding, actions outside the card, and a 16px gap above those actions. The Jobs header uses only the shared 8px top inset from the app shell.

## Jobs gaps

- `v2-jobs/README.md` was not in the available zip.
- Empty and error cards follow the round-2 layout tokens. The form behind Add a role is still outside this batch.
- Filter has no result.
- "See all 24" has no destination.
- "drag cards · swipe" is a label. Stage change does not use drag and drop, and no drag result is drawn.
- The swipe hint is not a gesture.
- Add a role has no form in this batch.
- J04 describes a stale banner when a cache exists. That banner is not drawn, and no refresh control is drawn.
- The detail "more" control has no menu. The more-menu frames are EXPLORATORY and are not built.
- Open posting has no URL.
- Only Globex has a detail frame. The other board cards do not open a page.
- Save stage previews the stage the user picked, then shows "Demo only. Nothing was saved." It does not persist, send mail, create a calendar event, or invent a next-step date. Closing the sheet drops a preview that has not finished.
- Undo stays on the page. The history control for after the notice expires is not drawn.
- Explore matches opens the fixture matches on the populated pipeline. An empty matches list is not drawn.
- Loading, empty, and error are query views of the fixtures. They are not a network load.
