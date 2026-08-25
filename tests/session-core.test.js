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

test("a question resumed after a relaunch is marked interrupted and does not restart shownAt; earns base coins only", () => {
  const state = freshState();
  SessionCore.start(state, seededRng(5), 1000);
  const painted = SessionCore.paint(state, 1000);
  assert.equal(painted.interrupted, false);
  const shownAtBefore = state.active.current.shownAt;

  // simulate relaunch: paint() called again while a current question exists
  const resumed = SessionCore.paint(state, 5000);
  assert.equal(resumed.interrupted, true);
  assert.equal(resumed.shownAt, shownAtBefore);

  const result = SessionCore.submit(state, Facts.answer(resumed.asked), 5100, {});
  assert.equal(result.interrupted, true);
  const attempt = state.active.attempts[0];
  assert.equal(attempt.withinLimit, false);
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
