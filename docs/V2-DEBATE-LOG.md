# v2 design — Codex debate log (2026-08-28)

Artifact: `docs/V2-DESIGN.md`. Adversary: Codex gpt-5.6-sol, effort high (chosen by Marat). Debating side: Fable 5 (session model). Mode: plan-context under an L2 unattended grant — the designer decides, no user checkpoints.

**Task:** harden the v2 design (Batch 0 fixes, Batch S structure split, Batch 1 features, Batch 2 Rectangle Tetris) before executor briefs are written.
**Real constraints:** static PWA, no build step, no runtime deps, single state blob with CAS saves, child's live data on an iPad (29 sessions, 1 205 coins) must never be lost or corrupted, Hebrew feminine copy, egress only api.github.com.
**Costly to reverse:** the one-time facts rebuild (B2a) runs on the child's real data; the album/threshold model (ids in `unlocked`); the parked→array shape; the file split (cache-busting contract).

## Brief
- Attack focus: migration correctness (B2a rebuild, parked array), economy edge cases (album curve, golden, series), Tetris feasibility for an 8-year-old on touch, structure-split risk, scope creep.
- Off-limits (Marat's settled decisions): balloons count for mastery; perfect-series prizes; Tetris = option C with tap answers; structure = option B split; session size 10–20; album 2 + golden combined; sticker names.
- Depth: standard (MAX_ROUNDS 4). Severity floor: blockers + major.

## Round 1 — Codex: REVISION (12 items: 5 BLOCKER, 7 MAJOR)
| # | Sev | Objection | Designer response |
|---|---|---|---|
| 1 | BLOCKER | Facts rebuild replays completed sessions only → wipes attempts held in `active`/parked journals | Accepted. Rebuild replays `sessions[].attempts` + `active.attempts` + parked journals in `t` order; committed in the boot CAS save; failure leaves state untouched (§2 B2a). |
| 2 | BLOCKER | Rebuild trusts unvalidated attempt records; "skip and set guard" closes the migration forever | Accepted. Per-attempt preflight; malformed → untouched + `done:false` (re-run next boot); only "trimmed" sets `done:true` (can never become safe). |
| 3 | MAJOR | `masteredAfter` history stays false after rebuild | Accepted. Timeline replay snapshots `masteredAfter`/`stationsReached` per session at its `endedAt`; `map.reached` rebuilt at the right boundary. |
| 4 | BLOCKER | `parked` object→array: truthy empty array, unpark ambiguity, old-client/SW skew | Accepted. Additive `parkedSessions` (max 2, unique modes ≠ active), `parked` deleted after migration, LIFO unpark on finish, all call sites audited, both shapes importable (§4.4). |
| 5 | BLOCKER | Tetris retries mint row coins (I1) | Accepted. Retry placements tainted; rows containing grey/retry cells pay 0; `_rows` before `newUnlocks()`; explicit 10×10 miss→retry test (§4.2/4.3). |
| 6 | MAJOR | Well overloaded (mean area 31 cells; 310–620 cells/session into 140) — resets dominate | Accepted. Simulator gate with acceptance limits and CONFIG-only levers (COLS 10/12, ROWS 14–20, PIECE_SCALE, ROTATE_ALLOWED) before implementation; failure = stop/escalate (§4.6). |
| 7 | MAJOR | No deterministic journaled phase machine; transitionend unreliable; per-tap saves | Accepted. Pure reducer falling→landed→answered→placed with `deadline`; placement inside `submit()` (one save); moves UI-local; tap-a-column control; CSS is projection only; child playtest = post-ship item, mode off by default (§4.2, 4.7). |
| 8 | MAJOR | Session size mutable via `refreshSettings`; carryover slice by size wrong for legacy journals | Accepted. Denominator = `active.planned.length`; `carryoverTaken` recorded at start, leftover by key; legacy journals handled (§3.3). |
| 9 | MAJOR | `unlocked` not canonicalised; golden reveal of locked stickers; album titles in CONFIG | Accepted. Migrate/import normalise ids; `newUnlocks` after every ledger append; boundaries 1980/2005/3960 tested; titles in `T`; no locked reveals (§3.4). |
| 10 | BLOCKER | Deploy-contract test can't catch "changed asset, forgot bump"; version convention contradictory | Accepted. Content-hash asset URLs recomputed by the test; `tools/bump-version.js`; one convention (`APP_VERSION` → cache name); order/async/`cache:"reload"` asserted; S1 ships first (§7.1). |
| 11 | MAJOR | B1 mixes incomparable measurements, contradicts F9 | Accepted in modified form: per-mode series on a shared all-session axis (nulls), not "gaps only" — a mostly-balloon child would otherwise still see an empty accuracy chart, which is the complaint (§2 B1). |
| 12 | MAJOR | Batch S bundles too much | Accepted. S1 contract → S2 mechanical split → S3 behavioural cleanup, each its own release (§1). |
Rebuttals: none outright; #11 modified (per-mode lines instead of gaps).

## Round 2 — Codex: REVISION (prior: 8 RESOLVED, 4 STILL OPEN; 5 NEW)
| Item | Sev | Objection | Designer response |
|---|---|---|---|
| P1 | BLOCKER | Rebuild on CAS failure keeps a rebuilt in-memory view (violates byte-identical-on-failure) | Accepted: candidate adopted only after the boot CAS save succeeds; on failure the original state runs unchanged (play not blocked — rebuttal: the original is self-consistent and the rebuild is idempotent later). |
| P2 | BLOCKER | Temporal/source integrity of replayed attempts unchecked | Accepted: `startedAt ≤ t ≤ endedAt`, `key ∈ planned`, first attempts ⊆ planned, active/parked `t ≥ startedAt`; same in `validateImport`. |
| P4 | BLOCKER | Old client drops `parkedSessions` (migrate rebuilds an enumerated object) | Accepted: schema bumps — 2 at Batch 0 (`meta`, canonical unlocks), 3 at Batch 2 (`parkedSessions`); old clients refuse via `schemaTooNew`. |
| P10 | BLOCKER | Entry points (index.html, manifest, icons) unprotected; tool edit order unspecified | Accepted: `RELEASE = version-fingerprint` over index/manifest/icons as the cache name; tool order defined; test recomputes both. |
| N1 | MAJOR | Rebuild could reach a station from unfinished (active/parked) evidence | Accepted: stations only at completed-session boundaries; no `now` fallback. |
| N2 | BLOCKER | No validation contract for Tetris journals/settings | Accepted: full contract in §4.4 (grid shape/cells, phase, deadline, bounds, caps); malformed → reject/discard. |
| N3 | BLOCKER | Overflow checked after mutation | Accepted: landing → overflow? reset + recompute → place → clear; triggering piece placed in the fresh well. |
| N4 | MAJOR | `PIECE_SCALE` breaks the area model (63 is odd); `ROTATE_ALLOWED` conflicts with as-asked orientation | Accepted: both levers removed; levers = COLS {10,12,14}, ROWS 14–20; gate failure = stop/escalate. |
| N5 | MAJOR | Moving inline style attributes is not mechanical | Accepted: S2 extracts only the `<style>` block. |

## Round 3 — Codex: REVISION (P1, P4, P10, N1–N5 RESOLVED; P2 STILL OPEN; 1 NEW)
| Item | Sev | Objection | Designer response |
|---|---|---|---|
| P2 | BLOCKER | `first attempts ⊆ planned` allows duplicates/missing → false evidence | Accepted: multiset of non-retry attempts == `planned` exactly; `firstTryCorrect`/`misses` must agree; else preflight fails without rebuilding. |
| N6 | MAJOR | Reduced-motion "appears landed" contradicts deadline ×2 semantics | Accepted: stationary piece + numeric countdown, moves to landed at the deadline; semantic phase identical to the animated path. |
Rebuttal accepted by Codex: P1 "block play" dropped.

## Round 4 — Codex: P2 STILL OPEN (active/parked journals), reduced-motion RESOLVED, no new items
| Item | Sev | Objection | Designer response |
|---|---|---|---|
| P2 | BLOCKER | Active/parked journals could carry duplicate/missing first attempts | Accepted: `canonical(nonRetryAttempts) ⊎ canonical(queue) == canonical(planned)` exactly, no duplicates/overlap (design v5). |
MAX_ROUNDS (4) reached; one closure reply requested for verification of the single remaining edit.

## Closure — Codex: **APPROVE** (P2 RESOLVED)

## Synthesis (designer owns the decision)
- Initial position: `docs/V2-DESIGN.md` v1 (four batches, mixed charts, session-only rebuild, parked→array, Tetris with post-mutation overflow and two extra levers, single "structure" batch, version-string deploy test).
- Brief: attack migration correctness, economy edges, Tetris feasibility, split risk, scope; off-limits = Marat's settled calls; 4 rounds; blockers+major.
- Outcome: 18 objections over 4 rounds (7 BLOCKER, 11 MAJOR) — all accepted except two rebuttals Codex then accepted (#11 per-mode lines instead of gaps; P1 no play-blocking on CAS failure). Final: v5.
- Shared, still-unverified assumptions (flagged, not validated by either model): (a) `MASTERY_MS_THRESHOLD` 8 s is the right number — evidence is one child's 4 typed rounds; (b) the Tetris well can pass the §4.6 gate with COLS/ROWS alone — unknown until the simulator runs (stop condition if not); (c) album-2 curve "restart" pacing (~50 sessions) is desirable; (d) golden = station k → sticker k reads as meaningful to the child.
- Model/effort: Codex gpt-5.6-sol / high; rounds: 4 + closure. Artifact: `docs/V2-DESIGN.md` (v5). Log: this file.
