// V2-DESIGN §2 B2a — one-time evidence rebuild. The fixtures are built by
// DRIVING REAL PLAY through SessionCore (not hand-crafted raw objects) so
// they automatically satisfy every evidence invariant the same way a real
// device's history would; the tests then corrupt only the DERIVED fields
// (facts/masteredAfter/map.reached) the way pre-0.10.0 history was actually
// broken, and check the rebuild recovers exactly what live play produced.
const test = require("node:test");
const assert = require("node:assert/strict");
const { IDBFactory } = require("fake-indexeddb");
const MathCore = require("../core.js");
const { CONFIG, Facts, Map: MapCore, Migrate, SessionCore, Storage } = MathCore;

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function freshState() {
  const s = Migrate.emptyState();
  s.settings.falling.enabled = true;
  return s;
}

// Drives one session to completion; `wrongFirst` = how many distinct first
// tries to answer wrong (they get retried correctly right after).
function playSession(state, rng, startAt, opts, wrongFirst) {
  SessionCore.start(state, rng, startAt, opts);
  let t = startAt;
  const wrongOnce = new Set();
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const current = SessionCore.paint(state, t);
    if (!current) break;
    t += 137;
    if (!current.retry && wrongOnce.size < (wrongFirst || 0) && !wrongOnce.has(current.asked)) {
      wrongOnce.add(current.asked);
      SessionCore.submit(state, -1, t, {});
    } else {
      SessionCore.submit(state, Facts.answer(current.asked), t, {});
    }
  }
  return { session: SessionCore.finish(state, t + 1), endT: t + 1 };
}

// 29 completed sessions (typed + falling mixed, some with misses), then an
// active typed session (5 attempts, unfinished) with a parked falling
// session (4 attempts, unfinished) underneath it — the exact shape design
// §2 B2a's test list calls for.
function buildFixture() {
  const state = freshState();
  const rng = seededRng(7);
  let t = 10000;
  for (let i = 0; i < 29; i++) {
    const mode = i % 3 === 0 ? "falling" : "typed";
    const wrongFirst = i % 4 === 0 ? 2 : 0;
    const result = playSession(state, rng, t, { mode }, wrongFirst);
    t = result.endT + 500;
  }

  // Active falling session, 4 attempts, left unfinished.
  SessionCore.start(state, rng, t, { mode: "falling" });
  for (let i = 0; i < 4; i++) {
    const current = SessionCore.paint(state, t);
    t += 100;
    SessionCore.submit(state, Facts.answer(current.asked), t, {});
  }
  // Switch to typed: parks the falling session (4 attempts) and starts a
  // fresh typed one.
  t += 100;
  SessionCore.switchTo(state, "typed", rng, t);
  for (let i = 0; i < 5; i++) {
    const current = SessionCore.paint(state, t);
    t += 100;
    SessionCore.submit(state, Facts.answer(current.asked), t, {});
  }

  assert.equal(state.active.mode, "typed");
  assert.equal(state.active.attempts.length, 5);
  assert.equal(state.parkedSessions.length, 1);
  assert.equal(state.parkedSessions[0].mode, "falling");
  assert.equal(state.parkedSessions[0].attempts.length, 4);
  assert.equal(state.sessions.length, 29);
  return state;
}

function corruptDerivedFields(state) {
  // Simulate pre-0.10.0 drift: falling never touched facts, and the old 6s
  // threshold made mastery unreachable — facts/masteredAfter/map.reached all
  // out of sync with the true attempt history, exactly what B2a rebuilds.
  state.facts = {};
  state.sessions.forEach((s) => { s.masteredAfter = 0; });
  state.map.reached = {};
}

test("preflightEvidence: a real 29-session + active/parked fixture is clean", () => {
  const state = buildFixture();
  assert.deepEqual(Migrate.preflightEvidence(state), { ok: true });
});

test("evidenceRebuildPending: true on a fresh state, false after a successful rebuild", () => {
  const state = buildFixture();
  assert.equal(Migrate.evidenceRebuildPending(state), true);
  Migrate.rebuildEvidence(state, 999999);
  assert.equal(Migrate.evidenceRebuildPending(state), false);
});

test("rebuildEvidence rebuilds facts identical to live play (corrupted-then-recovered)", () => {
  const state = buildFixture();
  const truth = JSON.parse(JSON.stringify(state)); // what live play actually produced
  corruptDerivedFields(state);

  const result = Migrate.rebuildEvidence(state, 999999);
  assert.equal(result.ok, true);
  assert.deepEqual(state.facts, truth.facts);
  assert.equal(state.meta.evidenceRebuild.done, true);
  assert.equal(state.meta.evidenceRebuild.reason, "rebuilt");
});

test("rebuildEvidence rewrites each session's masteredAfter to the correct per-session value", () => {
  const state = buildFixture();
  const truth = JSON.parse(JSON.stringify(state));
  corruptDerivedFields(state);

  Migrate.rebuildEvidence(state, 999999);
  state.sessions.forEach((s, i) => {
    assert.equal(s.masteredAfter, truth.sessions[i].masteredAfter, "session " + i + " masteredAfter");
  });
});

test("rebuildEvidence lands stations on the same sessions live play reached them on", () => {
  const state = buildFixture();
  const truth = JSON.parse(JSON.stringify(state));
  corruptDerivedFields(state);

  Migrate.rebuildEvidence(state, 999999);
  assert.deepEqual(state.map.reached, truth.map.reached);
  state.sessions.forEach((s, i) => {
    assert.deepEqual((s.stationsReached || []).slice().sort(), (truth.sessions[i].stationsReached || []).slice().sort(), "session " + i + " stationsReached");
  });
});

test("rebuildEvidence: active/parked attempts feed live facts but never assign a station", () => {
  const state = buildFixture();
  const stationsBefore = Object.keys(state.map.reached).length;
  corruptDerivedFields(state);
  Migrate.rebuildEvidence(state, 999999);
  // No new station beyond what the 29 COMPLETED sessions already reached —
  // the active/parked attempts must not have moved map.reached on their own.
  assert.equal(Object.keys(state.map.reached).length, stationsBefore);
});

test("a second rebuild (second boot) is a no-op: deterministic replay, same result", () => {
  const state = buildFixture();
  corruptDerivedFields(state);
  Migrate.rebuildEvidence(state, 111);
  const once = JSON.parse(JSON.stringify(state));
  Migrate.rebuildEvidence(state, 222); // idempotent if called again with different `now`
  once.meta.evidenceRebuild.at = state.meta.evidenceRebuild.at; // `now` legitimately differs
  assert.deepEqual(state, once);
});

test("malformed attempt (bad ok type) -> preflight fails, state untouched, guard done:false", () => {
  const state = buildFixture();
  const before = JSON.parse(JSON.stringify(state));
  state.active.attempts[0].ok = "yes"; // must be boolean

  const check = Migrate.preflightEvidence(state);
  assert.equal(check.ok, false);
  assert.equal(check.reason, "malformed");

  const result = Migrate.rebuildEvidence(state, 500);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "malformed");
  assert.equal(state.meta.evidenceRebuild.done, false);
  assert.equal(state.meta.evidenceRebuild.reason, "malformed");
  // Nothing else changed — facts/sessions/map are byte-identical to before.
  assert.deepEqual(state.facts, before.facts);
  assert.deepEqual(state.sessions, before.sessions);
  assert.deepEqual(state.map, before.map);
});

test("a session trimmed by retention (no attempts array) -> untouched + done:true, reason:trimmed", () => {
  const state = buildFixture();
  const before = JSON.parse(JSON.stringify(state));
  delete state.sessions[0].attempts; // simulates ATTEMPTS_RETENTION_SESSIONS trimming

  const check = Migrate.preflightEvidence(state);
  assert.equal(check.ok, false);
  assert.equal(check.reason, "trimmed");

  const result = Migrate.rebuildEvidence(state, 500);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "trimmed");
  assert.equal(state.meta.evidenceRebuild.done, true); // trimmed is a PERMANENT terminal state
  assert.equal(state.meta.evidenceRebuild.reason, "trimmed");
  assert.equal(Migrate.evidenceRebuildPending(state), false); // never retried again
  assert.deepEqual(state.facts, before.facts);
  assert.deepEqual(state.map, before.map);
});

test("a duplicate first attempt breaks the planned multiset -> preflight fails (malformed)", () => {
  const state = buildFixture();
  const session = state.sessions[state.sessions.length - 1];
  const nonRetry = session.attempts.filter((a) => !a.retry);
  // Duplicate the first non-retry attempt's `asked` onto a second one (so
  // the multiset of non-retry attempts no longer equals `planned` exactly).
  nonRetry[1].asked = nonRetry[0].asked;
  nonRetry[1].key = nonRetry[0].key;

  const check = Migrate.preflightEvidence(state);
  assert.equal(check.ok, false);
  assert.equal(check.reason, "malformed");
});

test("[storage] a failed CAS during the evidence rebuild leaves state byte-identical; guard stays pending", async () => {
  const idb = new IDBFactory();
  const localStorage = (() => {
    const data = {};
    return {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: (k) => { delete data[k]; },
    };
  })();

  const a = Storage.create({ indexedDB: idb, localStorage, dbName: "evrebuild" });
  await a.load();
  a.state = buildFixture();
  await a.save(() => {}, 50); // rev 0 -> 1, seeds the record

  const b = Storage.create({ indexedDB: idb, localStorage, dbName: "evrebuild" });
  await b.load(); // loads rev 1, same state as `a`

  // Window A advances the rev behind B's back, so B's CAS will go stale.
  await a.save((s) => { s.settings.childName = "changed elsewhere"; }, 100);

  const before = JSON.parse(JSON.stringify(b.state));
  const result = await b.save((s) => { Migrate.rebuildEvidence(s, 500); }, 500);

  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.deepEqual(b.state, before, "a failed save must leave in-memory state (facts/sessions/map/meta) byte-identical");
  assert.equal(Migrate.evidenceRebuildPending(b.state), true, "the guard stays pending — the next boot retries");
});

// ============================================================================
// Closing-review 0-R (fresh Fable 5, SHIP-AFTER-FIXES) — HIGH-1, MEDIUM-2/3/4
// ============================================================================

function drainActive(state, t) {
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const current = SessionCore.paint(state, t);
    if (!current) break;
    t += 137;
    SessionCore.submit(state, Facts.answer(current.asked), t, {});
  }
  return t;
}

// [HIGH-1 fixture (b)] typed A starts, plays 3, is parked; falling F is
// played to completion and FINISHES FIRST (chronologically and by array
// index); A is then resumed and finishes SECOND. F's own attempts all
// happened after A's 3 pre-park attempts, so F's finish-boundary snapshot
// must already reflect them.
function buildInterleaveFixture(seed) {
  const state = freshState();
  const rng = seededRng(seed);
  let t = 1000;
  for (let i = 0; i < 8; i++) {
    SessionCore.start(state, rng, t, { mode: "typed" });
    t = drainActive(state, t);
    SessionCore.finish(state, t + 1);
    t += 500;
  }
  SessionCore.start(state, rng, t, { mode: "typed" });
  for (let i = 0; i < 3; i++) {
    const current = SessionCore.paint(state, t);
    t += 137;
    SessionCore.submit(state, Facts.answer(current.asked), t, {});
  }
  t += 100;
  SessionCore.switchTo(state, "falling", rng, t);
  t = drainActive(state, t);
  const F = SessionCore.finish(state, t + 1);
  t += 500;
  t = drainActive(state, t);
  const A = SessionCore.finish(state, t + 1);
  return { state, F, A };
}

// [HIGH-1 fixture (a)] falling started, 4 submits, PARKED (never finished —
// its attempts' `t`s are early and it never gets its own sIdx among
// completed sessions); a typed session is drained and finishes; falling is
// auto-unparked by that finish, then re-parked by starting a second typed
// session, which also finishes. The parked falling journal's early-`t`
// attempts (sIdx===Infinity under the old buggy gate) must still feed facts
// before the LATER-finishing typed sessions are snapshotted.
function buildStraddleFixture(seed) {
  const state = freshState();
  const rng = seededRng(seed);
  let t = 1000;
  for (let i = 0; i < 8; i++) {
    SessionCore.start(state, rng, t, { mode: "typed" });
    t = drainActive(state, t);
    SessionCore.finish(state, t + 1);
    t += 500;
  }
  SessionCore.start(state, rng, t, { mode: "falling" });
  for (let i = 0; i < 4; i++) {
    const current = SessionCore.paint(state, t);
    t += 137;
    SessionCore.submit(state, Facts.answer(current.asked), t, {});
  }
  t += 100;
  SessionCore.switchTo(state, "typed", rng, t); // parks falling; starts a new typed session
  t = drainActive(state, t);
  const A = SessionCore.finish(state, t + 1); // auto-unparks falling as active
  t += 100;
  SessionCore.switchTo(state, "typed", rng, t); // re-parks falling; starts a second new typed session
  t = drainActive(state, t);
  const B = SessionCore.finish(state, t + 1);
  return { state, A, B };
}

test("[HIGH-1 a] parked-early-t straddle: an active/parked journal's early attempts must still feed facts before a LATER-finishing session is snapshotted", () => {
  const { state, A, B } = buildStraddleFixture(11);
  const truth = JSON.parse(JSON.stringify(state));
  corruptDerivedFields(state);
  const result = Migrate.rebuildEvidence(state, 999999);
  assert.equal(result.ok, true);
  const aIdx = state.sessions.findIndex((s) => s.id === A.id);
  const bIdx = state.sessions.findIndex((s) => s.id === B.id);
  assert.equal(state.sessions[aIdx].masteredAfter, truth.sessions[aIdx].masteredAfter, "session A's rebuilt masteredAfter must match live play");
  assert.equal(state.sessions[bIdx].masteredAfter, truth.sessions[bIdx].masteredAfter, "session B's rebuilt masteredAfter must match live play");
  assert.deepEqual(state.map.reached, truth.map.reached, "stations legitimately reached during live play must not be dropped by the rebuild");
});

test("[HIGH-1 b] finished-while-parked interleave: a session that finishes EARLIER (by endedAt/array index) must see a later-finishing sibling's PRE-PARK attempts, which chronologically precede it", () => {
  const { state, F, A } = buildInterleaveFixture(3);
  const truth = JSON.parse(JSON.stringify(state));
  corruptDerivedFields(state);
  const result = Migrate.rebuildEvidence(state, 999999);
  assert.equal(result.ok, true);
  const fIdx = state.sessions.findIndex((s) => s.id === F.id);
  const aIdx = state.sessions.findIndex((s) => s.id === A.id);
  assert.equal(state.sessions[fIdx].masteredAfter, truth.sessions[fIdx].masteredAfter, "F's rebuilt masteredAfter must match live play (must include A's 3 pre-park attempts)");
  assert.equal(state.sessions[aIdx].masteredAfter, truth.sessions[aIdx].masteredAfter, "A's rebuilt masteredAfter must match live play");
  assert.deepEqual(
    state.sessions[fIdx].stationsReached.slice().sort(),
    truth.sessions[fIdx].stationsReached.slice().sort(),
    "F's rebuilt stationsReached must match live play"
  );
  assert.deepEqual(state.map.reached, truth.map.reached, "stations legitimately reached during live play must not be dropped by the rebuild");
});

// ---------------------------------------------------------------------------
// MEDIUM-2 — import/restore must re-trigger the pending rebuild, not wait for
// the next cold boot. The three UI callers (import confirm, restore-lastgood,
// cloud restore) now run `if (Migrate.evidenceRebuildPending(S())) await
// save(...rebuildEvidence...)` right after backupThenReplace succeeds —
// verified by grep in the status log; this is the storage-level proof that
// the check+save sequence actually flips the guard to done:true.
// ---------------------------------------------------------------------------
test("[MEDIUM-2] a state imported via backupThenReplace stays pending until the caller explicitly re-runs the rebuild (as all three UI callers now do)", async () => {
  const idb = new IDBFactory();
  const localStorage = (() => {
    const data = {};
    return {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: (k) => { delete data[k]; },
    };
  })();
  const storage = Storage.create({ indexedDB: idb, localStorage, dbName: "importrebuild" });
  await storage.load();
  storage.state = Migrate.emptyState();
  await storage.save(() => {}, 10); // seed the record

  const imported = buildFixture(); // a real, non-trivial play fixture
  imported.meta = { evidenceRebuild: null }; // simulates an old (schema-1) backup migrated on import
  const importResult = await storage.backupThenReplace(imported, 20);
  assert.equal(importResult.ok, true);
  assert.equal(Migrate.evidenceRebuildPending(storage.state), true, "backupThenReplace alone must not silently trigger the rebuild");

  if (Migrate.evidenceRebuildPending(storage.state)) {
    await storage.save((s) => { Migrate.rebuildEvidence(s, 999); });
  }
  assert.equal(storage.state.meta.evidenceRebuild.done, true, "the UI-caller check+save sequence must flip the guard to done:true immediately, not wait for the next cold boot");
});

// ---------------------------------------------------------------------------
// MEDIUM-3 — validateImport is structural only; the semantic/clock-skew-
// tolerant invariants live only in the boot preflight.
// ---------------------------------------------------------------------------
test("[MEDIUM-3] validateImport accepts a negative ms (an iOS clock step mid-question) — no longer a whole-backup rejection", () => {
  const raw = {
    sessions: [{
      id: "s1", startedAt: 1000, endedAt: 2000,
      planned: ["1x2"], firstTryCorrect: 1, coinsEarned: 1, masteredAfter: 0, misses: [],
      attempts: [{ key: "1x2", asked: "1x2", ok: true, ms: -3, t: 1500, retry: false, interrupted: false }],
    }],
  };
  const result = Migrate.validateImport(raw);
  assert.equal(result.ok, true, "problems: " + JSON.stringify(result.problems));
});

test("[MEDIUM-3] the boot preflight tolerates a 2-minute clock skew but rejects a 1-day one", () => {
  function sessionWithAttemptT(t) {
    return {
      startedAt: 1000000, endedAt: 1001000, planned: ["1x2"], firstTryCorrect: 1, misses: [],
      attempts: [{ key: "1x2", asked: "1x2", ok: true, ms: 50, t, retry: false, interrupted: false }],
    };
  }
  const twoMinSkew = 2 * 60 * 1000;
  const oneDaySkew = 24 * 60 * 60 * 1000;
  assert.ok(twoMinSkew < CONFIG.EVIDENCE_CLOCK_SKEW_MS, "test sanity: 2min must be inside the configured tolerance");
  assert.ok(oneDaySkew > CONFIG.EVIDENCE_CLOCK_SKEW_MS, "test sanity: 1 day must be outside the configured tolerance");
  const okState = { sessions: [sessionWithAttemptT(1000000 - twoMinSkew)], active: null, parked: null };
  assert.deepEqual(Migrate.preflightEvidence(okState), { ok: true });
  const badState = { sessions: [sessionWithAttemptT(1000000 - oneDaySkew)], active: null, parked: null };
  assert.deepEqual(Migrate.preflightEvidence(badState), { ok: false, reason: "malformed" });
});

test("[MEDIUM-3] rebuildEvidence clamps a negative ms to 0 at replay instead of rejecting it", () => {
  const state = {
    sessions: [{
      id: "s1", startedAt: 1000, endedAt: 2000, mode: "typed",
      planned: ["1x2"], firstTryCorrect: 1, misses: [],
      masteredAfter: 0, stationsReached: [],
      attempts: [{ key: "1x2", asked: "1x2", ok: true, ms: -3, t: 1500, retry: false, interrupted: false }],
    }],
    facts: {}, active: null, parked: null, map: { reached: {} }, meta: { evidenceRebuild: null },
  };
  const check = Migrate.preflightEvidence(state);
  assert.deepEqual(check, { ok: true }, "a negative ms must not fail the preflight — it's tolerated and clamped");
  const result = Migrate.rebuildEvidence(state, 9999);
  assert.equal(result.ok, true);
  assert.equal(state.facts["1x2"].recent[0].ms, 0, "ms must be clamped to 0, never left negative in the replayed fact history");
});

// ---------------------------------------------------------------------------
// MEDIUM-4 — one hand-built minimal session per invariant, isolating exactly
// ONE violation each, so a mutant deleting that ONE check is provably killed.
// ---------------------------------------------------------------------------
function minimalSession(overrides) {
  const base = {
    id: "s1",
    startedAt: 1000000,
    endedAt: 1001000,
    mode: "typed",
    planned: ["1x2", "3x4"],
    firstTryCorrect: 2,
    misses: [],
    attempts: [
      { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000100, retry: false, interrupted: false },
      { key: "3x4", asked: "3x4", ok: true, ms: 50, t: 1000900, retry: false, interrupted: false },
    ],
  };
  return Object.assign({}, base, overrides);
}

function preflightOf(session) {
  return Migrate.preflightEvidence({ sessions: [session], active: null, parked: null });
}

test("[MEDIUM-4] baseline: a clean minimal 2-fact session passes preflight", () => {
  assert.deepEqual(preflightOf(minimalSession()), { ok: true });
});

// V2-DESIGN §8: `planned` may contain a canonical key TWICE (a mirror pair).
// completedSessionEvidenceProblem's multiset check already compares full
// `asked` strings by count, so this needs no code change — only proof.
test("[§8] preflight accepts a planned canonical key twice (a mirror pair) with exactly two matching first attempts", () => {
  const session = minimalSession({
    planned: ["1x2", "2x1", "3x4"],
    firstTryCorrect: 3,
    attempts: [
      { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000100, retry: false, interrupted: false },
      { key: "1x2", asked: "2x1", ok: true, ms: 50, t: 1000300, retry: false, interrupted: false },
      { key: "3x4", asked: "3x4", ok: true, ms: 50, t: 1000900, retry: false, interrupted: false },
    ],
  });
  assert.deepEqual(preflightOf(session), { ok: true });
});

test("[§8] preflight rejects a THIRD occurrence of a mirror-paired canonical key (multiset count mismatch)", () => {
  const session = minimalSession({
    planned: ["1x2", "2x1", "3x4"],
    firstTryCorrect: 3,
    attempts: [
      { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000100, retry: false, interrupted: false },
      { key: "1x2", asked: "2x1", ok: true, ms: 50, t: 1000300, retry: false, interrupted: false },
      { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000500, retry: false, interrupted: false },
      { key: "3x4", asked: "3x4", ok: true, ms: 50, t: 1000900, retry: false, interrupted: false },
    ],
  });
  assert.deepEqual(preflightOf(session), { ok: false, reason: "malformed" });
});

test("[MEDIUM-4] duplicate first attempt (misses consistent) breaks the planned multiset", () => {
  const session = minimalSession({
    attempts: [
      { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000100, retry: false, interrupted: false },
      { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000900, retry: false, interrupted: false },
    ],
  });
  assert.deepEqual(preflightOf(session), { ok: false, reason: "malformed" });
});

test("[MEDIUM-4] a missing planned fact (never attempted) breaks the planned multiset", () => {
  const session = minimalSession({
    attempts: [{ key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000100, retry: false, interrupted: false }],
    firstTryCorrect: 1,
  });
  assert.deepEqual(preflightOf(session), { ok: false, reason: "malformed" });
});

test("[MEDIUM-4] `t` before startedAt, beyond the clock-skew tolerance", () => {
  const session = minimalSession({
    attempts: [
      { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000000 - CONFIG.EVIDENCE_CLOCK_SKEW_MS - 1000, retry: false, interrupted: false },
      { key: "3x4", asked: "3x4", ok: true, ms: 50, t: 1000900, retry: false, interrupted: false },
    ],
  });
  assert.deepEqual(preflightOf(session), { ok: false, reason: "malformed" });
});

test("[MEDIUM-4] `t` after endedAt, beyond the clock-skew tolerance", () => {
  const session = minimalSession({
    attempts: [
      { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000100, retry: false, interrupted: false },
      { key: "3x4", asked: "3x4", ok: true, ms: 50, t: 1001000 + CONFIG.EVIDENCE_CLOCK_SKEW_MS + 1000, retry: false, interrupted: false },
    ],
  });
  assert.deepEqual(preflightOf(session), { ok: false, reason: "malformed" });
});

test("[MEDIUM-4] an attempt's key does not belong to `planned`", () => {
  const session = minimalSession({
    attempts: [
      { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000100, retry: false, interrupted: false },
      { key: "5x6", asked: "5x6", ok: true, ms: 50, t: 1000900, retry: false, interrupted: false },
    ],
  });
  assert.deepEqual(preflightOf(session), { ok: false, reason: "malformed" });
});

test("[MEDIUM-4] `firstTryCorrect` disagrees with the actual non-retry attempts", () => {
  const session = minimalSession({ firstTryCorrect: 1 }); // both attempts are actually ok:true
  assert.deepEqual(preflightOf(session), { ok: false, reason: "malformed" });
});

test("[MEDIUM-4] `misses` disagrees with the actual non-retry attempts", () => {
  const session = minimalSession({
    attempts: [
      { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000100, retry: false, interrupted: false },
      { key: "3x4", asked: "3x4", ok: false, ms: 50, t: 1000900, retry: false, interrupted: false },
    ],
    firstTryCorrect: 1,
    misses: [], // should be ["3x4"]
  });
  assert.deepEqual(preflightOf(session), { ok: false, reason: "malformed" });
});

test("[MEDIUM-4] a journal's non-retry-attempts ⊎ queue does not equal planned (multiset mismatch)", () => {
  const journ = {
    id: "j1", startedAt: 1000000, mode: "typed",
    planned: ["1x2", "3x4"], queue: ["1x2"], retryQueue: [], attempts: [], current: null,
  };
  const result = Migrate.preflightEvidence({ sessions: [], active: journ, parked: null });
  assert.deepEqual(result, { ok: false, reason: "malformed" });
});

test("[MEDIUM-4] a journal attempt's `t` is before startedAt, beyond the clock-skew tolerance", () => {
  const journ = {
    id: "j2", startedAt: 1000000, mode: "typed",
    planned: ["1x2", "3x4"], queue: ["3x4"], retryQueue: [], current: null,
    attempts: [{ key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000000 - CONFIG.EVIDENCE_CLOCK_SKEW_MS - 1000, retry: false, interrupted: false }],
  };
  const result = Migrate.preflightEvidence({ sessions: [], active: journ, parked: null });
  assert.deepEqual(result, { ok: false, reason: "malformed" });
});

test("[MEDIUM-4] a non-finite ms (not merely negative) is structurally invalid", () => {
  const session = minimalSession({
    attempts: [
      { key: "1x2", asked: "1x2", ok: true, ms: Infinity, t: 1000100, retry: false, interrupted: false },
      { key: "3x4", asked: "3x4", ok: true, ms: 50, t: 1000900, retry: false, interrupted: false },
    ],
  });
  assert.deepEqual(preflightOf(session), { ok: false, reason: "malformed" });
});

function oneFactSession(id, t0, interrupted) {
  return {
    id, startedAt: t0, endedAt: t0 + 200, mode: "typed",
    planned: ["1x2"], firstTryCorrect: 1, misses: [],
    attempts: [{ key: "1x2", asked: "1x2", ok: true, ms: 50, t: t0 + 100, retry: false, interrupted: interrupted }],
    masteredAfter: 0, stationsReached: [], coinsEarned: 0, perfect: false, totalMs: 50,
  };
}

test("[MEDIUM-4] rebuildEvidence preserves `interrupted` on replay — an interrupted-only history never masters", () => {
  const state = {
    sessions: [oneFactSession("s1", 1000000, true), oneFactSession("s2", 1002000, true), oneFactSession("s3", 1004000, true)],
    facts: {}, active: null, parked: null, map: { reached: {} }, meta: { evidenceRebuild: null },
  };
  assert.deepEqual(Migrate.preflightEvidence(state), { ok: true });
  const result = Migrate.rebuildEvidence(state, 9999999);
  assert.equal(result.ok, true);
  assert.equal(Facts.mastery(state.facts["1x2"]), "learning", "3 correct-but-interrupted attempts must never master — Facts.mastery requires !interrupted for all of the last 3");
});

test("[MEDIUM-4] validateImport rejects a session attempt whose key does not belong to planned (structural check, not just the preflight's semantic copy)", () => {
  const raw = {
    sessions: [{
      id: "s1", startedAt: 1000000, endedAt: 1001000,
      planned: ["1x2", "3x4"], firstTryCorrect: 2, coinsEarned: 2, masteredAfter: 0, misses: [],
      attempts: [
        { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000100, retry: false, interrupted: false },
        { key: "5x6", asked: "5x6", ok: true, ms: 50, t: 1000900, retry: false, interrupted: false },
      ],
    }],
  };
  const result = Migrate.validateImport(raw);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.indexOf("attempts has a structurally invalid attempt") !== -1));
});

test("[MEDIUM-4] a RETRY attempt's key does not belong to planned — isolates the key-membership check from the multiset check (which only looks at non-retry attempts)", () => {
  const session = minimalSession({
    attempts: [
      { key: "1x2", asked: "1x2", ok: true, ms: 50, t: 1000100, retry: false, interrupted: false },
      { key: "3x4", asked: "3x4", ok: true, ms: 50, t: 1000900, retry: false, interrupted: false },
      { key: "5x6", asked: "5x6", ok: true, ms: 50, t: 1000950, retry: true, interrupted: false },
    ],
  });
  assert.deepEqual(preflightOf(session), { ok: false, reason: "malformed" });
});

// ---------------------------------------------------------------------------
// Fix-verification round 2 (fresh Fable 5, 2026-08-28) — NEW-ISSUE-A: a
// backward clock step between the last submit and finish() puts attempt `t`
// past endedAt (inside the skew tolerance). Those attempts must still be
// replayed by their OWN session's boundary, or the station that session
// reached live is dropped by the rebuild ("reached is permanent").
// ---------------------------------------------------------------------------
test("[NEW-ISSUE-A] attempts with t > endedAt (clock stepped back before finish) are replayed by their own session's boundary — the station it reached survives the rebuild", () => {
  const state = freshState();
  const rng = seededRng(21);
  let t = 1000;
  let skewed = null;
  for (let i = 0; i < 60 && !skewed; i++) {
    SessionCore.start(state, rng, t, { mode: "typed" });
    t = drainActive(state, t);
    if (MapCore.newlyReached(state).length) {
      skewed = SessionCore.finish(state, t - 1000); // endedAt 1 s BEFORE the last attempts (within EVIDENCE_CLOCK_SKEW_MS)
    } else {
      SessionCore.finish(state, t + 1);
    }
    t += 500;
  }
  assert.ok(skewed && skewed.stationsReached.length > 0, "fixture must reach a station in the skewed session");
  assert.ok(skewed.attempts.some((a) => a.t > skewed.endedAt), "fixture must have attempts after endedAt");
  const truth = JSON.parse(JSON.stringify(state));
  corruptDerivedFields(state);
  assert.deepEqual(Migrate.preflightEvidence(state), { ok: true });
  const result = Migrate.rebuildEvidence(state, 999999);
  assert.equal(result.ok, true);
  assert.deepEqual(state.map.reached, truth.map.reached, "the station reached in the skewed session must survive");
  const idx = state.sessions.findIndex((s) => s.id === skewed.id);
  assert.equal(state.sessions[idx].masteredAfter, truth.sessions[idx].masteredAfter);
});

// Residual MEDIUM-4 gap: a journal (active/parked, never finished) whose
// attempts would complete a station must NOT assign it — stations are only
// evaluated at completed-session boundaries.
test("[MEDIUM-4 residual] a journal that completes a table's mastery does not reach the station until its session finishes", () => {
  const keys = [];
  for (let n = CONFIG.FACTS_MIN; n <= CONFIG.FACTS_MAX; n++) keys.push(Facts.key(1, n));
  // V2-DESIGN §8: mastery also needs Facts.mirrorOk for non-square facts.
  // s1/s2 ask every fact in its forward direction ("1xn"); the still-active
  // journal (the "third fast correct" that flips mastery) asks the MIRROR
  // direction ("nx1") for non-square facts — exactly what Selector's own
  // chooseDirection would naturally do once the forward direction already
  // has 2 fast-correct entries and the reverse has none (rule 2). This keeps
  // the "3rd occurrence -> mastered" structure of the original fixture intact
  // while also satisfying the new mirror requirement.
  function askedFor(k, reversed) {
    const [a, b] = Facts.parts(k);
    return reversed && a !== b ? b + "x" + a : k;
  }
  function plannedFor(reversed) {
    return keys.map((k) => askedFor(k, reversed));
  }
  function attemptsAt(t0, reversed) {
    return keys.map((k, i) => {
      const asked = askedFor(k, reversed);
      return { key: k, asked, answer: Facts.answer(asked), ok: true, ms: 500, retry: false, withinLimit: true, interrupted: false, mode: "typed", coins: 1, t: t0 + i * 100 };
    });
  }
  function completed(id, t0) {
    return { id, startedAt: t0, endedAt: t0 + 2000, abandoned: false, mode: "typed", challengeOn: false, timeLimitSec: 10, planned: plannedFor(false), attempts: attemptsAt(t0 + 10, false), firstTryCorrect: 10, totalMs: 5000, misses: [], coinsEarned: 10, perfect: true, perfectSeries: 1, masteredAfter: 0, unlocksEarned: [], stationsReached: [] };
  }
  const state = freshState();
  state.sessions = [completed("s1", 1000), completed("s2", 10000)];
  state.active = { id: "s3", startedAt: 20000, mode: "typed", settingsSnapshot: SessionCore.buildSnapshot(state, "typed"), planned: plannedFor(true), queue: [], retryQueue: [], attempts: attemptsAt(20010, true), current: null, deferred: [] };
  assert.deepEqual(Migrate.preflightEvidence(state), { ok: true });
  const result = Migrate.rebuildEvidence(state, 999999);
  assert.equal(result.ok, true);
  assert.equal(MapCore.progress(state, 1), 10, "facts DO reflect the journal's attempts (third fast correct → mastered, mirror satisfied)");
  assert.deepEqual(state.map.reached, {}, "but no station is assigned from an unfinished journal");
  assert.deepEqual(state.sessions[1].stationsReached, [], "and the last completed boundary (2 attempts per fact, mirror not yet satisfied) did not qualify");
});
