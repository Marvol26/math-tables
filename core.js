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

  return {
    CONFIG: CONFIG,
    Facts: Facts,
    Economy: Economy,
    Selector: Selector,
  };
});
