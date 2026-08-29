# Falling numbers — game mode design (v1, 2026-08-27, Marat's request)

Extends DESIGN v4 and MAP-DESIGN. Personal domain. Executor: Sonnet in a fresh session (`falling-build-plan.md`). Reviewer: Fable 5 via the Agent tool.

## 1. What it is
An optional second way to play. An expression (e.g. `7 × 8`) is shown at the top; **N candidate answers fall from the top of the screen** over a parent-chosen number of seconds. The child **taps** the correct number. At least 4 candidates; the wrong ones are deliberately close.

## 2. Decisions (designer; Marat may flip any)
| # | Decision |
|---|---|
| F1 | Entry: Home gets a second button "מספרים נופלים 🎈" when the parent enables the mode (`settings.falling.enabled`, default **off**). Amended 2026-08-28: the button is shown even while a typed session is suspended — that session is *parked* (`state.parked`) and returns after the balloon round; a parked falling session stays resumable even if the parent later disables the mode, but no new one starts. |
| F2 | Parent settings: `falling.durationSec` 3–20 (default 8) = time for a number to reach the bottom; `falling.options` 4–6 (default 4). |
| F3 | A falling session = 10 facts from the same `Selector.plan` (carryover/focus/review as usual) so it feels consistent. |
| F4 | **Amended 2026-08-28 (Marat, D1)**: a correct tap pays the fact's base value (×2 if tapped before the numbers land; retries 0), streak/perfect/near-perfect bonuses and sticker unlocks apply, **and now also updates facts/mastery/map exactly like a typed answer**; **carryover stays typed-only** (a balloon miss never feeds carryover — recognition ≠ recall for that one purpose, see research note 2026-08-27). The session record is stored with `mode: "falling"` and shown in the parent history with a 🎈. |
| F5 | Wrong tap → same feedback as typed mode: dot-array picture + strategy line, waits for "הבנתי", then the fact is re-asked at the end of the session (same-session retry only; no carryover). |
| F6 | Time runs out → the numbers **land at the bottom and stay tappable**; label "נחתו! אפשר לבחור בנחת 🙂"; no ×2. Never a miss. |
| F7 | Distractors (pure, in core, tested): for `a×b=p` generate candidates in priority order: `(a±1)×b`, `a×(b±1)` (same-table neighbours), `p±a`, `p±b`, digit swap of `p` (two distinct digits), `a+b`, `p±10`; keep unique, ≠ p, 1…100; take `options−1`; if short, fill with random products of other facts within ±20 of p. Shuffle positions. |
| F8 | Layout: each candidate is a big round bubble (≥ 64 px) in its own lane (`options` lanes across the width, order shuffled), falling with a CSS animation whose duration = `durationSec`; bubbles wobble slightly; tapping any bubble submits it. On the Mac, keys 1–N pick the bubble in that lane (left→right) as a keyboard path. |
| F9 | Timing/KPIs: `shownAt` at paint, `withinLimit` = tapped before landing; attempts recorded like typed ones with `mode:"falling"`. **Amended 2026-08-28 (Marat, D1)**: `Stats.trends` `masteredCount` now includes falling sessions (balloon taps move mastery/map). `accuracy`/`avgMs` STAY typed-only — a 4-option tap has a 25% guess floor and tap time ≠ recall time. `coins` unchanged (both modes). |
| F10 | Exit/suspend works exactly as in typed mode (`state.active` journal). Amended 2026-08-28: the question the round was suspended on is deferred; when it returns it renders already landed (no ×2); every other question after a resume falls normally. |

## 3. Data
- `settings.falling = { enabled:false, durationSec:8, options:4 }` (migrate default; additive; schema stays 1).
- `state.active.mode = "typed" | "falling"` (default "typed"; migrate fills it). `session.mode` likewise.
- `attempt.mode` on each attempt record.
- `SessionCore.start(state, rng, now, { mode })`. Amended 2026-08-28: falling now counts for mastery and the journey map exactly like typed answers — `Facts.updateFromAttempt` and `Map.newlyReached` both run unconditionally. The ONE thing `finish()` still skips for `active.mode === "falling"` is carryover recomputation (I-F1: `state.carryover` stays exactly as it was when the falling session started); coins/ledger/unlocks/session record are unaffected either way.

## 4. Screens
- **Home**: "מספרים נופלים 🎈" button (only when enabled); resume label shows the mode's icon if the suspended session is falling.
- **Falling question screen**: expression card at the top (LTR island, same size as typed), coin badge, dots, the lanes area filling the rest (`100dvh` minus header), bubbles falling; ✕ exit + bottom exit line as in typed. Feedback reuses `showFeedback` (correct: confetti/fast badge; wrong: picture + הבנתי).
- **Summary**: unchanged; title adds 🎈 for falling sessions.
- **Parent**: settings block "מספרים נופלים": enable toggle, duration slider, options 4/5/6; history rows show 🎈.

## 5. Out of scope
Mixing typed and falling in one session; ~~falling mode affecting mastery~~ (in scope since 2026-08-28 — see F4); falling misses carrying over into typed sessions; sounds beyond the existing blips; landscape-specific lane layouts beyond "lanes shrink to fit".

## 6. Tests (node)
Distractors: count = options−1, unique, ≠ p, all in 1…100, at least one same-table neighbour when it exists, deterministic under an injected rng; `start({mode:"falling"})` sets `active.mode`; `finish()` for falling: coins/ledger/session recorded with `mode:"falling"`, **facts updated, mastery/map updated like typed, carryover untouched** (amended 2026-08-28, Marat D1); `Stats.trends` includes falling in `masteredCount` but keeps `accuracy`/`avgMs` typed-only; migrate defaults; validateImport accepts old sessions without `mode`.
