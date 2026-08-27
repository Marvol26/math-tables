const test = require("node:test");
const assert = require("node:assert/strict");
const { IDBFactory } = require("fake-indexeddb");
const { CONFIG, Migrate, Storage } = require("../core.js");

function makeLocalStorage() {
  const data = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

function seedState() {
  const s = Migrate.emptyState();
  s.settings.childName = "נועה";
  s.settings.pinHash = "salt:digest";
  return s;
}

test("save() increments rev on each successful write", async () => {
  const idb = new IDBFactory();
  const storage = Storage.create({ indexedDB: idb, localStorage: makeLocalStorage(), dbName: "db1" });
  await storage.load();
  storage.state = seedState();
  await storage.save((s) => { s.settings.sound = false; }, 100);
  assert.equal(storage.rev, 1);
  await storage.save((s) => { s.settings.sound = true; }, 200);
  assert.equal(storage.rev, 2);
  assert.equal(storage.state.settings.sound, true);
});

test("two windows on the same DB: the second window's write goes stale after the first commits", async () => {
  const idb = new IDBFactory();
  const localStorage = makeLocalStorage();
  const a = Storage.create({ indexedDB: idb, localStorage, dbName: "shared" });
  await a.load();
  a.state = seedState();
  await a.save((s) => { s.settings.sound = false; }, 100); // rev 0 -> 1, seeds the record

  const b = Storage.create({ indexedDB: idb, localStorage, dbName: "shared" });
  await b.load(); // loads rev 1

  // window A writes again -> rev 1 -> 2
  const aResult = await a.save((s) => { s.settings.childName = "from A"; }, 200);
  assert.equal(aResult.ok, true);
  assert.equal(a.rev, 2);

  // window B still thinks rev is 1 -> its write must abort as stale
  const bResult = await b.save((s) => { s.settings.childName = "from B"; }, 300);
  assert.equal(bResult.ok, false);
  assert.equal(bResult.stale, true);
  assert.equal(b.stale, true);
  // B's in-memory state must be untouched by the failed write
  assert.equal(b.state.settings.childName, "נועה");

  // reloading B picks up the current rev (A's write)
  await b.load();
  assert.equal(b.rev, 2);
  assert.equal(b.state.settings.childName, "from A");
});

test("10 concurrent queued saves on one window serialize: rev advances by exactly 10, none stale", async () => {
  const idb = new IDBFactory();
  const storage = Storage.create({ indexedDB: idb, localStorage: makeLocalStorage(), dbName: "db2" });
  await storage.load();
  storage.state = seedState();

  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(storage.save((s) => { s.economy.ledger.push({ id: "l_" + i, t: i, type: "earn", amount: 1, ref: "x", note: "" }); }, i));
  }
  const results = await Promise.all(promises);
  assert.ok(results.every((r) => r.ok === true));
  assert.equal(storage.rev, 10);
  assert.equal(storage.state.economy.ledger.length, 10);
});

test("mirror is restored into an empty IDB (IDB wiped, localStorage mirror survives)", async () => {
  const localStorage = makeLocalStorage();
  const idb1 = new IDBFactory();
  const a = Storage.create({ indexedDB: idb1, localStorage, dbName: "wipe-test" });
  await a.load();
  a.state = seedState();
  await a.save((s) => { s.settings.childName = "מיררור"; }, 100);

  // simulate IDB being wiped (fresh factory) while localStorage mirror survives
  const idb2 = new IDBFactory();
  const b = Storage.create({ indexedDB: idb2, localStorage, dbName: "wipe-test" });
  const loaded = await b.load();
  assert.equal(loaded.settings.childName, "מיררור");
  assert.equal(b.rev, 1);

  // and it was actually restored into the (new, empty) IDB, not just held in memory
  const c = Storage.create({ indexedDB: idb2, localStorage: makeLocalStorage(), dbName: "wipe-test" });
  const loadedFromIdbOnly = await c.load();
  assert.equal(loadedFromIdbOnly.settings.childName, "מיררור");
});

test("backupThenReplace + undoLastReplace round-trip keeps the device's own pinHash and restores prior data", async () => {
  const idb = new IDBFactory();
  const storage = Storage.create({ indexedDB: idb, localStorage: makeLocalStorage(), dbName: "db3" });
  await storage.load();
  storage.state = seedState();
  await storage.save((s) => { s.sessions.push({ id: "s1" }); }, 100);
  const pinHashBefore = storage.state.settings.pinHash;

  const replacement = Migrate.emptyState();
  replacement.settings.pinHash = "someone-elses-hash"; // must NOT survive (caller's job to strip; here we simulate a raw replace)
  replacement.sessions = [];
  const result = await storage.backupThenReplace(replacement, 200);
  assert.equal(result.ok, true);
  assert.deepEqual(storage.state.sessions, []);

  const undoResult = await storage.undoLastReplace(300);
  assert.equal(undoResult.ok, true);
  assert.deepEqual(storage.state.sessions, [{ id: "s1" }]);
  assert.equal(storage.state.settings.pinHash, pinHashBefore);
});

test("importJson keeps the device's own pinHash even though the imported blob has a different one", async () => {
  const idb = new IDBFactory();
  const storage = Storage.create({ indexedDB: idb, localStorage: makeLocalStorage(), dbName: "db4" });
  await storage.load();
  storage.state = seedState();
  await storage.save(() => {}, 50);
  const devicePinHash = storage.state.settings.pinHash;

  const foreign = Migrate.emptyState();
  foreign.settings.pinHash = "foreign-hash";
  foreign.settings.childName = "ילד אחר";
  foreign.sessions = [{ id: "s_foreign", planned: ["6x7"], firstTryCorrect: 1, coinsEarned: 5, masteredAfter: 0 }];

  const result = await storage.importJson(JSON.stringify(foreign), 100);
  assert.equal(result.ok, true);
  assert.equal(storage.state.settings.pinHash, devicePinHash);
  assert.equal(storage.state.settings.childName, "ילד אחר");
  assert.deepEqual(storage.state.sessions, [{ id: "s_foreign", planned: ["6x7"], firstTryCorrect: 1, coinsEarned: 5, masteredAfter: 0 }]);
});

test("[WP9 finding C] exportJson strips settings.pinHash/recoveryHash from the serialized backup but not from live state", async () => {
  const idb = new IDBFactory();
  const storage = Storage.create({ indexedDB: idb, localStorage: makeLocalStorage(), dbName: "db-export" });
  await storage.load();
  storage.state = seedState();
  storage.state.settings.recoveryHash = "recovery-salt:recovery-digest";
  await storage.save(() => {}, 50);

  const result = await storage.exportJson(100);
  assert.equal(result.ok, true);
  const parsed = JSON.parse(result.json);
  assert.equal(parsed.settings.pinHash, undefined);
  assert.equal(parsed.settings.recoveryHash, undefined);
  // Live in-memory state must still have its own PIN — only the serialized copy is stripped.
  assert.equal(storage.state.settings.pinHash, "salt:digest");
  assert.equal(storage.state.settings.recoveryHash, "recovery-salt:recovery-digest");
});

test("importJson rejects a malformed blob without touching state", async () => {
  const idb = new IDBFactory();
  const storage = Storage.create({ indexedDB: idb, localStorage: makeLocalStorage(), dbName: "db5" });
  await storage.load();
  storage.state = seedState();
  const before = JSON.stringify(storage.state);

  const result = await storage.importJson(JSON.stringify({ economy: { ledger: [{ id: "l1" }] } }), 100);
  assert.equal(result.ok, false);
  assert.ok(result.problems.length > 0);
  assert.equal(JSON.stringify(storage.state), before);
});

test("a failed save (IDB throwing) leaves in-memory state (incl. active) intact and surfaces an error", async () => {
  const idb = new IDBFactory();
  const storage = Storage.create({ indexedDB: idb, localStorage: makeLocalStorage(), dbName: "db6" });
  await storage.load();
  storage.state = seedState();
  storage.state.active = { id: "s_active", current: { key: "6x7" } };

  // break the db handle so the next save() throws
  const realDb = storage.db;
  storage.db = { transaction: () => { throw new Error("simulated IDB failure"); } };

  const result = await storage.save((s) => { s.settings.sound = false; }, 100);
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.equal(storage.state.active.id, "s_active"); // untouched
  assert.equal(storage.state.settings.sound, true); // mutation not applied

  storage.db = realDb;
});

// --- 2026-08-27: ratchet snapshot (last-good) ---

// --- 2026-08-27: last-good ratchet snapshot (data-loss guard) ---
function stateWithSessions(n) {
  const s = seedState();
  for (let i = 0; i < n; i++) s.sessions.push({ id: "s_" + i, startedAt: i, endedAt: i + 1, planned: ["1x2"], attempts: [], firstTryCorrect: 1, totalMs: 1, misses: [], coinsEarned: 1, perfect: false, masteredAfter: 0, unlocksEarned: [] });
  return s;
}

test("[lastgood] the snapshot never shrinks: a fresh empty state cannot overwrite a state with sessions", async () => {
  const localStorage = makeLocalStorage();
  const a = Storage.create({ indexedDB: new IDBFactory(), localStorage, dbName: "d1" });
  await a.load();
  a.state = stateWithSessions(5);
  await a.save((s) => { s.settings.sound = false; }, 100);
  assert.equal(a.readLastGood().state.sessions.length, 5);
  // a new, empty IDB (as if wiped) + a boot that saves an empty state must not touch the snapshot
  const b = Storage.create({ indexedDB: new IDBFactory(), localStorage, dbName: "d1" });
  localStorage.removeItem("mathtrainer.v1.mirror"); // mirror gone too
  await b.load();
  b.state = Migrate.emptyState();
  await b.save((s) => { s.settings.pinHash = "new:pin"; }, 200);
  assert.equal(b.readLastGood().state.sessions.length, 5, "snapshot still holds the 5 sessions");
});

test("[lastgood] setup-path restore (no current PIN) clears the snapshot's PIN so setup continues", async () => {
  const localStorage = makeLocalStorage();
  const a = Storage.create({ indexedDB: new IDBFactory(), localStorage, dbName: "d4" });
  await a.load();
  a.state = stateWithSessions(2);
  a.state.settings.pinHash = "old:pin"; a.state.settings.recoveryHash = "old:rec";
  await a.save((s) => {}, 100);
  const b = Storage.create({ indexedDB: new IDBFactory(), localStorage, dbName: "d4" });
  localStorage.removeItem("mathtrainer.v1.mirror");
  await b.load();
  b.state = Migrate.emptyState(); // setup screen state: no PIN
  const r = await b.restoreLastGood(300);
  assert.equal(r.ok, true);
  assert.equal(b.state.sessions.length, 2);
  assert.equal(b.state.settings.pinHash, null);
  assert.equal(b.state.settings.recoveryHash, null);
});

test("[lastgood] equal session count: the latest state wins; a deliberate reset clears the snapshot", async () => {
  const localStorage = makeLocalStorage();
  const a = Storage.create({ indexedDB: new IDBFactory(), localStorage, dbName: "d5" });
  await a.load();
  a.state = stateWithSessions(2);
  await a.save((s) => { s.settings.sound = false; }, 100);
  await a.save((s) => { s.settings.sound = true; }, 200);
  assert.equal(a.readLastGood().state.settings.sound, true);
  a.clearLastGood();
  assert.equal(a.readLastGood(), null);
  await a.save((s) => {}, 300); // a later save re-seeds the snapshot from the current state
  assert.equal(a.readLastGood().state.sessions.length, 2);
});

test("[lastgood] restoreLastGood brings the sessions back and keeps the PIN the parent just set", async () => {
  const localStorage = makeLocalStorage();
  const a = Storage.create({ indexedDB: new IDBFactory(), localStorage, dbName: "d2" });
  await a.load();
  a.state = stateWithSessions(3);
  a.state.settings.pinHash = "old:pin";
  await a.save((s) => { s.settings.sound = true; }, 100);
  const b = Storage.create({ indexedDB: new IDBFactory(), localStorage, dbName: "d2" });
  localStorage.removeItem("mathtrainer.v1.mirror");
  await b.load();
  b.state = Migrate.emptyState();
  await b.save((s) => { s.settings.pinHash = "new:pin"; s.settings.recoveryHash = "new:rec"; }, 200);
  const r = await b.restoreLastGood(300);
  assert.equal(r.ok, true);
  assert.equal(b.state.sessions.length, 3);
  assert.equal(b.state.settings.pinHash, "new:pin");
  assert.equal(b.state.settings.recoveryHash, "new:rec");
  assert.equal(b.state.settings.childName, "נועה");
});

test("[lastgood] a state with more sessions advances the snapshot", async () => {
  const localStorage = makeLocalStorage();
  const a = Storage.create({ indexedDB: new IDBFactory(), localStorage, dbName: "d3" });
  await a.load();
  a.state = stateWithSessions(2);
  await a.save((s) => {}, 100);
  await a.save((s) => { s.sessions.push({ id: "s_x", startedAt: 9, endedAt: 10, planned: ["1x2"], attempts: [], firstTryCorrect: 1, totalMs: 1, misses: [], coinsEarned: 1, perfect: false, masteredAfter: 0, unlocksEarned: [] }); }, 200);
  assert.equal(a.readLastGood().state.sessions.length, 3);
});
