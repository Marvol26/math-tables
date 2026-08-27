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
The fresh Fable 5 reviewer flagged a real but non-bug interaction, not covered
by FALLING-DESIGN F1–F10: the once-per-day perfect bonus (+5) and the daily
streak counter are shared across typed and falling sessions. A falling
"perfect" (recognition, easier — a tap among 4-6 options) can consume the
day's perfect bonus before a harder typed perfect that same day, which would
then earn 0; and a day where the child only played falling still counts
toward `dailyStreak`. Both are consistent with the letter of F4 ("coins/
stickers apply" to falling) but the interaction was never explicitly decided.
Not fixed — needs Marat's call: (a) leave as-is (simplest, and arguably fine —
a bonus is a bonus), (b) give falling its own separate daily-perfect slot, or
(c) exclude falling-only days from the streak. Left for a future session.

## Falling numbers — residual verification (WP-F3, 2026-08-27)
The `resize_window` browser automation tool did not reliably shrink the
viewport below ~500×723 in this environment, so the F3-2 done-when's precise
multi-viewport screenshot matrix (320×568, 375×667, 568×320, 820×1180) is only
partially verified — 6-lane bubble fit was confirmed comfortably at ~500px
width, but the smallest-width and landscape cases are not yet pixel-checked.
WP-F5 (live verification) should re-attempt with device emulation or a real
device if this tool limitation persists.
