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
