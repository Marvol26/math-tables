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
      var appended = Economy.ledgerAppend(state, {
        id: ledgerEntryId,
        t: t,
        type: "redeem",
        amount: -request.costSnapshot,
        ref: request.id,
        note: request.nameSnapshot,
      });
      if (!appended.ok) return { ok: false, reason: "ledger entry id collision" };
      request.status = "approved";
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
      if (state.active) {
        var err = new Error("cannot start: a session is already active (state.active is set)");
        err.code = "ACTIVE_SESSION_EXISTS";
        throw err;
      }
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
        // Coins must be computed from the fact's PRE-attempt state — the value
        // that was on screen when the question was painted — before this
        // attempt's own outcome can flip its mastery (WP1-gate M3).
        attemptRecord.coins = Economy.coinsFor(state, current.key, {
          ok: ok,
          retry: false,
          withinLimit: withinLimit,
        });
        Facts.updateFromAttempt(state, current.key, {
          ok: ok,
          ms: ms,
          asked: current.asked,
          t: now,
          withinLimit: withinLimit,
          interrupted: !!current.interrupted,
          retry: false,
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
              // Cumulative bonus count, not the run position — two separate
              // 5-runs in one session would otherwise collide on the same id
              // and the duplicate-id guard would silently eat the second bonus.
              id: "l_" + sid + "_streak_" + streakCount,
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

  // --------------------------------------------------------------------
  // Stats — pure, first-attempt-only (DESIGN §7)
  // --------------------------------------------------------------------
  function dayStart(t) {
    var d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  var Stats = {
    // Median ms of the last MASTERY_WINDOW correct, non-interrupted first
    // attempts (DESIGN §7) — the same eligible set Facts.mastery() uses, so a
    // miss or an interrupted resume (which can carry an arbitrarily large ms
    // across a relaunch) never poisons the displayed speed (WP1-gate M2).
    factMedianMs: function (fact) {
      var eligible = (fact.recent || []).filter(function (r) { return r.ok && !r.interrupted; });
      var last = eligible.slice(-CONFIG.MASTERY_WINDOW);
      if (!last.length) return null;
      var times = last.map(function (r) { return r.ms; }).sort(function (a, b) { return a - b; });
      return times[Math.floor(times.length / 2)];
    },

    perFactTable: function (state) {
      return Facts.allKeys().map(function (key) {
        var fact = Facts.getFact(state, key);
        var median = Stats.factMedianMs(fact);
        return {
          key: key,
          attempts: fact.attempts,
          correct: fact.correct,
          accuracy: fact.attempts ? fact.correct / fact.attempts : null,
          medianMs: median,
          lastSeen: fact.lastSeen,
          mastery: Facts.mastery(fact),
        };
      });
    },

    // Average ms of first, non-interrupted attempts, clamped at CONFIG.SPEED_CLAMP_MS.
    sessionAvgMs: function (session) {
      var eligible = (session.attempts || []).filter(function (a) { return !a.retry && !a.interrupted; });
      if (!eligible.length) return 0;
      var total = eligible.reduce(function (sum, a) { return sum + Math.min(a.ms, CONFIG.SPEED_CLAMP_MS); }, 0);
      return total / eligible.length;
    },

    sessionSummary: function (session) {
      return {
        id: session.id,
        firstTryCorrect: session.firstTryCorrect,
        avgMs: Stats.sessionAvgMs(session),
        misses: session.misses.length,
        retries: (session.attempts || []).filter(function (a) { return a.retry; }).length,
        coins: session.coinsEarned,
        challengeOn: session.challengeOn,
        timeLimitSec: session.timeLimitSec,
        masteredAfter: session.masteredAfter,
      };
    },

    trends: function (state, n) {
      var sessions = state.sessions.slice(-n);
      return {
        accuracy: sessions.map(function (s) {
          return s.planned.length ? s.firstTryCorrect / s.planned.length : 0;
        }),
        avgMs: sessions.map(Stats.sessionAvgMs),
        masteredCount: sessions.map(function (s) { return s.masteredAfter; }),
        coins: sessions.map(function (s) { return s.coinsEarned; }),
      };
    },

    // 10x10 grid; cell (a,b) and (b,a) share the same canonical-key data (mirrored).
    heatmap: function (state) {
      var grid = [];
      for (var a = CONFIG.FACTS_MIN; a <= CONFIG.FACTS_MAX; a++) {
        var row = [];
        for (var b = CONFIG.FACTS_MIN; b <= CONFIG.FACTS_MAX; b++) {
          var key = Facts.key(a, b);
          var fact = Facts.getFact(state, key);
          row.push({
            key: key,
            attempts: fact.attempts,
            accuracy: fact.attempts ? fact.correct / fact.attempts : null,
            mastery: Facts.mastery(fact),
          });
        }
        grid.push(row);
      }
      return grid;
    },

    weakest: function (state, now, n) {
      var count = n || 8;
      var candidates = Facts.allKeys().filter(function (k) {
        var fact = Facts.getFact(state, k);
        return fact.attempts > 0 && Facts.mastery(fact) !== "mastered";
      });
      candidates.sort(function (x, y) {
        return Selector.weaknessScore(state, y, now) - Selector.weaknessScore(state, x, now);
      });
      return candidates.slice(0, count);
    },

    totals: function (state, now) {
      var sums = Economy.sums(state.economy.ledger);
      var masteredCount = Facts.allKeys().filter(function (k) {
        return Facts.mastery(Facts.getFact(state, k)) === "mastered";
      }).length;

      var daySet = new Set(state.sessions.map(function (s) { return dayStart(s.endedAt); }));
      var oneDay = 24 * 60 * 60 * 1000;
      var todayStart = dayStart(now);
      var streak = 0;
      var cursor = null;
      if (daySet.has(todayStart)) cursor = todayStart;
      else if (daySet.has(todayStart - oneDay)) cursor = todayStart - oneDay;
      while (cursor !== null && daySet.has(cursor)) {
        streak++;
        cursor -= oneDay;
      }

      return {
        totalSessions: state.sessions.length,
        lifetimeCoins: sums.lifetimeCoins,
        balance: sums.balance,
        masteredCount: masteredCount,
        dailyStreak: streak,
      };
    },
  };

  // --------------------------------------------------------------------
  // Migrate — pure raw -> state normalization + import validation (DESIGN §8)
  // --------------------------------------------------------------------
  var Migrate = {
    emptyState: function () {
      return {
        schemaVersion: CONFIG.SCHEMA_VERSION,
        rev: 0,
        savedAt: 0,
        createdAt: 0,
        lastExportAt: null,
        settings: {
          childName: "",
          challengeOn: false,
          timeLimitSec: CONFIG.DEFAULT_TIME_LIMIT_SEC,
          sound: true,
          pinHash: null,
          recoveryHash: null,
          forceNumpad: null,
        },
        economy: { ledger: [], unlocked: [], rewards: [], requests: [] },
        facts: {},
        sessions: [],
        carryover: [],
        active: null,
      };
    },

    // Pure: raw -> normalized state. Rejects a newer schema with a coded error.
    // Idempotent: migrate(migrate(raw)) === migrate(raw).
    migrate: function (raw) {
      if (!raw || typeof raw !== "object") return Migrate.emptyState();
      if (typeof raw.schemaVersion === "number" && raw.schemaVersion > CONFIG.SCHEMA_VERSION) {
        var err = new Error("schemaVersion " + raw.schemaVersion + " is newer than supported " + CONFIG.SCHEMA_VERSION);
        err.code = "SCHEMA_TOO_NEW";
        throw err;
      }
      var rs = raw.settings || {};
      var re = raw.economy || {};
      var state = {
        schemaVersion: CONFIG.SCHEMA_VERSION,
        rev: raw.rev || 0,
        savedAt: raw.savedAt || 0,
        createdAt: raw.createdAt || 0,
        lastExportAt: raw.lastExportAt || null,
        settings: {
          childName: rs.childName || "",
          challengeOn: !!rs.challengeOn,
          timeLimitSec: rs.timeLimitSec || CONFIG.DEFAULT_TIME_LIMIT_SEC,
          sound: typeof rs.sound === "boolean" ? rs.sound : true,
          pinHash: rs.pinHash || null,
          recoveryHash: rs.recoveryHash || null,
          // null = auto-detect by pointer type; true/false = explicit override
          // from the question screen's "הצג מקלדת" toggle (DESIGN §9.2).
          forceNumpad: typeof rs.forceNumpad === "boolean" ? rs.forceNumpad : null,
        },
        economy: {
          ledger: Array.isArray(re.ledger) ? JSON.parse(JSON.stringify(re.ledger)) : [],
          unlocked: Array.isArray(re.unlocked) ? re.unlocked.slice() : [],
          rewards: Array.isArray(re.rewards) ? JSON.parse(JSON.stringify(re.rewards)) : [],
          requests: Array.isArray(re.requests) ? JSON.parse(JSON.stringify(re.requests)) : [],
        },
        facts: raw.facts ? JSON.parse(JSON.stringify(raw.facts)) : {},
        sessions: Array.isArray(raw.sessions) ? JSON.parse(JSON.stringify(raw.sessions)) : [],
        carryover: Array.isArray(raw.carryover) ? raw.carryover.slice() : [],
        active: raw.active ? JSON.parse(JSON.stringify(raw.active)) : null,
      };
      // Any resumed session (fresh boot or import onto another device) counts
      // as a lifecycle interruption (DESIGN §6/§7, R2 #5, R3 #2).
      if (state.active && state.active.current) {
        state.active.current.interrupted = true;
      }
      return state;
    },

    // migrate() + strip device-local auth so the destination device's own
    // pinHash/recoveryHash are never overwritten by an import (D15).
    // Caller (Storage.importJson, WP2) must re-apply the device's own values.
    forImport: function (raw) {
      var state = Migrate.migrate(raw);
      state.settings.pinHash = null;
      state.settings.recoveryHash = null;
      return state;
    },

    validateImport: function (raw) {
      var problems = [];
      if (!raw || typeof raw !== "object") {
        return { ok: false, problems: ["not an object"] };
      }
      if (raw.schemaVersion !== undefined && typeof raw.schemaVersion !== "number") {
        problems.push("schemaVersion must be a number");
      }
      if (typeof raw.schemaVersion === "number" && raw.schemaVersion > CONFIG.SCHEMA_VERSION) {
        problems.push("schemaVersion " + raw.schemaVersion + " is newer than supported " + CONFIG.SCHEMA_VERSION);
      }
      if (raw.economy && raw.economy.ledger !== undefined) {
        if (!Array.isArray(raw.economy.ledger)) {
          problems.push("economy.ledger must be an array");
        } else {
          raw.economy.ledger.forEach(function (entry, i) {
            if (!entry || typeof entry !== "object") {
              problems.push("ledger[" + i + "] is not an object");
              return;
            }
            if (typeof entry.id !== "string" || !entry.id) problems.push("ledger[" + i + "].id must be a non-empty string");
            if (typeof entry.t !== "number") problems.push("ledger[" + i + "].t must be a number");
            if (["earn", "redeem", "adjust"].indexOf(entry.type) === -1) problems.push("ledger[" + i + "].type must be earn/redeem/adjust");
            if (typeof entry.amount !== "number") problems.push("ledger[" + i + "].amount must be a number");
          });
        }
      }
      if (raw.facts !== undefined && (typeof raw.facts !== "object" || raw.facts === null || Array.isArray(raw.facts))) {
        problems.push("facts must be an object");
      } else if (raw.facts) {
        Object.keys(raw.facts).forEach(function (k) {
          var fact = raw.facts[k];
          if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
            problems.push("facts[" + k + "] must be an object");
            return;
          }
          if (typeof fact.attempts !== "number") problems.push("facts[" + k + "].attempts must be a number");
          if (typeof fact.correct !== "number") problems.push("facts[" + k + "].correct must be a number");
          if (typeof fact.lastSeen !== "number") problems.push("facts[" + k + "].lastSeen must be a number");
          if (fact.recent !== undefined && !Array.isArray(fact.recent)) problems.push("facts[" + k + "].recent must be an array");
        });
      }
      if (raw.sessions !== undefined) {
        if (!Array.isArray(raw.sessions)) {
          problems.push("sessions must be an array");
        } else {
          raw.sessions.forEach(function (session, i) {
            if (!session || typeof session !== "object") {
              problems.push("sessions[" + i + "] is not an object");
              return;
            }
            if (!Array.isArray(session.planned)) problems.push("sessions[" + i + "].planned must be an array");
            if (typeof session.firstTryCorrect !== "number") problems.push("sessions[" + i + "].firstTryCorrect must be a number");
            if (typeof session.coinsEarned !== "number") problems.push("sessions[" + i + "].coinsEarned must be a number");
            if (typeof session.masteredAfter !== "number") problems.push("sessions[" + i + "].masteredAfter must be a number");
          });
        }
      }
      if (raw.settings !== undefined && (typeof raw.settings !== "object" || raw.settings === null)) {
        problems.push("settings must be an object");
      }
      if (raw.carryover !== undefined && !Array.isArray(raw.carryover)) {
        problems.push("carryover must be an array");
      }
      if (raw.active !== undefined && raw.active !== null) {
        if (typeof raw.active !== "object" || Array.isArray(raw.active)) {
          problems.push("active must be an object or null");
        } else {
          var a = raw.active;
          if (!Array.isArray(a.planned)) problems.push("active.planned must be an array");
          if (!Array.isArray(a.queue)) problems.push("active.queue must be an array");
          if (!Array.isArray(a.retryQueue)) problems.push("active.retryQueue must be an array");
          if (!Array.isArray(a.attempts)) problems.push("active.attempts must be an array");
          if (typeof a.id !== "string" || !a.id) problems.push("active.id must be a non-empty string");
        }
      }
      return { ok: problems.length === 0, problems: problems };
    },

    // Self-heals derived fields that can drift on an older/foreign export
    // (currently: sticker unlocks implied by the ledger but missing from
    // economy.unlocked). Mutates and returns `state`.
    recompute: function (state) {
      var newly = Economy.newUnlocks(state);
      if (newly.length) {
        state.economy.unlocked = state.economy.unlocked.concat(newly);
      }
      return state;
    },
  };

  // --------------------------------------------------------------------
  // Storage — IndexedDB-authoritative, localStorage-mirrored (DESIGN §8).
  // Injectable indexedDB/localStorage so it is Node-testable under
  // fake-indexeddb (PA-2) and browser-real in index.html.
  // --------------------------------------------------------------------
  var DB_NAME = "mathtrainer";
  var STORE_NAME = "state";
  var RECORD_ID = "state";
  var BACKUP_ID = "backup";
  var MIRROR_KEY = "mathtrainer.v1.mirror";

  function idbOpen(idbFactory, dbName) {
    return new Promise(function (resolve, reject) {
      var req = idbFactory.open(dbName, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("idbOpen failed")); };
    });
  }

  function idbGet(db, id) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, "readonly");
      var req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error || new Error("idbGet failed")); };
    });
  }

  function idbPut(db, record) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        reject(tx.error || new Error("idbPut failed"));
      };
    });
  }

  // Single readwrite transaction: read the 'state' record's rev, compare to
  // `expectedRev`; on mismatch abort (nothing written, no partial state) and
  // resolve {ok:false, stale:true}; on match, apply every put in `puts` and
  // resolve {ok:true} once the transaction commits (DESIGN §8 rev-check gate).
  function idbCasWrite(db, expectedRev, puts) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, "readwrite");
      var store = tx.objectStore(STORE_NAME);
      var mismatched = false;
      var getReq = store.get(RECORD_ID);
      getReq.onsuccess = function () {
        var existing = getReq.result;
        var actualRev = existing ? existing.rev : 0;
        if (actualRev !== expectedRev) {
          mismatched = true;
          try { tx.abort(); } catch (e) { /* already aborting */ }
          return;
        }
        puts.forEach(function (p) { store.put(p); });
      };
      getReq.onerror = function () {
        try { tx.abort(); } catch (e) { /* already aborting */ }
      };
      tx.oncomplete = function () { resolve({ ok: true }); };
      tx.onabort = function () { resolve({ ok: false, stale: mismatched }); };
      tx.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault(); // let onabort settle it
      };
    });
  }

  function StorageInstance(opts) {
    this.idb = opts.indexedDB;
    this.localStorage = opts.localStorage;
    this.dbName = opts.dbName || DB_NAME;
    this.db = null;
    this.state = null;
    this.rev = 0;
    this.stale = false;
    this._queue = Promise.resolve();
  }

  StorageInstance.prototype._enqueue = function (fn) {
    var result = this._queue.then(fn, fn);
    this._queue = result.then(function () {}, function () {});
    return result;
  };

  StorageInstance.prototype._mirror = function () {
    try {
      this.localStorage.setItem(MIRROR_KEY, JSON.stringify({ rev: this.rev, state: this.state }));
    } catch (e) { /* mirror is best-effort */ }
  };

  StorageInstance.prototype._readMirror = function () {
    try {
      var raw = this.localStorage.getItem(MIRROR_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  };

  // IDB first; falls back to the localStorage mirror if IDB is unavailable
  // or unparseable; restores the mirror into IDB if IDB is empty but the
  // mirror has data (IDB wiped). Returns null if neither has anything.
  StorageInstance.prototype.load = function () {
    var self = this;
    return idbOpen(self.idb, self.dbName)
      .then(function (db) {
        self.db = db;
        return idbGet(db, RECORD_ID);
      })
      .then(function (record) {
        if (record) {
          self.rev = record.rev;
          self.state = record.state;
          self._mirror();
          return self.state;
        }
        var mirror = self._readMirror();
        if (mirror) {
          self.rev = mirror.rev;
          self.state = mirror.state;
          return idbPut(self.db, { id: RECORD_ID, rev: self.rev, state: self.state }).then(function () {
            return self.state;
          });
        }
        self.rev = 0;
        self.state = null;
        return null;
      })
      .catch(function () {
        var mirror = self._readMirror();
        if (mirror) {
          self.rev = mirror.rev;
          self.state = mirror.state;
          return self.state;
        }
        self.rev = 0;
        self.state = null;
        return null;
      });
  };

  // Enqueues onto the per-window promise queue (at most one transaction in
  // flight). `mutator(clone)` mutates a clone of the current state in place;
  // the clone only replaces `this.state` on a successful commit — a failed
  // save (stale or exception) always leaves `this.state` (incl. `active`)
  // untouched.
  StorageInstance.prototype.save = function (mutator, now) {
    var self = this;
    return self._enqueue(function () {
      if (!self.state) return Promise.resolve({ ok: false, error: "no state loaded" });
      var clone = JSON.parse(JSON.stringify(self.state));
      mutator(clone);
      clone.rev = self.rev + 1;
      clone.savedAt = now;
      var expectedRev = self.rev;
      return idbCasWrite(self.db, expectedRev, [{ id: RECORD_ID, rev: clone.rev, state: clone }])
        .then(function (result) {
          if (!result.ok) {
            self.stale = true;
            return { ok: false, stale: true };
          }
          self.rev = clone.rev;
          self.state = clone;
          self._mirror();
          return { ok: true, state: self.state };
        })
        .catch(function (err) {
          return { ok: false, error: String((err && err.message) || err) };
        });
    });
  };

  StorageInstance.prototype.flush = function () {
    return this._queue;
  };

  // Backs up the current state to a separate 'backup' record, then replaces
  // the whole 'state' record with `newState` — both in one transaction, so
  // an interrupted write never leaves a backup without its matching replace
  // (used by import/reset; undo reads the backup record back).
  StorageInstance.prototype.backupThenReplace = function (newState, now) {
    var self = this;
    return self._enqueue(function () {
      if (!self.state) return Promise.resolve({ ok: false, error: "no state loaded" });
      var backupRecord = { id: BACKUP_ID, rev: self.rev, state: self.state, savedAt: now };
      var nextState = JSON.parse(JSON.stringify(newState));
      nextState.rev = self.rev + 1;
      nextState.savedAt = now;
      var mainRecord = { id: RECORD_ID, rev: nextState.rev, state: nextState };
      return idbCasWrite(self.db, self.rev, [backupRecord, mainRecord])
        .then(function (result) {
          if (!result.ok) {
            self.stale = true;
            return { ok: false, stale: true };
          }
          self.rev = nextState.rev;
          self.state = nextState;
          self._mirror();
          return { ok: true, state: self.state };
        })
        .catch(function (err) {
          return { ok: false, error: String((err && err.message) || err) };
        });
    });
  };

  StorageInstance.prototype.undoLastReplace = function (now) {
    var self = this;
    return self._enqueue(function () {
      return idbGet(self.db, BACKUP_ID).then(function (backup) {
        if (!backup) return { ok: false, reason: "no backup available" };
        var restored = JSON.parse(JSON.stringify(backup.state));
        restored.rev = self.rev + 1;
        restored.savedAt = now;
        var mainRecord = { id: RECORD_ID, rev: restored.rev, state: restored };
        return idbCasWrite(self.db, self.rev, [mainRecord]).then(function (result) {
          if (!result.ok) {
            self.stale = true;
            return { ok: false, stale: true };
          }
          self.rev = restored.rev;
          self.state = restored;
          self._mirror();
          return { ok: true, state: self.state };
        });
      });
    });
  };

  // Sets lastExportAt (a real save, so other windows see it too) then
  // returns the serialized JSON. Strips settings.pinHash/recoveryHash from
  // the SERIALIZED copy only (never from self.state, which still needs
  // them) — a backup file is meant to move off-device (email, Drive), and
  // DESIGN §8 treats these as device-local; leaving them in gave anyone who
  // ever saw a backup file an offline-crackable copy of the parent PIN and
  // recovery code (WP9 review finding C). Round-trip is unaffected: an
  // import already nulls foreign pinHash/recoveryHash and re-applies the
  // importing device's own values, and Migrate falls back to null when
  // these keys are absent, same as when they were explicitly null.
  StorageInstance.prototype.exportJson = function (now) {
    var self = this;
    return self.save(function (s) { s.lastExportAt = now; }, now).then(function (result) {
      if (!result.ok) return result;
      var json = JSON.stringify(self.state, function (key, value) {
        if (key === "pinHash" || key === "recoveryHash") return undefined;
        return value;
      });
      return { ok: true, json: json };
    });
  };

  // validate -> migrate (stripping any foreign PIN) -> keep this device's own
  // pinHash/recoveryHash -> preview via Migrate metadata -> backupThenReplace.
  StorageInstance.prototype.importJson = function (text, now) {
    var self = this;
    var raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return Promise.resolve({ ok: false, problems: ["invalid JSON"] });
    }
    var validation = Migrate.validateImport(raw);
    if (!validation.ok) return Promise.resolve({ ok: false, problems: validation.problems });
    var imported = Migrate.forImport(raw);
    imported.settings.pinHash = self.state ? self.state.settings.pinHash : null;
    imported.settings.recoveryHash = self.state ? self.state.settings.recoveryHash : null;
    return self.backupThenReplace(imported, now);
  };

  var Storage = {
    create: function (opts) {
      return new StorageInstance(opts);
    },
  };

  // --------------------------------------------------------------------
  // Pin — child-deterrent PIN hashing + recovery code (WebCrypto; injectable
  // so it is Node-testable via crypto.webcrypto). Not a security boundary
  // against an adult attacker — stated purpose is a deterrent only.
  // --------------------------------------------------------------------
  var Pin = {
    RECOVERY_ALPHABET: "ABCDEFGHJKMNPQRSTUVWXYZ23456789", // no I/L/O/0/1

    isValidFormat: function (pin) {
      return /^\d{4}$/.test(pin);
    },

    randomHex: function (cryptoObj, byteLength) {
      var arr = new Uint8Array(byteLength);
      cryptoObj.getRandomValues(arr);
      return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    },

    sha256Hex: function (cryptoObj, text) {
      var enc = new TextEncoder().encode(text);
      return cryptoObj.subtle.digest("SHA-256", enc).then(function (buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      });
    },

    // Returns "salt:digest" — the single string DESIGN §8 stores as settings.pinHash.
    hash: function (cryptoObj, pin) {
      var salt = Pin.randomHex(cryptoObj, 16);
      return Pin.sha256Hex(cryptoObj, pin + ":" + salt).then(function (digest) {
        return salt + ":" + digest;
      });
    },

    verify: function (cryptoObj, pin, stored) {
      if (!stored) return Promise.resolve(false);
      var parts = stored.split(":");
      var salt = parts[0];
      var digest = parts[1];
      return Pin.sha256Hex(cryptoObj, pin + ":" + salt).then(function (d) { return d === digest; });
    },

    generateRecoveryCode: function (cryptoObj, length) {
      var len = length || 6;
      var arr = new Uint8Array(len);
      cryptoObj.getRandomValues(arr);
      var out = "";
      for (var i = 0; i < len; i++) {
        out += Pin.RECOVERY_ALPHABET[arr[i] % Pin.RECOVERY_ALPHABET.length];
      }
      return out;
    },
  };

  return {
    CONFIG: CONFIG,
    Facts: Facts,
    Economy: Economy,
    Selector: Selector,
    SessionCore: SessionCore,
    Storage: Storage,
    Pin: Pin,
    Stats: Stats,
    Migrate: Migrate,
  };
});
