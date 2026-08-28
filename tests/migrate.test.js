const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG, Economy, Migrate } = require("../core.js");

function sampleRaw() {
  return {
    schemaVersion: 1,
    rev: 5,
    savedAt: 100,
    createdAt: 1,
    lastExportAt: null,
    settings: { childName: "נועה", challengeOn: true, timeLimitSec: 10, sound: true, pinHash: "abc", recoveryHash: "xyz" },
    economy: {
      ledger: [{ id: "l_1", t: 1, type: "earn", amount: 10, ref: "s1", note: "" }],
      unlocked: [],
      rewards: [],
      requests: [],
    },
    facts: { "6x7": { attempts: 1, correct: 1, lastSeen: 1, recent: [] } },
    sessions: [],
    carryover: [],
    active: null,
  };
}

test("migrate() is idempotent", () => {
  const raw = sampleRaw();
  const once = Migrate.migrate(raw);
  const twice = Migrate.migrate(once);
  assert.deepEqual(twice, once);
});

test("migrate() rejects a newer schema with a coded error", () => {
  const raw = sampleRaw();
  raw.schemaVersion = CONFIG.SCHEMA_VERSION + 1;
  assert.throws(() => Migrate.migrate(raw), (err) => err.code === "SCHEMA_TOO_NEW");
});

test("validateImport() rejects a malformed ledger entry", () => {
  const raw = sampleRaw();
  raw.economy.ledger.push({ id: "l_2", t: "not-a-number", type: "bogus" }); // missing amount, bad type/t
  const result = Migrate.validateImport(raw);
  assert.equal(result.ok, false);
  assert.ok(result.problems.length > 0);
});

test("validateImport() accepts a well-formed raw blob", () => {
  const raw = sampleRaw();
  const result = Migrate.validateImport(raw);
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
});

test("validateImport() rejects carryover that is not an array", () => {
  const raw = sampleRaw();
  raw.carryover = "6x7";
  const result = Migrate.validateImport(raw);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.indexOf("carryover") !== -1));
});

test("validateImport() rejects an active session missing queue/retryQueue/attempts (would crash SessionCore.paint)", () => {
  const raw = sampleRaw();
  raw.active = { id: "s_active", startedAt: 1, planned: ["6x7"] }; // missing queue, retryQueue, attempts
  const result = Migrate.validateImport(raw);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.indexOf("active.queue") !== -1));
  assert.ok(result.problems.some((p) => p.indexOf("active.retryQueue") !== -1));
  assert.ok(result.problems.some((p) => p.indexOf("active.attempts") !== -1));
});

test("[WP9 finding D] validateImport() rejects a malformed session entry (would crash Stats.trends on s.planned.length)", () => {
  const raw = sampleRaw();
  raw.sessions.push({}); // missing planned/firstTryCorrect/coinsEarned/masteredAfter
  const result = Migrate.validateImport(raw);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.indexOf("sessions[0].planned") !== -1));
  assert.ok(result.problems.some((p) => p.indexOf("sessions[0].firstTryCorrect") !== -1));
});

test("[WP9 finding D] validateImport() rejects a fact value that isn't an object (would crash Facts.updateFromAttempt in strict mode)", () => {
  const raw = sampleRaw();
  raw.facts["2x7"] = "junk";
  const result = Migrate.validateImport(raw);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.indexOf("facts[2x7]") !== -1));
});

test("[WP9 finding D] validateImport() rejects a fact object missing numeric attempts/correct/lastSeen", () => {
  const raw = sampleRaw();
  raw.facts["3x4"] = { recent: [] };
  const result = Migrate.validateImport(raw);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.indexOf("facts[3x4].attempts") !== -1));
});

test("validateImport() rejects an active session with a non-string id", () => {
  const raw = sampleRaw();
  raw.active = { id: 123, planned: [], queue: [], retryQueue: [], attempts: [] };
  const result = Migrate.validateImport(raw);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.indexOf("active.id") !== -1));
});

test("an imported suspended session is preserved; its in-flight question is deferred to the end of the queue", () => {
  const raw = sampleRaw();
  raw.active = {
    id: "s_active",
    startedAt: 1,
    settingsSnapshot: { challengeOn: false, timeLimitSec: 10 },
    planned: ["6x7"],
    queue: ["6x7"],
    retryQueue: [],
    attempts: [],
    current: { key: "6x7", asked: "6x7", shownAt: 1, interrupted: false },
  };
  const state = Migrate.migrate(raw);
  assert.ok(state.active);
  assert.equal(state.active.current, null);
  assert.deepEqual(state.active.planned, ["6x7"]);
});

test("forImport() drops pinHash/recoveryHash so a caller must re-apply the device's own", () => {
  const raw = sampleRaw();
  const state = Migrate.forImport(raw);
  assert.equal(state.settings.pinHash, null);
  assert.equal(state.settings.recoveryHash, null);
  // a plain migrate() (normal boot path) must NOT drop the device's own PIN
  const bootState = Migrate.migrate(raw);
  assert.equal(bootState.settings.pinHash, "abc");
});

test("recompute() self-heals a missing unlock implied by the ledger", () => {
  const state = Migrate.emptyState();
  Economy.ledgerAppend(state, { id: "l_1", t: 1, type: "earn", amount: 60, ref: "s1", note: "" });
  assert.deepEqual(state.economy.unlocked, []);
  Migrate.recompute(state);
  assert.deepEqual(state.economy.unlocked, [CONFIG.STICKERS[0], CONFIG.STICKERS[1]]);
});

test("[WP3 regression] migrate() preserves settings.forceNumpad across a reload (every boot calls migrate())", () => {
  const raw = sampleRaw();
  raw.settings.forceNumpad = true;
  const state = Migrate.migrate(raw);
  assert.equal(state.settings.forceNumpad, true);

  const rawFalse = sampleRaw();
  rawFalse.settings.forceNumpad = false;
  assert.equal(Migrate.migrate(rawFalse).settings.forceNumpad, false);

  // absent -> defaults to null (auto-detect), not dropped/undefined
  const rawAbsent = sampleRaw();
  assert.equal(Migrate.migrate(rawAbsent).settings.forceNumpad, null);
});

// --- Punch-list P10 (2026-08-26): deeper import validation ---
test("[P10] validateImport rejects active.current without asked/key/shownAt", () => {
  const raw = Migrate.emptyState(0);
  raw.active = { id: "s_1", planned: ["2x3"], queue: [], retryQueue: [], attempts: [], current: {} };
  const v = Migrate.validateImport(raw);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /active\.current\.asked/.test(p)));
});

test("[P10] validateImport accepts a well-formed active.current and null current", () => {
  const raw = Migrate.emptyState(0);
  raw.active = { id: "s_1", planned: ["2x3"], queue: [], retryQueue: [], attempts: [], current: { asked: "3x2", key: "2x3", shownAt: 5, retry: false, interrupted: false } };
  assert.equal(Migrate.validateImport(raw).ok, true);
  raw.active.current = null;
  assert.equal(Migrate.validateImport(raw).ok, true);
});

test("[P10] validateImport rejects a ledger amount outside ±LEDGER_MAX_ABS_AMOUNT", () => {
  const raw = Migrate.emptyState(0);
  raw.economy.ledger = [{ id: "l_x", t: 1, type: "earn", amount: 999999 }];
  const v = Migrate.validateImport(raw);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /out of range/.test(p)));
  raw.economy.ledger = [{ id: "l_x", t: 1, type: "earn", amount: 31 }];
  assert.equal(Migrate.validateImport(raw).ok, true);
});

// --- Closing review 2026-08-26: legitimate round-trip + requests validation ---
test("[review] a state produced by start→paint round-trips through validateImport", () => {
  const { SessionCore } = require("../core.js");
  const state = Migrate.emptyState(0);
  SessionCore.start(state, () => 0.5, 1000);
  SessionCore.paint(state, 1500);
  const raw = JSON.parse(JSON.stringify(state));
  assert.equal(Migrate.validateImport(raw).ok, true);
  assert.equal(Migrate.validateImport(Migrate.migrate(raw)).ok, true);
});

test("[review] validateImport rejects a request with a string costSnapshot or bad status", () => {
  const raw = Migrate.emptyState(0);
  raw.economy.requests = [{ id: "q1", rewardId: "r1", nameSnapshot: "x", costSnapshot: "<img src=x onerror=1>", t: 1, status: "requested" }];
  assert.equal(Migrate.validateImport(raw).ok, false);
  raw.economy.requests = [{ id: "q1", rewardId: "r1", nameSnapshot: "x", costSnapshot: 10, t: 1, status: "weird" }];
  assert.equal(Migrate.validateImport(raw).ok, false);
  raw.economy.requests = [{ id: "q1", rewardId: "r1", nameSnapshot: "x", costSnapshot: 10, t: 1, status: "requested" }];
  raw.economy.rewards = [{ id: "r1", name: "x", cost: 10, active: true }];
  assert.equal(Migrate.validateImport(raw).ok, true);
});
