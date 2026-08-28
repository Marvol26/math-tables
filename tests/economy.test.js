const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG, Facts, Economy } = require("../core.js");

function emptyState() {
  return {
    facts: {},
    economy: { ledger: [], unlocked: [], rewards: [], requests: [] },
  };
}

test("retry earns 0 coins", () => {
  const state = emptyState();
  const coins = Economy.coinsFor(state, "6x7", { ok: true, retry: true, withinLimit: true });
  assert.equal(coins, 0);
});

test("a wrong answer earns 0 coins", () => {
  const state = emptyState();
  const coins = Economy.coinsFor(state, "6x7", { ok: false, retry: false, withinLimit: false });
  assert.equal(coins, 0);
});

test("within-limit doubles the base value", () => {
  const state = emptyState();
  const base = Economy.coinsFor(state, "6x7", { ok: true, retry: false, withinLimit: false });
  const doubled = Economy.coinsFor(state, "6x7", { ok: true, retry: false, withinLimit: true });
  assert.equal(base, 3);
  assert.equal(doubled, 6);
});

test("mastered facts pay 1 (2 within the limit)", () => {
  const state = emptyState();
  const key = "6x7";
  for (let i = 0; i < 3; i++) {
    Facts.updateFromAttempt(state, key, { ok: true, ms: 4000, asked: key, t: i, withinLimit: true, interrupted: false, retry: false });
  }
  assert.equal(Facts.mastery(state.facts[key]), "mastered");
  assert.equal(Economy.coinsFor(state, key, { ok: true, retry: false, withinLimit: false }), 1);
  assert.equal(Economy.coinsFor(state, key, { ok: true, retry: false, withinLimit: true }), 2);
});

test("perfectSeriesLength: consecutive perfect sessions ending with the most recent one", () => {
  const p = { perfect: true };
  const np = { perfect: false };
  assert.equal(Economy.perfectSeriesLength([]), 0);
  assert.equal(Economy.perfectSeriesLength([p, np]), 0);
  assert.equal(Economy.perfectSeriesLength([np, p]), 1);
  assert.equal(Economy.perfectSeriesLength([p, p, p]), 3);
  assert.equal(Economy.perfectSeriesLength([p, np, p, p]), 2);
  // old records without perfectSeries must work — only `.perfect` is read
  assert.equal(Economy.perfectSeriesLength([{ perfect: true }, { perfect: true }]), 2);
});

test("perfectSeriesExtra: 1st perfect +0, 2nd +5, 3rd+ +10 (last entry repeats)", () => {
  assert.equal(Economy.perfectSeriesExtra(1), 0);
  assert.equal(Economy.perfectSeriesExtra(2), 5);
  assert.equal(Economy.perfectSeriesExtra(3), 10);
  assert.equal(Economy.perfectSeriesExtra(7), 10);
});

test("9/10 first-try-correct earns the near-perfect bonus; other counts do not", () => {
  assert.equal(Economy.nearPerfectBonusAmount(9), CONFIG.NEAR_PERFECT_BONUS);
  assert.equal(Economy.nearPerfectBonusAmount(10), 0);
  assert.equal(Economy.nearPerfectBonusAmount(8), 0);
});

test("approving a request twice produces exactly one redeem entry", () => {
  const state = emptyState();
  state.economy.rewards.push({ id: "r1", name: "גלידה", cost: 10, active: true });
  Economy.ledgerAppend(state, { id: "l_earn1", t: 1, type: "earn", amount: 50, ref: "s1", note: "session" });
  Economy.requestReward(state, "r1", "q1", 2);

  const first = Economy.approveRequest(state, "q1", "l_q1_redeem", 3);
  assert.equal(first.ok, true);
  const second = Economy.approveRequest(state, "q1", "l_q1_redeem", 4);
  assert.equal(second.ok, false);

  const redeemEntries = state.economy.ledger.filter((e) => e.type === "redeem");
  assert.equal(redeemEntries.length, 1);
  assert.equal(redeemEntries[0].amount, -10);
});

test("approval with insufficient balance is rejected with a reason and does not touch the ledger", () => {
  const state = emptyState();
  state.economy.rewards.push({ id: "r1", name: "גלידה", cost: 100, active: true });
  Economy.ledgerAppend(state, { id: "l_earn1", t: 1, type: "earn", amount: 5, ref: "s1", note: "session" });
  Economy.requestReward(state, "r1", "q1", 2);

  const result = Economy.approveRequest(state, "q1", "l_q1_redeem", 3);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "insufficient balance");
  assert.equal(state.economy.ledger.length, 1);
  assert.equal(state.economy.requests[0].status, "requested");
});

test("deactivating (deleting) a reward leaves requests and ledger history intact", () => {
  const state = emptyState();
  state.economy.rewards.push({ id: "r1", name: "גלידה", cost: 10, active: true });
  Economy.ledgerAppend(state, { id: "l_earn1", t: 1, type: "earn", amount: 50, ref: "s1", note: "session" });
  Economy.requestReward(state, "r1", "q1", 2);
  Economy.approveRequest(state, "q1", "l_q1_redeem", 3);

  const requestsBefore = JSON.stringify(state.economy.requests);
  const ledgerBefore = JSON.stringify(state.economy.ledger);

  Economy.deactivateReward(state, "r1");

  assert.equal(state.economy.rewards[0].active, false);
  assert.equal(JSON.stringify(state.economy.requests), requestsBefore);
  assert.equal(JSON.stringify(state.economy.ledger), ledgerBefore);
});

test("ledgerAppend rejects a duplicate id", () => {
  const state = emptyState();
  const first = Economy.ledgerAppend(state, { id: "l_x", t: 1, type: "earn", amount: 3, ref: "s1", note: "" });
  const second = Economy.ledgerAppend(state, { id: "l_x", t: 2, type: "earn", amount: 3, ref: "s1", note: "" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(state.economy.ledger.length, 1);
});

test("unlockThreshold and newUnlocks follow the 25n + 5n(n-1)/2 curve", () => {
  assert.equal(Economy.unlockThreshold(1), 25);
  assert.equal(Economy.unlockThreshold(2), 55);
  assert.equal(Economy.unlockThreshold(3), 90);

  const state = emptyState();
  Economy.ledgerAppend(state, { id: "l_e1", t: 1, type: "earn", amount: 60, ref: "s1", note: "" });
  const unlocks = Economy.newUnlocks(state);
  assert.deepEqual(unlocks, [CONFIG.STICKERS[0], CONFIG.STICKERS[1]]);
});

test("[WP1-gate minor] approveRequest never marks a request approved if the ledger entry id collides (no free reward)", () => {
  const state = emptyState();
  state.economy.rewards.push({ id: "r1", name: "גלידה", cost: 10, active: true });
  Economy.ledgerAppend(state, { id: "l_earn1", t: 1, type: "earn", amount: 50, ref: "s1", note: "session" });
  // pre-seed a ledger entry with the id approveRequest will try to use
  Economy.ledgerAppend(state, { id: "l_collide", t: 2, type: "earn", amount: 0, ref: "x", note: "" });
  Economy.requestReward(state, "r1", "q1", 3);

  const result = Economy.approveRequest(state, "q1", "l_collide", 4);
  assert.equal(result.ok, false);
  assert.equal(state.economy.requests[0].status, "requested"); // not silently approved
  assert.equal(state.economy.ledger.filter((e) => e.type === "redeem").length, 0);
});

// --- Punch-list P11 (2026-08-26): double-tap guard ---
test("[P11] requestReward refuses a second pending request for the same reward", () => {
  const state = require("../core.js").Migrate.emptyState(0);
  state.economy.rewards.push({ id: "r1", name: "x", cost: 10, active: true });
  assert.equal(Economy.requestReward(state, "r1", "q1", 1).ok, true);
  const second = Economy.requestReward(state, "r1", "q2", 2);
  assert.equal(second.ok, false);
  assert.equal(state.economy.requests.length, 1);
  state.economy.requests[0].status = "rejected";
  assert.equal(Economy.requestReward(state, "r1", "q3", 3).ok, true, "a new request is allowed once the old one is processed");
});
