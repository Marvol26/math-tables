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
  const key = "6x6"; // square (same tier as 6x7): no V2-DESIGN §8 mirror requirement
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

test("near-perfect = exactly NEAR_PERFECT_MISSES misses out of plannedLength (V2-DESIGN §3.3, scales with session size)", () => {
  assert.equal(CONFIG.NEAR_PERFECT_MISSES, 1);
  // 10-question session: 9/10 (1 miss) is near-perfect, 10/10 is perfect (not near-perfect), 8/10 is not.
  assert.equal(Economy.nearPerfectBonusAmount(9, 10), CONFIG.NEAR_PERFECT_BONUS);
  assert.equal(Economy.nearPerfectBonusAmount(10, 10), 0);
  assert.equal(Economy.nearPerfectBonusAmount(8, 10), 0);
  // 20-question session: near-perfect is 19/20, not 9/20 — the bonus scales with the plan size.
  assert.equal(Economy.nearPerfectBonusAmount(19, 20), CONFIG.NEAR_PERFECT_BONUS);
  assert.equal(Economy.nearPerfectBonusAmount(9, 20), 0);
  assert.equal(Economy.nearPerfectBonusAmount(20, 20), 0);
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

test("[V2-DESIGN §3.4] two 24-sticker albums, UNLOCK_COUNT 48, ids unique", () => {
  assert.equal(CONFIG.ALBUMS.length, 2);
  assert.equal(CONFIG.ALBUMS[0].id, "animals");
  assert.equal(CONFIG.ALBUMS[1].id, "adventure");
  assert.equal(CONFIG.ALBUMS[0].stickers.length, 24);
  assert.equal(CONFIG.ALBUMS[1].stickers.length, 24);
  assert.equal(CONFIG.UNLOCK_COUNT, 48);
  assert.equal(CONFIG.STICKERS.length, 48);
  assert.equal(new Set(CONFIG.STICKERS).size, 48); // every id unique across both albums
});

test("[V2-DESIGN §3.4] unlockThreshold exact album boundaries: n=24 -> 1980, n=25 -> 2005, n=48 -> 3960", () => {
  assert.equal(Economy.unlockThreshold(24), 1980);
  assert.equal(Economy.unlockThreshold(25), 2005);
  assert.equal(Economy.unlockThreshold(48), 3960);
});

test("[V2-DESIGN §3.4] newUnlocks reaches into album 2 once lifetime coins cross the album-1 boundary", () => {
  const state = emptyState();
  Economy.ledgerAppend(state, { id: "l_e1", t: 1, type: "earn", amount: 2005, ref: "s1", note: "" });
  state.economy.unlocked = CONFIG.STICKERS.slice(0, 24); // album 1 fully unlocked already
  const unlocks = Economy.newUnlocks(state);
  assert.deepEqual(unlocks, [CONFIG.STICKERS[24]]); // first sticker of album 2 ("rocket")
  assert.equal(CONFIG.STICKERS[24], "rocket");
});

test("[V2-DESIGN §3.4] goldenStickers: station k (MAP_PATH position) reached -> sticker k of album 1 is golden, only if unlocked", () => {
  const state = emptyState();
  state.map = { reached: {} };
  // MAP_PATH = [1, 2, 10, ...]; reach the first two stations (positions 1 and 2).
  state.map.reached[CONFIG.MAP_PATH[0]] = 1;
  state.map.reached[CONFIG.MAP_PATH[1]] = 2;
  const album1 = CONFIG.ALBUMS[0].stickers;
  // Neither sticker unlocked yet -> no golden reveal anywhere (no reveal of a locked sticker).
  assert.deepEqual(Economy.goldenStickers(state), []);
  // Unlock only the first of the two gilded stickers.
  state.economy.unlocked = [album1[0]];
  assert.deepEqual(Economy.goldenStickers(state), [album1[0]]);
  // Unlock both.
  state.economy.unlocked = [album1[0], album1[1]];
  assert.deepEqual(Economy.goldenStickers(state), [album1[0], album1[1]]);
});

// Package-1 closing review F3: the two assertions above reach only
// MAP_PATH[0]/[1] (tables 1, 2), where path POSITION (0/1) happens to equal
// (table-1) — so a mutant that gilds `album1[table - 1]` instead of the
// correct `album1[idx]` survives undetected. MAP_PATH[2] = table 10, where
// idx (2) and table-1 (9) diverge (album1[2] = "fox", album1[9] = "koala"),
// which kills that mutant.
test("[V2-DESIGN §3.4 / F3] goldenStickers gilds by PATH POSITION, not by table number: MAP_PATH[2] (table 10) gilds album1[2] (\"fox\"), never album1[9] (\"koala\")", () => {
  const state = emptyState();
  state.map = { reached: {} };
  state.map.reached[CONFIG.MAP_PATH[2]] = 1; // table 10, path position index 2
  const album1 = CONFIG.ALBUMS[0].stickers;
  assert.equal(CONFIG.MAP_PATH[2], 10, "sanity: this is the design's own path order");
  assert.equal(album1[2], "fox");
  assert.equal(album1[9], "koala");
  state.economy.unlocked = [album1[2], album1[9]]; // unlock BOTH candidates so only golden-ness distinguishes them
  assert.deepEqual(Economy.goldenStickers(state), [album1[2]]);
  assert.ok(!Economy.goldenStickers(state).includes(album1[9]), "koala (table-1 indexing) must NOT be golden");
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
