# Journey map — design (v1, 2026-08-27 — approved by Marat: learning order, reach at 10/10, mild practice priority)

Extends DESIGN v4. Personal domain. Executor: designer session (Fable 5); closing review: fresh Fable 5 agent (Codex out of credits).

## 1. What it is
A winding path with **10 stations, one per multiplication table**, in a learning order (not numeric):
`×1 → ×2 → ×10 → ×5 → ×3 → ×4 → ×6 → ×7 → ×8 → ×9`, ending at a 🏰. The child's 🐢 (same character as the countdown) stands at the station she is working on. Reached stations glow and keep a ⭐. A screen of its own ("המפה שלי 🗺️" on Home) plus a one-line status on Home.

## 2. Rules (all numbers in CONFIG)
- **Table n's facts** = the 10 facts `n×1 … n×10` (canonical keys `min×max`; facts shared between tables count for both).
- **Station progress** = mastered facts of that table / 10 (mastery as in DESIGN §7: 3 correct first attempts, median ≤ 6 s).
- **Station reached** when progress hits **10/10** (`CONFIG.STATION_REQUIRED = 10`). Reaching is **permanent** (`state.map.reached[n] = timestamp`) — a later slip dims the ⭐ to ☆ (progress shows 9/10) but the station stays reached and the turtle never walks back. **Never falls.**
- **Turtle position** = the first station in path order that is not reached. All 10 reached → the turtle is at the 🏰 with a crown 👑.
- **Practice follows the map**: unseen facts of the *current* station's table are introduced before other unseen facts (sum order kept within each group), and seen facts of that table get a mild priority (`CONFIG.MAP_FOCUS_BONUS = 1.5` on the weakness score). Amended after review (2026-08-27): the earlier bonus-only rule was inert until every fact had been seen, so stations lit out of order and in bursts. Carryover and mastered-review rules are unchanged, so she still sees other tables; the current table just appears a bit more often.
- **Celebration**: when `finish()` reaches a new station, the summary gets a banner "הגעת לתחנה ×5! 🎉" with the station badge popping in, confetti, and the unlock sound; several stations in one session share one banner.

## 3. Screens
- **Map screen**: vertical zig-zag path (SVG, fits any portrait width; landscape scrolls), stations as round badges "×5" with a state: reached (gold, ⭐), current (blue ring, 🐢 beside it, "3/10"), ahead (grey, "0/10"). Tapping a station shows its 10 facts as small chips coloured by mastery (green/orange/grey) — read-only, no practice from here (sessions stay the only way to play, D4). Back button.
- **Home**: line under the coin pill — "🐢 את בתחנה ×4 · 3/10" — and a button "המפה שלי 🗺️" next to the collection/rewards buttons.
- **Parent view**: a small "מפה" row in the stats: stations reached N/10 and the current table (no new charts).

## 4. Data
`state.map = { reached: { "5": 1756...,  } }` (table number → time reached). Added by `migrate()` with a default `{}` — **schemaVersion stays 1** (additive, defaulting; old backups import fine). Export/import/undo/reset unchanged (reset clears it).

## 5. Out of scope (v1)
Animal titles / XP levels; practice launched from a station; per-station rewards; falling.

## 6. Tests (node)
Table facts = 10 per table, shared facts counted; progress/reached/current computations; reached is monotone (mastery drop keeps it); path order; selector bonus applied only to the current table and never duplicates or breaks carryover-first; migrate defaults `map` and import validation accepts/rejects its shape.

## 7. Decisions (Marat, 2026-08-27)
(a) Learning order. (b) Reached at 10/10. (c) Practice priority for the current table (unseen-first + mild bonus, see §2).
