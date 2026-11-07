# Design gaps

The shell follows Artie's flattened frames in Figma file `SQTyJdMUAGvbk08UMuAdlC`, nodes `1:2` through `1:20`. The zip described as `uploads/` (HANDOFF.md, tokens.json, tailwind.config.cjs, HTML references, the font files, and their license) was not in the workspace. Choices below are not approved by that missing package.

## Sampled, not supplied

- `web/tailwind.config.cjs` and the color variables in `web/app/globals.css` were sampled from the frame pixels. Names such as `canvas`, `finance`, and `journal` are local names.
- Fills that match the frames: canvas `#f5f6f4`, card `#ffffff`, ink `#1f2a24`, line `#e6e8e4`, finance `#2e8b6a`, jobs `#3a86c8`, journal `#c2577a`, spent `#e07a5f`, gold `#e9b949`. Dark finance home: canvas `#0e1310`, card `#161d18`, line `#26302a`, ink `#ecf1ee`.
- Text and white-on-button colors are darker than those fills so body text and button labels reach WCAG AA 4.5:1. Chart bars, rings, and the sparkline keep the sampled fills. Gold and coral are not used as small text colors.
- DM Sans is loaded with `next/font`. The font files and license from the zip were not available.
- Reference PNGs in `web/design/references/` are the flattened frames, saved for comparison. They are not the page.

## What the frames do not specify

- Frames are one phone viewport, 390 by 844, and they are flattened images. Nothing below that viewport was designed. Pages stop at the content that is visible there, plus the short accounts list noted on that screen.
- The status bar, time, and home indicator are device chrome and are not part of the page.
- Dark mode exists only for Finance home (`1:6`). Every other screen stays light. The sun control on More sets that finance-home preference and does not darken More.
- Icons were unresolved. The icons in `web/components/Icon.tsx` are simple stand-ins.
- Names, amounts, and dates are the frames' example copy. They are not mapped from the API, the contract fixtures, or SQLite. The API still serves `contract/fixtures.json`.
- Charts and rings are reconstructed shapes. They are not a series from the read API.
- From 768px the column widens. From 1024px the bottom bar becomes a left nav. Neither breakpoint is in the frames.
- Finance home does not show the section tabs. Those tabs are on Goals and the category sheet's page, where the frames draw them. Accounts has no frame. That page says so and lists the synthetic fixture accounts.
- The More frame draws an "Amount < 0" chip and also a positive payroll row. The chip starts off so the pictured rows stay visible. Turning it on hides inflows. "Search 412 rows" is the frame's example placeholder. The table has the 14 example rows.
- Jobs tabs other than the pipeline, and Journal tabs other than the feed, jump within the designed content. They are not extra screens.
- Controls that look tappable in a static frame stay on the page: chart range, recategorize, job status, notes, the journal composer, and table filters. They do not call the API and they are not saved.
- Sheets add a close button, an Escape key, and a Tab loop. The frames do not show those controls. The category sheet opens with the page so the first view matches frame `1:10`. The journal composer opens from the add button or `?compose=1`.

## API

Fixture route handlers in Next.js remain the synthetic path. The FastAPI service is still optional and has no host config.
