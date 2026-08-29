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

test("validateImport: perfectSeries is optional, must be a non-negative number when present (review 2026-08-28 LOW-1)", () => {
  const base = { planned: ["1x1"], firstTryCorrect: 1, coinsEarned: 1, masteredAfter: 0 };
  assert.equal(Migrate.validateImport({ sessions: [Object.assign({}, base)] }).ok, true);
  assert.equal(Migrate.validateImport({ sessions: [Object.assign({ perfectSeries: 0 }, base)] }).ok, true);
  assert.equal(Migrate.validateImport({ sessions: [Object.assign({ perfectSeries: 3 }, base)] }).ok, true);
  assert.equal(Migrate.validateImport({ sessions: [Object.assign({ perfectSeries: -1 }, base)] }).ok, false);
  assert.equal(Migrate.validateImport({ sessions: [Object.assign({ perfectSeries: "2" }, base)] }).ok, false);
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

// V2-DESIGN §2 B1 (revised 2026-08-28): accuracy/avgMs are now per-mode
// series aligned to ONE common window of the last n sessions (all modes),
// with null at every position that isn't that mode — not a typed-only
// filtered/shrunk axis. Fixture: one typed session, one falling session with
// identical shape except mode/coins.
test("Stats.trends: per-mode accuracy/avgMs series are null-aligned to the common window; coins/masteredCount stay all-mode", () => {
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
    masteredAfter: 7,
    attempts: [{ retry: false, interrupted: false, ms: 500 }, { retry: false, interrupted: false, ms: 500 }],
  };
  const state = { sessions: [typedSession, fallingSession] };
  const trends = Stats.trends(state, 30);

  assert.deepEqual(trends.accuracy.typed, [0.5, null]);
  assert.deepEqual(trends.accuracy.falling, [null, 1]);
  assert.deepEqual(trends.accuracy.wall, [null, null]);
  assert.deepEqual(trends.avgMs.typed, [1500, null]);
  assert.deepEqual(trends.avgMs.falling, [null, 500]);
  assert.deepEqual(trends.masteredCount, [5, 7]); // both sessions — mastery/map move for falling too
  assert.deepEqual(trends.coins, [3, 99]);
  assert.deepEqual(trends.modes, ["typed", "falling"]);
});

// WP-F1's original concern (a run of falling sessions starving the typed
// line) is now addressed differently: instead of filtering typed sessions
// into their own pre-windowed axis, the typed line simply shows gaps (null)
// at every falling-session position across the ONE shared window — design
// §2 B1's own test list: "a run of 30 falling sessions leaves the typed
// line with gaps, not blanks."
test("Stats.trends: a run of falling sessions leaves the typed line with gaps, not blanks", () => {
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

  // Window large enough to hold every session (31), so the typed session
  // is not simply dropped by the window itself — its gap is real, not a
  // side effect of windowing.
  const trends = Stats.trends(state, 31);
  assert.equal(trends.accuracy.typed.length, 31);
  assert.equal(trends.accuracy.typed[0], 1, "the one typed session's own accuracy value survives"); // 1/1 = 1
  assert.ok(trends.accuracy.typed.slice(1).every((v) => v === null), "every falling-session position is null, not dropped");
  assert.ok(trends.accuracy.falling.slice(1).every((v) => v === 1), "the falling line carries every falling session's own value");
  assert.equal(trends.accuracy.falling[0], null);
  assert.equal(trends.coins.length, 31); // coins/masteredCount stay all-mode, unaffected
  assert.equal(trends.masteredCount.length, 31);
});
