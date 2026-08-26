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

test("plan() never contains duplicate canonical keys", () => {
  const state = emptyState();
  for (let seed = 0; seed < 20; seed++) {
    const planned = Selector.plan(state, seededRng(seed), 1000);
    const keys = keysOf(planned);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(planned.length, CONFIG.SESSION_SIZE);
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

test("first-ever session (all facts unseen, no carryover) = the current station's (×1) 10 facts", () => {
  const state = emptyState();
  const planned = Selector.plan(state, seededRng(3), 1000);
  const keys = keysOf(planned);
  assert.equal(keys.length, 10);
  const table1 = Facts.allKeys().filter((k) => Facts.parts(k)[0] === 1);
  assert.deepEqual(new Set(keys), new Set(table1));
});

test("with every station reached, the first session falls back to the 10 smallest-sum facts", () => {
  const state = emptyState();
  state.map = { reached: {} };
  CONFIG.MAP_PATH.forEach((n) => { state.map.reached[n] = 1; });
  const planned = Selector.plan(state, seededRng(3), 1000);
  const keys = keysOf(planned);
  assert.equal(keys.length, 10);
  // every key with sum(a,b) <= 6 (9 such keys) must be present
  const sumLE6 = Facts.allKeys().filter((k) => {
    const [a, b] = Facts.parts(k);
    return a + b <= 6;
  });
  assert.equal(sumLE6.length, 9);
  assert.ok(sumLE6.every((k) => keys.includes(k)));
  // the 10th key must have sum 7 (the next distinct sum)
  const tenth = keys.find((k) => !sumLE6.includes(k));
  const [a, b] = Facts.parts(tenth);
  assert.equal(a + b, 7);
});

test("includes at least one mastered fact for review when mastered facts exist and slots are free", () => {
  const state = emptyState();
  const masteredKey = "6x7";
  for (let i = 0; i < 3; i++) {
    Facts.updateFromAttempt(state, masteredKey, { ok: true, ms: 4000, asked: "6x7", t: i, withinLimit: true, interrupted: false, retry: false });
  }
  assert.equal(Facts.mastery(state.facts[masteredKey]), "mastered");
  const planned = Selector.plan(state, seededRng(4), 1000);
  const keys = keysOf(planned);
  assert.ok(keys.includes(masteredKey));
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
