const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG, Facts, SessionCore } = require("../core.js");

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function freshState() {
  return {
    facts: {},
    economy: { ledger: [], unlocked: [], rewards: [], requests: [] },
    sessions: [],
    carryover: [],
    settings: { challengeOn: false, timeLimitSec: 10 },
  };
}

// Drives a full session to completion, answering every question correctly.
function playPerfectSession(state, rng, startAt) {
  SessionCore.start(state, rng, startAt);
  let t = startAt;
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const current = SessionCore.paint(state, t);
    if (!current) break;
    t += 100;
    SessionCore.submit(state, Facts.answer(current.asked), t, {});
  }
  return SessionCore.finish(state, t + 1);
}

// Drives a full session, missing exactly `missCount` distinct facts on their
// first attempt (retried correctly afterward) — for V2-DESIGN §3.3 near-perfect
// / stars fixtures that need an exact firstTryCorrect count independent of size.
function playSessionWithMisses(state, rng, startAt, missCount) {
  SessionCore.start(state, rng, startAt);
  let t = startAt;
  let missesLeft = missCount;
  const missedAlready = new Set();
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const current = SessionCore.paint(state, t);
    if (!current) break;
    t += 100;
    const correctAnswer = Facts.answer(current.asked);
    let answer = correctAnswer;
    if (!current.retry && missesLeft > 0 && !missedAlready.has(current.asked)) {
      missedAlready.add(current.asked);
      missesLeft--;
      answer = correctAnswer + 1; // wrong on the first attempt only
    }
    SessionCore.submit(state, answer, t, {});
  }
  return SessionCore.finish(state, t + 1);
}

test("a perfect session: 10/10, perfect=true, one earn entry + one perfect entry", () => {
  const state = freshState();
  const session = playPerfectSession(state, seededRng(1), 1000);
  assert.equal(session.firstTryCorrect, 10);
  assert.equal(session.perfect, true);
  assert.equal(state.sessions.length, 1);
  const perfectEntries = state.economy.ledger.filter((e) => e.id.endsWith("_perfect"));
  assert.equal(perfectEntries.length, 1);
  assert.equal(perfectEntries[0].amount, CONFIG.PERFECT_BONUS);
  assert.equal(state.active, null);
});

test("[S3-F M5] two separate 5-answer streaks within one 10-question perfect session mint cumulative _streak_1/_streak_2 ids", () => {
  const state = freshState();
  const session = playPerfectSession(state, seededRng(1), 1000);
  const streakEntries = state.economy.ledger.filter((e) => e.id.startsWith("l_" + session.id + "_streak_"));
  assert.deepEqual(streakEntries.map((e) => e.id), ["l_" + session.id + "_streak_1", "l_" + session.id + "_streak_2"]);
  streakEntries.forEach((e) => assert.equal(e.amount, CONFIG.STREAK_BONUS));
});

test("a wrong answer is pushed to retryQueue and appears at the end of the session", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(2), 1000);
  const firstAsked = state.active.planned[0];
  let t = 1000;

  // answer the first question wrong, the rest correctly
  for (let i = 0; i < state.active.planned.length; i++) {
    const current = SessionCore.paint(state, t);
    t += 100;
    if (current.asked === firstAsked && !current.retry) {
      SessionCore.submit(state, -1, t, {}); // guaranteed wrong
    } else {
      SessionCore.submit(state, Facts.answer(current.asked), t, {});
    }
  }
  assert.equal(state.active.queue.length, 0);
  assert.equal(state.active.retryQueue.length, 1);
  assert.equal(state.active.retryQueue[0], firstAsked);
});

test("wrong again on retry: item is pushed back to the end of retryQueue", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(3), 1000);
  const firstAsked = state.active.planned[0];
  let t = 1000;
  for (let i = 0; i < state.active.planned.length; i++) {
    const current = SessionCore.paint(state, t);
    t += 100;
    if (current.asked === firstAsked && !current.retry) {
      SessionCore.submit(state, -1, t, {});
    } else {
      SessionCore.submit(state, Facts.answer(current.asked), t, {});
    }
  }
  // now retry the missed one, wrong again
  const retryCurrent = SessionCore.paint(state, t);
  t += 100;
  assert.equal(retryCurrent.retry, true);
  SessionCore.submit(state, -1, t, {});
  assert.equal(state.active.retryQueue.length, 1);
  assert.equal(state.active.retryQueue[0], firstAsked);

  // finally answer correctly
  const finalCurrent = SessionCore.paint(state, t);
  t += 100;
  SessionCore.submit(state, Facts.answer(finalCurrent.asked), t, {});
  assert.equal(state.active.retryQueue.length, 0);
});

test("retry attempts are flagged retry:true and earn 0 coins; the miss is stored once in session.misses", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(4), 1000);
  const firstAsked = state.active.planned[0];
  let t = 1000;
  for (let i = 0; i < state.active.planned.length; i++) {
    const current = SessionCore.paint(state, t);
    t += 100;
    if (current.asked === firstAsked && !current.retry) {
      SessionCore.submit(state, -1, t, {});
    } else {
      SessionCore.submit(state, Facts.answer(current.asked), t, {});
    }
  }
  const retryCurrent = SessionCore.paint(state, t);
  t += 100;
  SessionCore.submit(state, Facts.answer(retryCurrent.asked), t, {});
  const session = SessionCore.finish(state, t + 1);

  const retryAttempt = session.attempts.find((a) => a.retry);
  assert.ok(retryAttempt);
  assert.equal(retryAttempt.coins, 0);
  assert.equal(session.misses.length, 1);
  assert.equal(session.firstTryCorrect, 9);
});

test("a question resumed after a relaunch is deferred to the end of its queue and re-painted fresh (live clock, no restart of the same question)", () => {
  const rng = () => 0.5;
  const state = require("../core.js").Migrate.emptyState();
  SessionCore.start(state, rng, 1000);
  const first = SessionCore.paint(state, 1000);
  assert.equal(first.interrupted, false);
  const firstAsked = first.asked;
  const queueBefore = state.active.queue.slice();
  const resumed = SessionCore.paint(state, 50000); // relaunch: paint again with a leftover current
  assert.notEqual(resumed.asked, firstAsked, "a different question is shown first");
  assert.equal(resumed.shownAt, 50000);
  assert.equal(resumed.interrupted, false);
  assert.equal(state.active.queue[state.active.queue.length - 1], firstAsked, "the interrupted fact went to the end of the queue");
  assert.equal(state.active.queue.length, queueBefore.length, "nothing lost, nothing duplicated");
  const result = SessionCore.submit(state, Facts.answer(resumed.asked), 52000, {});
  assert.equal(result.ok, true);
  assert.equal(result.interrupted, false);
});

test("a submit while the app is hidden still marks the attempt interrupted (base coins only)", () => {
  const rng = () => 0.5;
  const state = require("../core.js").Migrate.emptyState();
  state.settings.challengeOn = true; state.settings.timeLimitSec = 10;
  SessionCore.start(state, rng, 1000);
  const q = SessionCore.paint(state, 1000);
  SessionCore.markInterrupted(state);
  assert.equal(state.active.current.interrupted, true);
  const result = SessionCore.submit(state, Facts.answer(q.asked), 2000, {});
  assert.equal(result.interrupted, true);
  assert.equal(result.withinLimit, false);
});

test("markInterrupted (visibilitychange) flags the current question independently of submit", () => {
  const state = freshState();
  state.settings.challengeOn = true;
  SessionCore.start(state, seededRng(6), 1000);
  const current = SessionCore.paint(state, 1000);
  SessionCore.markInterrupted(state);
  assert.equal(state.active.current.interrupted, true);
  const result = SessionCore.submit(state, Facts.answer(current.asked), 1500, {});
  assert.equal(result.interrupted, true);
});

test("finish() is idempotent: calling it twice for the same session id produces one session and one earn entry", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(7), 1000);
  let t = 1000;
  const activeId = state.active.id;
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const current = SessionCore.paint(state, t);
    t += 100;
    SessionCore.submit(state, Facts.answer(current.asked), t, {});
  }
  const activeSnapshotBeforeFinish = JSON.parse(JSON.stringify(state.active));
  const first = SessionCore.finish(state, t + 1);
  assert.equal(first.id, activeId);
  assert.equal(state.sessions.length, 1);

  // simulate a caller re-invoking finish with a stale (not-yet-nulled) active reference
  state.active = activeSnapshotBeforeFinish;
  const second = SessionCore.finish(state, t + 500);
  assert.equal(second, null);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.active, null);

  const earnEntries = state.economy.ledger.filter((e) => e.id === "l_" + activeId + "_earn");
  assert.equal(earnEntries.length, 1);
});

test("suspend/resume keeps the same plan and the same current question position", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(8), 1000);
  const plannedBefore = state.active.planned.slice();
  const painted = SessionCore.paint(state, 1000);

  // simulate app close/reopen via full JSON round-trip
  const reloaded = JSON.parse(JSON.stringify(state));

  assert.deepEqual(reloaded.active.planned, plannedBefore);
  assert.equal(reloaded.active.current.key, painted.key);
  assert.equal(reloaded.active.current.asked, painted.asked);
  assert.equal(reloaded.active.queue.length, state.active.queue.length);
});

// --- WP1-gate regression tests (fixes for M1/M3 found by the strong-model review) ---

test("[WP1-gate M1] start() refuses to clobber an in-flight session; the original session, its attempts and journal survive the throw", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(9), 1000);
  const originalId = state.active.id;
  const originalPlanned = state.active.planned.slice();
  const current = SessionCore.paint(state, 1000);
  SessionCore.submit(state, Facts.answer(current.asked), 1100, {});
  const attemptsBefore = JSON.stringify(state.active.attempts);

  assert.throws(() => SessionCore.start(state, seededRng(10), 5000), (err) => err.code === "ACTIVE_SESSION_EXISTS");

  assert.equal(state.active.id, originalId);
  assert.deepEqual(state.active.planned, originalPlanned);
  assert.equal(JSON.stringify(state.active.attempts), attemptsBefore);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.economy.ledger.length, 0);
});

test("[WP1-gate M3] coins paid for the attempt that flips a fact to mastered match the value shown before that attempt (tier value, not mastered-1)", () => {
  const state = freshState();
  const key = "6x7";
  // two prior fast-correct attempts: fact is "learning", displayed value = tier 3 (6x7 is tier 3)
  Facts.updateFromAttempt(state, key, { ok: true, ms: 3000, asked: key, t: 1, withinLimit: false, interrupted: false, retry: false });
  Facts.updateFromAttempt(state, key, { ok: true, ms: 3000, asked: key, t: 2, withinLimit: false, interrupted: false, retry: false });
  assert.equal(Facts.mastery(state.facts[key]), "learning");
  assert.equal(Facts.value(state, key), 3);

  state.carryover = [key]; // force this fact into the plan
  SessionCore.start(state, seededRng(11), 2000);
  let t = 2000;
  // drive the plan, answering `key` correctly (this is the 3rd fast-correct attempt -> flips to mastered)
  while (state.active.queue.length > 0) {
    const current = SessionCore.paint(state, t);
    t += 100;
    SessionCore.submit(state, Facts.answer(current.asked), t, {});
  }
  const keyAttempt = state.active.attempts.find((a) => a.key === key);
  assert.equal(Facts.mastery(state.facts[key]), "mastered"); // this attempt did flip it
  assert.equal(keyAttempt.coins, 3); // but it was paid the pre-attempt (tier) value, not the post-attempt mastered value of 1
});

test("[WP1-gate M3] a fact that demotes FROM mastered on this very attempt (slow but correct) pays the pre-attempt mastered value, not the post-attempt tier value", () => {
  const state = freshState();
  const key = "6x7";
  // V2-DESIGN §8: seed the mirror direction first (earlier `t`, so it falls
  // OUTSIDE the last-3 window below and leaves the median math untouched) so
  // the fact can reach "mastered" at all.
  Facts.updateFromAttempt(state, key, { ok: true, ms: 2000, asked: "7x6", t: -1, withinLimit: false, interrupted: false, retry: false });
  // recent tail = [4000, 9000, 4000]: last-3 median = 4000ms -> mastered (pre-attempt), value shown = 1
  [4000, 9000, 4000].forEach((ms, i) => {
    Facts.updateFromAttempt(state, key, { ok: true, ms: ms, asked: key, t: i, withinLimit: false, interrupted: false, retry: false });
  });
  assert.equal(Facts.mastery(state.facts[key]), "mastered");
  assert.equal(Facts.value(state, key), 1);

  state.carryover = [key];
  SessionCore.start(state, seededRng(12), 2000);
  let t = 2000;
  while (state.active.queue.length > 0) {
    const current = SessionCore.paint(state, t);
    // this attempt takes 9000ms for `key` (pushes last-3 median to 9000 -> demotes),
    // and a trivial 100ms for every other planned fact.
    const delay = current.key === key ? 9000 : 100;
    const submitAt = t + delay;
    SessionCore.submit(state, Facts.answer(current.asked), submitAt, {});
    t = submitAt;
  }
  assert.equal(Facts.mastery(state.facts[key]), "learning"); // this attempt did demote it
  const keyAttempt = state.active.attempts.find((a) => a.key === key);
  assert.equal(keyAttempt.coins, 1); // but paid the pre-attempt (mastered) value that was on screen, not the post-attempt tier value of 3
});

test("[WP1-gate test-gap] carryover overflow survives an intervening finish(): unconsumed items reappear, misses-first, deduped", () => {
  const state = freshState();
  state.carryover = [
    "1x1", "1x2", "1x3", "1x4", "1x5", "1x6", "1x7", "1x8", "1x9", "1x10",
    "2x2", "2x3", "2x4",
  ];
  SessionCore.start(state, seededRng(13), 1000);
  const planned = state.active.planned.slice();
  let t = 1000;
  const missedAsked = planned[0]; // miss the first planned question, answer the rest correctly
  const [ma, mb] = missedAsked.split("x").map(Number);
  const missedKey = Facts.key(ma, mb);
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const current = SessionCore.paint(state, t);
    t += 100;
    if (current.asked === missedAsked && !current.retry) {
      SessionCore.submit(state, -1, t, {});
    } else {
      SessionCore.submit(state, Facts.answer(current.asked), t, {});
    }
  }
  const session = SessionCore.finish(state, t + 1);

  assert.deepEqual(session.misses, [missedKey]);
  // next carryover = today's miss first, then the 3 unconsumed overflow items, in order
  assert.deepEqual(state.carryover, [missedKey, "2x2", "2x3", "2x4"]);
});

// D2 (Marat 2026-08-28): the "first perfect of the day only" cap is gone —
// every perfect round pays the perfect bonus, and a 2nd perfect in a row
// (same day or not) also pays the series extra.
test("two perfect sessions on the same day BOTH get the perfect bonus (the daily cap is gone)", () => {
  const state = freshState();
  const morning = new Date(2026, 7, 25, 9, 0, 0).getTime();
  const laterSameDay = new Date(2026, 7, 25, 20, 0, 0).getTime();

  const s1 = playPerfectSession(state, seededRng(14), morning);
  assert.equal(s1.perfect, true);
  assert.equal(s1.perfectSeries, 1);

  const s2 = playPerfectSession(state, seededRng(15), laterSameDay);
  assert.equal(s2.perfect, true);
  assert.equal(s2.perfectSeries, 2);

  const perfectEntries = state.economy.ledger.filter((e) => e.id.endsWith("_perfect"));
  assert.equal(perfectEntries.length, 2);
  const seriesEntries = state.economy.ledger.filter((e) => e.id.endsWith("_series"));
  assert.equal(seriesEntries.length, 1);
  assert.equal(seriesEntries[0].amount, CONFIG.PERFECT_SERIES_EXTRA[1]);
});

test("[S3-F M2b] within a session, the _perfect ledger entry is appended BEFORE the _series entry", () => {
  const state = freshState();
  const morning = new Date(2026, 7, 25, 9, 0, 0).getTime();
  const laterSameDay = new Date(2026, 7, 25, 20, 0, 0).getTime();
  playPerfectSession(state, seededRng(14), morning); // s1: series=1, no _series entry yet
  const s2 = playPerfectSession(state, seededRng(15), laterSameDay); // s2: series=2, gets both
  const perfectIdx = state.economy.ledger.findIndex((e) => e.id === "l_" + s2.id + "_perfect");
  const seriesIdx = state.economy.ledger.findIndex((e) => e.id === "l_" + s2.id + "_series");
  assert.notEqual(perfectIdx, -1);
  assert.notEqual(seriesIdx, -1);
  assert.ok(perfectIdx < seriesIdx, "_perfect must land in the ledger before _series within the same session");
});

test("perfect series: 3 perfect in a row, then a 9/10, then a perfect one — series and ledger track correctly", () => {
  const state = freshState();
  let t = 1000;

  const s1 = playPerfectSession(state, seededRng(20), t); t += 100000;
  const s2 = playPerfectSession(state, seededRng(21), t); t += 100000;
  const s3 = playPerfectSession(state, seededRng(22), t); t += 100000;

  // session 4: 9/10 (miss the first question on its first try)
  SessionCore.start(state, seededRng(23), t);
  const firstAsked4 = state.active.planned[0];
  let missedOnce = false;
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const current = SessionCore.paint(state, t);
    t += 100;
    if (current.asked === firstAsked4 && !current.retry && !missedOnce) {
      missedOnce = true;
      SessionCore.submit(state, -1, t, {});
    } else {
      SessionCore.submit(state, Facts.answer(current.asked), t, {});
    }
  }
  const s4 = SessionCore.finish(state, t + 1);
  t += 100000;

  const s5 = playPerfectSession(state, seededRng(24), t);

  assert.deepEqual([s1.perfectSeries, s2.perfectSeries, s3.perfectSeries, s4.perfectSeries, s5.perfectSeries], [1, 2, 3, 0, 1]);

  function entryFor(session, suffix) {
    return state.economy.ledger.find((e) => e.id === "l_" + session.id + "_" + suffix);
  }
  assert.equal(entryFor(s1, "perfect").amount, CONFIG.PERFECT_BONUS);
  assert.equal(entryFor(s1, "series"), undefined);

  assert.equal(entryFor(s2, "perfect").amount, CONFIG.PERFECT_BONUS);
  assert.equal(entryFor(s2, "series").amount, 5);

  assert.equal(entryFor(s3, "perfect").amount, CONFIG.PERFECT_BONUS);
  assert.equal(entryFor(s3, "series").amount, 10);

  assert.equal(entryFor(s4, "perfect"), undefined);
  assert.equal(entryFor(s4, "near").amount, CONFIG.NEAR_PERFECT_BONUS);

  assert.equal(entryFor(s5, "perfect").amount, CONFIG.PERFECT_BONUS);
  assert.equal(entryFor(s5, "series"), undefined);
});

test("perfect series counts across game modes: a perfect falling session after a perfect typed one is series 2", () => {
  const state = freshState();
  state.settings.falling = { enabled: true, durationSec: 8, options: 4 };
  let t = 1000;

  const s1 = playPerfectSession(state, seededRng(25), t);
  assert.equal(s1.perfectSeries, 1);
  t += 100000;

  SessionCore.start(state, seededRng(26), t, { mode: "falling" });
  while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
    const current = SessionCore.paint(state, t);
    t += 100;
    SessionCore.submit(state, Facts.answer(current.asked), t, {});
  }
  const s2 = SessionCore.finish(state, t + 1);

  assert.equal(s2.mode, "falling");
  assert.equal(s2.perfect, true);
  assert.equal(s2.perfectSeries, 2);
  const seriesEntry = state.economy.ledger.find((e) => e.id === "l_" + s2.id + "_series");
  assert.ok(seriesEntry);
  assert.equal(seriesEntry.amount, 5);
});

// --- Closing review 2026-08-26: submit() exposes retry/withinLimit for the UI ---
test("[review] submit result carries withinLimit and retry flags", () => {
  const { Migrate, SessionCore, Facts } = require("../core.js");
  const state = Migrate.emptyState(0);
  state.settings.challengeOn = true;
  state.settings.timeLimitSec = 10;
  SessionCore.start(state, () => 0.5, 1000);
  SessionCore.paint(state, 1000);
  const asked = state.active.current.asked;
  const fast = SessionCore.submit(state, Facts.answer(asked), 3000, {});
  assert.equal(fast.ok, true);
  assert.equal(fast.asked, asked, "submit result names the fact asked (used by the wrong-answer helper)");
  assert.equal(fast.withinLimit, true);
  assert.equal(fast.retry, false);
  SessionCore.paint(state, 4000);
  const wrong = SessionCore.submit(state, -1, 5000, {});
  assert.equal(wrong.ok, false);
  // drain the queue correctly, then the retry comes back
  while (state.active.queue.length > 0) {
    SessionCore.paint(state, 6000);
    SessionCore.submit(state, Facts.answer(state.active.current.asked), 6500, {});
  }
  SessionCore.paint(state, 7000);
  assert.equal(state.active.current.retry, true);
  const retryResult = SessionCore.submit(state, Facts.answer(state.active.current.asked), 7500, {});
  assert.equal(retryResult.ok, true);
  assert.equal(retryResult.retry, true);
});

test("[S3-F M8] finish() unlocks a sticker whose threshold is crossed by THIS session's own coins, not only pre-existing lifetime coins", () => {
  // unlockThreshold(1) = 25; a solo perfect session with this rng earns 19
  // (verified: 10 base + 4 streak + 5 perfect) — below threshold on its own.
  // Seed 20 pre-existing lifetime coins (below threshold) so the crossing
  // happens only once THIS session's ledger entries (earn/streak/perfect,
  // appended by applyBonuses) are counted — pins Economy.newUnlocks() being
  // called AFTER those appends, not before.
  const state = freshState();
  state.economy.ledger.push({ id: "l_seed_earn", t: 500, type: "earn", amount: 20, ref: "seed", note: "seed" });
  const session = playPerfectSession(state, seededRng(1), 1000);
  assert.ok(session.coinsEarned > 0);
  assert.ok(20 + session.coinsEarned >= CONFIG.UNLOCK_BASE, "this fixture must actually cross unlockThreshold(1) this session");
  assert.deepEqual(session.unlocksEarned, [CONFIG.STICKERS[0]]);
  assert.ok(state.economy.unlocked.includes(CONFIG.STICKERS[0]));
});

// --------------------------------------------------------------------
// V2-DESIGN §3.3 — session size 10-20 (immutable per-plan)
// --------------------------------------------------------------------

test("[V2-DESIGN §3.3] settings.sessionSize is read ONCE at start(): active.planned.length reflects it, and stays fixed even if settings change mid-session", () => {
  const state = freshState();
  state.settings.sessionSize = 20;
  SessionCore.start(state, seededRng(30), 1000);
  assert.equal(state.active.planned.length, 20);
  assert.equal(state.active.queue.length, 20);
  // Slider moved while this session is in flight: refreshSettings() must never touch planned.
  state.settings.sessionSize = 10;
  SessionCore.refreshSettings(state);
  assert.equal(state.active.planned.length, 20, "active.planned.length is the only denominator, fixed at start()");
});

test("[V2-DESIGN §3.3] default sessionSize (absent from settings) is CONFIG.SESSION_SIZE_DEFAULT = 10", () => {
  const state = freshState();
  delete state.settings.sessionSize;
  SessionCore.start(state, seededRng(31), 1000);
  assert.equal(state.active.planned.length, CONFIG.SESSION_SIZE_DEFAULT);
  assert.equal(CONFIG.SESSION_SIZE_DEFAULT, 10);
});

test("[V2-DESIGN §3.3] resolveSessionSize clamps out-of-bounds/garbage values into [MIN, MAX]", () => {
  const tooBig = freshState(); tooBig.settings.sessionSize = 999;
  assert.equal(SessionCore.resolveSessionSize(tooBig), CONFIG.SESSION_SIZE_MAX);
  const tooSmall = freshState(); tooSmall.settings.sessionSize = 1;
  assert.equal(SessionCore.resolveSessionSize(tooSmall), CONFIG.SESSION_SIZE_MIN);
  const garbage = freshState(); garbage.settings.sessionSize = "twenty";
  assert.equal(SessionCore.resolveSessionSize(garbage), CONFIG.SESSION_SIZE_DEFAULT);
});

test("[V2-DESIGN §3.3] 9/10 and 19/20 (exactly NEAR_PERFECT_MISSES=1 miss) earn the near-perfect bonus; 8/10 and 16/20 do not", () => {
  const s10miss1 = freshState();
  const r10miss1 = playSessionWithMisses(s10miss1, seededRng(32), 1000, 1);
  assert.equal(r10miss1.firstTryCorrect, 9);
  assert.ok(s10miss1.economy.ledger.some((e) => e.note === "near-perfect"), "9/10 must mint the near-perfect bonus");

  const s10miss2 = freshState();
  const r10miss2 = playSessionWithMisses(s10miss2, seededRng(33), 1000, 2);
  assert.equal(r10miss2.firstTryCorrect, 8);
  assert.ok(!s10miss2.economy.ledger.some((e) => e.note === "near-perfect"), "8/10 must NOT mint the near-perfect bonus");

  const s20miss1 = freshState(); s20miss1.settings.sessionSize = 20;
  const r20miss1 = playSessionWithMisses(s20miss1, seededRng(34), 1000, 1);
  assert.equal(r20miss1.firstTryCorrect, 19);
  assert.equal(r20miss1.planned.length, 20);
  assert.ok(s20miss1.economy.ledger.some((e) => e.note === "near-perfect"), "19/20 must mint the near-perfect bonus (scales with size)");

  const s20miss4 = freshState(); s20miss4.settings.sessionSize = 20;
  const r20miss4 = playSessionWithMisses(s20miss4, seededRng(35), 1000, 4);
  assert.equal(r20miss4.firstTryCorrect, 16);
  assert.ok(!s20miss4.economy.ledger.some((e) => e.note === "near-perfect"), "16/20 must NOT mint the near-perfect bonus");
});

test("[V2-DESIGN §3.3] carryover: leftover is computed by KEY (carryoverTaken), not by slicing at a fixed size — an old 10-question journal finishes correctly after the slider moves to 20, and vice versa", () => {
  // Legacy journal: started before this batch, so no carryoverTaken field on
  // state.active (simulates an in-flight session loaded from an old backup).
  const legacy = freshState();
  legacy.carryover = ["1x1", "1x2", "1x3"];
  SessionCore.start(legacy, seededRng(36), 1000);
  delete legacy.active.carryoverTaken; // simulate a pre-this-batch journal
  let t = 1000;
  while (legacy.active.queue.length > 0 || legacy.active.retryQueue.length > 0) {
    const current = SessionCore.paint(legacy, t);
    if (!current) break;
    t += 100;
    // Miss every first attempt (so all facts become carryover candidates) but
    // answer retries correctly, or the retry queue never drains.
    const answer = current.retry ? Facts.answer(current.asked) : Facts.answer(current.asked) + 1;
    SessionCore.submit(legacy, answer, t, {});
  }
  // legacy fallback = first planned.length (10) carryover keys "taken" -> since
  // all 3 original carryover keys were <= 10 and got planned, leftover from
  // state.carryover is empty; next carryover = this session's own misses.
  const before = legacy.sessions.length;
  SessionCore.finish(legacy, t + 1);
  assert.equal(legacy.sessions.length, before + 1);
  assert.ok(legacy.carryover.length > 0, "misses repopulate carryover even under the legacy fallback");

  // Now the forward case: slider moved 10 -> 20 with real carryoverTaken recorded.
  const grown = freshState();
  grown.carryover = ["2x2", "2x3"];
  grown.settings.sessionSize = 20;
  SessionCore.start(grown, seededRng(37), 2000);
  assert.deepEqual(grown.active.carryoverTaken.slice().sort(), ["2x2", "2x3"].sort());
  let t2 = 2000;
  while (grown.active.queue.length > 0 || grown.active.retryQueue.length > 0) {
    const current = SessionCore.paint(grown, t2);
    if (!current) break;
    t2 += 100;
    SessionCore.submit(grown, Facts.answer(current.asked), t2, {});
  }
  SessionCore.finish(grown, t2 + 1);
  assert.deepEqual(grown.carryover, [], "fully-consumed, fully-correct carryover leaves nothing behind");
});

test("[V2-DESIGN §3.3] perfect-series continuity holds across different session sizes", () => {
  const state = freshState();
  const s1 = playPerfectSession(state, seededRng(38), 1000); // size 10 (default)
  assert.equal(s1.perfectSeries, 1);
  state.settings.sessionSize = 20;
  const s2 = playPerfectSession(state, seededRng(39), 2000); // size 20
  assert.equal(s2.perfectSeries, 2);
  state.settings.sessionSize = 10;
  const s3 = playPerfectSession(state, seededRng(40), 3000); // back to size 10
  assert.equal(s3.perfectSeries, 3);
});

// --- V2-DESIGN §8 amended 2026-08-29, closing-review MEDIUM ---
// `current.mirror` used to be adjacency-only (previous planned item shares
// the canonical key). That is wrong in two cases: (a) a deferred/resumed
// first-of-pair paints its neighbour (the true second direction) as if it
// were the second of the pair, even though the first was never answered;
// (b) a missed mirror question's own retry re-shows the flag. Both tests
// fail against the pre-fix (adjacency-only) code.

function mirrorPairJournal() {
  return {
    id: "s1",
    startedAt: 1000,
    mode: "typed",
    settingsSnapshot: { challengeOn: false, timeLimitSec: 10 },
    planned: ["6x7", "7x6"],
    queue: ["6x7", "7x6"],
    retryQueue: [],
    attempts: [],
    current: null,
    deferred: [],
  };
}

test("[§8 MEDIUM] a deferred first-of-pair does not make its neighbour paint with a false mirror flag", () => {
  const state = { facts: {}, active: mirrorPairJournal() };
  const c1 = SessionCore.paint(state, 1000);
  assert.equal(c1.asked, "6x7");
  assert.equal(c1.mirror, false);
  SessionCore.deferCurrent(state); // relaunch mid-question — "6x7" never answered
  const c2 = SessionCore.paint(state, 2000);
  assert.equal(c2.asked, "7x6", "the deferred item moves to the end; its neighbour (the mirror direction) is asked next");
  assert.equal(c2.mirror, false, "the true first-of-pair was never answered — no false mirror flag");
});

test("[§8 MEDIUM] a missed mirror question's own retry does not re-show the mirror flag", () => {
  const state = { facts: {}, active: mirrorPairJournal() };
  const c1 = SessionCore.paint(state, 1000);
  SessionCore.submit(state, Facts.answer(c1.asked), 1100, {}); // correct: first of pair answered
  const c2 = SessionCore.paint(state, 1200);
  assert.equal(c2.asked, "7x6");
  assert.equal(c2.mirror, true, "sanity: the second of the pair IS flagged once the first was actually answered");
  SessionCore.submit(state, Facts.answer(c2.asked) + 1, 1300, {}); // miss it
  const c3 = SessionCore.paint(state, 1400); // retry
  assert.equal(c3.retry, true);
  assert.equal(c3.mirror, false, "a retry of the mirror question must not re-show the hint");
});
