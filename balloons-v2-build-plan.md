# Balloons v2 — build plan (2026-08-28, Marat's five requests)

Executor: Sonnet subagent, this repo, working tree only. Reviewer: Fable 5 (fresh
agent) + Marat's live check. **Do not `git commit` or `git push`.**

## 0. Executor contract

- Read `CLAUDE.md` first. Hard rules 2 (strings in `T`), 3 (numbers in `CONFIG`),
  6 (mutations only inside `save()`), 7 (version bump in three places), 9
  (`escapeHtml`) apply to every line you write.
- Do NOT compose Hebrew. Every new user-visible string is given verbatim below.
- Do NOT change anything not listed here. If a listed step turns out impossible
  or contradicts the code you find, stop and report — do not improvise a design.
- Work order: WP-A → WP-B → WP-C → WP-D → WP-E → versions → docs → verification.
- Done means: `npm test` green (report the count), rule-6 grep clean, `node --check`
  clean on the extracted inline script, `node tools/simulate-economy.js` output
  pasted in your report (before AND after WP-B), and a written report listing
  every file touched and every assumption you had to make.

Decisions Marat made on 2026-08-28 (settled — do not reopen):
- D1 Balloon (falling) sessions now count for mastery and the map, exactly like
  typed answers. Carryover of balloon misses into typed sessions stays OFF.
- D2 10/10 prizes: every perfect round pays the perfect bonus (the "first perfect
  of the day" cap is dropped); 2 perfect rounds in a row pay extra; 3+ in a row pay
  more. Series counts across both modes and across days (a non-perfect round resets it).
- D3 Feedback on the balloon screen must never move the balloons (layout jump fix
  only; pop/fly-away reactions stay).
- D4 On Home, the balloon button comes first; the typed play/resume button sits
  below it on its own line (also when it reads "בואי נתחיל!").
- D5 Balloon numbers must be clearly readable (today the white highlight sits under
  the digits).

---

## WP-A — balloon sessions count for mastery + map (core.js, tests, UI line)

### core.js
1. `SessionCore.submit` (~line 823): remove the `if (active.mode !== "falling")`
   guard so `Facts.updateFromAttempt(...)` runs for every non-retry attempt in
   both modes. Update the comment: falling now counts for mastery/map (Marat
   2026-08-28); only carryover stays typed-only.
2. `SessionCore.finish` (~line 955–970): compute `stationsReached` via
   `Map.newlyReached(state)` for BOTH modes (drop the `!isFalling` guard around the
   map block; keep `state.map` init). Keep the carryover block exactly as is
   (`if (!isFalling)` stays there — D1).
3. `Stats.trends` (~line 1076): `masteredCount` must now come from ALL sessions
   (window `sessions`, not `learningSessions`) because balloon rounds move mastery.
   `accuracy` and `avgMs` STAY typed-only (a 4-option tap has a 25 % guess floor and
   tap time ≠ recall time). Rewrite the comment accordingly. `coins` unchanged.

### tests
4. `tests/falling-session.test.js`: flip the two "untouched" tests:
   - "a perfect falling session updates facts and pays coins; carryover stays untouched":
     `state.facts` must differ from before (attempts incremented for every planned
     fact), `state.carryover` deep-equal to before, coins > 0, `_earn` entry present.
   - "a station whose 10th fact is mastered in a falling session IS reached":
     reuse the existing fixture from the old "map guard" test; assert
     `session.stationsReached` contains the station and `state.map.reached[n]` is set.
     Keep the typed positive control.
   - Add: "a balloon tap masters a fact under the normal rule": one fact with two
     prior correct fast typed attempts; a falling session in which it is answered
     correctly with `ms` ≤ `CONFIG.MASTERY_MS_THRESHOLD` → `Facts.mastery` is
     "mastered"; the same with `ms` > threshold → "learning".
5. `tests/falling-migrate-stats.test.js`: update the two `Stats.trends` tests:
   `masteredCount` now includes falling sessions (`[5, 5]` in the first test's
   fixture — set the falling fixture's `masteredAfter` to 7 and expect `[5, 7]`);
   `accuracy`/`avgMs` still typed-only; the starve-window test keeps asserting
   accuracy/avgMs are not starved, and additionally that `masteredCount.length`
   equals the windowed session count.
6. `tests/stats.test.js` / `tests/session-core.test.js`: run; fix only tests that
   encode the old rule.

### index.html
7. `renderFallingQuestion`: add the map line inside `.question-info`, right after
   the `dots-text` div:
   `'<div class="map-status">' + mapLine + "</div>"` where `mapLine` is computed
   exactly as in `Screens.home` (`MathCore.Map.currentStation(state)` →
   `T.home.mapDone` or `T.home.mapStatus(station, MathCore.Map.progress(state, station), CONFIG.STATION_REQUIRED)`).
   Extract that two-line computation into a helper `mapStatusLine(state)` used by
   both Home and the falling screen (no duplicated logic).

---

## WP-B — perfect-series prizes (core.js, tests, UI, simulator)

### CONFIG (core.js)
8. Keep `PERFECT_BONUS: 5`. Add directly below it:
   ```js
   // Perfect-series extra (Marat 2026-08-28): index = consecutive perfect rounds
   // minus 1, last entry repeats. 1st perfect: +0 extra, 2nd in a row: +5, 3rd+: +10.
   // The series counts across both game modes and across days; any non-perfect
   // round resets it. Replaces the "first perfect of the day only" cap (R1 #6).
   PERFECT_SERIES_EXTRA: [0, 5, 10],
   ```

### Economy (core.js)
9. Delete `Economy.hasPerfectBonusToday` and `Economy.perfectBonusAmount`
   (and their test in `tests/economy.test.js`). Add:
   ```js
   // Number of consecutive perfect sessions ending with the most recent one
   // (0 when the last session was not perfect). Pure; sessions are chronological.
   perfectSeriesLength: function (sessions) { ... }
   // Extra coins for a series of `n` consecutive perfect rounds (n >= 1).
   perfectSeriesExtra: function (n) {
     var table = CONFIG.PERFECT_SERIES_EXTRA;
     return table[Math.min(n, table.length) - 1];
   }
   ```
10. `SessionCore.finish`: in the `if (perfect)` branch:
    - `perfectSeries = Economy.perfectSeriesLength(state.sessions) + 1` (computed
      BEFORE the session record is pushed).
    - Ledger `l_<sid>_perfect` amount = `CONFIG.PERFECT_BONUS` (always).
    - If `Economy.perfectSeriesExtra(perfectSeries) > 0` append
      `{ id: "l_" + sid + "_series", t: now, type: "earn", amount: extra, ref: sid, note: "perfect-series" }`
      and add it to `totalCoins`.
    - Session record gains `perfectSeries: perfectSeries` (0 for non-perfect
      sessions).
    Idempotency is unchanged (ids deterministic by sid; a sid already in
    `sessions` is never re-applied).
11. `Migrate.migrate`: old sessions without `perfectSeries` are left as-is
    (`Economy.perfectSeriesLength` must treat a missing field as irrelevant — it
    only reads `perfect`). `Migrate.validateImport`: if sessions are field-checked,
    accept an optional numeric `perfectSeries` ≥ 0. Check the code; do not add
    validation that did not exist.

### tests
12. `tests/economy.test.js`: replace the daily-cap test with:
    - `perfectSeriesLength([])` = 0; `[p, np]` = 0; `[np, p]` = 1; `[p, p, p]` = 3;
      `[p, np, p, p]` = 2 (where `p = {perfect:true}`, `np = {perfect:false}`;
      old records without `perfectSeries` must work).
    - `perfectSeriesExtra(1)=0, (2)=5, (3)=10, (7)=10`.
13. `tests/session-core.test.js`: add "perfect series": play 3 perfect sessions in a
    row, then a 9/10, then a perfect one, via `SessionCore`; assert ledger ids and
    amounts: session1 `_perfect` 5 and no `_series`; session2 `_perfect` 5 +
    `_series` 5; session3 `_perfect` 5 + `_series` 10; session4 `_near` 2, no
    `_perfect`; session5 `_perfect` 5, no `_series` (reset); `session.perfectSeries`
    = 1, 2, 3, 0, 1. Also: two perfect sessions on the same day BOTH get `_perfect`
    (the cap is gone). Also: a perfect falling session after a perfect typed one →
    series 2 (mixed modes count).
    Existing test "perfect session → 10/10 + one `_perfect` ledger entry" stays valid.

### index.html — summary
14. `T.summary` add (verbatim):
    ```js
    perfectSeriesTitle: function (n) { return bdi(n) + " בסדרה!!! 🎆🎆"; },
    perfectSeriesSub: "שני סבבים מושלמים ברצף! מדהים!",
    perfectSeriesSub3: "שלושה סבבים מושלמים ברצף (או יותר)! אלופה!!!",
    seriesBonus: function (n) { return "בונוס סדרה " + bdi("+" + n) + " 🪙"; },
    ```
15. `renderSummary`: when `session.perfect && session.perfectSeries >= 2`, the title
    is `T.summary.perfectSeriesTitle(session.perfectSeries)` (class
    `summary-title-perfect`) with sub-line `perfectSeriesSub` for 2 and
    `perfectSeriesSub3` for ≥ 3, followed by
    `'<div class="station-banner">' + T.summary.seriesBonus(extra) + "</div>"`
    where `extra = MathCore.Economy.perfectSeriesExtra(session.perfectSeries)`.
    Keep the 🎈 suffix logic. Celebration: for series ≥ 2 call `fireworksShow()`
    twice (second one via `setTimeout(fireworksShow, 900)`) and `confettiBurst(100)`;
    for series ≥ 3 `confettiBurst(140)`; sound stays `SOUNDS.perfect`. Wrap in the
    existing try/catch.
16. Parent history rows (~line 2211) — append `" 🔥" + bdi(sess.perfectSeries)`
    when `sess.perfectSeries >= 2`. No new string needed.

### simulator
17. Run `node tools/simulate-economy.js` BEFORE touching core.js and again AFTER
    WP-B; paste both outputs in the report. If the average profile's
    sessions-to-collection leaves the 60–110 band, say so prominently — do not
    tune numbers yourself.

---

## WP-C — feedback never moves the balloons (index.html CSS only)

18. Root cause: `showFeedback` inserts the note (`.fast-badge`, `.wrong-helper`,
    `.muted`) after `#equation` inside `.question-info`; the card grows and pushes
    `.lanes` down. Fix with CSS scoped to the falling screen — add after the
    existing `[data-screen="question"][data-falling="1"] .question-info { ... }`
    block:
    ```css
    /* Feedback floats over the lanes instead of growing the card, so the
       balloons never move when the badge or the picture appears (Marat 2026-08-28). */
    [data-screen="question"][data-falling="1"] .question-info > .fast-badge,
    [data-screen="question"][data-falling="1"] .question-info > .wrong-helper,
    [data-screen="question"][data-falling="1"] .question-info > .muted:not(.map-status):not(.dots-text) {
      position: absolute; top: calc(100% + 0.5rem); left: 50%; transform: translateX(-50%);
      z-index: 6; width: max-content; max-width: min(92vw, 520px);
      background: var(--card-bg); border-radius: 20px; padding: 0.8rem 1rem;
      box-shadow: 0 10px 28px rgba(43,45,66,0.22);
      max-height: calc(100dvh - 260px); overflow-y: auto;
    }
    ```
    Then verify in the code that `.question-info` already has `position: relative`
    (it does at line ~177) and that the `interrupted` label (rendered at paint time,
    before any feedback) is NOT caught by the `.muted` selector — if it is, give it
    a class `interrupted-label` and exclude it too. The `.fast-badge` `pop`
    animation uses `transform` — check `@keyframes pop`; if it animates `transform`,
    the `translateX(-50%)` would be overridden during the animation. In that case
    use `left: 0; right: 0; margin: 0 auto; width: fit-content;` instead of the
    transform centring for these three rules.
19. Guard the other height changers on that screen: add `min-height: 1.4em` is
    already on `.falling-landed-label` (below the lanes — fine). Nothing else.
20. Do NOT touch `submitAnswer`'s pause or `balloonReactions` (D3).

---

## WP-D — Home button order (index.html)

21. In `Screens.home` render: output, in this order, each in its own block:
    ```
    (showFallingBtn ? '<div><button data-action="play-falling">…</button></div>' : "") +
    '<div><button data-action="play">…</button></div>' +
    ```
    Labels unchanged. Bindings unchanged. Nothing else moves.

---

## WP-E — readable balloon numbers (index.html CSS)

22. Replace the `.bubble` `background`, `color`, `font-size` lines with:
    ```css
    background:
      radial-gradient(circle at 30% 22%, rgba(255,255,255,0.65) 0, rgba(255,255,255,0) 16%),
      radial-gradient(circle at 50% 40%, var(--c) 0, var(--c) 55%, color-mix(in srgb, var(--c) 72%, #000) 100%);
    color: #fff; font-size: 1.5rem;
    text-shadow: 0 1px 0 rgba(0,0,0,0.55), 0 0 6px rgba(0,0,0,0.45), 0 0 1px rgba(0,0,0,0.9);
    ```
    and darken the two light lanes so white digits read on them:
    `.lane:nth-child(6n+4) { --c: #F2A600; --ct: #fff; }` (was `#FFC93C`, dark text) and
    `.lane:nth-child(6n+6) { --c: #FF7A3D; --ct: #fff; }` (was `#FF9F68`). Keep `--ct`
    declared (unused now is fine — or delete `--ct` everywhere; pick one and be
    consistent). The `@media (max-width:380px)` and landscape overrides only change
    size — leave them.

---

## Versions, docs, verification

23. Rule 7: `sw.js` `VERSION = "v13"`; `APP_VERSION = "0.10.0"`;
    `core.js?v=0.10.0` in BOTH the `<script src>` and `sw.js` `PRECACHE_URLS`.
24. Docs (amend, don't leave contradicting text; date every amendment 2026-08-28):
    - `docs/FALLING-DESIGN.md` F4 and F9: balloons now update facts/mastery/map;
      carryover stays off; Stats accuracy/avgMs stay typed-only, masteredCount includes
      falling. §6 tests line updated.
    - `docs/DESIGN.md` §5 "Perfect session": replace the daily-cap sentence with the
      series rule and `CONFIG.PERFECT_SERIES_EXTRA`.
    - `CLAUDE.md` rule 5: ledger id list gains `_series`.
    - `docs/MAP-DESIGN.md` line 26: remove "falling" from the not-in-scope list.
    - `math-build-status.md`: one new entry "balloons v2" with evidence (test count,
      simulator before/after, grep results).
25. Verification (all output in the report):
    - `npm test`.
    - `grep -nE 'MathCore\.(SessionCore|Economy|Pin|Migrate)\.' index.html` — every
      mutating call sits inside `save(function (s) {...})`; pure reads
      (`perfectSeriesExtra`, `Map.*`, `Stats.*`, `Facts.*`) are fine outside.
    - `node --check` on the extracted inline script (extraction one-liner is in
      `math-build-status.md`).
    - Headless layout check for WP-C (write it in the scratchpad dir, keep it): open
      `index.html` in headless Chrome, force the falling screen DOM (or build a
      minimal page that includes the app's CSS and the falling-screen markup), record
      `.lanes` `getBoundingClientRect().top/height`, insert a `<div class="wrong-helper">`
      with a 10-row dot array + a button into `.question-info` after `#equation`,
      re-measure → must be identical. Repeat with `.fast-badge`.
    - Screenshot of the falling screen at 390×844 for WP-E (headless
      `--screenshot`); include the path.
