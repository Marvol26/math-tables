# Skill scouting — v2 cycle (2026-08-29), for Marat's yes/no

## New skill candidates
1. **`subagent-build-loop`** (global) — the loop this cycle ran six times: executor subagent (Sonnet) with a kickoff prompt naming the baseline commit → fresh Fable reviewer with an "assume the author was wrong" brief → fixes routed back to the *same* executor → fix-verification with the *same* reviewer → designer commits/pushes → record the next baseline in the status log. Encodes: baseline-in-kickoff (the plan's baseline drifts as soon as docs are committed), the "resume the same agent" rule, and the usage-limit fallback (relaunch a fresh reviewer with the same brief).
2. **`headless-layout-harness`** (project `.claude/skills`) — the CDP-driven harness pattern (`fv-harness.js`/`fv2-harness.js`): seed the localStorage mirror with a state, navigate, click through, measure rects at a viewport matrix, screenshot. Reused by four packages; each executor re-derived it.

## Updates to existing skills
- **handoff-plan**: add "the baseline commit is given in the kickoff prompt, not the plan header" (the plan file itself is committed, so a header baseline is stale by construction — hit on package S1).
- **adversarial-review**: add "a reviewer killed by the session usage limit returns a one-line result — relaunch a fresh reviewer with the same brief; do not treat the stub as a review" (hit on package S3).
- **design-to-build**: add "simulator-gated packages must name the escalation owner and the parking convention for the WIP (local branch, not main)" (hit on package 2).
- **codex-plan-debate**: add "record which levers a gate may tune; a gate that fails inside its levers is a design decision, not an executor tuning task" (the Tetris gate).
