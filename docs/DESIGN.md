# לוח הכפל — Design (settled document)

Status: **v4 — Codex (gpt-5.6-sol, high) APPROVED after 4 rounds on 2026-08-25; pending Gate 1 (Marat)** · Domain: **Personal** (Marat, 2026-08-25) · Supersedes `~/.claude/plans/i-want-to-talk-ethereal-unicorn.md` (desktop-only `file://` plan; overtaken by the iPad decision).

## 1. Goal
A multiplication-tables game (1×1 … 10×10) for an 8-year-old girl, in Hebrew, that she *wants* to play: typed answers, no clues, coins per question, an optional parent-controlled Challenge Mode with a per-question time limit, an unlockable collection plus parent-defined real rewards, and a parent view with KPIs (accuracy, speed, mastery, trends).

## 2. Decisions (owner · date)
| # | Decision | Owner |
|---|---|---|
| D1 | Facts = tables 1–10, 55 unordered pairs (a×b and b×a share stats; each attempt records the direction asked). | Marat 2026-08-25 |
| D2 | Hebrew UI, RTL, **feminine** address forms. Child's name set in parent settings, stored only on-device. | Marat 2026-08-25 |
| D3 | Answers fully typed, digits only, no hints/choices. Mac: physical keyboard. iPad/iPhone: custom big on-screen numpad; the `<input>` is `readonly` + `inputmode="none"` so the iOS keyboard never appears. | Marat (typed) · design |
| D4 | Session = 10 planned questions; wrong → correct answer shown briefly → re-asked at END of session until correct → also carried into next session. | Marat 2026-08-25 |
| D5 | Delivery: **GitHub Pages** (account Marvol26) + iOS "Add to Home Screen" (standalone PWA, offline via service worker). Works on Mac browsers too. | Marat 2026-08-25 |
| D6 | Persistence on-device only: localStorage + IndexedDB, JSON export/import to move between devices. Nothing is uploaded. | design |
| D7 | Single child profile in v1 (schema allows a later `profiles` migration). | Marat 2026-08-25 |
| D8 | Challenge Mode: parent toggle + time limit (default 10 s). Timeout **never punishes**: question stays open, correct answer still earns base coins, message is encouraging. Within the limit → coins ×2 + a nice effect. Challenge OFF → no visible timer (timing still measured silently). | Marat 2026-08-25 |
| D9 | Coins: harder facts worth more; retries earn 0. Values in §5, CONFIG-tunable. | Marat (harder = more) · values design |
| D10 | Two reward tracks: **collection** unlocked by lifetime-coin thresholds (never lost) and **real rewards** defined by the parent, requested by the child, approved by the parent. | Marat (both) · mechanics design |
| D11 | Perfect session (10/10 first try) → "amazing" celebration; otherwise encouraging. Stars: 3 = 10/10, 2 = ≥8, 1 = otherwise. | Marat 2026-08-25 |
| D12 | **A session is never lost or discarded.** The plan is generated and saved at session start; every painted question and every answer is journaled inside the main state; leaving early just *suspends* the session, which resumes on the next launch at the same question. There is no "abandon" — a session ends only when its 10 planned questions (plus retries) are done (debate R1 #1, R2 #2). | design 2026-08-25 |
| D15 | **Parent setup comes first**: on first run a parent screen sets the child's name, the 4-digit PIN and shows a one-time recovery code before the child can play. Import never overwrites the device PIN (debate R2 #4). | design 2026-08-25 |
| D13 | **KPIs and mastery use first attempts only**; retries are stored (`retry:true`) for the parent's "fixed today" list but never feed accuracy, speed, mastery, streaks, or coins (debate R1 #2). | design 2026-08-25 |
| D14 | Parent view is behind a **4-digit PIN** set on first entry (debate R1 #7). | design 2026-08-25 |

Amendment to the earlier "single HTML file" constraint: a service worker cannot be inline, so the deliverable is a **single-page app of ~5 static files** (§3). Still no build step, no backend, no dependencies.

## 3. Files (repo root = this folder)
```
index.html            the whole app: inline CSS + JS
sw.js                 service worker: cache-first, VERSION constant, skipWaiting + clientsClaim
manifest.webmanifest  name "לוח הכפל", display: standalone, dir: rtl, lang: he, icons
icon-180.png / icon-512.png   apple-touch-icon and manifest icon
README.md             install / backup / update / "uninstalling deletes progress" (Hebrew + English)
docs/DESIGN.md, docs/DEBATE-LOG.md
```
Fonts: Google Fonts "Varela Round" with a system fallback stack; not cached by the SW, offline uses the fallback.

## 4. JS structure (one IIFE, banner-commented sections)
`CONFIG` · `T` (all strings, feminine) · `Storage` (load/save/migrate/export/import/journal) · `Facts` · `Economy` (values, ledger, unlocks) · `Selector` · `Session` (runtime + journal) · `Stats` (pure, first-attempt-only) · `Charts` (inline SVG + CSS-grid heatmap) · `UI` (router, numpad + keyboard, animations, PIN) · `App.init()`.

## 5. Game economy (all numbers in `CONFIG`)
- **Fact value** = tier of the **smaller** operand `min(a,b)` (Marat, 2026-08-26 — was `max` in v4): {1,2,10} → 1 🪙, {3,4,5} → 2, {6,7,8,9} → 3. So 1×6 = 1, 3×9 = 2, 6×7 = 3. `CONFIG.TIER_BY` switches the rule. **Mastered facts pay 1 🪙 flat** (review value; stops grinding known facts — R1 #5).
- **First attempt correct** earns the value; **within challenge limit** doubles it; **retries earn 0** ("עכשיו את יודעת! ✨") and do not extend streaks.
- **Streak**: 5 first-attempt correct in a row → +2 🪙, flame badge.
- **Perfect session**: fixed celebration always (D11). Economic bonus **+5 🪙, only for the first perfect session of the day**; 9/10 gets +2 "כמעט מושלם!" — no cliff, no random rare-sticker stake (R1 #6).
- **Ledger** (R1 #4): `economy.ledger[]` is append-only: `{id, t, type: "earn"|"redeem"|"adjust", amount, ref, note}`. `lifetimeCoins = Σ earn`, `balance = Σ all`. Never stored as mutable counters; recomputed on load (cached in memory).
- **Collection**: 24 emoji stickers, unlock *n* at lifetime ≥ `25n + 5n(n−1)/2` (25, 55, 90, 130 … 1 980). Expected earnings ≈ 20–45 🪙/session (10 facts × ~2 × up to ×2 + bonuses) → full collection in roughly 60–90 sessions ≈ 3 months of near-daily play. Simulation of this curve is a build-checklist item.
- **Real rewards**: parent list `{id, name, cost, active}`; child taps "לבקש" → `requests[]` entry `{id, rewardId, nameSnapshot, costSnapshot, t, status: requested|approved|rejected|cancelled}`. Approval (parent, PIN) re-checks balance at that moment, appends a `redeem` ledger entry (−costSnapshot) and is idempotent by request id. Rewards are repeatable; editing/deleting a reward never touches history.
- **Session per day**: unlimited (an 8-year-old wanting to play more is the goal), but the selector always prefers non-mastered facts and mastered ones pay 1, so grinding is slow by construction.

## 6. Session algorithm
**Plan:** carryover FIFO first (overflow >10 stays queued, order preserved) → unseen facts (tie-break a+b ascending, random) then weakest (`(1−acc)·2 + learning?1:0 + daysSinceSeen/7`) up to `chosen+6` → 1–2 random mastered for review → random fill. No duplicate keys. Shuffle. Direction: prefer the direction with a recent miss, else random. First session = the 10 smallest-sum facts.
**Runtime:** `queue`, `retryQueue`; wrong → answer display (1.8 s originally; 3.2 s with the dot-array helper since 2026-08-27) → push to retry; when queue empties, retry loop until empty. Progress = 10 dots; retries show 🔁.
**Journal (D12):** `state.active = {id, startedAt, settingsSnapshot, planned, queue, retryQueue, attempts, current:{key, asked, shownAt, interrupted}}` lives **inside the main state blob** — one object, one write, no second key (R2 #1, #6). It is saved (a) at session start with the full plan (so relaunch or exit can never re-roll the plan), (b) when a question is painted (`current`), (c) after every submit. On launch with `state.active` present: home shows "ממשיכות!" and resumes the session; **the question that was on screen when it was suspended is deferred to the end of its queue and a fresh question is painted with a live clock** (amended 2026-08-28 — replaces the earlier "resumed question is interrupted" rule, which made every resume start without a clock). `interrupted` now only marks a question the app was backgrounded on while it was being answered (base coins only, no challenge bar, "ממשיכות בלי שעון"). Exit (✕ → "יוצאות? נמשיך אחר כך מאותו מקום") only suspends; carried-over facts inside the plan therefore never disappear (R2 #2 / R1 #3).
**Parked slot (2026-08-28):** `state.parked` holds one suspended session of the *other* game mode while the child plays this one (`SessionCore.switchTo/park/unpark`); it returns to `active` when the current session finishes. Resuming a session re-reads the parent's current settings (`refreshSettings`) so a Challenge change applies from the next question.
**`finish()`** (only when `queue` and `retryQueue` are both empty): update facts from first attempts (store retries), compute `firstTryCorrect / misses / totalMs / coins / masteredAfter`, **`carryover = dedupe([...misses, ...leftover])`** (today's misses first — R1 #3), append ledger entries with `ref = session id` (deterministic ids `l_<sessionId>_earn`, so a replay cannot double-credit), check unlocks, push the session record, set `state.active = null`, and **save all of that in a single write**. If the save fails, `state.active` stays and the summary is not shown; the next launch offers to finish again (idempotent by session id: a session id already in `sessions` is never re-applied). Coins/unlocks are shown only after the save succeeds (R1 #9).

## 7. KPIs & mastery (first attempts only — D13)
Per fact: `attempts`, `correct`, accuracy, median ms of the last 3 correct first attempts, lastSeen; mastery `new` / `mastered` (last 3 first attempts all correct AND their median ms ≤ 6 s AND none `interrupted`) / `learning`. Per session: firstTryCorrect, avg first-attempt ms (clamped 30 s, `interrupted` excluded), misses, retries count, coins, challengeOn+limit, abandoned flag, masteredAfter. Trends: accuracy, avg time, mastered count, coins; 10×10 heatmap; weakest 8; totals + daily streak.

**Timing (R1 #12):** `performance.now()` captured in a `requestAnimationFrame` after the equation is painted; stopped at submit; feedback time excluded. `visibilitychange` → hidden during a question marks it `interrupted:true`; a question the session was suspended on is *deferred* (end of its queue) and, when it comes back, is also `interrupted` — she has already seen it (amended 2026-08-28; supersedes R2 #5's "resume the same question without a clock"). Interrupted attempts earn base coins if correct, count for accuracy, but are excluded from speed stats, `withinLimit`, and mastery-time; the turtle track is hidden and "ממשיכות בלי שעון" is shown. Every other question after a resume has a live clock.

## 8. Data model (`mathtrainer.v1`)
```json
{ "schemaVersion": 1, "rev": 412, "savedAt": 0, "createdAt": 0, "lastExportAt": null,
  "settings": { "childName": "", "challengeOn": false, "timeLimitSec": 10, "sound": true, "pinHash": null },
  "economy": { "ledger": [ {"id":"l_…","t":0,"type":"earn","amount":31,"ref":"s_…","note":"session"} ],
               "unlocked": ["cat"], "rewards": [ {"id":"r1","name":"…","cost":100,"active":true} ],
               "requests": [ {"id":"q1","rewardId":"r1","nameSnapshot":"…","costSnapshot":100,"t":0,"status":"requested"} ] },
  "facts": { "2x7": { "attempts": 0, "correct": 0, "lastSeen": 0,
             "recent": [ {"ok":true,"ms":4120,"asked":"7x2","t":0,"withinLimit":true,"interrupted":false} ] } },
  "sessions": [ { "id":"s_…","startedAt":0,"endedAt":0,"abandoned":false,"challengeOn":true,"timeLimitSec":10,
                  "planned":["7x2"],"attempts":[{"key":"2x7","asked":"7x2","answer":14,"ok":true,"ms":4120,"retry":false,"withinLimit":true,"interrupted":false,"coins":6}],
                  "firstTryCorrect":8,"totalMs":0,"misses":[],"coinsEarned":31,"perfect":false,"masteredAfter":23,"unlocksEarned":["fox"] } ],
  "carryover": [] }
```
`recent` holds the last 20 first attempts. `sessions[].attempts` is kept for the newest 200 sessions; older sessions keep their aggregate fields only (R1 #9; ~1 KB/session so this is years away). The in-progress session is `state.active` (§6) — part of the same blob, never a separate key. `settings.pinHash` + `settings.recoveryHash` are device-local (see import).

**Storage protocol (R1 #8, R2 #3):** **IndexedDB is the authoritative store**; localStorage is a synchronous mirror for fast boot. `save()` runs one IDB `readwrite` transaction: read stored `rev`; if it differs from the `rev` this window loaded/last wrote, **abort** — the window marks itself stale, shows "המשחק נפתח בחלון אחר — רענני" and stops writing; otherwise write `rev+1` and, after the transaction commits, mirror to localStorage. `load()` prefers IDB; if IDB is unavailable/unparseable it falls back to the localStorage mirror; if IDB is missing but the mirror exists (IDB wiped), the mirror is restored into IDB. A `BroadcastChannel` message is only a courtesy notification to other windows. **Within a window all mutations go through one promise queue** (at most one transaction in flight, each save sees the previous save's `rev`); the numpad/keyboard is disabled until the session-start and question-paint saves have committed, and a submitted answer is committed before the feedback is shown (R3 #1). A failed save (quota/exception) is retried once, then shown as a persistent banner; `state.active` is untouched by failed saves. `navigator.storage.persist()` requested on first run.

**Migration / import (R1 #10, R2 #6):** `migrate()` is a pure function `raw → state` (idempotent by `schemaVersion`; rejects a *newer* schema with a clear message). Import = validate shape → migrate → recompute derived fields (ledger sums, mastery) → preview ("32 סבבים, 412 מטבעות, ייצוא מ-…"; warns "הסבב הפתוח יימחק" if `state.active` exists) → confirm (PIN) → current state saved under `mathtrainer.v1.backup` → replace the **whole** blob in one write. An imported `active` (suspended session) is **kept** and resumes on the destination device with its in-flight question deferred (R3 #2, amended 2026-08-28); the device's `pinHash`/`recoveryHash` are kept, the imported ones ignored. Never merge. Reset (PIN + "מחק") = same path with an empty state, PIN retained. **Undo**: the parent view offers a PIN-gated one-level "בטלי ייבוא/איפוס אחרון" that previews `mathtrainer.v1.backup` and restores it atomically via the same replace path (R3 #3).

## 9. Screens
1. **Home**: title, mascot, coin balance pill, streak, huge "בואי נתחיל!" (or "ממשיכים!" if a journal exists), buttons "האוסף שלי" / "פרסים", tiny grey "הורים". iOS Safari not in standalone → banner: Share → "הוספה למסך הבית". Backup banner (not only in parent view — R1 #11) when never exported or > 14 days, or after a reward is approved.
2. **Question**: equation `7 × 8 = [ ]` (LTR island), "שווה 3 🪙" badge, 10 progress dots, numpad (0–9, ⌫, ✓) when `pointer: coarse`, keyboard otherwise, "הצג מקלדת" toggle for hybrids. Challenge ON (amended 2026-08-27): a **turtle walk** instead of a bar — 🐢 ambles along a track toward 🏁 over the time limit; at the flag it rests with 💤 and "הצב הגיע ונח 😴 — אפשר לאט 🙂", question stays open; a fast correct answer turns it into a hopping 🐇. Correct: green flash, coins fly to the balance pill, confetti. Wrong: soft orange shake, then the **dot-array helper** — the fact as `a` rows of `b` dots lighting up row by row (CONFIG.HELPER_CASCADE_MS) under the caption "a × b = product" — shown for CONFIG.WRONG_ANSWER_HELPER_MS (3.2 s). It explains after a miss; it never hints while answering (D3). ✕ / Escape → "יוצאות? נמשיך אחר כך מאותו מקום" (suspend only, D12).
   **Layout (R1 #13):** `min-height: 100dvh`, `env(safe-area-inset-*)`, numpad keys ≥ 56 px; compact layout when height < 600 px (equation smaller, dots collapse to "3/10"); the ✓ key must be visible on iPhone SE portrait, iPhone landscape, iPad Split View 1/3, and standalone mode.
3. **Summary**: stars, `8/10`, coins counting up, "למדנו היום" list, unlock reveal, "עוד סבב!" / "סיימנו". Perfect → fireworks + "מושלם!!!"; else "כל הכבוד, ממשיכים!" with a specific encouragement. Shown only after the save succeeded.
4. **Collection**: sticker shelf; next-unlock progress bar.
5. **Rewards (child)**: parent-defined list with progress bars and "לבקש"; pending requests shown as "מחכה לאישור".
6. **Parent (PIN)**: settings (name, challenge on/off, time limit slider 5–30 s, sound, change PIN), rewards editor, pending requests approve/reject, KPI tiles, 4 SVG line charts, heatmap, weakest table, session history (abandoned flagged), export/import/reset (reset requires PIN + typing "מחק"), backup status. **First run** (D15): a parent setup screen (name, PIN, recovery code shown once with "כתבו את זה במקום בטוח") precedes the child's first game. "שכחתי קוד" → enter the recovery code → set a new PIN; without it there is no recovery (documented in README).
7. **Stale window**: if another window has written since this one loaded, a full-screen "רענני" card replaces the app (no writes possible).

## 10. Visual direction
Warm cream `#FFF8F0`, white cards r=24, primary `#4F7CFF`, correct `#3CC97A`, wrong `#FF9F68` (never red), gold `#FFC93C`, text `#2B2D42`, muted `#8D99AE`; parent view `#F4F6FB`. Equation `clamp(40px, 9vw, 96px)`. CSS-only animations, `prefers-reduced-motion`. Optional WebAudio blips. Responsive iPhone → iPad → desktop. `frontend-design` + `dataviz` skills at build.

## 11. PWA / hosting
- Manifest + `apple-touch-icon` + `apple-mobile-web-app-capable`; `sw.js` caches the app files under a `VERSION` cache, deletes old caches on activate. **Update toast ("יש גרסה חדשה — רענני") only on the home screen, never mid-session** (R1 #1).
- Repo `Marvol26/math-tables` (public, guessable URL; no personal data in the files). **Creating/pushing the repo is outward-facing → gated.**
- iOS storage: plain Safari tabs may be evicted after ~7 days of non-use (ITP); Home-Screen apps are exempt. Uninstalling the Home-Screen app **deletes all progress** — stated in README and in the first-run banner. Mitigations: install banner, `storage.persist()`, export prompts (home banner + after redemption). Verify eviction behaviour empirically in the build checklist.

## 12. Alternatives rejected
- `file://` + Mac launcher: iOS runs no JS from local files. Kept only the dual-write idea.
- Native / Capacitor wrapper: heavy, slow updates.
- SM-2 spaced repetition: unnecessary for 55 facts.
- Timeout as a miss: rejected by Marat.
- Checksummed merge protocol for two stores (R1 #8): rejected as oversized — single-writer lock + rev wins.
- Storage-quota alarm system (R1 #9): rejected — ~1 KB/session against ≥5 MB; bounded attempts retention + save-failure banner suffices.
- "Abandon" semantics + separate deferred queue (R2 #2): rejected in favour of suspend-only sessions — simpler and closes the exploit completely.
- Separate journal key (R1/R2): rejected — the in-progress session lives in the main blob so finalization, import and reset are each a single atomic write.
- Lease/fencing protocol between windows (R2 #3): rejected in favour of the IDB transactional rev check — a real commit gate with far less code.

## 13. Open (CONFIG-tunable after play-testing)
Coin tiers, unlock curve, default time limit, streak/perfect bonus sizes, sticker set.
