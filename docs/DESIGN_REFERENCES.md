# Design research record

Required by the rulebook (section 1.1) before UI work. Checked on **2026-11-05** by fetching each page's current text.
Fetched pages that render client-side may return little text; where that happened it is stated, and nothing is claimed
beyond what was read.

## Reference matrix

| Reference | URL | What was observed | Decision | Licence / terms | Accessibility | Performance |
|---|---|---|---|---|---|---|
| Motion (Framer Motion successor) | https://motion.dev/ , /docs/react-accessibility | React/JS/Vue animation library; "free and open source" (licence name not stated on the pages read). `MotionConfig reducedMotion="user"` disables transform and layout animation when the OS asks; `useReducedMotion` hook exists | **Not used.** The rulebook says start with CSS; every animation here is a 120-200 ms CSS transition/keyframe, disabled by `prefers-reduced-motion` and by the Motion setting | not verified (name not stated) | Pattern adopted (honour the OS setting, with a manual override), implemented in CSS | Avoids a dependency. The old draft depended on `framer-motion` and was removed |
| Realtime Colors | https://www.realtimecolors.com/ | Previews text / background / primary / secondary / accent on a realistic page; fonts selectable; exports CSS / Tailwind / SCSS. Its contrast indicator is **pass / warn / fail only, no numeric ratio** | Used as a *method* reference. Real ratios are computed by `scripts/contrast.mjs` | not applicable (no code reused) | Numeric WCAG ratios are needed for the record, so a script computes them (136 checks) | none |
| Fontshare | https://www.fontshare.com/ , /terms | Both pages returned only the title "Fontshare: Quality Fonts. Free." The licence text could **not** be read (client-rendered) | **Not used.** Without readable terms, self-hosting and redistribution rights are unverified | **unknown** | n/a | n/a |

Not visited (no claim made about them): Godly, 21st.dev, Watermelon UI, Lenis, React Spring, Paper Shaders and the other
names in the rulebook inventory. Only three references were evaluated, one of them inconclusive; the rulebook's
"evaluate at least three" is met in count, not in depth.

## Typography (decision)

Instrument Sans Variable (UI) and JetBrains Mono Variable (code), both SIL Open Font License, installed from npm
(`@fontsource-variable/*`) and bundled, so there is no request to a font CDN (works offline, no third-party tracking).

## Two visual directions compared

| | A. Graphite + ember (chosen) | B. Paper-first |
|---|---|---|
| Idea | Warm charcoal surfaces, one amber accent, text tags next to every colour | Light paper background, ink text, burnt-orange accent |
| Fit | Editors are used for long sessions; dark default respects `prefers-color-scheme` only when the user's OS asks | Great for reading, weaker for code focus |
| Result | Shipped as the `graphite` theme | Shipped too, as `paper`, plus `contrast` (high contrast) |

The theme defaults to "follow system", so neither direction is forced. Purple-on-dark defaults and gradient blobs, which
the earlier draft used, were removed.

## Human-design acceptance test (rulebook 1.4)

* First screen is the workspace, not a marketing page: the empty state offers New file, Import ZIP, templates.
* No fabricated data: the draft's fake "extensions marketplace" (invented download counts and authors) was deleted.
* Real content in templates (a steeping timer, a prime sieve, a tally counter), real empty / error states, text next to colour.
* Mobile: bottom navigation, no horizontal overflow at 360, 640 and 740 px widths (A-07, A-08).
