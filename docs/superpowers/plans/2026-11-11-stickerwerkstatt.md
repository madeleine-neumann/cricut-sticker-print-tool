# Stickerwerkstatt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-ruby:subagent-driven-development (recommended) or superpowers-ruby:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing single-page interface with the approved bilingual Stickerwerkstatt, preserve calculation and export behavior, and publish its static build through GitHub Pages under MIT.

**Architecture:** Svelte owns UI and application state. The existing calculation engine becomes an importable module without DOM dependencies. Focused services handle image input, sticker rendering, sheet layout, browser downloads, and translation. Vite builds the static app for the repository subpath.

**Tech Stack:** Svelte 5, TypeScript, Vite, CSS, Node test runner, GitHub Actions.

---

## File map

- `src/lib/engine/*`: existing pure algorithms, made importable without changing calculations.
- `src/lib/stickers.ts`: input images, DPI, pixel bounds and per-sticker computation.
- `src/lib/sheets.ts`: existing grid and nesting behavior adapted to a typed app API.
- `src/lib/export.ts`: PNG, SVG, PDF and print downloads.
- `src/lib/i18n.ts`, `src/lib/locales/{de,en}.ts`: locale choice, translations and formatting.
- `src/lib/state.svelte.ts`: motif collection, selection, settings and derived status.
- `src/components/*`: header, step navigation, motif list, cut controls, sheet controls, two previews, export actions, status.
- `src/App.svelte`, `src/app.css`, `src/main.ts`, `index.html`: application shell and design system.
- `public/*`: only owned, licensed static assets required by the application; no legacy illustrations or sample image.
- `tests/*`: preserved algorithm regressions and new locale, app flow and export tests.
- `.github/workflows/pages.yml`, `vite.config.ts`, `package.json`, `README.md`, `LICENSE`: build and publication.

## Task 1: Establish a buildable static Svelte shell

**Files:** Modify `package.json`, `index.html`; create `vite.config.ts`, `tsconfig.json`, `src/main.ts`, `src/App.svelte`, `src/app.css`, `.gitignore`.

- [x] Write a smoke test in `tests/build-smoke.test.cjs` that runs `npm run build` and asserts `dist/index.html` and a referenced JS asset exist.
- [x] Run the smoke test; it failed against the old build script as expected.
- [x] Add Svelte, Vite, TypeScript and the Svelte Vite plugin. Set `base: '/cricut-sticker-print-tool/'` in `vite.config.ts` and output to `dist`.
- [x] Mount `<App />` from `src/main.ts`; show a semantic page title, language control and three step buttons in `src/App.svelte`.
- [x] Add `.gitignore` entries for `node_modules/` and `dist/`. Create the lockfile, run `npm ci`, `npm test`, and the build smoke test; all passed. Add `svelte-check` and prevent 320px header overflow after review.
- [x] Commit with `feat: establish Svelte app shell` and follow-up `fix: keep shell header within narrow viewports`.

## Task 2: Preserve the calculation engine as a module

**Files:** Move `src/engine/01-mask.js` through `04-formats.js` to `src/lib/engine/`; create `src/lib/engine/index.js`; modify `tests/border.test.cjs`.

- [x] Add a compatibility test that compares representative bleed, cut-path, PNG DPI and sheet layout output from the old `assets/engine.js` with the new module.
- [x] Run the compatibility test; expect module import failure.
- [x] Keep algorithm bodies unchanged. Export their named functions and constants through `src/lib/engine/index.js`; remove reliance on concatenation order in the new app. Retain the old bundle as a comparison fixture and as the old offline archive's runtime until Task 7 removes that archive after replacement verification.
- [x] Run existing and new engine tests; require exact output parity for fixed inputs.
- [x] Commit with `refactor: expose sticker engine as modules`.

## Task 3: Add two complete locales

**Files:** Create `src/lib/i18n.ts`, `src/lib/locales/de.ts`, `src/lib/locales/en.ts`; modify `src/App.svelte`; create `tests/i18n.test.cjs`.

- [x] Test locale detection: stored `en` overrides browser `de`, browser `de` applies on first visit, other languages fall back to `en`.
- [x] Test that German and English dictionaries have identical keys and that parameterized messages substitute values safely.
- [x] Implement `locale`, `setLocale`, `t(key, params)`, and `formatNumber(value)` with `Intl.NumberFormat`. Set document language on change and store user choice in local storage.
- [x] Translate all labels, help, warnings, status and guide content; render the DE / EN switch as two buttons with an announced selected state.
- [x] Run locale tests and build; commit with `feat: add German and English UI`.

## Task 4: Move motif input and sticker computation into Svelte state

**Files:** Create `src/lib/stickers.ts`, `src/lib/state.svelte.ts`, `src/components/MotifList.svelte`, `src/components/CutControls.svelte`, `src/components/StickerPreview.svelte`; modify `src/App.svelte`.

- [x] Test loading PNG/WebP files, rejecting unsupported or oversize files, reading PNG DPI, removing/selecting motifs, and defaults for height, copies and cut options.
- [x] Test the adapter against a simple pixel fixture: output dimensions, cut path and print mask must match the old application.
- [x] Port the existing image loading and result calculation from `src/app/01-designs.js` and `02-preview-export.js` into typed services. Keep image pixels in memory and never upload them.
- [x] Implement accessible upload, motif list, precise numeric controls, secondary sliders and advanced disclosure. Preview uses canvas and SVG overlay, with a textual size/quality summary. Do not include sample images.
- [x] Run tests and exercise upload, selection, cut preview and warnings in a browser. Commit with `feat: build motif and cut workspace`.

## Task 5: Move sheet planning and exports

**Files:** Create `src/lib/sheets.ts`, `src/lib/export.ts`, `src/components/SheetControls.svelte`, `src/components/SheetPreview.svelte`, `src/components/ExportActions.svelte`; modify `src/App.svelte`.

- [x] Test A4, Letter and Cricut formats, copies, margins, grid and nesting, rotation, and no-fit errors against existing outputs.
- [x] Test generated PNG DPI metadata, SVG physical size and cut path, and PDF page dimensions with a small fixed fixture.
- [x] Port layout and rendering from `src/app/03-sheet.js` and download/print behavior from `04-downloads.js`. Preserve all currently supported output formats and the special Cricut mat options.
- [x] Group export actions by purpose while keeping separate PNG, PDF, SVG, combined SVG and print choices. Disable actions while results are stale or computing.
- [x] Run tests and manually download each format. Commit with `feat: build sheet and export workspace`.

## Task 6: Complete visual design and accessibility

**Files:** Modify `src/app.css`, `src/App.svelte`, `src/components/*`; add any local font assets under `public/fonts/` after license verification.

- [ ] Match the approved visual direction: cool paper surface, navy text, cobalt actions, mint/peach/lavender details, restrained peel-corner motif, large preview and minimal decoration.
- [ ] Check desktop and mobile layouts at narrow and wide viewports; preserve visible preview access and a reachable primary action.
- [ ] Check keyboard order, visible focus, labels and error associations, live status, contrast, reduced motion and canvas text alternatives.
- [ ] Fix issues found in those checks; run all tests and build. Commit with `style: finish accessible sticker workshop`.

## Task 7: Publish and document

**Files:** Create `LICENSE`, `.github/workflows/pages.yml`; modify `README.md`; remove obsolete checked-in generated bundles and offline ZIP only after replacement build/export is verified.

- [x] Use the confirmed code ownership for the MIT license. Remove the old illustrations and sample image; verify licensing of any new fonts or assets.
- [x] Document local development, build, tests, language behavior, privacy, output formats and the distinction between print file and Cricut cut file in German and English.
- [x] Add a GitHub Actions workflow that runs `npm ci`, tests, `npm run build`, uploads `dist`, then deploys it to Pages with `pages: write` and `id-token: write`.
- [x] Run production preview under `/cricut-sticker-print-tool/`; confirm assets and downloads resolve under the subpath (the sample image and separate guide page were removed; the guide is part of the app).
- [x] Commit with `ci: publish Stickerwerkstatt to GitHub Pages`; push `main` to the user-provided repository and confirm the Pages URL is live.

## Final verification

- [ ] Run the full test suite and production build with no errors.
- [ ] Verify representative PNG, SVG and PDF exports plus browser print.
- [ ] Check German and English UI on desktop and mobile, including keyboard access and reduced motion.
- [ ] Check the deployed Pages site under its repository URL and report any remaining limits.
