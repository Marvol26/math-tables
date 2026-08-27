const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG, Facts, SessionCore, Map: MapCore } = require("../core.js");

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function freshState(overrides) {
  return Object.assign(
    {
      facts: {},
      economy: { ledger: [], unlocked: [], rewards: [], requests: [] },
      sessions: [],
      carryover: [],
      settings: { challengeOn: false, timeLimitSec: 10, falling: { enabled: true, durationSec: 8, options: 4 } },
      map: { reached: {} },
    },
    overrides || {}
  );
}

// Drives a session to completion; `wrongFirst` = number of first-tries to answer wrong (retried correctly).
function playSession(state, rng, startAt, opts, wrongFirst) {
  SessionCore.start(state, rng, startAt, opts);
  let t = startAt;
  const wrongOnce = new Set();
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const current = SessionCore.paint(state, t);
    if (!current) break;
    t += 100;
    if (!current.retry && wrongOnce.size < (wrongFirst || 0) && !wrongOnce.has(current.asked)) {
      wrongOnce.add(current.asked);
      SessionCore.submit(state, -1, t, {});
    } else {
      SessionCore.submit(state, Facts.answer(current.asked), t, {});
    }
  }
  return SessionCore.finish(state, t + 1);
}

test("falling: start() sets active.mode and a falling settingsSnapshot", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(1), 1000, { mode: "falling" });
  assert.equal(state.active.mode, "falling");
  assert.equal(state.active.settingsSnapshot.challengeOn, true);
  assert.equal(state.active.settingsSnapshot.timeLimitSec, 8);
  assert.equal(state.active.settingsSnapshot.falling.durationSec, 8);
  assert.equal(state.active.settingsSnapshot.falling.options, 4);
});

test("falling: a perfect session leaves facts, carryover, map.reached untouched but pays coins", () => {
  const state = freshState();
  const factsBefore = JSON.parse(JSON.stringify(state.facts));
  const carryoverBefore = JSON.parse(JSON.stringify(state.carryover));
  const mapBefore = JSON.parse(JSON.stringify(state.map));

  const session = playSession(state, seededRng(2), 1000, { mode: "falling" }, 0);

  assert.deepEqual(state.facts, factsBefore);
  assert.deepEqual(state.carryover, carryoverBefore);
  assert.deepEqual(state.map, mapBefore);
  assert.equal(session.mode, "falling");
  assert.equal(session.stationsReached.length, 0);
  assert.ok(session.coinsEarned > 0);
  const earnEntry = state.economy.ledger.find((e) => e.id === "l_" + session.id + "_earn");
  assert.ok(earnEntry);
  assert.ok(earnEntry.amount > 0);
});

test("falling: retries inside a falling session still earn 0 coins", () => {
  const state = freshState();
  const session = playSession(state, seededRng(3), 1000, { mode: "falling" }, 3);
  const retryAttempts = session.attempts.filter((a) => a.retry);
  assert.ok(retryAttempts.length > 0);
  retryAttempts.forEach((a) => assert.equal(a.coins, 0));
  // misses still show up in the session record (informational) but never in carryover
  assert.equal(state.carryover.length, 0);
});

test("falling: every attempt is tagged mode:'falling', typed sessions default to mode:'typed'", () => {
  const fallingState = freshState();
  const fallingSession = playSession(fallingState, seededRng(4), 1000, { mode: "falling" }, 0);
  fallingSession.attempts.forEach((a) => assert.equal(a.mode, "falling"));

  const typedState = freshState();
  const typedSession = playSession(typedState, seededRng(5), 1000, undefined, 0);
  assert.equal(typedState.active, null);
  assert.equal(typedSession.mode, "typed");
  typedSession.attempts.forEach((a) => assert.equal(a.mode, "typed"));
  assert.ok(Object.keys(typedState.facts).length > 0); // typed mode does update facts
});

// A masteredFact helper builder so both the mastered-facts fixture and the
// positive control below share one definition.
function masteredFact(key) {
  return {
    attempts: 3,
    correct: 3,
    lastSeen: 500,
    recent: [
      { ok: true, ms: 100, asked: key, t: 100, withinLimit: false, interrupted: false },
      { ok: true, ms: 100, asked: key, t: 200, withinLimit: false, interrupted: false },
      { ok: true, ms: 100, asked: key, t: 300, withinLimit: false, interrupted: false },
    ],
  };
}

// WP-F8 gate review (fresh Fable 5, MEDIUM): the original version of this test
// pre-seeded only 9/10 mastered facts, so Map.newlyReached() could never
// return a station regardless of whether the finish() map guard exists —
// falling sessions never advance facts, so progress stays at 9 either way. A
// mutation test (deleting the `if (!isFalling)` map guard in SessionCore.finish)
// still passed the old test. Fixed: seed exactly 10/10 mastered facts (the
// station WOULD be reached this instant if the guard were removed) and add a
// same-state positive control proving a typed session on the identical
// fixture DOES mark it reached — so the fixture is proven capable of
// triggering the map, making the falling-mode assertion meaningful.
test("falling: a station that would be reached this session is NOT reached in falling mode (map guard)", () => {
  const state = freshState();
  for (let i = 1; i <= 10; i++) {
    state.facts[Facts.key(1, i)] = masteredFact(Facts.key(1, i));
  }
  assert.equal(MapCore.progress(state, 1), 10);
  assert.equal(MapCore.isReached(state, 1), false);

  const session = playSession(state, seededRng(6), 1000, { mode: "falling" }, 0);
  assert.equal(session.stationsReached.length, 0);
  assert.equal(MapCore.isReached(state, 1), false);
});

test("falling: positive control — the same 10/10-mastered fixture IS reached by a typed session", () => {
  const state = freshState();
  for (let i = 1; i <= 10; i++) {
    state.facts[Facts.key(1, i)] = masteredFact(Facts.key(1, i));
  }
  assert.equal(MapCore.isReached(state, 1), false);

  const session = playSession(state, seededRng(6), 1000, undefined, 0);
  assert.deepEqual(session.stationsReached, [1]);
  assert.equal(MapCore.isReached(state, 1), true);
});
