const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG, Facts, Economy, Stats } = require("../core.js");

function fixtureState() {
  const state = {
    facts: {},
    economy: { ledger: [], unlocked: [], rewards: [], requests: [] },
    sessions: [],
    carryover: [],
    settings: { challengeOn: false, timeLimitSec: 10 },
  };

  // "6x7" mastered
  for (let i = 0; i < 3; i++) {
    Facts.updateFromAttempt(state, "6x7", { ok: true, ms: 3000, asked: "6x7", t: i, withinLimit: true, interrupted: false, retry: false });
  }
  // "3x4" learning, weaker (one miss)
  Facts.updateFromAttempt(state, "3x4", { ok: true, ms: 5000, asked: "3x4", t: 1, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, "3x4", { ok: false, ms: 6000, asked: "4x3", t: 2, withinLimit: false, interrupted: false, retry: false });

  Economy.ledgerAppend(state, { id: "l_e1", t: 1, type: "earn", amount: 20, ref: "s1", note: "" });

  state.sessions.push({
    id: "s1",
    startedAt: 1,
    endedAt: 2,
    abandoned: false,
    challengeOn: false,
    timeLimitSec: 10,
    planned: ["1x1", "1x2", "1x3", "1x4", "1x5", "1x6", "1x7", "1x8", "1x9", "1x10"],
    attempts: [
      { key: "1x1", asked: "1x1", answer: 1, ok: true, ms: 2000, retry: false, withinLimit: true, interrupted: false, coins: 1, t: 1 },
      { key: "1x2", asked: "1x2", answer: 2, ok: true, ms: 50000, retry: false, withinLimit: false, interrupted: false, coins: 1, t: 1 },
      { key: "1x3", asked: "1x3", answer: 3, ok: true, ms: 999999, retry: false, withinLimit: false, interrupted: true, coins: 1, t: 1 },
    ],
    firstTryCorrect: 9,
    totalMs: 1000,
    misses: ["1x4"],
    coinsEarned: 20,
    perfect: false,
    masteredAfter: 1,
    unlocksEarned: [],
  });

  return state;
}

test("perFactTable returns all 55 facts with mastery/accuracy/medianMs derived from first attempts", () => {
  const state = fixtureState();
  const table = Stats.perFactTable(state);
  assert.equal(table.length, 55);
  const mastered = table.find((f) => f.key === "6x7");
  assert.equal(mastered.mastery, "mastered");
  assert.equal(mastered.attempts, 3);
  const learning = table.find((f) => f.key === "3x4");
  assert.equal(learning.mastery, "learning");
  assert.equal(learning.accuracy, 0.5);
});

test("sessionAvgMs excludes retries and interrupted attempts, and clamps at 30s", () => {
  const state = fixtureState();
  const avg = Stats.sessionAvgMs(state.sessions[0]);
  // eligible: 2000ms and clamp(50000)=30000ms -> avg = (2000+30000)/2 = 16000
  assert.equal(avg, 16000);
});

test("trends() returns parallel arrays for the last n sessions; per-mode accuracy/avgMs, all-mode coins/masteredCount", () => {
  const state = fixtureState();
  const trends = Stats.trends(state, 30);
  assert.equal(trends.accuracy.typed.length, 1);
  assert.equal(trends.accuracy.typed[0], 0.9);
  assert.deepEqual(trends.accuracy.falling, [null]);
  assert.deepEqual(trends.accuracy.tetris, [null]);
  assert.equal(trends.coins[0], 20);
  assert.equal(trends.masteredCount[0], 1);
  assert.deepEqual(trends.modes, ["typed"]);
});

test("heatmap: mirrored cells (a,b) and (b,a) are identical", () => {
  const state = fixtureState();
  const grid = Stats.heatmap(state);
  assert.deepEqual(grid[5][6], grid[6][5]); // a=6,b=7 vs a=7,b=6 (0-indexed rows 5/6 -> values 6/7)
  assert.equal(grid[5][6].key, "6x7");
  assert.equal(grid[5][6].mastery, "mastered");
});

test("weakest(): returns attempted, non-mastered facts ordered by weakness, mastered facts excluded", () => {
  const state = fixtureState();
  const weakest = Stats.weakest(state, 1000, 8);
  assert.ok(weakest.includes("3x4"));
  assert.ok(!weakest.includes("6x7"));
});

test("totals(): lifetime coins, mastered count, and daily streak", () => {
  const state = fixtureState();
  const oneDay = 24 * 60 * 60 * 1000;
  const today = new Date(2026, 7, 25, 10, 0, 0).getTime();
  state.sessions[0].endedAt = today;
  const totals = Stats.totals(state, today);
  assert.equal(totals.totalSessions, 1);
  assert.equal(totals.lifetimeCoins, 20);
  assert.equal(totals.masteredCount, 1);
  assert.equal(totals.dailyStreak, 1);

  // no session today or yesterday -> streak resets to 0
  const totalsLater = Stats.totals(state, today + 3 * oneDay);
  assert.equal(totalsLater.dailyStreak, 0);

  // played today AND yesterday -> streak of 2
  state.sessions.push({ ...state.sessions[0], id: "s0", endedAt: today - oneDay });
  const totalsTwoDays = Stats.totals(state, today);
  assert.equal(totalsTwoDays.dailyStreak, 2);
});

test("[WP1-gate M2] factMedianMs/perFactTable use only the last 3 correct, non-interrupted first attempts (DESIGN §7) — a miss or an interrupted resume never poisons the displayed speed", () => {
  const fact = {
    attempts: 5,
    correct: 4,
    lastSeen: 5,
    recent: [
      { ok: true, ms: 4000, asked: "6x7", t: 1, withinLimit: true, interrupted: false },
      { ok: false, ms: 2000, asked: "6x7", t: 2, withinLimit: false, interrupted: false }, // a miss must not enter the median window
      { ok: true, ms: 999999, asked: "6x7", t: 3, withinLimit: false, interrupted: true }, // interrupted: excluded even though ok=true
      { ok: true, ms: 4000, asked: "6x7", t: 4, withinLimit: true, interrupted: false },
      { ok: true, ms: 4000, asked: "6x7", t: 5, withinLimit: true, interrupted: false },
    ],
  };
  // eligible (ok && !interrupted), last 3: [4000 (t1), 4000 (t4), 4000 (t5)] -> median 4000
  assert.equal(Stats.factMedianMs(fact), 4000);

  const state = { facts: { "6x7": fact } };
  const row = Stats.perFactTable(state).find((r) => r.key === "6x7");
  assert.equal(row.medianMs, 4000);
});
