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

test("a perfect falling session updates facts and pays coins; carryover stays untouched", () => {
  const state = freshState();
  const factsBefore = JSON.parse(JSON.stringify(state.facts));
  const carryoverBefore = JSON.parse(JSON.stringify(state.carryover));

  const session = playSession(state, seededRng(2), 1000, { mode: "falling" }, 0);

  // Balloon sessions now count for mastery, exactly like typed answers
  // (Marat 2026-08-28): attempts incremented once per planned OCCURRENCE of
  // the fact — a V2-DESIGN §8 mirror pair plans the same canonical key
  // twice, so that fact's attempts count is 2, not 1.
  assert.notDeepEqual(state.facts, factsBefore);
  const occurrences = {};
  session.planned.forEach((asked) => {
    const key = Facts.key.apply(null, Facts.parts(asked)); // "asked" may be non-canonical direction (e.g. "6x1")
    occurrences[key] = (occurrences[key] || 0) + 1;
  });
  Object.keys(occurrences).forEach((key) => {
    assert.ok(state.facts[key], "fact " + key + " must have been touched");
    assert.equal(state.facts[key].attempts, occurrences[key]);
  });
  // Carryover stays typed-only — falling never touches it (D1).
  assert.deepEqual(state.carryover, carryoverBefore);
  assert.equal(session.mode, "falling");
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
  const [a, b] = Facts.parts(key);
  const recent = [
    { ok: true, ms: 100, asked: key, t: 100, withinLimit: false, interrupted: false },
    { ok: true, ms: 100, asked: key, t: 200, withinLimit: false, interrupted: false },
    { ok: true, ms: 100, asked: key, t: 300, withinLimit: false, interrupted: false },
  ];
  // V2-DESIGN §8: non-square facts also need the mirror direction fast-correct.
  if (a !== b) recent.push({ ok: true, ms: 100, asked: b + "x" + a, t: 400, withinLimit: false, interrupted: false });
  return { attempts: recent.length, correct: recent.length, lastSeen: 500, recent };
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
// Balloon sessions now count for the map too (Marat 2026-08-28): the guard
// that used to skip Map.newlyReached() for falling mode is gone.
test("a station whose 10th fact is mastered in a falling session IS reached", () => {
  const state = freshState();
  for (let i = 1; i <= 10; i++) {
    state.facts[Facts.key(1, i)] = masteredFact(Facts.key(1, i));
  }
  assert.equal(MapCore.progress(state, 1), 10);
  assert.equal(MapCore.isReached(state, 1), false);

  const session = playSession(state, seededRng(6), 1000, { mode: "falling" }, 0);
  assert.deepEqual(session.stationsReached, [1]);
  assert.equal(MapCore.isReached(state, 1), true);
  assert.ok(state.map.reached[1]);
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

// Balloon taps now feed mastery under the exact same rule as typed answers
// (Marat 2026-08-28): last 3 correct, non-interrupted, median ms <= threshold.
// Mastery uses the MEDIAN of the last 3 correct attempts (core.js Facts.mastery):
// with two equal seeded values the median is pinned to that value regardless
// of the 3rd attempt's ms, so the two seeds must straddle the threshold (one
// far below, one far above) for the balloon tap's own ms to become the
// median and decide mastered vs. learning on its own.
test("a balloon tap masters a fact under the normal rule", () => {
  const key = "6x6"; // square: no V2-DESIGN §8 mirror requirement, isolates the ms-threshold rule
  function seedStraddling(state) {
    Facts.updateFromAttempt(state, key, { ok: true, ms: 0, asked: key, t: 0, withinLimit: true, interrupted: false, retry: false });
    Facts.updateFromAttempt(state, key, { ok: true, ms: 999999, asked: key, t: 1, withinLimit: true, interrupted: false, retry: false });
  }
  function playSingleFallingQuestion(state, seed, ms) {
    SessionCore.start(state, seededRng(seed), 1000, { mode: "falling" });
    // Force this single-question session onto our target key, bypassing the
    // normal Selector-chosen plan, so the fact under test is the one asked.
    state.active.planned = [key];
    state.active.queue = [key];
    const current = SessionCore.paint(state, 2000);
    SessionCore.submit(state, Facts.answer(current.asked), 2000 + ms, {});
    return SessionCore.finish(state, 2000 + ms + 1);
  }

  const fastState = freshState();
  seedStraddling(fastState);
  playSingleFallingQuestion(fastState, 30, CONFIG.MASTERY_MS_THRESHOLD);
  assert.equal(Facts.mastery(fastState.facts[key]), "mastered");

  const slowState = freshState();
  seedStraddling(slowState);
  playSingleFallingQuestion(slowState, 31, CONFIG.MASTERY_MS_THRESHOLD + 1000);
  assert.equal(Facts.mastery(slowState.facts[key]), "learning");
});
