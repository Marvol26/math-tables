// ============================================================================
// core.js — pure logic for לוח הכפל (loaded via <script src> by index.html,
// cached by the service worker; also require()-able under node --test).
// ============================================================================
(function (root, factory) {
  var MathCore = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = MathCore;
  } else {
    root.MathCore = MathCore;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // --------------------------------------------------------------------
  // CONFIG — every tunable number lives here (I7).
  // --------------------------------------------------------------------
  var CONFIG = {
    FACTS_MIN: 1,
    FACTS_MAX: 10,
    SESSION_SIZE: 10,

    // Economy
    TIER_VALUE: { 1: 1, 2: 2, 3: 3 }, // tier index -> coin value
    MASTERED_VALUE: 1,
    WITHIN_LIMIT_MULTIPLIER: 2,
    RETRY_VALUE: 0,
    STREAK_LENGTH: 5,
    STREAK_BONUS: 2,
    PERFECT_BONUS: 5,
    NEAR_PERFECT_MIN_CORRECT: 9,
    NEAR_PERFECT_BONUS: 2,

    // Mastery / KPIs
    MASTERY_WINDOW: 3,
    MASTERY_MS_THRESHOLD: 6000,
    SPEED_CLAMP_MS: 30000,
    RECENT_WINDOW: 20,

    // Collection / unlocks
    UNLOCK_COUNT: 24,
    UNLOCK_BASE: 25,
    UNLOCK_STEP: 5,
    STICKERS: [
      "cat", "dog", "fox", "owl", "bee", "frog",
      "fish", "duck", "panda", "koala", "lion", "tiger",
      "zebra", "giraffe", "elephant", "monkey", "rabbit", "hedgehog",
      "turtle", "dolphin", "butterfly", "ladybug", "unicorn", "dragon",
    ],

    // Challenge mode
    DEFAULT_TIME_LIMIT_SEC: 10,
    MIN_TIME_LIMIT_SEC: 5,
    MAX_TIME_LIMIT_SEC: 30,

    // Storage / retention
    ATTEMPTS_RETENTION_SESSIONS: 200,
    SCHEMA_VERSION: 1,

    // UI timing (shared so no number lives outside CONFIG — I7)
    WRONG_ANSWER_DISPLAY_MS: 1800,
    ANIMATION_MAX_MS: 1800,
  };

  // --------------------------------------------------------------------
  // Facts
  // --------------------------------------------------------------------
  var Facts = {
    key: function (a, b) {
      var lo = Math.min(a, b);
      var hi = Math.max(a, b);
      return lo + "x" + hi;
    },

    allKeys: function () {
      var keys = [];
      for (var a = CONFIG.FACTS_MIN; a <= CONFIG.FACTS_MAX; a++) {
        for (var b = a; b <= CONFIG.FACTS_MAX; b++) {
          keys.push(Facts.key(a, b));
        }
      }
      return keys;
    },

    parts: function (key) {
      var pieces = key.split("x");
      return [Number(pieces[0]), Number(pieces[1])];
    },

    // Product for a directional "asked" string (e.g. "7x2" -> 14).
    answer: function (asked) {
      var p = Facts.parts(asked);
      return p[0] * p[1];
    },

    tier: function (key) {
      var p = Facts.parts(key);
      var m = Math.max(p[0], p[1]);
      if (m === 1 || m === 2 || m === 10) return 1;
      if (m === 3 || m === 4 || m === 5) return 2;
      return 3; // 6,7,8,9
    },

    emptyFact: function () {
      return { attempts: 0, correct: 0, lastSeen: 0, recent: [] };
    },

    getFact: function (state, key) {
      return state.facts[key] || Facts.emptyFact();
    },

    mastery: function (fact) {
      if (!fact || fact.attempts === 0) return "new";
      var recent = fact.recent || [];
      if (recent.length < CONFIG.MASTERY_WINDOW) return "learning";
      var last3 = recent.slice(-CONFIG.MASTERY_WINDOW);
      var allCorrect = last3.every(function (r) {
        return r.ok && !r.interrupted;
      });
      if (!allCorrect) return "learning";
      var times = last3.map(function (r) {
        return r.ms;
      }).sort(function (x, y) {
        return x - y;
      });
      var median = times[Math.floor(times.length / 2)];
      if (median <= CONFIG.MASTERY_MS_THRESHOLD) return "mastered";
      return "learning";
    },

    value: function (state, key) {
      var fact = Facts.getFact(state, key);
      if (Facts.mastery(fact) === "mastered") return CONFIG.MASTERED_VALUE;
      return CONFIG.TIER_VALUE[Facts.tier(key)];
    },

    // Mutates state.facts[key] in place. `attempt` = {ok, ms, asked, t, withinLimit, interrupted, retry}
    // Retries never update fact stats (I1) — caller must not invoke this for retries.
    updateFromAttempt: function (state, key, attempt) {
      if (attempt.retry) {
        throw new Error("Facts.updateFromAttempt must not be called for a retry attempt");
      }
      if (!state.facts[key]) state.facts[key] = Facts.emptyFact();
      var fact = state.facts[key];
      fact.attempts += 1;
      if (attempt.ok) fact.correct += 1;
      fact.lastSeen = attempt.t;
      fact.recent = fact.recent || [];
      fact.recent.push({
        ok: attempt.ok,
        ms: attempt.ms,
        asked: attempt.asked,
        t: attempt.t,
        withinLimit: !!attempt.withinLimit,
        interrupted: !!attempt.interrupted,
      });
      if (fact.recent.length > CONFIG.RECENT_WINDOW) {
        fact.recent = fact.recent.slice(-CONFIG.RECENT_WINDOW);
      }
      return fact;
    },
  };

  // --------------------------------------------------------------------
  // Economy
  // --------------------------------------------------------------------
  var Economy = {
    // Base coins for one attempt. Retries and wrong answers earn 0 (I1).
    coinsFor: function (state, key, attempt) {
      if (attempt.retry || !attempt.ok) return 0;
      var value = Facts.value(state, key);
      return attempt.withinLimit ? value * CONFIG.WITHIN_LIMIT_MULTIPLIER : value;
    },

    // Appends a ledger entry; rejects (no-op) if `entry.id` already exists.
    ledgerAppend: function (state, entry) {
      var ledger = state.economy.ledger;
      var exists = ledger.some(function (e) {
        return e.id === entry.id;
      });
      if (exists) return { ok: false, reason: "duplicate id" };
      ledger.push(entry);
      return { ok: true };
    },

    sums: function (ledger) {
      var lifetimeCoins = 0;
      var balance = 0;
      ledger.forEach(function (e) {
        balance += e.amount;
        if (e.type === "earn") lifetimeCoins += e.amount;
      });
      return { lifetimeCoins: lifetimeCoins, balance: balance };
    },

    unlockThreshold: function (n) {
      return CONFIG.UNLOCK_BASE * n + CONFIG.UNLOCK_STEP * n * (n - 1) / 2;
    },

    // Sticker ids not yet in state.economy.unlocked whose threshold is met.
    // Does not mutate state — caller applies the result.
    newUnlocks: function (state) {
      var lifetime = Economy.sums(state.economy.ledger).lifetimeCoins;
      var unlockedSet = new Set(state.economy.unlocked || []);
      var result = [];
      for (var n = 1; n <= CONFIG.UNLOCK_COUNT; n++) {
        if (lifetime < Economy.unlockThreshold(n)) break; // thresholds strictly increase
        var stickerId = CONFIG.STICKERS[n - 1];
        if (!unlockedSet.has(stickerId)) result.push(stickerId);
      }
      return result;
    },

    hasPerfectBonusToday: function (ledger, t) {
      var day = new Date(t);
      return ledger.some(function (e) {
        if (e.type !== "earn" || !/_perfect$/.test(e.id)) return false;
        var d = new Date(e.t);
        return (
          d.getFullYear() === day.getFullYear() &&
          d.getMonth() === day.getMonth() &&
          d.getDate() === day.getDate()
        );
      });
    },

    perfectBonusAmount: function (ledger, t) {
      return Economy.hasPerfectBonusToday(ledger, t) ? 0 : CONFIG.PERFECT_BONUS;
    },

    nearPerfectBonusAmount: function (firstTryCorrect) {
      return firstTryCorrect === CONFIG.NEAR_PERFECT_MIN_CORRECT ? CONFIG.NEAR_PERFECT_BONUS : 0;
    },

    requestReward: function (state, rewardId, id, t) {
      var reward = state.economy.rewards.find(function (r) {
        return r.id === rewardId && r.active;
      });
      if (!reward) return { ok: false, reason: "reward not found or inactive" };
      var request = {
        id: id,
        rewardId: rewardId,
        nameSnapshot: reward.name,
        costSnapshot: reward.cost,
        t: t,
        status: "requested",
      };
      state.economy.requests.push(request);
      return { ok: true, request: request };
    },

    approveRequest: function (state, requestId, ledgerEntryId, t) {
      var request = state.economy.requests.find(function (r) {
        return r.id === requestId;
      });
      if (!request) return { ok: false, reason: "request not found" };
      if (request.status !== "requested") {
        return { ok: false, reason: "already processed" };
      }
      var balance = Economy.sums(state.economy.ledger).balance;
      if (balance < request.costSnapshot) {
        return { ok: false, reason: "insufficient balance" };
      }
      request.status = "approved";
      Economy.ledgerAppend(state, {
        id: ledgerEntryId,
        t: t,
        type: "redeem",
        amount: -request.costSnapshot,
        ref: request.id,
        note: request.nameSnapshot,
      });
      return { ok: true };
    },

    rejectRequest: function (state, requestId) {
      var request = state.economy.requests.find(function (r) {
        return r.id === requestId;
      });
      if (!request) return { ok: false, reason: "request not found" };
      if (request.status !== "requested") {
        return { ok: false, reason: "already processed" };
      }
      request.status = "rejected";
      return { ok: true };
    },

    // "Deleting" a reward = deactivating it; history (requests/ledger) is untouched.
    deactivateReward: function (state, rewardId) {
      var reward = state.economy.rewards.find(function (r) {
        return r.id === rewardId;
      });
      if (!reward) return { ok: false, reason: "reward not found" };
      reward.active = false;
      return { ok: true };
    },
  };

  // --------------------------------------------------------------------
  // Selector — session planning (DESIGN §6)
  // --------------------------------------------------------------------
  function fisherYatesShuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  var Selector = {
    // Reuses the direction of the most recent miss for this fact, if any; else random.
    chooseDirection: function (fact, key, rng) {
      var parts = Facts.parts(key);
      var a = parts[0];
      var b = parts[1];
      if (fact && fact.recent && fact.recent.length) {
        for (var i = fact.recent.length - 1; i >= 0; i--) {
          if (!fact.recent[i].ok) return fact.recent[i].asked;
        }
      }
      return rng() < 0.5 ? a + "x" + b : b + "x" + a;
    },

    weaknessScore: function (state, key, now) {
      var fact = Facts.getFact(state, key);
      var acc = fact.attempts > 0 ? fact.correct / fact.attempts : 0;
      var learning = Facts.mastery(fact) === "learning" ? 1 : 0;
      var daysSinceSeen = fact.lastSeen ? (now - fact.lastSeen) / (1000 * 60 * 60 * 24) : 0;
      return (1 - acc) * 2 + learning + daysSinceSeen / 7;
    },

    // Pure: does not mutate `state`. Returns an array of directional strings
    // (e.g. "7x2"), length up to CONFIG.SESSION_SIZE, no duplicate canonical keys.
    plan: function (state, rng, now) {
      var used = new Set();
      var planned = [];

      function tryAdd(key) {
        if (used.has(key)) return false;
        used.add(key);
        var fact = Facts.getFact(state, key);
        planned.push(Selector.chooseDirection(fact, key, rng));
        return true;
      }

      // 1. Carryover FIFO first — overflow beyond SESSION_SIZE stays queued
      //    (state.carryover itself is never mutated here; SessionCore.finish
      //    recomputes the next carryover from misses + unconsumed leftover).
      var carryover = state.carryover || [];
      for (var c = 0; c < carryover.length && planned.length < CONFIG.SESSION_SIZE; c++) {
        tryAdd(carryover[c]);
      }

      var remaining = CONFIG.SESSION_SIZE - planned.length;
      if (remaining > 0) {
        var allKeys = Facts.allKeys();

        // Reserve 1-2 slots for mastered review, if any mastered facts exist.
        var masteredPool = allKeys.filter(function (k) {
          return !used.has(k) && Facts.mastery(Facts.getFact(state, k)) === "mastered";
        });
        var reserveMastered = 0;
        if (masteredPool.length > 0 && remaining > 0) {
          reserveMastered = Math.min(remaining, masteredPool.length, 1 + Math.floor(rng() * 2));
        }
        var nonMasteredSlots = remaining - reserveMastered;

        // 2a. Unseen facts, sum ascending, random tie-break within equal sums.
        if (nonMasteredSlots > 0) {
          var unseen = allKeys.filter(function (k) {
            return !used.has(k) && Facts.getFact(state, k).attempts === 0;
          });
          var bySum = {};
          unseen.forEach(function (k) {
            var p = Facts.parts(k);
            var sum = p[0] + p[1];
            (bySum[sum] = bySum[sum] || []).push(k);
          });
          var sums = Object.keys(bySum).map(Number).sort(function (x, y) {
            return x - y;
          });
          var unseenOrdered = [];
          sums.forEach(function (sum) {
            unseenOrdered.push.apply(unseenOrdered, fisherYatesShuffle(bySum[sum].slice(), rng));
          });
          for (var u = 0; u < unseenOrdered.length && nonMasteredSlots > 0; u++) {
            if (tryAdd(unseenOrdered[u])) nonMasteredSlots--;
          }
        }

        // 2b. Weakest ("learning") facts: candidate pool of nonMasteredSlots+6,
        //     then a random pick from that pool (adds session-to-session variety).
        if (nonMasteredSlots > 0) {
          var learningPool = allKeys.filter(function (k) {
            return !used.has(k) && Facts.mastery(Facts.getFact(state, k)) === "learning";
          });
          learningPool.sort(function (x, y) {
            return Selector.weaknessScore(state, y, now) - Selector.weaknessScore(state, x, now);
          });
          var poolSize = Math.min(learningPool.length, nonMasteredSlots + 6);
          var candidatePool = fisherYatesShuffle(learningPool.slice(0, poolSize), rng);
          for (var w = 0; w < candidatePool.length && nonMasteredSlots > 0; w++) {
            if (tryAdd(candidatePool[w])) nonMasteredSlots--;
          }
        }

        // 3. Mastered review slots.
        if (reserveMastered > 0) {
          var masteredShuffled = fisherYatesShuffle(masteredPool.slice(), rng);
          var taken = 0;
          for (var m = 0; m < masteredShuffled.length && taken < reserveMastered; m++) {
            if (tryAdd(masteredShuffled[m])) taken++;
          }
        }

        // 4. Random fill (only reached if the pools above could not fill the session).
        if (planned.length < CONFIG.SESSION_SIZE) {
          var leftoverKeys = fisherYatesShuffle(
            allKeys.filter(function (k) {
              return !used.has(k);
            }),
            rng
          );
          for (var f = 0; f < leftoverKeys.length && planned.length < CONFIG.SESSION_SIZE; f++) {
            tryAdd(leftoverKeys[f]);
          }
        }
      }

      return fisherYatesShuffle(planned, rng);
    },
  };

  // --------------------------------------------------------------------
  // SessionCore — pure state transitions on state.active (DESIGN §6, §7)
  // --------------------------------------------------------------------
  var SessionCore = {
    // Creates state.active from a fresh plan. Mutates `state`, returns state.active.
    start: function (state, rng, now) {
      var planned = Selector.plan(state, rng, now);
      var active = {
        id: "s_" + now + "_" + Math.floor(rng() * 1e6),
        startedAt: now,
        settingsSnapshot: {
          challengeOn: !!state.settings.challengeOn,
          timeLimitSec: state.settings.timeLimitSec || CONFIG.DEFAULT_TIME_LIMIT_SEC,
        },
        planned: planned.slice(),
        queue: planned.slice(),
        retryQueue: [],
        attempts: [],
        current: null,
      };
      state.active = active;
      return active;
    },

    // Paints the next question. If a question is already displayed (current
    // set, unanswered) this call represents a resume after a relaunch/lifecycle
    // interruption: mark it interrupted, keep the original shownAt (no restart).
    paint: function (state, now) {
      var active = state.active;
      if (!active) throw new Error("no active session");
      if (active.current) {
        active.current.interrupted = true;
        return active.current;
      }
      var fromRetry = active.queue.length === 0 && active.retryQueue.length > 0;
      var asked = fromRetry ? active.retryQueue[0] : active.queue[0];
      if (!asked) return null; // nothing left to paint; caller should finish()
      var key = Facts.key.apply(null, Facts.parts(asked));
      active.current = {
        key: key,
        asked: asked,
        shownAt: now,
        interrupted: false,
        retry: fromRetry,
      };
      return active.current;
    },

    // Marks the currently displayed question interrupted without changing shownAt
    // (e.g. visibilitychange while a question is on screen, independent of submit).
    markInterrupted: function (state) {
      var active = state.active;
      if (active && active.current) active.current.interrupted = true;
    },

    submit: function (state, answer, now, opts) {
      var active = state.active;
      if (!active || !active.current) throw new Error("no current question to submit");
      var current = active.current;
      if (opts && opts.hidden) current.interrupted = true;

      var ok = Number(answer) === Facts.answer(current.asked);
      var ms = now - current.shownAt;
      var withinLimit =
        active.settingsSnapshot.challengeOn &&
        !current.interrupted &&
        ms <= active.settingsSnapshot.timeLimitSec * 1000;

      var attemptRecord = {
        key: current.key,
        asked: current.asked,
        answer: Number(answer),
        ok: ok,
        ms: ms,
        retry: !!current.retry,
        withinLimit: withinLimit,
        interrupted: !!current.interrupted,
        coins: 0,
        t: now,
      };

      if (!current.retry) {
        Facts.updateFromAttempt(state, current.key, {
          ok: ok,
          ms: ms,
          asked: current.asked,
          t: now,
          withinLimit: withinLimit,
          interrupted: !!current.interrupted,
          retry: false,
        });
        attemptRecord.coins = Economy.coinsFor(state, current.key, {
          ok: ok,
          retry: false,
          withinLimit: withinLimit,
        });
      }

      active.attempts.push(attemptRecord);

      if (!current.retry) {
        active.queue.shift();
      } else {
        active.retryQueue.shift();
      }
      if (!ok) {
        active.retryQueue.push(current.asked);
      }
      active.current = null;

      return {
        ok: ok,
        coins: attemptRecord.coins,
        correctAnswer: Facts.answer(current.asked),
        interrupted: attemptRecord.interrupted,
      };
    },

    // Only valid when both queues are empty. Finalizes the session in one
    // logical write: updates ledger/unlocks/carryover, pushes the session
    // record, clears state.active. Idempotent by session id (I2).
    finish: function (state, now) {
      var active = state.active;
      if (!active) return null;
      if (state.sessions.some(function (s) { return s.id === active.id; })) {
        state.active = null;
        return null;
      }
      if (active.queue.length > 0 || active.retryQueue.length > 0) {
        throw new Error("cannot finish: queue/retryQueue not empty");
      }

      var sid = active.id;
      var firstAttempts = active.attempts.filter(function (a) { return !a.retry; });
      var firstTryCorrect = firstAttempts.filter(function (a) { return a.ok; }).length;
      var misses = [];
      firstAttempts.forEach(function (a) {
        if (!a.ok && misses.indexOf(a.key) === -1) misses.push(a.key);
      });
      var totalMs = firstAttempts.reduce(function (sum, a) { return sum + a.ms; }, 0);
      var baseCoins = active.attempts.reduce(function (sum, a) { return sum + a.coins; }, 0);

      var earnAmount = baseCoins;
      Economy.ledgerAppend(state, {
        id: "l_" + sid + "_earn",
        t: now,
        type: "earn",
        amount: earnAmount,
        ref: sid,
        note: "session",
      });
      var totalCoins = earnAmount;

      // Streak bonus: every 5th consecutive first-attempt correct (retries excluded).
      var streakRun = 0;
      var streakCount = 0;
      firstAttempts.forEach(function (a) {
        if (a.ok) {
          streakRun++;
          if (streakRun % CONFIG.STREAK_LENGTH === 0) {
            streakCount++;
            var amount = CONFIG.STREAK_BONUS;
            Economy.ledgerAppend(state, {
              id: "l_" + sid + "_streak_" + streakRun,
              t: now,
              type: "earn",
              amount: amount,
              ref: sid,
              note: "streak",
            });
            totalCoins += amount;
          }
        } else {
          streakRun = 0;
        }
      });

      var perfect = firstTryCorrect === active.planned.length;
      if (perfect) {
        var perfectAmount = Economy.perfectBonusAmount(state.economy.ledger, now);
        if (perfectAmount > 0) {
          Economy.ledgerAppend(state, {
            id: "l_" + sid + "_perfect",
            t: now,
            type: "earn",
            amount: perfectAmount,
            ref: sid,
            note: "perfect",
          });
          totalCoins += perfectAmount;
        }
      } else {
        var nearAmount = Economy.nearPerfectBonusAmount(firstTryCorrect);
        if (nearAmount > 0) {
          Economy.ledgerAppend(state, {
            id: "l_" + sid + "_near",
            t: now,
            type: "earn",
            amount: nearAmount,
            ref: sid,
            note: "near-perfect",
          });
          totalCoins += nearAmount;
        }
      }

      var unlocksEarned = Economy.newUnlocks(state);
      state.economy.unlocked = (state.economy.unlocked || []).concat(unlocksEarned);

      var masteredAfter = Facts.allKeys().filter(function (k) {
        return Facts.mastery(Facts.getFact(state, k)) === "mastered";
      }).length;

      var leftoverCarryover = (state.carryover || []).slice(CONFIG.SESSION_SIZE);
      var nextCarryover = [];
      misses.concat(leftoverCarryover).forEach(function (k) {
        if (nextCarryover.indexOf(k) === -1) nextCarryover.push(k);
      });

      var session = {
        id: sid,
        startedAt: active.startedAt,
        endedAt: now,
        abandoned: false,
        challengeOn: active.settingsSnapshot.challengeOn,
        timeLimitSec: active.settingsSnapshot.timeLimitSec,
        planned: active.planned.slice(),
        attempts: active.attempts.slice(),
        firstTryCorrect: firstTryCorrect,
        totalMs: totalMs,
        misses: misses,
        coinsEarned: totalCoins,
        perfect: perfect,
        masteredAfter: masteredAfter,
        unlocksEarned: unlocksEarned,
      };

      state.sessions.push(session);
      if (state.sessions.length > CONFIG.ATTEMPTS_RETENTION_SESSIONS) {
        var cutoff = state.sessions.length - CONFIG.ATTEMPTS_RETENTION_SESSIONS;
        for (var i = 0; i < cutoff; i++) {
          delete state.sessions[i].attempts;
        }
      }

      state.carryover = nextCarryover;
      state.active = null;

      return session;
    },
  };

  return {
    CONFIG: CONFIG,
    Facts: Facts,
    Economy: Economy,
    Selector: Selector,
    SessionCore: SessionCore,
  };
});
