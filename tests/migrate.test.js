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

test("an imported suspended session is preserved with current.interrupted=true", () => {
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
  assert.equal(state.active.current.interrupted, true);
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
