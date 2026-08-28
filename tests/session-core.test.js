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
  // recent = [4000, 9000, 4000]: last-3 median = 4000ms -> mastered (pre-attempt), value shown = 1
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

test("[WP1-gate test-gap] the perfect bonus is awarded only once per calendar day across two real perfect sessions driven through finish()", () => {
  const state = freshState();
  const morning = new Date(2026, 7, 25, 9, 0, 0).getTime();
  const laterSameDay = new Date(2026, 7, 25, 20, 0, 0).getTime();

  const s1 = playPerfectSession(state, seededRng(14), morning);
  assert.equal(s1.perfect, true);

  const s2 = playPerfectSession(state, seededRng(15), laterSameDay);
  assert.equal(s2.perfect, true);

  const perfectEntries = state.economy.ledger.filter((e) => e.id.endsWith("_perfect"));
  assert.equal(perfectEntries.length, 1);
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
