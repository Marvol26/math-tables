const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG, Facts } = require("../core.js");

function emptyState() {
  return { facts: {} };
}

test("allKeys returns exactly 55 unique keys", () => {
  const keys = Facts.allKeys();
  assert.equal(keys.length, 55);
  assert.equal(new Set(keys).size, 55);
});

test("key() is commutative", () => {
  assert.equal(Facts.key(7, 3), Facts.key(3, 7));
  assert.equal(Facts.key(7, 3), "3x7");
});

// V2-DESIGN §8: mastery also requires Facts.mirrorOk. These four tests
// exercise the pre-existing recency/speed/interrupted rule in isolation, so
// they use a SQUARE key ("6x6") — squares are mirrorOk-trivial (only one
// direction) — leaving the mirror interaction to its own tests below.
test("mastery requires 3 correct first attempts with median <= 8000ms (CONFIG.MASTERY_MS_THRESHOLD, V2-DESIGN B2b) and none interrupted", () => {
  const state = emptyState();
  const key = "6x6";
  const good = { ok: true, ms: 4000, asked: "6x6", t: 1, withinLimit: true, interrupted: false, retry: false };
  Facts.updateFromAttempt(state, key, good);
  assert.equal(Facts.mastery(state.facts[key]), "learning");
  Facts.updateFromAttempt(state, key, { ...good, t: 2 });
  assert.equal(Facts.mastery(state.facts[key]), "learning");
  Facts.updateFromAttempt(state, key, { ...good, t: 3 });
  assert.equal(Facts.mastery(state.facts[key]), "mastered");
});

test("mastery is not reached if the median of the last 3 exceeds the threshold", () => {
  const state = emptyState();
  const key = "6x6";
  Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x6", t: 1, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 9000, asked: "6x6", t: 2, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 10000, asked: "6x6", t: 3, withinLimit: false, interrupted: false, retry: false });
  assert.equal(Facts.mastery(state.facts[key]), "learning");
});

test("an interrupted attempt in the last 3 blocks mastery", () => {
  const state = emptyState();
  const key = "6x6";
  Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x6", t: 1, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x6", t: 2, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x6", t: 3, withinLimit: true, interrupted: true, retry: false });
  assert.equal(Facts.mastery(state.facts[key]), "learning");
});

test("a miss demotes: three correct then a miss is no longer mastered", () => {
  const state = emptyState();
  const key = "6x6";
  for (let i = 0; i < 3; i++) {
    Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x6", t: i, withinLimit: true, interrupted: false, retry: false });
  }
  assert.equal(Facts.mastery(state.facts[key]), "mastered");
  Facts.updateFromAttempt(state, key, { ok: false, ms: 4000, asked: "6x6", t: 4, withinLimit: true, interrupted: false, retry: false });
  assert.equal(Facts.mastery(state.facts[key]), "learning");
});

// --- V2-DESIGN §8: mirrorOk / mastery-requires-mirror ---

test("[§8] mirrorOk: squares are trivially ok even with zero attempts recorded", () => {
  assert.equal(Facts.mirrorOk(Facts.emptyFact(), "6x6"), true);
});

test("[§8] mirrorOk: a non-square fact with no recent entries is not ok", () => {
  assert.equal(Facts.mirrorOk(Facts.emptyFact(), "6x7"), false);
  assert.equal(Facts.mirrorOk(null, "6x7"), false);
});

test("[§8] mirrorOk: fast+correct in only ONE direction is not ok", () => {
  const state = emptyState();
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 3000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  assert.equal(Facts.mirrorOk(state.facts["6x7"], "6x7"), false);
});

test("[§8] mirrorOk: fast+correct in BOTH directions is ok", () => {
  const state = emptyState();
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 3000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 3000, asked: "7x6", t: 2, withinLimit: true, interrupted: false, retry: false });
  assert.equal(Facts.mirrorOk(state.facts["6x7"], "6x7"), true);
});

// V2-DESIGN §8 amended 2026-08-29 (closing-review HIGH-2): "quick" is no
// longer per-direction-independent — mirrorOk needs BOTH directions to have
// a correct entry and AT LEAST ONE of them (either direction) to be quick
// (absolute or relative to its immediate predecessor). Both entries here are
// slow AND not in a qualifying preceding-answer relationship (9000ms is not
// within MIRROR_FAST_RATIO of the other 9000ms entry), so neither the
// absolute nor the relative bar is met anywhere -> not ok.
test("[§8 HIGH-2] mirrorOk: correct but SLOW in both directions, with no quick relative pair either, is not ok", () => {
  const state = emptyState();
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 9000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 9000, asked: "7x6", t: 2, withinLimit: true, interrupted: false, retry: false });
  assert.equal(Facts.mirrorOk(state.facts["6x7"], "6x7"), false);
});

// The four scenarios V2-DESIGN §8 names explicitly for the amended
// "quick mirror answer" rule (closing-review HIGH-2 — a flat MIRROR_FAST_MS
// alone was unreachable for a ~10s typist, stalling mastery/the map).
test("[§8 HIGH-2] mirrorOk: 9s then <=5.4s (MIRROR_FAST_RATIO of 9s) in the OTHER direction is ok, even though neither alone beats the absolute bar", () => {
  const state = emptyState();
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 9000, asked: "6x7", t: 1, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 5400, asked: "7x6", t: 2, withinLimit: false, interrupted: false, retry: false });
  assert.equal(Facts.mirrorOk(state.facts["6x7"], "6x7"), true);
});

test("[§8 HIGH-2] mirrorOk: 9s then 6s (short of the 0.6 ratio, 6000 > 5400) is not ok", () => {
  const state = emptyState();
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 9000, asked: "6x7", t: 1, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 6000, asked: "7x6", t: 2, withinLimit: false, interrupted: false, retry: false });
  assert.equal(Facts.mirrorOk(state.facts["6x7"], "6x7"), false);
});

test("[§8 HIGH-2] mirrorOk: an absolute-fast (<=4000ms) entry in the second direction alone is ok, even though the first direction was slow", () => {
  const state = emptyState();
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 9000, asked: "6x7", t: 1, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 3900, asked: "7x6", t: 2, withinLimit: false, interrupted: false, retry: false });
  assert.equal(Facts.mirrorOk(state.facts["6x7"], "6x7"), true);
});

test("[§8 HIGH-2] mirrorOk: the ratio path does not apply when the immediately preceding entry was a miss", () => {
  const state = emptyState();
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 9000, asked: "6x7", t: 1, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, "6x7", { ok: false, ms: 9000, asked: "6x7", t: 2, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 5000, asked: "7x6", t: 3, withinLimit: false, interrupted: false, retry: false });
  assert.equal(Facts.mirrorOk(state.facts["6x7"], "6x7"), false);
});

test("[§8] mirrorOk: an interrupted fast-correct entry does not count", () => {
  const state = emptyState();
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 3000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 3000, asked: "7x6", t: 2, withinLimit: true, interrupted: true, retry: false });
  assert.equal(Facts.mirrorOk(state.facts["6x7"], "6x7"), false);
});

// V2-DESIGN §8 amended 2026-08-29 (fix-verification escalation): mastery
// requires Facts.bothDirectionsOk (correct in each direction, ANY speed),
// NOT Facts.mirrorOk (the quick-mirror signal is parent-view-only now — a
// simulated 5-11s typist never mastered anything under a quick-mirror gate,
// since ~3s of every answer is typing time).
test("[§8] mastery: a non-square fact correct 3x in ONE direction only never masters (bothDirectionsOk false)", () => {
  const state = emptyState();
  const key = "6x7";
  for (let i = 0; i < 3; i++) {
    Facts.updateFromAttempt(state, key, { ok: true, ms: 3000, asked: "6x7", t: i, withinLimit: true, interrupted: false, retry: false });
  }
  assert.equal(Facts.mastery(state.facts[key]), "learning");
});

test("[§8] mastery: a non-square fact reaches mastered once BOTH directions are correct (bothDirectionsOk), regardless of mirrorOk", () => {
  const state = emptyState();
  const key = "6x7";
  Facts.updateFromAttempt(state, key, { ok: true, ms: 3000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 3000, asked: "6x7", t: 2, withinLimit: true, interrupted: false, retry: false });
  assert.equal(Facts.mastery(state.facts[key]), "learning"); // last3 not yet all-correct-both-directions
  Facts.updateFromAttempt(state, key, { ok: true, ms: 3000, asked: "7x6", t: 3, withinLimit: true, interrupted: false, retry: false });
  assert.equal(Facts.mastery(state.facts[key]), "mastered");
});

test("[§8 fix-verification] mastery: correct-but-SLOW (well over MIRROR_FAST_MS, no quick-mirror pair) in both directions still masters — mirrorOk is not the gate", () => {
  const state = emptyState();
  const key = "6x7";
  // 7000ms in each direction: correct, non-interrupted, median(7000)<=MASTERY_MS_THRESHOLD(8000),
  // but nowhere near CONFIG.MIRROR_FAST_MS(4000) and no quick relative pair either
  // (7000 is not <= MIRROR_FAST_RATIO*7000). Facts.mirrorOk would say false here.
  Facts.updateFromAttempt(state, key, { ok: true, ms: 7000, asked: "6x7", t: 1, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 7000, asked: "6x7", t: 2, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 7000, asked: "7x6", t: 3, withinLimit: false, interrupted: false, retry: false });
  assert.equal(Facts.mirrorOk(state.facts[key], key), false, "sanity: mirrorOk is indeed false for this fixture");
  assert.equal(Facts.bothDirectionsOk(state.facts[key], key), true);
  assert.equal(Facts.mastery(state.facts[key]), "mastered");
});

test("[§8] mastery: a square fact needs no mirror — 3 correct in its one direction masters it", () => {
  const state = emptyState();
  const key = "7x7";
  for (let i = 0; i < 3; i++) {
    Facts.updateFromAttempt(state, key, { ok: true, ms: 3000, asked: "7x7", t: i, withinLimit: true, interrupted: false, retry: false });
  }
  assert.equal(Facts.mastery(state.facts[key]), "mastered");
});

test("[§8] bothDirectionsOk in all four states (mirrors the mirrorOk state-table, but speed-agnostic)", () => {
  const state = emptyState();
  assert.equal(Facts.bothDirectionsOk(Facts.emptyFact(), "6x7"), false, "no attempts");
  assert.equal(Facts.bothDirectionsOk(Facts.emptyFact(), "6x6"), true, "square trivially ok");
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 9000, asked: "6x7", t: 1, withinLimit: false, interrupted: false, retry: false });
  assert.equal(Facts.bothDirectionsOk(state.facts["6x7"], "6x7"), false, "one direction only");
  Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 9000, asked: "7x6", t: 2, withinLimit: false, interrupted: false, retry: false });
  assert.equal(Facts.bothDirectionsOk(state.facts["6x7"], "6x7"), true, "both directions correct, slow — speed does not matter here");
});

test("a retry never changes attempts/correct/recent", () => {
  const state = emptyState();
  const key = "6x7";
  Facts.updateFromAttempt(state, key, { ok: false, ms: 4000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  const before = JSON.stringify(state.facts[key]);
  assert.throws(() => {
    Facts.updateFromAttempt(state, key, { ok: true, ms: 3000, asked: "6x7", t: 2, withinLimit: true, interrupted: false, retry: true });
  });
  assert.equal(JSON.stringify(state.facts[key]), before);
});

test("value(): tiers 1/2/10 -> 1, 3/4/5 -> 2, 6/7/8/9 -> 3; mastered pays 1 flat", () => {
  const state = emptyState();
  assert.equal(Facts.value(state, "1x2"), 1);
  assert.equal(Facts.value(state, "2x10"), 1);
  assert.equal(Facts.value(state, "3x4"), 2);
  assert.equal(Facts.value(state, "5x5"), 2);
  assert.equal(Facts.value(state, "6x7"), 3);
  assert.equal(Facts.value(state, "9x9"), 3);

  const key = "6x6"; // square: no mirror requirement, isolates the mastered-pays-1 rule
  for (let i = 0; i < 3; i++) {
    Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x6", t: i, withinLimit: true, interrupted: false, retry: false });
  }
  assert.equal(Facts.value(state, key), CONFIG.MASTERED_VALUE);
});

// --- Punch-list P6 (2026-08-26): tier rule switch, default unchanged ---
test("[P6] CONFIG.TIER_BY is 'min' (Marat 2026-08-26): 1x6 pays 1, 6x7 pays 3, 3x9 pays 2; 'max' still works", () => {
  const state = require("../core.js").Migrate.emptyState(0);
  assert.equal(CONFIG.TIER_BY, "min");
  assert.equal(Facts.value(state, "1x6"), 1);
  assert.equal(Facts.value(state, "6x7"), 3);
  assert.equal(Facts.value(state, "3x9"), 2);
  CONFIG.TIER_BY = "max";
  try { assert.equal(Facts.value(state, "1x6"), 3); } finally { CONFIG.TIER_BY = "min"; }
});
