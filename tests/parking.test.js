"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Facts, Migrate, SessionCore, CONFIG } = require("../core.js");
const rng = () => 0.5;
function fresh() { const s = Migrate.emptyState(); s.settings.falling = { enabled: true, durationSec: 8, options: 4 }; return s; }

test("refreshSettings: a challenge toggled on while a typed session is suspended applies on resume", () => {
  const state = Migrate.emptyState();
  SessionCore.start(state, rng, 1000);
  assert.equal(state.active.settingsSnapshot.challengeOn, false);
  state.settings.challengeOn = true; state.settings.timeLimitSec = 12;
  SessionCore.switchTo(state, "typed", rng, 2000); // resume
  assert.equal(state.active.settingsSnapshot.challengeOn, true);
  assert.equal(state.active.settingsSnapshot.timeLimitSec, 12);
});

test("switchTo(falling) parks a suspended typed session; finishing the falling round brings it back intact", () => {
  const state = fresh();
  SessionCore.start(state, rng, 1000);
  SessionCore.paint(state, 1100);
  SessionCore.submit(state, Facts.answer(state.active.current.asked), 1500, {});
  const typedId = state.active.id;
  SessionCore.switchTo(state, "falling", rng, 2000);
  assert.equal(state.active.mode, "falling");
  assert.equal(state.parkedSessions.length, 1);
  assert.equal(state.parkedSessions[0].id, typedId);
  assert.equal(state.parkedSessions[0].attempts.length, 1);
  let guard = 0;
  while (state.active && state.active.mode === "falling" && guard++ < 40) {
    SessionCore.paint(state, 3000 + guard * 100);
    SessionCore.submit(state, Facts.answer(state.active.current.asked), 3050 + guard * 100, {});
    if (!state.active.queue.length && !state.active.retryQueue.length) SessionCore.finish(state, 9000);
  }
  assert.equal(state.parkedSessions.length, 0);
  assert.equal(state.active.id, typedId, "the typed session is active again");
  assert.equal(state.active.attempts.length, 1);
});

test("switchTo swaps between an active and a parked session of the other mode; same mode just resumes", () => {
  const state = fresh();
  SessionCore.start(state, rng, 1000);
  const typedId = state.active.id;
  SessionCore.switchTo(state, "falling", rng, 2000);
  const fallingId = state.active.id;
  SessionCore.switchTo(state, "typed", rng, 3000);
  assert.equal(state.active.id, typedId);
  assert.equal(state.parkedSessions.length, 1);
  assert.equal(state.parkedSessions[0].id, fallingId);
  SessionCore.switchTo(state, "typed", rng, 4000);
  assert.equal(state.active.id, typedId);
  assert.equal(state.parkedSessions[0].id, fallingId);
  SessionCore.switchTo(state, "falling", rng, 5000);
  assert.equal(state.active.id, fallingId);
});

test("a parked session's in-flight question is deferred on swap; migrate/validateImport handle parked", () => {
  const state = fresh();
  SessionCore.start(state, rng, 1000);
  SessionCore.paint(state, 1100);
  const asked = state.active.current.asked;
  SessionCore.switchTo(state, "falling", rng, 2000);
  assert.equal(state.parkedSessions[0].current, null, "parking defers the in-flight question");
  assert.equal(state.parkedSessions[0].queue[state.parkedSessions[0].queue.length - 1], asked);
  SessionCore.switchTo(state, "typed", rng, 3000);
  assert.equal(state.active.current, null);
  const raw = JSON.parse(JSON.stringify(state));
  assert.equal(Migrate.validateImport(raw).ok, true);
  assert.equal(Migrate.migrate(raw).parkedSessions[0].mode, "falling");
  // Legacy schema-2 single-object shape still imports (backward compat).
  delete raw.parkedSessions;
  raw.parked = { id: "x" };
  assert.equal(Migrate.validateImport(raw).ok, false);
  raw.parked = { id: "y", mode: "falling", planned: [], queue: [], retryQueue: [], attempts: [], current: null };
  assert.equal(Migrate.validateImport(raw).ok, true);
  assert.equal(Migrate.migrate(raw).parkedSessions[0].id, "y");
  const old = Migrate.emptyState();
  assert.deepEqual(Migrate.migrate(old).parkedSessions, []);
});

test("[review] switchTo(falling) starts a NEW falling session only when the parent enabled the mode; a parked one stays resumable", () => {
  const state = Migrate.emptyState();
  state.settings.falling = { enabled: false, durationSec: 8, options: 4 };
  SessionCore.switchTo(state, "falling", rng, 1000);
  assert.equal(state.active.mode, "typed", "disabled → falls back to typed");
  state.settings.falling.enabled = true;
  SessionCore.switchTo(state, "falling", rng, 2000);
  assert.equal(state.active.mode, "falling");
  state.settings.falling.enabled = false;
  SessionCore.switchTo(state, "typed", rng, 3000); // park the falling one
  assert.equal(state.parkedSessions[0].mode, "falling");
  SessionCore.switchTo(state, "falling", rng, 4000); // resume parked even though disabled
  assert.equal(state.active.mode, "falling");
});

test("[review] validateImport rejects active+parked of the same mode and reports each problem once", () => {
  const raw = Migrate.emptyState();
  delete raw.parkedSessions;
  raw.active = { id: "a", mode: "typed", planned: [], queue: [], retryQueue: [], attempts: [], current: null };
  raw.parked = { id: "b", mode: "typed", planned: [], queue: [], retryQueue: [], attempts: [], current: null };
  const v = Migrate.validateImport(raw);
  assert.equal(v.ok, false);
  raw.parked.mode = "falling";
  assert.equal(Migrate.validateImport(raw).ok, true);
  raw.active.current = {};
  const problems = Migrate.validateImport(raw).problems.filter((p) => /active\.current\.asked/.test(p));
  assert.equal(problems.length, 1);
});

test("[4-2] validateImport rejects parkedSessions with duplicate/active-colliding modes, over-capacity arrays, and a malformed wall journal", () => {
  const base = () => Migrate.emptyState();
  const raw1 = base();
  raw1.active = { id: "a", mode: "typed", planned: [], queue: [], retryQueue: [], attempts: [], current: null };
  raw1.parkedSessions = [
    { id: "b", mode: "falling", planned: [], queue: [], retryQueue: [], attempts: [], current: null },
    { id: "c", mode: "typed", planned: [], queue: [], retryQueue: [], attempts: [], current: null }, // same as active
  ];
  assert.equal(Migrate.validateImport(raw1).ok, false);

  const raw2 = base();
  raw2.parkedSessions = [
    { id: "a", mode: "typed", planned: [], queue: [], retryQueue: [], attempts: [], current: null },
    { id: "b", mode: "falling", planned: [], queue: [], retryQueue: [], attempts: [], current: null },
    { id: "c", mode: "wall", planned: [], queue: [], retryQueue: [], attempts: [], current: null, wall: { grid: [], x: 0, wallsBuilt: 0 } },
  ];
  assert.equal(Migrate.validateImport(raw2).ok, false, "more than MAX_PARKED_SESSIONS entries");

  const raw3 = base();
  raw3.parked = { id: "x" };
  raw3.parkedSessions = [];
  assert.equal(Migrate.validateImport(raw3).ok, false, "parked and parkedSessions must not both be present");

  const raw4 = base();
  raw4.active = { id: "w", mode: "wall", planned: [], queue: [], retryQueue: [], attempts: [], current: null, wall: { grid: [[0]], x: 0, wallsBuilt: 0 } };
  assert.equal(Migrate.validateImport(raw4).ok, false, "wall.grid must have CONFIG.WALL.ROWS rows of CONFIG.WALL.COLS cells");
});

test("[review] disabled-falling tap with a parked typed session and no active one resumes the parked session (no duplicate)", () => {
  const state = fresh();
  SessionCore.start(state, rng, 1000);
  const typedId = state.active.id;
  state.parkedSessions = [state.active]; state.active = null; // the idempotent-finish shape
  state.settings.falling.enabled = false;
  SessionCore.switchTo(state, "falling", rng, 2000);
  assert.equal(state.active.id, typedId);
  assert.equal(state.parkedSessions.length, 0);
});

// --- review 2026-08-28: deferred questions never get a fresh clock ---
test("[review] length-1 boundary: the suspended-on question that comes straight back is interrupted (no ×2), typed queue and retry queue", () => {
  const state = fresh();
  state.settings.challengeOn = true; state.settings.timeLimitSec = 10;
  SessionCore.switchTo(state, "typed", rng, 1000);
  // answer 9 correctly
  for (let i = 0; i < 9; i++) { SessionCore.paint(state, 2000 + i * 100); SessionCore.submit(state, Facts.answer(state.active.current.asked), 2050 + i * 100, {}); }
  const last = SessionCore.paint(state, 5000);
  SessionCore.deferCurrent(state); // relaunch / exit on the last question
  const again = SessionCore.paint(state, 60000);
  assert.equal(again.asked, last.asked);
  assert.equal(again.interrupted, true, "same question back → no clock");
  const r = SessionCore.submit(state, Facts.answer(again.asked), 60500, {});
  assert.equal(r.withinLimit, false);
  // retry queue boundary
  const s2 = fresh(); s2.settings.challengeOn = true;
  SessionCore.start(s2, rng, 1000);
  SessionCore.paint(s2, 1000); SessionCore.submit(s2, -1, 1500, {}); // one miss → retryQueue
  for (let i = 0; i < 9; i++) { SessionCore.paint(s2, 2000 + i * 100); SessionCore.submit(s2, Facts.answer(s2.active.current.asked), 2050 + i * 100, {}); }
  const retry = SessionCore.paint(s2, 5000);
  assert.equal(retry.retry, true);
  SessionCore.deferCurrent(s2);
  const retryAgain = SessionCore.paint(s2, 9000);
  assert.equal(retryAgain.asked, retry.asked);
  assert.equal(retryAgain.interrupted, true);
});

test("[review] a deferred question re-asked later is interrupted (not mastery-eligible); the first question after resume is fresh", () => {
  const state = fresh();
  SessionCore.start(state, rng, 1000);
  const seen = SessionCore.paint(state, 1000).asked;
  SessionCore.deferCurrent(state);
  const first = SessionCore.paint(state, 5000);
  assert.notEqual(first.asked, seen);
  assert.equal(first.interrupted, false);
  let found = null, guard = 0;
  while (guard++ < 20) {
    SessionCore.submit(state, Facts.answer(state.active.current.asked), 5500 + guard * 100, {});
    const q = SessionCore.paint(state, 6000 + guard * 100);
    if (!q) break;
    if (q.asked === seen) { found = q; break; }
  }
  assert.ok(found, "the deferred question comes back");
  assert.equal(found.interrupted, true);
});

test("[review] park() defers directly and migrate defers a parked in-flight question from an old backup", () => {
  const state = fresh();
  SessionCore.start(state, rng, 1000);
  SessionCore.paint(state, 1000);
  const asked = state.active.current.asked;
  SessionCore.park(state);
  assert.equal(state.parkedSessions[0].current, null);
  assert.deepEqual(state.parkedSessions[0].deferred, [asked]);
  const raw = Migrate.emptyState();
  raw.parked = { id: "p", mode: "falling", planned: ["2x3"], queue: ["2x3"], retryQueue: [], attempts: [], current: { asked: "2x3", key: "2x3", shownAt: 5, retry: false, interrupted: false } };
  const m = Migrate.migrate(raw);
  assert.equal(m.parkedSessions[0].current, null);
  assert.deepEqual(m.parkedSessions[0].deferred, ["2x3"]);
});

// --- package 4 (docs/WALL-DESIGN.md): three-mode parking ---
test("[4-2] all six switch permutations across typed/falling/wall park and resume the right session, LIFO", () => {
  const state = Migrate.emptyState();
  state.settings.falling = { enabled: true, durationSec: 8, options: 4 };
  state.settings.wall = { enabled: true, durationSec: 10, options: 4 };

  SessionCore.switchTo(state, "typed", rng, 1000);
  const typedId = state.active.id;
  SessionCore.switchTo(state, "falling", rng, 2000); // parks typed
  const fallingId = state.active.id;
  assert.equal(state.parkedSessions.map((p) => p.mode).sort().join(","), "typed");
  SessionCore.switchTo(state, "wall", rng, 3000); // parks falling (2 parked now: typed, falling)
  const wallId = state.active.id;
  assert.equal(state.parkedSessions.length, 2);
  assert.deepEqual(state.parkedSessions.map((p) => p.mode), ["typed", "falling"]);

  // Resuming a NON-topmost parked mode (typed) still finds it out of LIFO order.
  SessionCore.switchTo(state, "typed", rng, 4000);
  assert.equal(state.active.id, typedId);
  assert.deepEqual(state.parkedSessions.map((p) => p.mode), ["falling", "wall"]);

  SessionCore.switchTo(state, "falling", rng, 5000);
  assert.equal(state.active.id, fallingId);
  assert.deepEqual(state.parkedSessions.map((p) => p.mode), ["wall", "typed"]);

  SessionCore.switchTo(state, "wall", rng, 6000);
  assert.equal(state.active.id, wallId);
  assert.deepEqual(state.parkedSessions.map((p) => p.mode), ["typed", "falling"]);

  // Same mode just resumes (no park/unpark churn).
  const before = state.parkedSessions.slice();
  SessionCore.switchTo(state, "wall", rng, 7000);
  assert.equal(state.active.id, wallId);
  assert.deepEqual(state.parkedSessions, before);
});

test("[4-2] a third mode cannot start while two are already parked (all three slots would be modes already in play, so switchTo always resumes)", () => {
  const state = Migrate.emptyState();
  state.settings.falling = { enabled: true, durationSec: 8, options: 4 };
  state.settings.wall = { enabled: true, durationSec: 10, options: 4 };
  SessionCore.switchTo(state, "typed", rng, 1000);
  SessionCore.switchTo(state, "falling", rng, 2000);
  SessionCore.switchTo(state, "wall", rng, 3000);
  assert.equal(state.parkedSessions.length, 2);
  // Every mode is already active-or-parked; switchTo to any of the three modes resumes, never throws.
  assert.doesNotThrow(() => SessionCore.switchTo(state, "typed", rng, 4000));
  assert.doesNotThrow(() => SessionCore.switchTo(state, "falling", rng, 5000));
  assert.doesNotThrow(() => SessionCore.switchTo(state, "wall", rng, 6000));
});

test("[4-2] both parkedSessions/legacy parked import shapes round-trip through migrate; a malformed wall journal is rejected on import", () => {
  const rawArray = Migrate.emptyState();
  rawArray.parkedSessions = [
    { id: "p1", mode: "typed", planned: [], queue: [], retryQueue: [], attempts: [], current: null },
    { id: "p2", mode: "falling", planned: [], queue: [], retryQueue: [], attempts: [], current: null },
  ];
  assert.equal(Migrate.validateImport(rawArray).ok, true);
  const migrated = Migrate.migrate(rawArray);
  assert.equal(migrated.parkedSessions.length, 2);
  assert.equal(migrated.parkedSessions[0].id, "p1");

  const rawLegacy = Migrate.emptyState();
  delete rawLegacy.parkedSessions;
  rawLegacy.parked = { id: "old", mode: "wall", planned: [], queue: [], retryQueue: [], attempts: [], current: null, wall: { grid: Array.from({ length: 14 }, () => new Array(10).fill(0)), x: 3, wallsBuilt: 2 } };
  assert.equal(Migrate.validateImport(rawLegacy).ok, true);
  assert.equal(Migrate.migrate(rawLegacy).parkedSessions[0].mode, "wall");

  const rawBadWall = Migrate.emptyState();
  rawBadWall.active = { id: "w", mode: "wall", planned: [], queue: [], retryQueue: [], attempts: [], current: null, wall: { grid: [[9, 0, 0, 0, 0, 0, 0, 0, 0, 0]].concat(Array.from({ length: 13 }, () => new Array(10).fill(0))), x: 0, wallsBuilt: 0 } };
  assert.equal(Migrate.validateImport(rawBadWall).ok, false, "cell value 9 is not in {0,1,2,3}");
});

// --- package 4 closing review (2026-08-29), finding F6: mutant-kill tests ---

test("[4-F M2] finish() unparks LIFO (most recently parked), not FIFO, with TWO parked", () => {
  const state = Migrate.emptyState();
  state.settings.falling = { enabled: true, durationSec: 8, options: 4 };
  state.settings.wall = { enabled: true, durationSec: 10, options: 4 };
  SessionCore.switchTo(state, "typed", rng, 1000);
  const typedId = state.active.id;
  SessionCore.switchTo(state, "falling", rng, 2000); // parks typed
  const fallingId = state.active.id;
  SessionCore.switchTo(state, "wall", rng, 3000); // parks falling; parkedSessions = [typed, falling]
  assert.deepEqual(state.parkedSessions.map((p) => p.id), [typedId, fallingId]);
  // Finish the active wall session with two parked underneath — LIFO must
  // bring back FALLING (the most recently parked), not typed (FIFO/shift).
  let guard = 0;
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const c = SessionCore.paint(state, 4000 + guard);
    SessionCore.submit(state, Facts.answer(c.asked), 4000 + guard + 50, { x: 0 });
    guard++;
    if (guard > 40) throw new Error("runaway");
  }
  SessionCore.finish(state, 5000 + guard);
  assert.equal(state.active.id, fallingId, "LIFO: the most recently parked (falling) returns, not the oldest (typed)");
  assert.equal(state.parkedSessions.length, 1);
  assert.equal(state.parkedSessions[0].id, typedId);
});

test("[4-F M3] park() throws PARKED_FULL once MAX_PARKED_SESSIONS (2) are already parked", () => {
  const state = Migrate.emptyState();
  state.active = { id: "active-wall", mode: "wall", startedAt: 1, planned: [], queue: [], retryQueue: [], attempts: [], current: null, deferred: [], carryoverTaken: [], wall: { grid: [], x: 0, wallsBuilt: 0 } };
  state.parkedSessions = [
    { id: "p-typed", mode: "typed", startedAt: 1, planned: [], queue: [], retryQueue: [], attempts: [], current: null, deferred: [] },
    { id: "p-falling", mode: "falling", startedAt: 1, planned: [], queue: [], retryQueue: [], attempts: [], current: null, deferred: [] },
  ];
  assert.throws(() => SessionCore.park(state), (e) => e.code === "PARKED_FULL");
  // Untouched on failure.
  assert.equal(state.parkedSessions.length, 2);
  assert.ok(state.active);
});

test("[4-F M5] validateImport rejects a wall journal grid cell value of 4 (only 0/1/2/3 are valid)", () => {
  const raw = Migrate.emptyState();
  const grid = Array.from({ length: 14 }, () => new Array(10).fill(0));
  grid[13][0] = 4; // invalid cell value
  raw.active = { id: "a", mode: "wall", planned: [], queue: [], retryQueue: [], attempts: [], current: null, wall: { grid: grid, x: 0, wallsBuilt: 0 } };
  const v = Migrate.validateImport(raw);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /cells must be 0\/1\/2\/3/.test(p)), v.problems.join("; "));
});

test("[4-F M7] park() throws PARKED_DUPLICATE_MODE when a session of the ACTIVE mode is already parked", () => {
  const state = Migrate.emptyState();
  state.active = { id: "active-wall-2", mode: "wall", startedAt: 1, planned: [], queue: [], retryQueue: [], attempts: [], current: null, deferred: [], carryoverTaken: [], wall: { grid: [], x: 0, wallsBuilt: 0 } };
  state.parkedSessions = [
    { id: "p-wall-dup", mode: "wall", startedAt: 1, planned: [], queue: [], retryQueue: [], attempts: [], current: null, deferred: [] },
  ];
  assert.throws(() => SessionCore.park(state), (e) => e.code === "PARKED_DUPLICATE_MODE");
  assert.equal(state.parkedSessions.length, 1);
  assert.ok(state.active);
});

test("[4-F M10] wall carryover stays frozen (OFF) across a session with a miss, unlike typed", () => {
  const state = Migrate.emptyState();
  state.settings.wall = { enabled: true, durationSec: 10, options: 4 };
  state.carryover = ["2x3"];
  const carryoverBefore = state.carryover.slice();
  SessionCore.start(state, rng, 1000, { mode: "wall" });
  // The carryover key is planned first (Selector.plan's carryover-FIFO
  // step) — answer it correctly, then miss the SECOND question, so the
  // miss key differs from the carryover key (otherwise "off" vs "on" would
  // coincidentally produce the same result and the test wouldn't discriminate).
  const firstParts = Facts.parts(state.active.planned[0]);
  assert.equal(Facts.key(firstParts[0], firstParts[1]), "2x3", "the carryover key is planned first (direction may vary)");
  let t = 1000;
  let idx = 0;
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const c = SessionCore.paint(state, t);
    t += 100;
    const wrong = idx === 1 && !c.retry; // miss the second FIRST-attempt question only
    SessionCore.submit(state, wrong ? -1 : Facts.answer(c.asked), t, { x: 0 });
    if (!c.retry) idx++;
  }
  SessionCore.finish(state, t + 1);
  assert.deepEqual(state.carryover, carryoverBefore, "wall mode must leave state.carryover byte-identical, even though a fact was missed");
});

test("[4-F M13] validateImport rejects a wall journal whose x is out of range for the CURRENT piece's width", () => {
  const raw = Migrate.emptyState();
  const grid = Array.from({ length: 14 }, () => new Array(10).fill(0));
  // asked "7x2" -> w=7; x=5 leaves only 3 free columns (10-7=3), so x must be <= 3.
  raw.active = {
    id: "a", mode: "wall", planned: ["7x2"], queue: ["7x2"], retryQueue: [], attempts: [],
    current: { asked: "7x2", key: "2x7", shownAt: 1 },
    wall: { grid: grid, x: 5, wallsBuilt: 0 },
  };
  const v = Migrate.validateImport(raw);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /wall\.x out of range for the current piece width/.test(p)), v.problems.join("; "));
});

test("[4-F M14] switchTo(wall) starts a NEW wall session only when the parent enabled the mode; a parked one stays resumable", () => {
  const state = Migrate.emptyState();
  state.settings.wall = { enabled: false, durationSec: 10, options: 4 };
  SessionCore.switchTo(state, "wall", rng, 1000);
  assert.equal(state.active.mode, "typed", "disabled -> falls back to typed");
  state.settings.wall.enabled = true;
  SessionCore.switchTo(state, "wall", rng, 2000);
  assert.equal(state.active.mode, "wall");
  state.settings.wall.enabled = false;
  SessionCore.switchTo(state, "typed", rng, 3000); // park the wall one
  assert.equal(state.parkedSessions[0].mode, "wall");
  SessionCore.switchTo(state, "wall", rng, 4000); // resume parked even though disabled
  assert.equal(state.active.mode, "wall");
});

test("[4-F M16] preflightEvidence inspects EVERY parked session, not just the first/active", () => {
  const state = Migrate.emptyState();
  state.settings.falling = { enabled: true, durationSec: 8, options: 4 };
  state.settings.wall = { enabled: true, durationSec: 10, options: 4 };
  SessionCore.switchTo(state, "typed", rng, 1000);
  SessionCore.paint(state, 1000);
  SessionCore.submit(state, 1, 1100, {});
  SessionCore.switchTo(state, "falling", rng, 2000); // parks typed (parkedSessions[0])
  SessionCore.paint(state, 2000);
  SessionCore.submit(state, 1, 2100, {});
  SessionCore.switchTo(state, "wall", rng, 3000); // parks falling (parkedSessions[1])
  assert.equal(state.parkedSessions.length, 2);
  assert.deepEqual(Migrate.preflightEvidence(state), { ok: true }, "clean two-parked state must pass");
  // Corrupt the SECOND parked session's (index 1, not the first) attempt.
  state.parkedSessions[1].attempts[0].t = "not a number";
  const pf = Migrate.preflightEvidence(state);
  assert.equal(pf.ok, false, "a corrupted attempt in the SECOND parked journal must be caught, not skipped");
});

test("[4-F M18] switchTo's swap defers the OUTGOING active session's in-flight question before parking it", () => {
  const state = Migrate.emptyState();
  state.settings.wall = { enabled: true, durationSec: 10, options: 4 };
  SessionCore.switchTo(state, "typed", rng, 1000);
  SessionCore.paint(state, 1000);
  const asked = state.active.current.asked;
  assert.ok(state.active.current, "typed has an in-flight question");
  SessionCore.switchTo(state, "wall", rng, 2000); // parks typed (with its current still set)
  SessionCore.switchTo(state, "typed", rng, 3000); // swap back: pulls typed out of parkedSessions, parks wall
  // Re-park wall then swap to typed again to exercise the SWAP branch (not
  // the "start new" branch) with wall as the outgoing session this time.
  SessionCore.paint(state, 3000);
  SessionCore.switchTo(state, "wall", rng, 4000); // swap: typed (with a NEW current) becomes outgoing/parked
  const parkedTyped = state.parkedSessions.find((p) => p.mode === "typed");
  assert.ok(parkedTyped, "typed must be parked");
  assert.equal(parkedTyped.current, null, "the outgoing session's in-flight question must be deferred, not carried into parkedSessions with current still set");
  assert.ok(parkedTyped.deferred.length > 0, "the deferred question must be recorded so it comes back later");
});

test("[4-F M20] a wall session's settingsSnapshot uses settings.wall.durationSec/options, not always the CONFIG default", () => {
  const state = Migrate.emptyState();
  state.settings.wall = { enabled: true, durationSec: 5, options: 6 };
  SessionCore.start(state, rng, 1000, { mode: "wall" });
  assert.notEqual(state.active.settingsSnapshot.wall.durationSec, CONFIG.WALL.DEFAULT_DURATION_SEC, "the test fixture's durationSec (5) must differ from CONFIG's default (10) to be discriminating");
  assert.equal(state.active.settingsSnapshot.wall.durationSec, 5);
  assert.equal(state.active.settingsSnapshot.timeLimitSec, 5);
  assert.equal(state.active.settingsSnapshot.wall.options, 6);
});
