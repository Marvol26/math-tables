const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG, Facts, Selector } = require("../core.js");

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function emptyState() {
  return { facts: {}, carryover: [] };
}

function keysOf(planned) {
  return planned.map((asked) => {
    const [a, b] = asked.split("x").map(Number);
    return Facts.key(a, b);
  });
}

// V2-DESIGN §8: a canonical key may now appear TWICE — a mirror pair, both
// directions of a brand-new (attempts === 0) non-square fact, planned back
// to back. It may never appear a third time, and a squared fact (only one
// direction exists) may never be duplicated.
test("plan(): a canonical key appears at most twice, only as an adjacent mirror pair of a non-square fact", () => {
  const state = emptyState();
  for (let seed = 0; seed < 20; seed++) {
    const planned = Selector.plan(state, seededRng(seed), 1000);
    assert.equal(planned.length, CONFIG.SESSION_SIZE_DEFAULT);
    const keys = keysOf(planned);
    const counts = {};
    keys.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
    Object.keys(counts).forEach((k) => {
      assert.ok(counts[k] <= 2, "canonical key " + k + " appeared " + counts[k] + " times in seed " + seed);
      if (counts[k] === 2) {
        const [a, b] = Facts.parts(k);
        assert.notEqual(a, b, "a square fact must never be duplicated: " + k);
        const dirA = a + "x" + b;
        const dirB = b + "x" + a;
        const idxA = planned.indexOf(dirA);
        const idxB = planned.indexOf(dirB);
        assert.notEqual(idxA, -1);
        assert.notEqual(idxB, -1);
        assert.equal(Math.abs(idxA - idxB), 1, "mirror pair must be adjacent for " + k + " in seed " + seed);
      }
    });
  }
});

test("carryover facts are placed first (included) and state.carryover is not mutated", () => {
  const state = emptyState();
  state.carryover = ["1x1", "2x2", "3x3"];
  const before = JSON.stringify(state.carryover);
  const planned = Selector.plan(state, seededRng(1), 1000);
  const keys = keysOf(planned);
  assert.ok(state.carryover.every((k) => keys.includes(k)));
  assert.equal(JSON.stringify(state.carryover), before);
});

test("carryover overflow beyond SESSION_SIZE: only the first 10 (FIFO order) enter the plan", () => {
  const state = emptyState();
  // 13 distinct canonical keys, in a known order.
  state.carryover = [
    "1x1", "1x2", "1x3", "1x4", "1x5", "1x6", "1x7", "1x8", "1x9", "1x10",
    "2x2", "2x3", "2x4",
  ];
  const expectedFirstTen = state.carryover.slice(0, 10);
  const planned = Selector.plan(state, seededRng(2), 1000);
  const keys = keysOf(planned);
  assert.equal(planned.length, 10);
  assert.deepEqual(new Set(keys), new Set(expectedFirstTen));
  // the overflow (positions 10-12) must not appear
  assert.ok(!keys.includes("2x2"));
  assert.ok(!keys.includes("2x3"));
  assert.ok(!keys.includes("2x4"));
});

// V2-DESIGN §8: table 1's own 10 facts no longer all fit in one 10-slot
// session — each non-square fact among them now costs 2 slots (a mirror
// pair), so only the lowest-sum ones fit before a filler from elsewhere
// takes the last seat. 1x1 (square, sum 2, 1 slot) + 1x2..1x5 (non-square,
// sums 3-6, 2 slots each) = 1 + 4*2 = 9 slots; 1x6 (sum 7) would need a 10th
// AND an 11th slot so it is skipped entirely, and the single remaining slot
// falls to the next-lowest-sum candidate overall: "2x2" (sum 4, square).
test("first-ever session (all facts unseen, no carryover): table 1's lowest-sum facts fill first, non-squares paired (V2-DESIGN §8)", () => {
  const state = emptyState();
  const planned = Selector.plan(state, seededRng(3), 1000);
  const keys = keysOf(planned);
  assert.equal(keys.length, 10);
  const counts = {};
  keys.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  assert.deepEqual(counts, { "1x1": 1, "1x2": 2, "1x3": 2, "1x4": 2, "1x5": 2, "2x2": 1 });
});

// With no current station (every station reached), unseen facts are picked
// in pure global sum-ascending order with new non-square facts paired.
test("with every station reached, the first session falls back to the smallest-sum facts, pairing new non-square facts (V2-DESIGN §8)", () => {
  const state = emptyState();
  state.map = { reached: {} };
  CONFIG.MAP_PATH.forEach((n) => { state.map.reached[n] = 1; });
  const planned = Selector.plan(state, seededRng(3), 1000);
  const keys = keysOf(planned);
  assert.equal(keys.length, 10);
  const counts = {};
  keys.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  assert.deepEqual(counts, { "1x1": 1, "1x2": 2, "1x3": 2, "2x2": 1, "1x4": 2, "2x3": 2 });
});

test("includes at least one mastered fact for review when mastered facts exist and slots are free", () => {
  const state = emptyState();
  const masteredKey = "6x7";
  for (let i = 0; i < 3; i++) {
    Facts.updateFromAttempt(state, masteredKey, { ok: true, ms: 4000, asked: "6x7", t: i, withinLimit: true, interrupted: false, retry: false });
  }
  // V2-DESIGN §8: mastery also needs the mirror direction fast-correct.
  Facts.updateFromAttempt(state, masteredKey, { ok: true, ms: 4000, asked: "7x6", t: 3, withinLimit: true, interrupted: false, retry: false });
  assert.equal(Facts.mastery(state.facts[masteredKey]), "mastered");
  const planned = Selector.plan(state, seededRng(4), 1000);
  const keys = keysOf(planned);
  assert.ok(keys.includes(masteredKey));
});

// --- V2-DESIGN §8: mirror pairs in Selector.plan ---

test("[§8] a 10-round with exactly 3 brand-new non-square facts forced into carryover would plan them singly (carryover is never paired) — this proves the exclusion directly", () => {
  const state = emptyState();
  state.carryover = ["1x2", "1x3", "1x4"]; // all-new, non-square, but via carryover
  const planned = Selector.plan(state, seededRng(6), 1000);
  const keys = keysOf(planned);
  const counts = {};
  keys.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  assert.equal(counts["1x2"], 1);
  assert.equal(counts["1x3"], 1);
  assert.equal(counts["1x4"], 1);
});

test("[§8] a 10-round with exactly 3 unseen non-square facts (rest of the pool exhausted) plans 3 pairs + 4 singles", () => {
  const state = emptyState();
  // Mark every fact attempted (not new) except 3 non-square facts, all of
  // one table so the current station's focus doesn't reorder them, and mark
  // enough as "mastered" so review slots don't crowd them out.
  Facts.allKeys().forEach((k) => {
    if (["1x2", "1x3", "1x4"].includes(k)) return;
    const [a, b] = Facts.parts(k);
    Facts.updateFromAttempt(state, k, { ok: true, ms: 3000, asked: k, t: 1, withinLimit: true, interrupted: false, retry: false });
    if (a !== b) Facts.updateFromAttempt(state, k, { ok: true, ms: 3000, asked: b + "x" + a, t: 2, withinLimit: true, interrupted: false, retry: false });
  });
  const planned = Selector.plan(state, seededRng(7), 1000);
  assert.equal(planned.length, 10);
  const keys = keysOf(planned);
  const counts = {};
  keys.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  assert.equal(counts["1x2"], 2);
  assert.equal(counts["1x3"], 2);
  assert.equal(counts["1x4"], 2);
  const otherKeys = Object.keys(counts).filter((k) => !["1x2", "1x3", "1x4"].includes(k));
  assert.equal(otherKeys.length, 4, "4 single (non-paired) facts fill the remaining slots");
  otherKeys.forEach((k) => assert.equal(counts[k], 1));
});

test("direction prefers the direction of the most recent miss", () => {
  const state = emptyState();
  const key = "2x7";
  // most recent attempt is a miss asked as "7x2"
  Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "2x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: false, ms: 4000, asked: "7x2", t: 2, withinLimit: true, interrupted: false, retry: false });
  state.carryover = [key];
  const planned = Selector.plan(state, seededRng(5), 1000);
  assert.ok(planned.includes("7x2"));
  assert.ok(!planned.includes("2x7"));
});

// --- V2-DESIGN §8: Selector.chooseDirection order 1 -> 2 -> 3 ---

test("[§8] chooseDirection: squares always return the single direction, no rng call needed", () => {
  assert.equal(Selector.chooseDirection(Facts.emptyFact(), "6x6", () => { throw new Error("must not call rng for a square"); }), "6x6");
});

test("[§8] chooseDirection order 1: the most recent miss wins even when a direction lacks a fast-correct entry", () => {
  const state = emptyState();
  const key = "6x7";
  Facts.updateFromAttempt(state, key, { ok: true, ms: 3000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: false, ms: 3000, asked: "6x7", t: 2, withinLimit: true, interrupted: false, retry: false });
  const dir = Selector.chooseDirection(state.facts[key], key, () => { throw new Error("must not fall through to rng"); });
  assert.equal(dir, "6x7");
});

// Closing-review HIGH-1 (2026-08-29): rule 1 used to scan the WHOLE recent
// window and return a miss's direction even after it had since been
// corrected — a direction lock that, combined with the mirror requirement,
// made a fact effectively un-masterable after a single miss (mid profile:
// 1 station in 120 sessions vs 10 at baseline). Fails against the pre-fix
// code (returns "6x7", the stale miss, instead of "7x6").
test("[§8 HIGH-1] chooseDirection order 1: a miss already followed by a correct answer in that SAME direction no longer locks it — falls through to rule 2 for the other direction", () => {
  const state = emptyState();
  const key = "6x7";
  Facts.updateFromAttempt(state, key, { ok: false, ms: 5000, asked: "6x7", t: 1, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 5000, asked: "6x7", t: 2, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 5000, asked: "6x7", t: 3, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 5000, asked: "6x7", t: 4, withinLimit: false, interrupted: false, retry: false });
  const dir = Selector.chooseDirection(state.facts[key], key, () => { throw new Error("must not fall through to rng — rule 2 must pick 7x6 (no quick entry yet)"); });
  assert.equal(dir, "7x6");
});

test("[§8] chooseDirection order 2: no miss, one direction lacks a fast-correct entry -> that direction is chosen", () => {
  const state = emptyState();
  const key = "6x7";
  Facts.updateFromAttempt(state, key, { ok: true, ms: 3000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  const dir = Selector.chooseDirection(state.facts[key], key, () => { throw new Error("must not fall through to rng"); });
  assert.equal(dir, "7x6");
});

test("[§8] chooseDirection order 3: both directions fast-correct or both missing it -> fewer correct answers wins", () => {
  const state = emptyState();
  const key = "6x7";
  // "6x7" answered correctly twice (slow, no fast-correct either way), "7x6" once.
  Facts.updateFromAttempt(state, key, { ok: true, ms: 9000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 9000, asked: "6x7", t: 2, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 9000, asked: "7x6", t: 3, withinLimit: true, interrupted: false, retry: false });
  const dir = Selector.chooseDirection(state.facts[key], key, () => { throw new Error("must not fall through to rng"); });
  assert.equal(dir, "7x6", "7x6 has fewer correct answers (1 vs 2)");
});

test("[§8] chooseDirection: a true tie (nothing to prefer) falls back to rng", () => {
  const dir = Selector.chooseDirection(Facts.emptyFact(), "6x7", () => 0.9);
  assert.equal(dir, "7x6");
});
