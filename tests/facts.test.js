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

test("mastery requires 3 correct first attempts with median <= 6000ms and none interrupted", () => {
  const state = emptyState();
  const key = "6x7";
  const good = { ok: true, ms: 4000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false };
  Facts.updateFromAttempt(state, key, good);
  assert.equal(Facts.mastery(state.facts[key]), "learning");
  Facts.updateFromAttempt(state, key, { ...good, t: 2 });
  assert.equal(Facts.mastery(state.facts[key]), "learning");
  Facts.updateFromAttempt(state, key, { ...good, t: 3 });
  assert.equal(Facts.mastery(state.facts[key]), "mastered");
});

test("mastery is not reached if the median of the last 3 exceeds the threshold", () => {
  const state = emptyState();
  const key = "6x7";
  Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 7000, asked: "6x7", t: 2, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 8000, asked: "6x7", t: 3, withinLimit: false, interrupted: false, retry: false });
  assert.equal(Facts.mastery(state.facts[key]), "learning");
});

test("an interrupted attempt in the last 3 blocks mastery", () => {
  const state = emptyState();
  const key = "6x7";
  Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x7", t: 1, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x7", t: 2, withinLimit: true, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x7", t: 3, withinLimit: true, interrupted: true, retry: false });
  assert.equal(Facts.mastery(state.facts[key]), "learning");
});

test("a miss demotes: three correct then a miss is no longer mastered", () => {
  const state = emptyState();
  const key = "6x7";
  for (let i = 0; i < 3; i++) {
    Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x7", t: i, withinLimit: true, interrupted: false, retry: false });
  }
  assert.equal(Facts.mastery(state.facts[key]), "mastered");
  Facts.updateFromAttempt(state, key, { ok: false, ms: 4000, asked: "6x7", t: 4, withinLimit: true, interrupted: false, retry: false });
  assert.equal(Facts.mastery(state.facts[key]), "learning");
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

  const key = "6x7";
  for (let i = 0; i < 3; i++) {
    Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: "6x7", t: i, withinLimit: true, interrupted: false, retry: false });
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
