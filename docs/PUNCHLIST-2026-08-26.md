# Punch-list build brief — 2026-08-26 (light cycle)

Source universe: `docs/VERIFICATION-2026-08-26.md` (three independent verifications). Executor: Claude Fable 5 in the designer session ("run it", Marat 2026-08-26) — small enough not to hand off. Closing reviewer: Codex gpt-5.6-sol/high (executor is the strongest Anthropic tier). Autonomy: local commits; **push requires Marat's yes** (prior grant expired at WP9).

| # | Item | Decision |
|---|---|---|
| P1 | Feminine strings: הציגי מקלדת / הציגי מקלדת מספרים, ממשיכות (resume + encouraging title), render `retryNowYouKnow` on a correct retry | fix |
| P2 | Distinct sticker per `CONFIG.STICKERS` name (emoji map in index.html), used on shelf + summary reveal | fix |
| P3 | "Beat the clock" effect (⚡ burst + label) when `withinLimit`; CSS confetti on correct; fireworks animation on perfect summary; honours reduced-motion | fix |
| P4 | Sound: tiny WebAudio blips (correct / wrong / unlock), gated by `settings.sound`; toggle stays | fix |
| P5 | "למדנו היום" renders `a × b = product` from canonical keys | fix |
| P6 | Coin tier by larger operand (1×6 = 3 coins) | **not changed** — `CONFIG.TIER_BY` switch added (`"max"` default, `"min"` optional); Marat decides |
| P7 | Update toast on first install | fix: ignore SW "updated" when no controller existed at load |
| P8 | Enter on Home starts/resumes | fix |
| P9 | Feedback timer paints a question over Home after ✕ | fix: cancel handle in `route()`, guard callback on screen |
| P10 | Import validation: `active.current` shape; ledger `|amount| ≤ 10000` | fix + tests |
| P11 | Duplicate reward requests on double-tap | fix in `Economy.requestReward` (reject when a pending request exists) + test |
| P12 | Strings outside `T` → `T` | fix (those found by the reviewers) |
| P13 | Export in iOS standalone | Marat's device check (unchanged) |
| P14 | Show child's name on Home | fix ("היי, נועה!") |
| — | Answer shown 1.8 s after a miss | **kept as designed** (D4); Marat can ask to remove |
| — | Backup banner on fresh install | fix: only after ≥1 session |
