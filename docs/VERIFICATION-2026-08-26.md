# Post-build verification — 2026-08-26

Three independent checks of the live build (commit 23bf9ea, https://marvol26.github.io/math-tables/, sw VERSION v4) against Marat's **original** requirements:
(a) Claude Fable 5 designer session — live walkthrough in Chrome + code reads; (b) fresh zero-context Fable 5 agent — code-level audit; (c) OpenAI Codex gpt-5.6-sol/high — read-only code audit. Tests: 75/75. Live files byte-identical to repo.

| Req | Verdict | Notes |
|---|---|---|
| R1 tables 1–10 | VERIFIED (a,b,c) | 55 facts, both directions asked |
| R2 pleasant / Hebrew feminine / iPad | PARTIAL (b,c) | masculine "הצג מקלדת" ×2, "ממשיכים" inconsistent; visuals clean but sparse; all 24 stickers render as the same 🎁; sound toggle is dead; childName never shown to the child; no real-device (iOS) run yet |
| R3 KPIs by timing | VERIFIED (a,b,c) | per-question ms, first attempts only, trends/heatmap/weakest |
| R4 typed, no clues | VERIFIED* (a,b,c) | *after a miss the correct answer is shown 1.8 s before the retry — by DESIGN D4, but both reviewers flag it as a "clue"; Marat to confirm |
| R5 10 q, retry same session + next | VERIFIED (a,b,c) | observed live: miss → retryQueue → carryover |
| R6 wants to play | PARTIAL (b,c) | mechanics work (coins, unlocks, requests/approval); the "wow" layer is thin: identical stickers, no sound, static emoji celebrations |
| R7 Challenge Mode | PARTIAL (b,c) | toggle/limit/×2/timeout-never-punishes all work; **no distinct "something nice" when beating the limit**; numpad toggle restarts the visual bar (cosmetic); setting applies from next session |
| R8 per-question prize | VERIFIED (a,b,c) | design weakness: tier by the *larger* operand → 1×6 pays 3 coins |
| R9 perfect vs encouraging | PARTIAL (b,c) | "fireworks" = one emoji; "למדנו היום" prints raw keys "3x4" (Latin x, no product); a correct retry shows no text (dead T key) |
| R10 persistence/PIN/backup | VERIFIED (b,c) with risks | import validation shallow (`current:{}` crashes render; crafted ledger accepted — PIN-gated path); export uses `<a download>` — must be confirmed in iOS standalone |

Findings by (a) alone: "יש גרסה חדשה" toast on the very first visit (sw posts "updated" on first install); Enter on Home does not start a session (DESIGN §9.1 said it should); backup banner shown on a fresh install with zero sessions.
Findings by (b) alone: ✕/back during the 1.8 s feedback window can paint a question over Home (uncancelled timer; no data corruption).
Findings by (c) alone: duplicate reward requests on rapid double-tap; clock-set-back yields negative elapsed (counts as within-limit); parent view has no inactivity auto-lock; user-visible strings outside `T` (list in Codex report).

## Punch-list candidates (not yet decided)
P1 feminine fixes (הציגי, ממשיכות, retry text); P2 distinct stickers (emoji per CONFIG name) + reveal; P3 challenge "beat the clock" effect + real confetti/fireworks; P4 sound blips or remove the toggle; P5 "למדנו היום" as "3 × 4 = 12"; P6 coin tier by min operand (or both ≥3); P7 sw first-install toast; P8 Enter on Home; P9 feedback-timer cancel on exit; P10 import validation (`current` shape, ledger bounds); P11 request double-tap guard; P12 strings into `T`; P13 verify export in iOS standalone; P14 show childName on Home.
