# Design gaps

The shell follows the handoff in the agent store (`tokens.json`, `tailwind.config.cjs`, and `sources/*.html`) for Figma file `SQTyJdMUAGvbk08UMuAdlC`, nodes `1:2` through `1:20`. Those files match `SHA256SUMS.json`. The checksum file also lists `evidence/` and `png/`, and those paths were not in the store. The comparison PNGs already in `web/design/references/` are the earlier frame exports.

## Tokens now in use

`web/tailwind.config.cjs` merges the handoff snippet. Accent colors are the handoff hex values. Page, card, text, muted, border, and inactive colors are the same hex values, stored as CSS variables so Finance home can use the dark set.

DM Sans is the handoff file `DM-Sans-variable.ttf` (SHA-256 `8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d`), self-hosted with `next/font/local`. The license is `web/fonts/OFL.txt`. `next/font/local` serves that file and sets `font-display: block`. Global CSS sets `font-optical-sizing: auto` and `font-variation-settings: normal`, as `sources/dm-sans.css` does. It is not the Google font download used before.

Earlier text colors were darkened so small labels cleared WCAG AA. Those overrides are gone. The handoff uses the same hex for fills and for small accent text. On white, `#2E8B6A` is 4.19:1, `#3A86C8` is 3.87:1, `#E07A5F` is 2.95:1, `#E9B949` is 1.83:1, and `#8E7CC3` is 3.61:1. White on `#2E8B6A` is 4.19:1, on `#3A86C8` is 3.87:1, and on `#C2577A` is 4.25:1. Muted `#6B746E` on `#F5F6F4` is 4.45:1. Dark muted `#8C978F` on `#0E1310` is 6.20:1. The short pairs are the approved literals, not a new palette.

## What the handoff still does not specify

- Frames and the HTML mock are one 390 by 844 viewport. The HTML continues below that (Finance recent rows and the extra weekly caps). Those rows are on the page because they are in the HTML. The raster clips them.
- The status bar, time, and home indicator are device chrome and are not part of the page.
- Dark mode exists only for Finance home. The sun control on More sets that preference and does not darken More.
- Icons in the HTML are inline and labeled lucide-style by the mock generator. `web/components/Icon.tsx` keeps simple stand-ins. Category tiles use a tinted square without those paths.
- Names, amounts, and dates are the HTML example copy. They are not mapped from the API or from SQLite.
- The sparkline paths are the HTML series. They are not a read from the API.
- From 1024px the bottom bar becomes a left nav. The handoff says desktop layout was not designed.
- Finance home does not show the section tabs. Those tabs are on Goals and Dining Out. Accounts has no frame.
- The More HTML draws an "Amount < 0" chip and also a positive payroll row. The chip starts off so the pictured rows stay visible.
- Sheets add a close button, Escape, and a Tab loop. The HTML does not show those controls.
- Controls that look tappable stay on the page and do not call the API.

## API

Fixture route handlers in Next.js remain the synthetic path. The FastAPI service is still optional and has no host config.
