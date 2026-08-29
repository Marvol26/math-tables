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
      settings: { challengeOn: false, timeLimitSec: 10, wall: { enabled: true, durationSec: 10, options: 4 } },
      map: { reached: {} },
    },
    overrides || {}
  );
}

// Drives a wall session to completion; `wrongFirst` = number of first-tries
// to answer wrong (retried correctly). Every submit carries an `x` — the
// pure Wall reducer runs inside SessionCore.submit for mode:"wall".
function playWallSession(state, rng, startAt, wrongFirst) {
  SessionCore.start(state, rng, startAt, { mode: "wall" });
  let t = startAt;
  const wrongOnce = new Set();
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const current = SessionCore.paint(state, t);
    if (!current) break;
    t += 100;
    if (!current.retry && wrongOnce.size < (wrongFirst || 0) && !wrongOnce.has(current.asked)) {
      wrongOnce.add(current.asked);
      SessionCore.submit(state, -1, t, { x: 0 });
    } else {
      SessionCore.submit(state, Facts.answer(current.asked), t, { x: 0 });
    }
  }
  return SessionCore.finish(state, t + 1);
}

test("[4-2] wall: start() sets active.mode, a wall settingsSnapshot, and an empty active.wall journal", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(1), 1000, { mode: "wall" });
  assert.equal(state.active.mode, "wall");
  assert.equal(state.active.settingsSnapshot.challengeOn, true);
  assert.equal(state.active.settingsSnapshot.timeLimitSec, 10);
  assert.equal(state.active.settingsSnapshot.wall.durationSec, 10);
  assert.equal(state.active.settingsSnapshot.wall.options, 4);
  assert.ok(state.active.wall);
  assert.equal(state.active.wall.grid.length, CONFIG.WALL.ROWS);
  assert.equal(state.active.wall.grid[0].length, CONFIG.WALL.COLS);
  assert.equal(state.active.wall.wallsBuilt, 0);
});

test("[4-2] wall: typed/falling sessions never get an active.wall journal", () => {
  const typedState = freshState();
  SessionCore.start(typedState, seededRng(2), 1000, {});
  assert.equal(typedState.active.wall, undefined);
  const fallingState = freshState({ settings: { challengeOn: false, timeLimitSec: 10, falling: { enabled: true, durationSec: 8, options: 4 } } });
  SessionCore.start(fallingState, seededRng(3), 1000, { mode: "falling" });
  assert.equal(fallingState.active.wall, undefined);
});

test("[4-2] wall: submit runs the pure Wall reducer inside the same mutation — correct=1, wrong=2 (grey), retry=3 (tainted)", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(4), 1000, { mode: "wall" });
  const current = SessionCore.paint(state, 1000);
  const result = SessionCore.submit(state, -1, 1500, { x: 0 }); // wrong first try
  assert.equal(result.ok, false);
  assert.equal(result.wallReset, false);
  const parts = Facts.parts(current.asked);
  // The piece was placed at x=0 clamped, w=parts[0], h=parts[1]; the well
  // was empty so it lands at the floor.
  const y = CONFIG.WALL.ROWS - parts[1];
  assert.equal(state.active.wall.grid[y][0], 2, "wrong first attempt -> grey");

  // Drain the rest of the queue so the next paint() serves the retry queue.
  state.active.queue = [];
  // Now answer the retry correctly -> cell 3 (retry, tainted, never grey/1).
  const retryQ = SessionCore.paint(state, 2000);
  assert.equal(retryQ.retry, true);
  SessionCore.submit(state, Facts.answer(retryQ.asked), 2100, { x: 0 });
  // The retry piece is placed on top of the first (grey) placement.
  const parts2 = Facts.parts(retryQ.asked);
  const y2 = y - parts2[1];
  assert.equal(state.active.wall.grid[y2][0], 3, "retry -> tainted, regardless of its own outcome");
});

test("[4-2] wall: a correct first attempt places cell value 1", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(5), 1000, { mode: "wall" });
  const current = SessionCore.paint(state, 1000);
  SessionCore.submit(state, Facts.answer(current.asked), 1500, { x: 0 });
  const parts = Facts.parts(current.asked);
  const y = CONFIG.WALL.ROWS - parts[1];
  assert.equal(state.active.wall.grid[y][0], 1);
});

test("[4-2] wall: ×2 (withinLimit) exactly like falling — the same shownAt/timeLimitSec path", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(6), 1000, { mode: "wall" });
  const current = SessionCore.paint(state, 1000);
  const fast = SessionCore.submit(state, Facts.answer(current.asked), 1000 + 2000, { x: 0 }); // well within 10s
  assert.equal(fast.withinLimit, true);

  const state2 = freshState();
  SessionCore.start(state2, seededRng(7), 1000, { mode: "wall" });
  const current2 = SessionCore.paint(state2, 1000);
  const slow = SessionCore.submit(state2, Facts.answer(current2.asked), 1000 + 20000, { x: 0 }); // past the 10s deadline
  assert.equal(slow.withinLimit, false);
});

test("[4-2] wall: overflow builds a fresh wall — wallReset true on the submit that overflows, wallsBuilt increments and is tallied in the finished session record", () => {
  // Pre-fill the well completely so the very FIRST submit already overflows
  // (landingRow(-1) for any piece height >= 1), without needing a well
  // smaller than the largest possible piece (facts run up to 10x10).
  const state = freshState({ facts: {} });
  SessionCore.start(state, seededRng(8), 1000, { mode: "wall" });
  state.active.wall.grid = state.active.wall.grid.map((row) => row.map(() => 1));
  let t = 1000;
  let sawReset = false;
  let guard = 0;
  while ((state.active.queue.length > 0 || state.active.retryQueue.length > 0) && guard++ < 40) {
    const current = SessionCore.paint(state, t);
    if (!current) break;
    t += 100;
    const r = SessionCore.submit(state, Facts.answer(current.asked), t, { x: 0 });
    if (r.wallReset) sawReset = true;
  }
  const session = SessionCore.finish(state, t + 1);
  assert.ok(sawReset, "a 1x1 well overflows on the very next placement");
  assert.ok(session.wallsBuilt >= 1);
});

test("[4-2] wall: carryover stays untouched (carryover off, like falling)", () => {
  const state = freshState();
  const carryoverBefore = JSON.parse(JSON.stringify(state.carryover));
  playWallSession(state, seededRng(9), 1000, 0);
  assert.deepEqual(state.carryover, carryoverBefore);
});

test("[4-2] wall: retries earn 0 coins; a perfect wall session updates facts and mints coins", () => {
  const state = freshState();
  const session = playWallSession(state, seededRng(10), 1000, 2);
  const retryAttempts = session.attempts.filter((a) => a.retry);
  assert.ok(retryAttempts.length > 0);
  retryAttempts.forEach((a) => assert.equal(a.coins, 0));

  const cleanState = freshState();
  const cleanSession = playWallSession(cleanState, seededRng(11), 1000, 0);
  assert.equal(cleanSession.mode, "wall");
  assert.ok(cleanSession.coinsEarned > 0);
  assert.ok(Object.keys(cleanState.facts).length > 0, "wall counts for mastery, like falling/typed");
  const earnEntry = cleanState.economy.ledger.find((e) => e.id === "l_" + cleanSession.id + "_earn");
  assert.ok(earnEntry && earnEntry.amount > 0);
  // No new ledger ids for wallsBuilt (docs/WALL-DESIGN.md §1 — coins come
  // from the facts only, exactly as balloons).
  assert.equal(cleanState.economy.ledger.some((e) => /rows|walls/.test(e.id)), false);
});

test("[4-2] wall: a station whose 10th fact is mastered in a wall session IS reached (counts for the map like falling)", () => {
  const state = freshState();
  function masteredFact(key) {
    const [a, b] = Facts.parts(key);
    const recent = [
      { ok: true, ms: 100, asked: key, t: 100, withinLimit: false, interrupted: false },
      { ok: true, ms: 100, asked: key, t: 200, withinLimit: false, interrupted: false },
      { ok: true, ms: 100, asked: key, t: 300, withinLimit: false, interrupted: false },
    ];
    if (a !== b) recent.push({ ok: true, ms: 100, asked: b + "x" + a, t: 400, withinLimit: false, interrupted: false });
    return { attempts: recent.length, correct: recent.length, lastSeen: 500, recent };
  }
  for (let i = 1; i <= 10; i++) state.facts[Facts.key(1, i)] = masteredFact(Facts.key(1, i));
  assert.equal(MapCore.isReached(state, 1), false);
  const session = playWallSession(state, seededRng(12), 1000, 0);
  assert.deepEqual(session.stationsReached, [1]);
  assert.equal(MapCore.isReached(state, 1), true);
});
