# Next actions (post-cycle)

Deferred items from this build cycle, in no particular order. None block
shipping v1 — the app is fully functional without any of these.

## Visual / audio polish (deliberately trimmed in WP3-5, see math-build-status.md)
- CSS confetti on a correct answer (currently: a green flash only).
- An actual coin-flying-to-the-pill animation (currently: the value badge
  just updates its text to "+N").
- A count-up animation on the summary screen's coin total (currently:
  static number).
- A streak flame badge (the +2 streak bonus itself works; there's no visual
  badge for it yet).
- WebAudio blips for correct/wrong/unlock, honouring `settings.sound`
  (explicitly optional per the plan; `settings.sound` toggle exists and is
  wired in the parent settings, just nothing plays yet).

## Icon artwork (PA-3)
`tools/make-icons.py` generates a placeholder icon (solid blue background +
geometric white ×). Real artwork — Marat's call on style/illustrator — would
replace this script's output (or the script entirely) before a "real" launch
impression matters. The manifest/head wiring (sizes, `apple-touch-icon`,
`purpose: any maskable`) doesn't need to change, just the PNG content.

## CONFIG tuning after real play-testing
All economy numbers are simulated (`tools/simulate-economy.js`: weak 149 /
average 62 / strong 55 sessions to full collection) but not yet validated
against an actual 8-year-old playing daily. After a few weeks of real use,
revisit:
- `CONFIG.UNLOCK_BASE` / `UNLOCK_STEP` (currently tuned so an average child
  finishes in ~60 sessions — DESIGN's original estimate was 60–90).
- `CONFIG.STREAK_BONUS` / `PERFECT_BONUS` / `NEAR_PERFECT_BONUS` sizes.
- `CONFIG.DEFAULT_TIME_LIMIT_SEC` (10s) once Challenge Mode gets real use.
- `CONFIG.STICKERS` — the 24-sticker list is a placeholder set (design §13
  explicitly lists the sticker set as open/CONFIG-tunable); swap for
  something more delightful once real icon artwork exists.

## Multi-profile migration path
DESIGN D7: single child profile in v1, but the schema was written to allow a
later `profiles` migration. No concrete migration plan exists yet — if a
second child ever needs profiles, this needs actual design work (a new
`Migrate` step, a profile-switcher UI, `state.facts`/`state.sessions`
becoming per-profile) before it's a small change.

## WP8 — empirical device verification (not yet run; needs Marat)
The build plan's WP8 checklist (11 items) covers device/browser behavior this
session could only partially verify from a desktop Chrome emulator:
- Items 1–8, 10–11 (desktop Chrome/Safari session mechanics, two-window
  staleness, export/import round-trip, mastery transitions, Challenge Mode,
  perfect/near-perfect summary, `sw.js` VERSION-bump toast) were exercised
  live during WP2–WP5 via the `claude-in-chrome` tool and are recorded in
  `math-build-status.md` with evidence — but a dedicated systematic WP8 pass
  re-checking each literal checklist item hasn't run yet.
- **Item 9 (iOS, needs Marat directly)**: install to Home Screen on iPad and
  iPhone; numpad ✓ visibility on iPhone portrait/landscape and iPad Split
  View 1/3; offline launch; `navigator.storage.persist()` result on real iOS
  Safari (the storage-status row in the parent view now shows this — DESIGN
  A2); and critically, **leaving the app unused 8+ days to confirm progress
  survives ITP eviction** (A1) — this specific check cannot close until 8+
  days after install, by its nature.
- Item 10 (offline with Google Fonts specifically blocked, not the whole
  network) — this session's offline test blocked the whole server, a
  strictly harder case the app passed, but not the literal WP8 scenario.

## Known modest deviations (recorded in full in math-build-status.md)
- Numpad keys are 44px (not the general ≥56px) only in the short-landscape
  compact layout (`@media (max-height:420px) and (min-width:480px)`) —
  physically necessary at real device heights (~330px), verified by testing.
- Change-PIN from inside the (already-unlocked) parent dashboard doesn't
  re-prompt for the old PIN.

## WP9 adversarial review — LOW findings deferred (not blocking ship)
The WP9 closing review (fresh Fable 5 reviewer, full-batch diff) confirmed
SHIP-AFTER-FIXES after HIGH/MEDIUM findings A–D were fixed (see
math-build-status.md WP9 entry for the fixes). These LOWs were recorded but
not fixed — ride along or address later, per the reviewer's own wording:
- **Daily streak breaks across DST**: `Economy` streak-counting walks fixed
  24h steps over local-midnight keys (`core.js` ~810-819); on Israel's fall
  DST change the 25-hour day can make the cursor miss the stored `dayStart`,
  silently ending a genuine streak once a year.
- **Home coin pill shows lifetime coins, not balance**: after a reward
  redemption, Home's coin number doesn't drop the way the Rewards screen's
  does. Possibly intentional (collection is lifetime-progress-based) but
  never explicitly decided — worth a design call from Marat, not obviously
  a bug.
- **Hard-rule-2 (all user-visible strings in `T`) violations found**: heatmap
  tooltips show English `mastered/learning/new` literals; a handful of
  hardcoded Hebrew strings in `showImportPreview` (invalid-file message,
  the "X סבבים, Y מטבעות" preview line), "אין עדיין נתונים"/"אין עדיין
  סבבים"/"(הוסר)", the update-toast text, and the boot "טוענת..." string.
  Should be moved into `T` in a future pass.
- **No save-retry**: DESIGN §8 says a failed save is retried once before
  showing the error banner; `Storage.save` currently goes straight to the
  banner on any failure.
- **Approve-reward double-click surfaces the wrong error text**: a second,
  already-processed approve returns reason `"already processed"` but the UI
  maps every failure to "אין מספיק מטבעות" (not enough coins). No double
  charge occurs (the underlying guard is sound) — this is a UI messaging
  issue only.
- **Exiting during the ~1.8s post-answer feedback window can re-paint the
  question over Home**: `showFeedback`'s `setTimeout` isn't cancelled on
  navigation, so tapping ✕ within that window can be followed by the timer
  firing a `paint()` that repaints the question screen on top of Home with
  the hash still at `#screen=home`. Code-inspection finding, not yet
  live-reproduced; likely fixable by cancelling the timeout in `onExitClick`
  the same way the WP9 interrupted-marking fix does.
- **Stale-state banner bypassed on some recovery paths**: a stale
  `backupThenReplace`/`undo` surfaces a generic error (or nothing, for
  reset/undo) instead of the proper stale-state card; the next ordinary
  save does show it correctly.

## Skill scouting (standing rule 5 — proposal only, not created)
Two repeatable patterns emerged this cycle that could become skills if
Marat wants them formalized:
1. **"PWA-for-kids on GitHub Pages" scaffold** — the whole shape of this
   build (single-page app + service worker + IndexedDB/localStorage
   dual-write + PIN-gated parent view + GitHub Pages) is a reusable pattern
   for a family of similar apps.
2. **The Node-testable single-page pattern** (PA-1) — a UMD guard on inline
   `<script>` content so `node --test` can exercise the same code that ships
   to the browser, no build step, no bundler. Reusable for any project with
   this "no build step but still want unit tests" constraint.

## Second-brain distillation (standing rule 6)
Not yet written — per the plan, this is designer-owned at close-out with
Marat's affirmative yes, not something the executor writes to `~/brain`.


## After the journey map (2026-08-27)
- If the turtle visibly sits at 9/10 for weeks while stations ahead light up: consider relaxing mastery to "3 of the last 4 first attempts correct" (`Facts.mastery`, CONFIG) — the reviewer's simulation showed a flat-85% child stalling ~17 sessions at ×5. Not a selector issue.
- Marat's device pass for 0.6.0: open המפה שלי, tap a station, finish a session that completes a table (banner + fireworks).

## Falling numbers — design question for Marat (WP-F1 gate review, 2026-08-27)
**Resolved 2026-08-28 (balloons v2):** the once-per-day perfect cap is gone — every perfect round pays +5 and consecutive perfect rounds pay a series extra (`CONFIG.PERFECT_SERIES_EXTRA`), across both modes. The text below is kept for history.

The fresh Fable 5 reviewer flagged a real but non-bug interaction, not covered
by FALLING-DESIGN F1–F10: the once-per-day perfect bonus (+5) and the daily
streak counter are shared across typed and falling sessions. A falling
"perfect" (recognition, easier — a tap among 4-6 options) can consume the
day's perfect bonus before a harder typed perfect that same day, which would
then earn 0; and a day where the child only played falling still counts
toward `dailyStreak`. Both are consistent with the letter of F4 ("coins/
stickers apply" to falling) but the interaction was never explicitly decided.
**Decided by Marat (2026-08-27, at push time): leave as-is.** No code
change — the shared once-per-day perfect bonus and shared daily streak
apply to both modes, unchanged.

## Falling numbers — residual verification (WP-F3, 2026-08-27)
The `resize_window` browser automation tool did not reliably shrink the
viewport below ~500×723 in this environment, so the F3-2 done-when's precise
multi-viewport screenshot matrix (320×568, 375×667, 568×320, 820×1180) is only
partially verified — 6-lane bubble fit was confirmed comfortably at ~500px
width, but the smallest-width and landscape cases are not yet pixel-checked.
WP-F5 (live verification) should re-attempt with device emulation or a real
device if this tool limitation persists.

## Falling numbers — WP-F8 closing review LOWs (2026-08-27, not fixed, recorded per reviewer)
- **LOW — no bubble wobble, bubbles below 64px on small screens.** F8 says bubbles "wobble slightly" and are "≥ 64 px" — no wobble animation exists, and bubbles shrink to 56px (≤380px width) / 48px (short landscape). Touch targets stay ≥44px so usability is fine; this is a spec-literalness gap, Marat's call whether to add wobble/enforce 64px minimum.
- **LOW — 6-bubble layout at 320px width: bubbles can overlap by a few px per side**, since 6 lanes at ~50px each hold 56px bubbles. An edge tap in the overlap zone could hit the neighbouring bubble. Combined with the already-recorded unverified small-viewport check (WP-F3 entry above) — both point at the same residual: pixel-verify 320px-wide + 6-option layouts on a real device or working device emulation.
- **LOW — "עוד סבב!" on a falling summary always starts a typed session**, not another falling round. Design-conformant (FALLING-DESIGN §4 says "Summary: unchanged") but possibly not what a child who just finished a balloon round expects. Marat's call whether "עוד סבב!" should be mode-aware.
- **LOW — backgrounding mid-fall (visibilitychange) gives no visual cue that the ×2 window is gone.** `markInterrupted` fires but the falling screen isn't re-rendered until the child returns, so bubbles keep visually falling with no "ממשיכות בלי שעון" label until the next paint. Same behavior class as typed mode's existing turtle-timer handling; not falling-specific, noted for completeness only.

## Session close-out 2026-08-28 (designer session 651c8ef0 reset)
State: everything pushed — live 0.9.2 / sw v12 (commit d345112). Tests 144/144. No open reviews.

### Marat's device pass (only he can do these)
1. iPad: tap "רענני" → "ממשיכות!" should open on a fresh question with the turtle; then "מספרים נופלים 🎈" (balloons, 6 options set; use 4 on the iPhone).
2. **Cloud backup token** (README "גיבוי אוטומטי לענן", 3 steps) — until set, progress lives only on the iPad.
3. One falling round in **portrait** on iPad and iPhone (layouts were measured headless, never on real hardware).
4. Export via the share sheet in the Home-Screen app → confirm a file lands in Files (P13).
5. 2FA on the GitHub account (repo is public; branch protection + issues/wiki off already applied).
6. Later: 8-day storage-retention check (A1).

### Open decisions (blocked on Marat)
- Show the correct answer after a miss (current: yes, 1.8 s → picture). Both reviewers flagged it as a "clue"; kept as designed.
- Mastery rule "3 in a row" vs "3 of last 4" if the turtle stalls at 9/10 for weeks.
- tarbut (ועד בית, Flask+SQLite, resident financial data): "any place any time" needs an always-on tailnet host (option 2: €4–5/mo VPS + Tailscale) — a design-to-build cycle if chosen. NOT a static-hosting candidate; never public.
- Whether to create the proposed skills (docs/SKILL-PROPOSALS-2026-08-28.md).

### Deferred LOWs (from reviews, not fixed)
- Stale comments at index.html seededRng (~1165) and exit-yes (~1587) mention the removed "short-circuit" branch.
- Landscape 568×320 falling: label + bottom exit line below the fold (page scrolls).
- Desktop export fallback marks lastExportAt even on old iOS (<15) preview path.
- Every save writes localStorage twice (mirror + lastgood) — fine under quota, noted.
- findGist first page only (100 gists); one account = one child.

## Evidence rebuild residual (2026-08-28, review LOW)
If a whole later session's `endedAt` is stepped back within `EVIDENCE_CLOCK_SKEW_MS`, the earlier session's rebuilt `masteredAfter` includes the later session's attempts (trend value off by one point; no station lost). Inherent to time-ordered replay; not fixable without trusting stored order, which would re-break the parked interleave.

## v2 cycle close-out (2026-08-29) — decisions owed by Marat
- **Rectangle Tetris — design decision needed.** The pure core + simulator (`tetris-wip` local branch, commit 7c5b245, not pushed) show that with "orientation as asked, no rotation/sliding" a row-completing placement exists only ~23 % of the time (gate required 40 %) for every COLS ∈ {10,12,14} × ROWS ∈ 14–20; resets ≤ 1/10 questions is met at 14×20. Options: (A) allow rotation (tap the piece) and re-run the gate; (B) drop the row-completion metric and ship "build the wall" (rectangles stack, a full wall = celebration + fresh wall, coins only from facts); (C) drop Tetris. The designer recommends B — it keeps the area-model teaching without a scoring mechanic the geometry cannot support.
- **Child playtest** of the new features on her iPad (spectators, names, 20-question rounds if enabled, album 2 progress) — the balloon start delay (0.6 s) and the 8 s mastery threshold are CONFIG numbers to tune from observation.
- **Evidence rebuild status** shows in the parent data section ("עדכון נתוני למידה"); if it says "לא בוצע" the stored attempts were inconsistent — export the JSON and send it to the designer.
- LOW residuals recorded by the reviews: parent x-axis "סבב N" indexes differ per chart; cloud-connect failed-save path untested (harness has no fetch); 320×568 landed-balloons label sits above the exit button only with the extra padding; landscape hides the spectators strip.
