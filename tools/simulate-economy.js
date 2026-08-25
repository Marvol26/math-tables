// Simulates a weak, average and strong child playing daily sessions and
// reports sessions-to-complete-collection (WP1-7 done-when: average child
// completes in 60-110 sessions).
"use strict";
const { CONFIG, Facts, SessionCore } = require("../core.js");

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(profile, seed, maxSessions) {
  const rng = mulberry32(seed);
  const state = {
    facts: {},
    economy: { ledger: [], unlocked: [], rewards: [], requests: [] },
    sessions: [],
    carryover: [],
    settings: { challengeOn: profile.challengeOn, timeLimitSec: 10 },
  };
  let now = 0;
  for (let s = 0; s < maxSessions; s++) {
    now += 24 * 60 * 60 * 1000; // one session per day
    SessionCore.start(state, rng, now);
    let t = now;
    while (state.active.queue.length > 0 || state.active.retryQueue.length > 0) {
      const current = SessionCore.paint(state, t);
      if (!current) break;
      const correct = rng() < profile.accuracy;
      const trueAnswer = Facts.answer(current.asked);
      const answer = correct ? trueAnswer : trueAnswer + 1;
      t += profile.speedMs + Math.floor(rng() * profile.speedJitterMs);
      SessionCore.submit(state, answer, t, {});
    }
    SessionCore.finish(state, t + 1);
    if (state.economy.unlocked.length >= CONFIG.UNLOCK_COUNT) {
      return s + 1;
    }
  }
  return null;
}

const profiles = {
  weak: { accuracy: 0.55, speedMs: 6000, speedJitterMs: 3000, challengeOn: false },
  average: { accuracy: 0.75, speedMs: 4000, speedJitterMs: 2000, challengeOn: true },
  strong: { accuracy: 0.92, speedMs: 2500, speedJitterMs: 1500, challengeOn: true },
};

const MAX_SESSIONS = 400;
Object.keys(profiles).forEach(function (name) {
  const result = simulate(profiles[name], name.length * 7919 + 13, MAX_SESSIONS);
  console.log(name + ": " + (result === null ? "did not complete within " + MAX_SESSIONS + " sessions" : result + " sessions to complete the collection"));
});
