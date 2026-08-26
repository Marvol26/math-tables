"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG, Facts, Map, Migrate, Selector, SessionCore } = require("../core.js");

function masterFact(state, key) {
  const fact = (state.facts[key] = state.facts[key] || Facts.emptyFact());
  fact.attempts += 3; fact.correct += 3; fact.lastSeen = 1;
  fact.recent = fact.recent.concat([1, 2, 3].map(() => ({ ok: true, ms: 2000, asked: key, t: 1, withinLimit: false, interrupted: false })));
}

test("tableKeys: 10 facts per table, shared facts count for both tables", () => {
  assert.equal(Map.tableKeys(3).length, 10);
  assert.ok(Map.tableKeys(3).includes("3x4") && Map.tableKeys(4).includes("3x4"));
  assert.ok(Map.tableKeys(7).includes("7x7"));
});

test("path order is the learning order and currentStation walks it", () => {
  assert.deepEqual(CONFIG.MAP_PATH, [1, 2, 10, 5, 3, 4, 6, 7, 8, 9]);
  const state = Migrate.emptyState();
  assert.equal(Map.currentStation(state), 1);
  state.map.reached[1] = 5;
  assert.equal(Map.currentStation(state), 2);
  CONFIG.MAP_PATH.forEach((n) => { state.map.reached[n] = 5; });
  assert.equal(Map.currentStation(state), null);
});

test("progress counts mastered facts of the table; newlyReached only at STATION_REQUIRED", () => {
  const state = Migrate.emptyState();
  Map.tableKeys(1).slice(0, 9).forEach((k) => masterFact(state, k));
  assert.equal(Map.progress(state, 1), 9);
  assert.deepEqual(Map.newlyReached(state), []);
  masterFact(state, Map.tableKeys(1)[9]);
  assert.deepEqual(Map.newlyReached(state), [1]);
});

test("reaching is permanent: a mastery drop keeps the station and the turtle position", () => {
  const state = Migrate.emptyState();
  Map.tableKeys(1).forEach((k) => masterFact(state, k));
  state.map.reached[1] = 10;
  state.facts["1x7"].recent.push({ ok: false, ms: 9000, asked: "1x7", t: 2, withinLimit: false, interrupted: false });
  assert.equal(Facts.mastery(state.facts["1x7"]), "learning");
  assert.equal(Map.progress(state, 1), 9);
  assert.equal(Map.isReached(state, 1), true);
  assert.equal(Map.currentStation(state), 2);
  assert.deepEqual(Map.newlyReached(state), []);
});

test("finish() records stationsReached and persists them in state.map (table pre-mastered; exercises finish → newlyReached → state.map)", () => {
  const state = Migrate.emptyState();
  Map.tableKeys(1).slice(0, 9).forEach((k) => masterFact(state, k));
  const rng = () => 0.5;
  SessionCore.start(state, rng, 1000);
  // answer the whole plan correctly and fast, three times for 1x10 is not needed: master it directly, then run a session
  masterFact(state, "1x10");
  let guard = 0;
  while (state.active && guard++ < 40) {
    SessionCore.paint(state, 2000 + guard * 100);
    SessionCore.submit(state, Facts.answer(state.active.current.asked), 2050 + guard * 100, {});
    if (!state.active.queue.length && !state.active.retryQueue.length) {
      const session = SessionCore.finish(state, 5000);
      assert.deepEqual(session.stationsReached, [1]);
    }
  }
  assert.equal(Map.isReached(state, 1), true);
  assert.equal(typeof state.map.reached[1], "number");
});

test("selector: current station's facts get the focus bonus, other tables do not", () => {
  const state = Migrate.emptyState();
  state.map.reached[1] = 1; // current station is now ×2
  assert.equal(Map.currentStation(state), 2);
  const focus = Selector.weaknessScore(state, "2x7", 0);
  const other = Selector.weaknessScore(state, "3x7", 0);
  assert.equal(focus - other, CONFIG.MAP_FOCUS_BONUS);
});

test("selector: carryover still comes first and there are no duplicates with the bonus in play", () => {
  const state = Migrate.emptyState();
  state.carryover = ["6x7", "8x9"];
  const plan = Selector.plan(state, () => 0.42, 0);
  const canon = plan.map((asked) => { const p = Facts.parts(asked); return Facts.key(p[0], p[1]); });
  assert.equal(new Set(canon).size, plan.length);
  assert.ok(canon.includes("6x7") && canon.includes("8x9"));
});

test("migrate defaults map; validateImport accepts a good map and rejects a bad one", () => {
  const old = Migrate.emptyState(); delete old.map;
  assert.deepEqual(Migrate.migrate(old).map, { reached: {} });
  const raw = Migrate.emptyState(); raw.map = { reached: { 1: 123, 10: 456 } };
  assert.equal(Migrate.validateImport(raw).ok, true);
  assert.deepEqual(Migrate.migrate(raw).map.reached, { 1: 123, 10: 456 });
  raw.map = { reached: { 11: 1 } };
  assert.equal(Migrate.validateImport(raw).ok, false);
  raw.map = { reached: { 3: "yes" } };
  assert.equal(Migrate.validateImport(raw).ok, false);
});

// --- review 2026-08-27 ---
test("[review] plan(): with a partly-seen state, unseen facts of the current station come before other unseen facts", () => {
  const state = Migrate.emptyState();
  state.map.reached[1] = 1; state.map.reached[2] = 1; // current station ×10
  // mark a scattering of other facts as seen so the sum-ascending intro would otherwise win
  ["3x3", "3x4", "4x4", "3x5", "4x5", "5x5"].forEach((k) => { const f = (state.facts[k] = Facts.emptyFact()); f.attempts = 1; f.correct = 1; f.lastSeen = 1; f.recent = [{ ok: true, ms: 3000, asked: k, t: 1, withinLimit: false, interrupted: false }]; });
  const plan = Selector.plan(state, () => 0.3, 1000);
  const canon = plan.map((asked) => { const p = Facts.parts(asked); return Facts.key(p[0], p[1]); });
  const focus = canon.filter((k) => { const p = Facts.parts(k); return p[0] === 10 || p[1] === 10; });
  assert.ok(focus.length >= 7, "expected most of the plan to be ×10 facts, got " + focus.length + " of " + canon.length);
});

test("[review] overview(): 10 rows in path order with exactly one current station", () => {
  const state = Migrate.emptyState();
  state.map.reached[1] = 5;
  const rows = Map.overview(state);
  assert.deepEqual(rows.map((r) => r.table), CONFIG.MAP_PATH);
  assert.equal(rows.filter((r) => r.current).length, 1);
  assert.equal(rows[1].current, true);
  assert.equal(rows[0].reached, true);
  assert.equal(rows[0].reachedAt, 5);
});

test("[review] validateImport accepts sessions without stationsReached (pre-0.6 backups)", () => {
  const raw = Migrate.emptyState();
  raw.sessions = [{ id: "s_old", startedAt: 1, endedAt: 2, planned: ["1x2"], firstTryCorrect: 1, totalMs: 10, misses: [], coinsEarned: 1, perfect: false, masteredAfter: 0, unlocksEarned: [] }];
  assert.equal(Migrate.validateImport(raw).ok, true);
});

test("[review] finish() can reach several stations at once (upgrade-day state) and records all of them", () => {
  const state = Migrate.emptyState();
  Map.tableKeys(1).forEach((k) => masterFact(state, k));
  Map.tableKeys(2).forEach((k) => masterFact(state, k));
  SessionCore.start(state, () => 0.5, 1000);
  let guard = 0, session = null;
  while (state.active && guard++ < 40) {
    SessionCore.paint(state, 2000 + guard * 100);
    SessionCore.submit(state, Facts.answer(state.active.current.asked), 2050 + guard * 100, {});
    if (!state.active.queue.length && !state.active.retryQueue.length) session = SessionCore.finish(state, 5000);
  }
  assert.deepEqual(session.stationsReached, [1, 2]);
  assert.equal(Map.currentStation(state), 10);
});
