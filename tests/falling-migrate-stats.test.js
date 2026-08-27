const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG, Migrate, Stats } = require("../core.js");

test("Migrate.emptyState() has a disabled falling default", () => {
  const state = Migrate.emptyState();
  assert.deepEqual(state.settings.falling, {
    enabled: false,
    durationSec: CONFIG.FALLING.DEFAULT_DURATION_SEC,
    options: CONFIG.FALLING.DEFAULT_OPTIONS,
  });
});

test("Migrate.migrate() fills in settings.falling default when absent from raw", () => {
  const state = Migrate.migrate({});
  assert.deepEqual(state.settings.falling, {
    enabled: false,
    durationSec: CONFIG.FALLING.DEFAULT_DURATION_SEC,
    options: CONFIG.FALLING.DEFAULT_OPTIONS,
  });
});

test("Migrate.migrate() carries a valid settings.falling through", () => {
  const state = Migrate.migrate({ settings: { falling: { enabled: true, durationSec: 12, options: 6 } } });
  assert.deepEqual(state.settings.falling, { enabled: true, durationSec: 12, options: 6 });
});

test("Migrate.migrate() defaults active.mode and old sessions' mode to 'typed'", () => {
  const raw = {
    active: { id: "s1", planned: [], queue: [], retryQueue: [], attempts: [], current: null },
    sessions: [{ id: "s0", planned: ["1x1"], firstTryCorrect: 1, coinsEarned: 1, masteredAfter: 0 }],
  };
  const state = Migrate.migrate(raw);
  assert.equal(state.active.mode, "typed");
  assert.equal(state.sessions[0].mode, "typed");
});

test("Migrate.migrate() preserves an explicit falling mode on active/sessions", () => {
  const raw = {
    active: { id: "s1", mode: "falling", planned: [], queue: [], retryQueue: [], attempts: [], current: null },
    sessions: [{ id: "s0", mode: "falling", planned: ["1x1"], firstTryCorrect: 1, coinsEarned: 1, masteredAfter: 0 }],
  };
  const state = Migrate.migrate(raw);
  assert.equal(state.active.mode, "falling");
  assert.equal(state.sessions[0].mode, "falling");
});

test("validateImport accepts old sessions without a mode field", () => {
  const raw = { sessions: [{ planned: ["1x1"], firstTryCorrect: 1, coinsEarned: 1, masteredAfter: 0 }] };
  const result = Migrate.validateImport(raw);
  assert.equal(result.ok, true);
});

test("validateImport accepts a well-formed settings.falling", () => {
  const result = Migrate.validateImport({ settings: { falling: { enabled: true, durationSec: 10, options: 5 } } });
  assert.equal(result.ok, true);
});

test("validateImport rejects settings.falling with an out-of-range durationSec/options or wrong types", () => {
  assert.equal(Migrate.validateImport({ settings: { falling: { durationSec: 1 } } }).ok, false);
  assert.equal(Migrate.validateImport({ settings: { falling: { durationSec: 999 } } }).ok, false);
  assert.equal(Migrate.validateImport({ settings: { falling: { options: 3 } } }).ok, false);
  assert.equal(Migrate.validateImport({ settings: { falling: { options: 7 } } }).ok, false);
  assert.equal(Migrate.validateImport({ settings: { falling: { enabled: "yes" } } }).ok, false);
  assert.equal(Migrate.validateImport({ settings: { falling: "nope" } }).ok, false);
});

// Fixture: one typed session, one falling session with identical shape except
// mode/coins, proving the falling session moves coins but not accuracy/speed/mastery.
test("Stats.trends: a falling session moves coins but not accuracy/avgMs/masteredCount", () => {
  const typedSession = {
    id: "t1",
    mode: "typed",
    planned: ["1x1", "2x2"],
    firstTryCorrect: 1,
    coinsEarned: 3,
    masteredAfter: 5,
    attempts: [{ retry: false, interrupted: false, ms: 1000 }, { retry: false, interrupted: false, ms: 2000 }],
  };
  const fallingSession = {
    id: "f1",
    mode: "falling",
    planned: ["3x3", "4x4"],
    firstTryCorrect: 2,
    coinsEarned: 99,
    masteredAfter: 5,
    attempts: [{ retry: false, interrupted: false, ms: 500 }, { retry: false, interrupted: false, ms: 500 }],
  };
  const state = { sessions: [typedSession, fallingSession] };
  const trends = Stats.trends(state, 30);

  assert.deepEqual(trends.accuracy, [0.5]); // only the typed session
  assert.deepEqual(trends.masteredCount, [5]); // only the typed session
  assert.equal(trends.avgMs.length, 1);
  assert.equal(trends.coins.length, 2); // both sessions
  assert.deepEqual(trends.coins, [3, 99]);
});

// WP-F1 gate review (fresh Fable 5, MEDIUM): filtering falling sessions AFTER
// windowing to the last n lets a run of falling sessions push real typed
// history out of the accuracy/avgMs/masteredCount trend window entirely,
// even though the app default (window 30) makes this the expected shape for
// a child who prefers the balloon game. Filter before windowing instead.
test("Stats.trends: a long run of falling sessions does not starve the learning-trend window", () => {
  const typedSession = {
    mode: "typed",
    planned: ["1x1"],
    firstTryCorrect: 1,
    coinsEarned: 1,
    masteredAfter: 3,
    attempts: [{ retry: false, interrupted: false, ms: 1000 }],
  };
  const fallingSession = {
    mode: "falling",
    planned: ["2x2"],
    firstTryCorrect: 1,
    coinsEarned: 5,
    masteredAfter: 3,
    attempts: [{ retry: false, interrupted: false, ms: 300 }],
  };
  const sessions = [typedSession];
  for (let i = 0; i < 30; i++) sessions.push(fallingSession);
  const state = { sessions };

  const trends = Stats.trends(state, 30);
  assert.equal(trends.accuracy.length, 1, "the one typed session must still appear in the window");
  assert.equal(trends.masteredCount.length, 1);
  assert.equal(trends.avgMs.length, 1);
  assert.equal(trends.coins.length, 30); // coins keeps the raw window (all-falling here)
});
