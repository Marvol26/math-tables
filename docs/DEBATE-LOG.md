# Design debate log — לוח הכפל

Mode: discussion (design-stage). Artifact: `docs/DESIGN.md`. Adversary: Codex **gpt-5.6-sol / high** (chosen by Marat, 2026-08-25). Debating side: Claude Fable 5 (session model).

## Task
Harden the design of a Hebrew multiplication-tables PWA for an 8-year-old girl before the executor brief is written.

## Real constraints / costly to reverse
Data model (coins, unlocks, redemptions, per-attempt limit), coin economy shape (children notice changes), hosting choice (GitHub Pages + iOS Home Screen), no backend, no build step.

## Brief
- Attack focus: (1) child engagement & economy exploits, (2) iOS PWA/storage pitfalls, (3) session algorithm & data-model edge cases.
- Off-limits (fixed by Marat): D1 facts 1–10; D2 Hebrew feminine; D3 typed digits, no hints; D4 session/retry/carryover rule; D5 GitHub Pages + Add to Home Screen; D7 single profile; D8 timeout never punishes; D11 perfect = amazing, else encouraging.
- Depth: standard → MAX_ROUNDS = 4.
- Severity floor: blockers + major.

## Rounds

### Round 1 — Codex (thread 01a03975-eae0-7450-bb7a-35bdb1b30622)
Codex raised 13 items (5 BLOCKER, 8 MAJOR):
1. BLOCKER end-only persistence = quit-to-erase exploit + data loss → **accepted**: per-answer journal, resume, explicit exit keeps answered attempts (D12); SW update toast only on home.
2. BLOCKER retries inflate accuracy/mastery → **accepted**: first-attempt-only KPIs (D13).
3. BLOCKER carryover order puts today's misses behind overflow → **accepted**: misses first.
4. BLOCKER reward spending not transaction-safe → **accepted (simplified)**: append-only ledger, request snapshots + states, idempotent approval, repeatable rewards.
5. MAJOR economy rewards grinding → **accepted**: mastered facts pay 1 flat, retries excluded from streaks, perfect bonus once/day, unlock curve defined + simulation checklist item.
6. MAJOR perfect-session cliff → **accepted**: no rare-sticker stake, +5 first perfect of day, 9/10 gets +2.
7. MAJOR parent settings reachable by child → **accepted**: 4-digit PIN (D14).
8. BLOCKER dual-write conflict/recovery → **partially accepted**: rev-wins read-repair + BroadcastChannel single-writer lock; checksum/merge protocol **rebutted** as oversized for a single-user local app.
9. MAJOR storage growth → **partially accepted**: attempts retained for newest 200 sessions, save-failure banner, journal kept until save succeeds; quota alarm **rebutted** (~1 KB/session vs ≥5 MB).
10. MAJOR migration/import corruption → **accepted (replace semantics)**: validate → migrate → recompute → preview → backup → replace; newer schema rejected.
11. MAJOR iOS data-survival overstated → **accepted**: storage.persist(), uninstall warning, export banners on home + after redemption.
12. MAJOR timing across iOS lifecycle → **accepted**: rAF-start, monotonic clock, `interrupted` flag excluded from speed/mastery/withinLimit.
13. MAJOR numpad layout in short viewports → **accepted**: 100dvh, safe-area insets, compact layout, device test matrix.
Artifact revised to v2.

### Round 2 — Codex verification + new items
Resolved: #2, #4, #5, #6, #9, #11, #13. Rebuttal #9 accepted by Codex; rebuttal #8 accepted for checksums/merge but not for the lock.
Still open (#1, #3, #7, #8, #10, #12) folded into 6 new items:
1. BLOCKER crash between state save and journal clear double-credits a session → **accepted**: `state.active` lives inside the main blob; finalization = one write; deterministic ledger ids by session id; session id already in `sessions` never re-applied.
2. MAJOR abandonment allows cherry-picking/reroll → **accepted, simpler form**: plan saved at session start; exit = suspend only; no abandon state, no deferred queue (D12 rewritten).
3. BLOCKER BroadcastChannel is not a lock → **accepted**: IndexedDB is authoritative; save = readwrite transaction with rev check, abort → window goes stale/read-only; localStorage is a mirror. Lease/fencing **rebutted** as unnecessary once the transactional gate exists.
4. MAJOR PIN ownership/recovery → **accepted**: parent setup screen before first play (D15), one-time recovery code, import/reset keep the device PIN.
5. MAJOR challenge timing reset by killing the app → **accepted**: `current` journaled at paint; resumed question = interrupted, base coins, "ממשיכות בלי שעון", no bar restart.
6. MAJOR import/reset vs journal → **accepted via #1**: whole-blob replace drops imported `active`, preview warns if a session is open.
Artifact revised to v3.

### Round 3 — Codex verification + new items
All six round-2 items RESOLVED. New:
1. MAJOR same-window saves can race (paint/submit/visibilitychange each capturing rev N) → **accepted**: per-window promise queue, input disabled until start/paint commits, answer committed before feedback.
2. MAJOR import drops an exported suspended session → **accepted**: imported `active` kept, resumed with current question interrupted.
3. MAJOR pre-import backup has no restore path → **accepted**: PIN-gated one-level undo via the same atomic replace path.
Artifact revised to v4.

### Round 4 — Codex verification
All three round-3 items RESOLVED. **APPROVE.**

## Outcome
Codex gpt-5.6-sol / high, 4 rounds, 22 items raised (7 BLOCKER, 15 MAJOR), 19 accepted, 3 rebutted (checksum/merge protocol, quota alarm, lease/fencing) — Codex accepted the rebuttals once a real commit gate existed.
Shared assumptions neither model verified empirically (build-checklist items): iOS ITP eviction exemption for Home-Screen apps; `navigator.storage.persist()` behaviour on iOS; `100dvh` in standalone mode; the unlock-curve pacing (needs a simulation).
