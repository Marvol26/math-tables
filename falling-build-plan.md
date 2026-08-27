# Falling numbers — build plan (executor brief)

```
plan_version: 1
date: 2026-08-27
domain: personal
autonomy: L1 auto — executor proceeds; the push (WP-F7) and any deletion/overwrite of files not created in this cycle require Marat's immediate yes
designer: Claude Fable 5 (session 651c8ef0)
executor: Sonnet, fresh session, cwd = this folder
baseline: commit 067aed3 on main (sw v8 / app 0.7.0 / core.js?v=0.7.0), 110/110 tests
decision doc: docs/FALLING-DESIGN.md (settled; F1–F10 are the spec)
project rules: CLAUDE.md (read it — versions in three places, strings in T, numbers in CONFIG, first-attempt-only KPIs, escapeHtml)
status log: math-build-status.md (append-only, format in math-build-plan.md §8)
```

## 0. Executor contract
1. Obey plan v1. Run the preflight (§6) before touching files. 2. Work the packages in order, one step at a time; append a status-log entry after every step. 3. `docs/FALLING-DESIGN.md`, `docs/DESIGN.md`, `docs/MAP-DESIGN.md` are settled and immutable to you; if reality contradicts them, stop that step, log the evidence, escalate to Marat. 4. Never edit settled content. 5. The batch is not done until WP-F8 (closing adversarial review) has returned SHIP and that is in the status log. 6. Do not push without Marat's yes.

## 1. Context manifest (read in this order)
1. This plan. 2. `docs/FALLING-DESIGN.md`. 3. `CLAUDE.md`. 4. `core.js` sections `CONFIG`, `Facts`, `Economy`, `Selector`, `SessionCore` (start/paint/submit/finish), `Stats`, `Migrate` — read them fully; you will extend `SessionCore.finish` and `Migrate`. 5. `index.html`: `T`, `Screens.home`, `Screens.question`/`renderQuestion`/`paintNextQuestion`/`submitAnswer`/`showFeedback`/`finishSession`, `renderSettingsSection`/`wireSettingsSection`, `renderStatsSection` (history rows), `sw.js`. 6. `tests/session-core.test.js` and `tests/selector.test.js` for the existing test style (injected rng/now, no mocks of core).

Decision summary: a second, optional game mode; same 10-fact plan; the child taps one of ≥4 falling bubbles; hard distractors; coins/stickers yes, mastery/map/carryover no; timeout = bubbles land and stay tappable; exit/resume as in typed mode; parent enables it and sets duration and option count.

## 2. Hard gates
- HG-1 `git status --porcelain` shows nothing except `.claude/`; `git rev-parse --short HEAD` = `067aed3` (or a later commit whose status-log entry you can read). Drift ⇒ log + escalate.
- HG-2 `npm test` → 110 passing.
- HG-3 `node --version` ≥ 20.

## 3. Work packages

### WP-F1 — Core: distractors + mode-aware session (tier: Sonnet; strong-model review at WP-F8)
Grants: write `core.js`, `tests/**`; egress none.
- **F1-1** `CONFIG.FALLING = { DEFAULT_DURATION_SEC: 8, MIN_DURATION_SEC: 3, MAX_DURATION_SEC: 20, DEFAULT_OPTIONS: 4, MIN_OPTIONS: 4, MAX_OPTIONS: 6, FILL_WINDOW: 20 }`. Add `Falling` module: `distractors(a, b, count, rng)` per FALLING-DESIGN F7 (priority list → unique → ≠ p → 1…100 → take `count`; fill from other facts' products within ±FILL_WINDOW of p, then anything). `candidates(a, b, options, rng)` → shuffled array containing p exactly once. Export `Falling`. Done-when: `tests/falling.test.js` — count, uniqueness, ≠ p, range, ≥1 same-table neighbour for 7×8 / 6×9 / 3×4, determinism for a fixed rng, `candidates` contains p once for all 55 facts × options 4/5/6.
- **F1-2** `SessionCore.start(state, rng, now, opts)` accepts `opts.mode` ("typed" default | "falling"); stores `active.mode`; `paint` unchanged; `submit` records `attempt.mode = active.mode`. `finish()`: when `active.mode === "falling"` → coins/ledger (same ids), streak/perfect/near bonuses, unlocks, session record (`mode:"falling"`), `masteredAfter` computed but **no** `Facts.updateFromAttempt`, **no** carryover change (`state.carryover` stays as it was), **no** `Map.newlyReached` (stationsReached = []). Typed mode behaviour byte-identical (existing tests must stay green without edits). Done-when: tests — falling finish leaves `facts`, `carryover`, `map.reached` deep-equal to before; coins/ledger/session recorded with `mode:"falling"`; retries inside a falling session still 0 coins; typed session unchanged.
- **F1-3** `Migrate`: `settings.falling` default `{ enabled:false, durationSec:8, options:4 }`; `active.mode`/`session.mode` default "typed" on load; `validateImport`: `settings.falling` shape if present (numbers within CONFIG ranges, enabled boolean), old sessions without `mode` accepted. `Stats`: exclude attempts with `mode:"falling"` from `perFactTable`, `sessionAvgMs`, accuracy trend, weakest, mastery-count — they still appear in `trends.coins` and history. Done-when: tests for defaults, validation accept/reject, and a fixture proving a falling session does not move accuracy/avgMs/mastered trends but does move coins.
- **F1-gate** `npm test` green; a fresh Agent (`model: "fable"`) reviews `git diff 067aed3..HEAD` for core only: "assume the author was wrong; hunt for falling attempts leaking into mastery/map/carryover, distractor sets that include the answer twice or trivial distractors, typed-mode regressions." Fix findings with regression tests. Record in the status log.

### WP-F2 — Parent settings + Home entry (tier: Sonnet)
Grants: write `index.html`; egress none.
- **F2-1** `T.parent.falling*` strings (feminine where child-facing; parent strings plural as elsewhere), settings block: enable checkbox, duration range (CONFIG min/max), options select 4/5/6; saved via the existing `save-settings` handler. Done-when: values persist across reload; sliders clamp to CONFIG.
- **F2-2** Home: button `data-action="play-falling"` "מספרים נופלים 🎈" shown only when `settings.falling.enabled`; if `state.active` exists, Home shows a single resume button whose label carries 🎈 when `active.mode === "falling"`, and the other mode's button is hidden (one session at a time). Done-when: both states render correctly via `#screen=home`.

### WP-F3 — Falling question screen (tier: Sonnet)
Grants: write `index.html`; egress none.
- **F3-1** `Screens.question` dispatches on `active.mode`: typed → existing `renderQuestion`; falling → `renderFallingQuestion`. Shared: dots, coin badge, exit buttons, `paintNextQuestion` (nextFrame), `submitAnswer(value)` path, `showFeedback`, `finishSession`. `renderFallingQuestion`: expression card (`.equation.ltr`, no input), a `.lanes` area (flex, `options` columns), one `.bubble` per candidate positioned in a lane at `top:-80px`, CSS `animation: bubble-fall var(--fall) linear forwards` with `--fall = settings.falling.durationSec` (snapshot from `active.settingsSnapshot`; add `falling` to the snapshot at start), `animationend` → mark `landed` (bubble stays at the bottom, keeps `pointer-events`), show "נחתו! אפשר לבחור בנחת 🙂". Tap/click on a bubble → `submitAnswer(Number(bubble.dataset.value))`; keyboard 1–N (left→right lane index) does the same on desktop. `withinLimit` must come from core (`shownAt` + `timeLimitSec`): set the falling session's `settingsSnapshot.challengeOn = true` and `timeLimitSec = durationSec` so `SessionCore.submit` computes the ×2 exactly as in Challenge Mode — no separate timing code. Interrupted/resumed question (`current.interrupted`) → bubbles render already landed, no ×2. `prefers-reduced-motion`: bubbles appear landed immediately. Done-when: full falling session playable in Chrome desktop (keys 1–4) and in device emulation (taps) with the numpad never shown; a wrong tap shows the picture and waits for "הבנתי"; landed bubbles still tappable; exit + resume returns to the same fact with landed bubbles.
- **F3-2** Layout: bubbles ≥ 64 px, lanes fit 4–6 columns at 320 px width (bubble 56 px at 6 lanes), landscape rule (`max-height:420px and min-width:480px`) keeps the expression and lanes side by side; `100dvh`, safe-area insets. Done-when: screenshots at 320×568, 375×667, 568×320, 820×1180 with all bubbles visible and tappable.
- **F3-3** Summary title shows 🎈 for falling sessions; parent history rows show 🎈 for `mode:"falling"`. Done-when: visible in a live check.

### WP-F4 — Versions + docs (tier: Sonnet)
Grants: write `sw.js`, `index.html` (version lines), `README.md`, `CLAUDE.md`, `NEXT-ACTIONS.md`.
- **F4-1** Bump the version in the **three** places (CLAUDE.md rule 7): `sw.js` VERSION v8 → v9 and `core.js?v=0.7.0` → `0.8.0` in `PRECACHE_URLS`; `index.html` `APP_VERSION` 0.8.0 and `<script src="core.js?v=0.8.0">`. Done-when: `grep -c "0.8.0" index.html sw.js` = 2 and 1; `grep -c '"v9"' sw.js` = 1.
- **F4-2** README (Hebrew + English): one paragraph on the mode, how to enable it, that it earns coins but does not count toward the map. CLAUDE.md: add `Falling` to the core section list and `renderFallingQuestion` to the UI list. NEXT-ACTIONS: anything deferred.

### WP-F5 — Live verification (tier: Sonnet, browser tools)
Serve locally (`python3 -m http.server 8766 --bind 127.0.0.1` from the project root). **Before every check**, in the tab: unregister service workers, delete caches, `fetch('index.html',{cache:'reload'})`, `fetch('core.js?v=0.8.0',{cache:'reload'})`, then load `index.html?v=<commit>` (the status log documents the stale-cache trap twice). Checklist → PASS/FAIL with evidence in the status log: enable mode in parent view → Home button appears → play a full falling session: correct tap (confetti, coins), fast tap before landing (fast badge, ×2), wrong tap (picture + הבנתי + re-ask at end), let one land (label, still tappable, base coins) → summary with 🎈 → parent history 🎈 → parent stats unchanged for accuracy/mastery (compare a typed vs falling session) → exit mid-session + resume → typed mode still works exactly as before.

### WP-F6 — Tests + status log
`npm test` green (expect ≥ 125). Every step logged.

### WP-F7 — Deploy (gated)
Ask Marat: "Push 0.8.0?" Only on his explicit yes: `git push origin main`, then poll `https://marvol26.github.io/math-tables/sw.js` until `VERSION = "v9"`. Record the result.

### WP-F8 — Closing review (unconditional)
**Invoke the `adversarial-review` skill (Skill tool, global) over the full diff `067aed3..HEAD`; if the Skill tool or the skill is unavailable, follow the inline fallback:** spawn a fresh zero-context Agent with `model: "fable"`, give it the full diff plus `docs/FALLING-DESIGN.md`, tell it to assume the author was wrong and hunt for: falling attempts leaking into mastery/map/carryover/speed stats; distractor sets containing the answer twice or trivially far values; a stuck `feedbackLock`; bubbles unreachable on small screens; typed-mode regressions; XSS in any new interpolation (candidate values must be numbers); masculine Hebrew addressed to the child; version bump completeness. Fix every MEDIUM+ with a regression test proven to fail on the pre-fix code, then a fix-verification pass until SHIP. Record in the status log. The cycle is not done before this.

## 4. Autonomy envelope
Decide alone: bubble visuals/colours within the palette, animation curves, lane layout details, test structure, Hebrew phrasing in the feminine register, exact CONFIG.FALLING defaults within the ranges in FALLING-DESIGN. Escalate: any change to F1–F10, any change to typed-mode behaviour, new dependencies (none allowed), anything outward-facing (push), deleting/overwriting files not created in this cycle, a failing empirical check.

## 5. Invariants (regression if violated)
- I-F1 A falling session never changes `facts`, `carryover`, `map.reached`, or any accuracy/speed/mastery statistic.
- I-F2 Every candidate set has exactly one correct value, `options` unique values, all within 1…100.
- I-F3 Typed mode is byte-for-byte unchanged in behaviour (existing tests untouched and green).
- I-F4 `withinLimit` for falling comes from `SessionCore.submit` (shownAt + timeLimitSec), never from UI timers.
- I-F5 Landed bubbles remain tappable; a landing is never recorded as a miss.
- I-F6 All new strings in `T`, all numbers in `CONFIG`, every interpolated value a number or `escapeHtml`'d.
- I-F7 Version bumped in three places before any push.

## 6. Preflight
`git rev-parse --short HEAD` = `067aed3` (or later, with a status-log entry explaining), clean tree, `npm test` 110/110, node ≥ 20. Record the result as the first status-log entry.

## 7. Kickoff prompt (paste into a NEW session after `/model sonnet`, cwd = project root)
```
You are the executor for the "מספרים נופלים" (falling numbers) game mode of לוח הכפל. Read, in this order: falling-build-plan.md (fully), docs/FALLING-DESIGN.md, CLAUDE.md, then the core.js and index.html sections the plan's context manifest names.
Before changing ANY file: (1) acknowledge the plan version (must be 1); (2) run the hard gates HG-1..HG-3 and the preflight in plan §6 and append the results to math-build-status.md in the format used there; (3) state which step is current (fresh start ⇒ WP-F1 F1-1); (4) confirm the autonomy level in the plan header (L1 auto) and the escalation categories in §4.
Then execute WP-F1 → WP-F8 in order, one step at a time, appending a status-log entry after every step. docs/FALLING-DESIGN.md, docs/DESIGN.md and docs/MAP-DESIGN.md are settled and immutable to you — if reality contradicts them, stop that step, log the evidence, and escalate to Marat. Typed mode must not change. WP-F7 (push) requires Marat's explicit yes first.
The batch is NOT done until WP-F8 — the adversarial-review skill (or its inline fallback in the plan) over the full diff 067aed3..HEAD — has run, its MEDIUM+ findings are fixed with regression tests proven to fail on the pre-fix code, its fix-verification pass returned SHIP, and that is recorded in math-build-status.md. Green tests are not evidence of correctness.
```
