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
    // Which operand decides the tier: "max" (DESIGN v4 rule: 1x6 pays like 6x6)
    // or "min" (1x6 pays 1, 6x7 pays 3). Changing this reprices the live
    // economy — Marat chose "min" on 2026-08-26 (punch-list P6).
    TIER_BY: "min",
    LEDGER_MAX_ABS_AMOUNT: 10000, // import validation bound (P10)
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
    WRONG_ANSWER_HELPER_MS: 3200, // a wrong answer shows the dot-array picture; needs a beat longer to absorb
    HELPER_CASCADE_MS: 1100, // the dot rows light up over this much time, whatever the row count

    // Journey map (docs/MAP-DESIGN.md, Marat 2026-08-27)
    MAP_PATH: [1, 2, 10, 5, 3, 4, 6, 9, 8, 7], // learning order; ×9 before ×8/×7 (digit-sum pattern makes it easy) — research 2026-08-27
    STATION_REQUIRED: 10, // mastered facts of the table needed to reach its station
    MAP_FOCUS_BONUS: 1.5, // added to the weakness score of the current station's facts
    ANIMATION_MAX_MS: 1800,

    // Falling numbers mode (docs/FALLING-DESIGN.md, Marat 2026-08-27)
    FALLING: {
      DEFAULT_DURATION_SEC: 8,
      MIN_DURATION_SEC: 3,
      MAX_DURATION_SEC: 20,
      DEFAULT_OPTIONS: 4,
      MIN_OPTIONS: 4,
      MAX_OPTIONS: 6,
      FILL_WINDOW: 20,
    },
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
      var m = CONFIG.TIER_BY === "min" ? Math.min(p[0], p[1]) : Math.max(p[0], p[1]);
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
      var pending = state.economy.requests.some(function (r) {
        return r.rewardId === rewardId && r.status === "requested";
      });
      if (pending) return { ok: false, reason: "already requested" }; // P11: double-tap guard
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

  // --------------------------------------------------------------------
  // Map — journey map by tables (docs/MAP-DESIGN.md). Pure functions.
  // --------------------------------------------------------------------
  var Map = {
    // The 10 canonical facts of table n (n×1 … n×10). Facts shared with other
    // tables (e.g. 3×4 belongs to ×3 and ×4) count for both.
    tableKeys: function (n) {
      var keys = [];
      for (var i = CONFIG.FACTS_MIN; i <= CONFIG.FACTS_MAX; i++) keys.push(Facts.key(n, i));
      return keys;
    },

    // mastered count of table n
    progress: function (state, n) {
      return Map.tableKeys(n).filter(function (k) {
        return Facts.mastery(Facts.getFact(state, k)) === "mastered";
      }).length;
    },

    isReached: function (state, n) {
      return !!(state.map && state.map.reached && state.map.reached[n]);
    },

    // First station in path order that is not reached; null when all are.
    currentStation: function (state) {
      for (var i = 0; i < CONFIG.MAP_PATH.length; i++) {
        if (!Map.isReached(state, CONFIG.MAP_PATH[i])) return CONFIG.MAP_PATH[i];
      }
      return null;
    },

    // Stations whose progress meets STATION_REQUIRED and are not yet reached.
    // Does not mutate; SessionCore.finish applies it. Reaching is permanent.
    newlyReached: function (state) {
      return CONFIG.MAP_PATH.filter(function (n) {
        return !Map.isReached(state, n) && Map.progress(state, n) >= CONFIG.STATION_REQUIRED;
      });
    },

    // Full picture for the UI: one row per station in path order.
    overview: function (state) {
      var current = Map.currentStation(state);
      return CONFIG.MAP_PATH.map(function (n, i) {
        return {
          table: n,
          index: i,
          progress: Map.progress(state, n),
          required: CONFIG.STATION_REQUIRED,
          reached: Map.isReached(state, n),
          reachedAt: state.map && state.map.reached ? state.map.reached[n] || null : null,
          current: n === current,
        };
      });
    },
  };

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

    // Facts of the current map station's table get a mild priority (MAP-DESIGN §2).
    isFocusFact: function (state, key) {
      var station = Map.currentStation(state);
      if (station === null) return false;
      var p = Facts.parts(key);
      return p[0] === station || p[1] === station;
    },

    weaknessScore: function (state, key, now) {
      var fact = Facts.getFact(state, key);
      var acc = fact.attempts > 0 ? fact.correct / fact.attempts : 0;
      var learning = Facts.mastery(fact) === "learning" ? 1 : 0;
      var daysSinceSeen = fact.lastSeen ? (now - fact.lastSeen) / (1000 * 60 * 60 * 24) : 0;
      var focus = Selector.isFocusFact(state, key) ? CONFIG.MAP_FOCUS_BONUS : 0;
      return (1 - acc) * 2 + learning + daysSinceSeen / 7 + focus;
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
          // Journey map: unseen facts of the CURRENT station's table are introduced
          // first (sum order kept within each half). Without this the sum-ascending
          // intro would light stations out of path order and in bursts (review
          // 2026-08-27, HIGH). The mild weakness bonus below handles seen facts.
          var focusFirst = unseenOrdered.filter(function (k) { return Selector.isFocusFact(state, k); });
          var others = unseenOrdered.filter(function (k) { return !Selector.isFocusFact(state, k); });
          unseenOrdered = focusFirst.concat(others);
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
          // Journey map: the current station's unmastered facts are taken first
          // (weakest first), so a station cannot stall while stations ahead of it
          // light up; the shuffled weakest pool fills whatever is left (variety).
          var focusLearning = learningPool.filter(function (k) { return Selector.isFocusFact(state, k); });
          for (var fl = 0; fl < focusLearning.length && nonMasteredSlots > 0; fl++) {
            if (tryAdd(focusLearning[fl])) nonMasteredSlots--;
          }
          var restLearning = learningPool.filter(function (k) { return !used.has(k); });
          var poolSize = Math.min(restLearning.length, nonMasteredSlots + 6);
          var candidatePool = fisherYatesShuffle(restLearning.slice(0, poolSize), rng);
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
  // Falling — distractor generation for the falling-numbers mode
  // (docs/FALLING-DESIGN.md F7). Pure, no DOM, no state mutation.
  // --------------------------------------------------------------------
  var Falling = {
    // A single swap of two distinct digits of p (no leading zero); null if
    // p has fewer than 2 digits or every swap collides back onto p.
    digitSwap: function (p) {
      var chars = String(p).split("");
      for (var i = 0; i < chars.length; i++) {
        for (var j = i + 1; j < chars.length; j++) {
          if (chars[i] === chars[j]) continue;
          var swapped = chars.slice();
          var tmp = swapped[i];
          swapped[i] = swapped[j];
          swapped[j] = tmp;
          if (swapped[0] === "0") continue;
          var n = Number(swapped.join(""));
          if (n !== p) return n;
        }
      }
      return null;
    },

    // Every product a×b for facts other than (a,b) itself (both directions
    // collapse to the same canonical fact, tried once).
    otherFactProducts: function (a, b) {
      var lo = Math.min(a, b);
      var hi = Math.max(a, b);
      var list = [];
      for (var x = CONFIG.FACTS_MIN; x <= CONFIG.FACTS_MAX; x++) {
        for (var y = x; y <= CONFIG.FACTS_MAX; y++) {
          if (x === lo && y === hi) continue;
          list.push(x * y);
        }
      }
      return list;
    },

    // `count` unique wrong answers for a×b=p, priority-ordered per F7,
    // always in 1…100 and never equal to p.
    distractors: function (a, b, count, rng) {
      var p = a * b;
      var used = {};
      used[p] = true;
      var result = [];

      function offer(n) {
        if (n === null || n === undefined || !isFinite(n)) return;
        n = Math.round(n);
        if (n < 1 || n > 100) return;
        if (used[n]) return;
        used[n] = true;
        result.push(n);
      }

      [
        (a - 1) * b, (a + 1) * b, a * (b - 1), a * (b + 1), // same-table neighbours
        p - a, p + a, p - b, p + b,
        Falling.digitSwap(p),
        a + b,
        p - 10, p + 10,
      ].forEach(offer);

      if (result.length < count) {
        var nearby = fisherYatesShuffle(
          Falling.otherFactProducts(a, b).filter(function (n) {
            return !used[n] && Math.abs(n - p) <= CONFIG.FALLING.FILL_WINDOW;
          }),
          rng
        );
        for (var i = 0; i < nearby.length && result.length < count; i++) offer(nearby[i]);
      }

      if (result.length < count) {
        var universe = [];
        for (var n2 = 1; n2 <= 100; n2++) if (!used[n2]) universe.push(n2);
        universe = fisherYatesShuffle(universe, rng);
        for (var j = 0; j < universe.length && result.length < count; j++) offer(universe[j]);
      }

      return result.slice(0, count);
    },

    // Shuffled candidate set of exactly `options` values containing a×b once.
    candidates: function (a, b, options, rng) {
      var p = a * b;
      var wrong = Falling.distractors(a, b, options - 1, rng);
      return fisherYatesShuffle(wrong.concat([p]), rng);
    },
  };

  // --------------------------------------------------------------------
  // SessionCore — pure state transitions on state.active (DESIGN §6, §7)
  // --------------------------------------------------------------------
  var SessionCore = {
    // Creates state.active from a fresh plan. Mutates `state`, returns state.active.
    // `opts.mode` = "typed" (default) | "falling" (docs/FALLING-DESIGN.md).
    // The rules a session plays by, taken from the CURRENT settings. Falling
    // mode's ×2 comes from the same withinLimit/timeLimitSec path as Challenge
    // Mode (F9/I-F4) — no separate timing code in the UI layer.
    buildSnapshot: function (state, mode) {
      var falling = state.settings.falling || {};
      return mode === "falling"
        ? {
            challengeOn: true,
            timeLimitSec: falling.durationSec || CONFIG.FALLING.DEFAULT_DURATION_SEC,
            falling: {
              durationSec: falling.durationSec || CONFIG.FALLING.DEFAULT_DURATION_SEC,
              options: falling.options || CONFIG.FALLING.DEFAULT_OPTIONS,
            },
          }
        : {
            challengeOn: !!state.settings.challengeOn,
            timeLimitSec: state.settings.timeLimitSec || CONFIG.DEFAULT_TIME_LIMIT_SEC,
          };
    },

    // Parent changed settings while a session is suspended: apply them from the
    // next question (Marat, 2026-08-28 — "the clock set in the parent menu
    // doesn't operate in the real game").
    refreshSettings: function (state) {
      if (!state.active) return null;
      state.active.settingsSnapshot = SessionCore.buildSnapshot(state, state.active.mode || "typed");
      return state.active.settingsSnapshot;
    },

    // One parking slot: a suspended session of the OTHER mode waits in
    // state.parked while the child plays this one, and comes back when it ends.
    park: function (state) {
      if (!state.active) return null;
      if (state.parked) throw Object.assign(new Error("parking slot occupied"), { code: "PARKED_EXISTS" });
      state.parked = state.active;
      state.active = null;
      return state.parked;
    },

    unpark: function (state) {
      if (state.active || !state.parked) return null;
      state.active = state.parked;
      state.parked = null;
      if (state.active.current) state.active.current.interrupted = true; // time passed away from it
      return state.active;
    },

    // Makes `mode` the active session: resumes it if it is active or parked,
    // otherwise parks the current session (if any) and starts a new one.
    switchTo: function (state, mode, rng, now) {
      mode = mode === "falling" ? "falling" : "typed";
      if (state.active && (state.active.mode || "typed") === mode) {
        SessionCore.refreshSettings(state);
        return state.active;
      }
      if (state.parked && (state.parked.mode || "typed") === mode) {
        var outgoing = state.active;
        state.active = state.parked;
        state.parked = outgoing;
        if (state.active.current) state.active.current.interrupted = true;
        SessionCore.refreshSettings(state);
        return state.active;
      }
      if (state.active) SessionCore.park(state);
      return SessionCore.start(state, rng, now, { mode: mode });
    },

    start: function (state, rng, now, opts) {
      if (state.active) {
        var err = new Error("cannot start: a session is already active (state.active is set)");
        err.code = "ACTIVE_SESSION_EXISTS";
        throw err;
      }
      var mode = opts && opts.mode === "falling" ? "falling" : "typed";
      var planned = Selector.plan(state, rng, now);
      var settingsSnapshot = SessionCore.buildSnapshot(state, mode);
      var active = {
        id: "s_" + now + "_" + Math.floor(rng() * 1e6),
        startedAt: now,
        mode: mode,
        settingsSnapshot: settingsSnapshot,
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
        mode: active.mode || "typed",
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
        // Falling mode is recognition, not recall (docs/FALLING-DESIGN.md F4/I-F1):
        // it earns coins but never touches facts/mastery/carryover/map.
        if (active.mode !== "falling") {
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
        asked: current.asked,
        interrupted: attemptRecord.interrupted,
        retry: attemptRecord.retry,
        withinLimit: attemptRecord.withinLimit,
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

      var isFalling = active.mode === "falling";

      // Journey map: stations reached in this session are permanent (never fall).
      // Falling mode is recognition, not recall (F4/I-F1) — it never moves the map.
      var stationsReached = [];
      if (!isFalling) {
        if (!state.map) state.map = { reached: {} };
        stationsReached = Map.newlyReached(state);
        stationsReached.forEach(function (n) { state.map.reached[n] = now; });
      }

      var masteredAfter = Facts.allKeys().filter(function (k) {
        return Facts.mastery(Facts.getFact(state, k)) === "mastered";
      }).length;

      // Falling mode never touches carryover (I-F1) — state.carryover stays
      // exactly as it was when the session started.
      var nextCarryover = state.carryover || [];
      if (!isFalling) {
        var leftoverCarryover = nextCarryover.slice(CONFIG.SESSION_SIZE);
        nextCarryover = [];
        misses.concat(leftoverCarryover).forEach(function (k) {
          if (nextCarryover.indexOf(k) === -1) nextCarryover.push(k);
        });
      }

      var session = {
        id: sid,
        startedAt: active.startedAt,
        endedAt: now,
        abandoned: false,
        mode: active.mode || "typed",
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
        stationsReached: stationsReached,
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
      if (state.parked) { state.active = state.parked; state.parked = null; if (state.active.current) state.active.current.interrupted = true; } // the parked session returns

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
      // Falling mode is recognition, not recall (F4/I-F1): it never moves
      // accuracy/speed/mastery trends, but it does still earn coins. Filter
      // BEFORE windowing (not after) — a run of falling sessions must not
      // push typed history out of the learning-trend window (WP-F1 gate
      // review, MEDIUM: a child who prefers falling would otherwise see
      // blank accuracy/speed/mastery charts once 30 falling sessions in a
      // row outrun the window, even though real typed history exists).
      var learningSessions = state.sessions
        .filter(function (s) { return (s.mode || "typed") !== "falling"; })
        .slice(-n);
      return {
        accuracy: learningSessions.map(function (s) {
          return s.planned.length ? s.firstTryCorrect / s.planned.length : 0;
        }),
        avgMs: learningSessions.map(Stats.sessionAvgMs),
        masteredCount: learningSessions.map(function (s) { return s.masteredAfter; }),
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
          // Cloud backup (private GitHub Gist). Device-local: stripped from export, kept on import.
          cloud: { token: null, gistId: null, lastOkAt: null, lastError: null, restoreFromGistId: null },
          // Falling numbers mode (docs/FALLING-DESIGN.md F2). Off by default.
          falling: { enabled: false, durationSec: CONFIG.FALLING.DEFAULT_DURATION_SEC, options: CONFIG.FALLING.DEFAULT_OPTIONS },
        },
        economy: { ledger: [], unlocked: [], rewards: [], requests: [] },
        facts: {},
        sessions: [],
        carryover: [],
        active: null,
        parked: null,
        map: { reached: {} },
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
          cloud: {
            token: rs.cloud && typeof rs.cloud.token === "string" ? rs.cloud.token : null,
            gistId: rs.cloud && typeof rs.cloud.gistId === "string" ? rs.cloud.gistId : null,
            lastOkAt: rs.cloud && typeof rs.cloud.lastOkAt === "number" ? rs.cloud.lastOkAt : null,
            lastError: rs.cloud && typeof rs.cloud.lastError === "string" ? rs.cloud.lastError : null,
            // a bigger backup found at connect time that was NOT adopted; restore prefers it
            restoreFromGistId: rs.cloud && typeof rs.cloud.restoreFromGistId === "string" ? rs.cloud.restoreFromGistId : null,
          },
          // Falling numbers mode (F2). Additive since 2026-08-27; old backups default to off.
          falling: {
            enabled: !!(rs.falling && rs.falling.enabled),
            durationSec: rs.falling && typeof rs.falling.durationSec === "number" ? rs.falling.durationSec : CONFIG.FALLING.DEFAULT_DURATION_SEC,
            options: rs.falling && typeof rs.falling.options === "number" ? rs.falling.options : CONFIG.FALLING.DEFAULT_OPTIONS,
          },
        },
        economy: {
          ledger: Array.isArray(re.ledger) ? JSON.parse(JSON.stringify(re.ledger)) : [],
          unlocked: Array.isArray(re.unlocked) ? re.unlocked.slice() : [],
          rewards: Array.isArray(re.rewards) ? JSON.parse(JSON.stringify(re.rewards)) : [],
          requests: Array.isArray(re.requests) ? JSON.parse(JSON.stringify(re.requests)) : [],
        },
        facts: raw.facts ? JSON.parse(JSON.stringify(raw.facts)) : {},
        sessions: Array.isArray(raw.sessions)
          ? JSON.parse(JSON.stringify(raw.sessions)).map(function (s) {
              s.mode = s.mode === "falling" ? "falling" : "typed";
              return s;
            })
          : [],
        carryover: Array.isArray(raw.carryover) ? raw.carryover.slice() : [],
        active: raw.active ? JSON.parse(JSON.stringify(raw.active)) : null,
        parked: raw.parked ? JSON.parse(JSON.stringify(raw.parked)) : null, // additive 2026-08-28 (one parked session of the other mode)
        // Additive since 2026-08-27 (journey map); schemaVersion unchanged — old backups default to no stations.
        map: { reached: raw.map && raw.map.reached && typeof raw.map.reached === "object" ? JSON.parse(JSON.stringify(raw.map.reached)) : {} },
      };
      // Any resumed session (fresh boot or import onto another device) counts
      // as a lifecycle interruption (DESIGN §6/§7, R2 #5, R3 #2).
      if (state.active && state.active.current) {
        state.active.current.interrupted = true;
      }
      if (state.active) {
        state.active.mode = state.active.mode === "falling" ? "falling" : "typed";
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
            else if (!isFinite(entry.amount) || Math.abs(entry.amount) > CONFIG.LEDGER_MAX_ABS_AMOUNT) problems.push("ledger[" + i + "].amount out of range");
          });
        }
      }
      if (raw.economy && raw.economy.rewards !== undefined) {
        if (!Array.isArray(raw.economy.rewards)) problems.push("economy.rewards must be an array");
        else raw.economy.rewards.forEach(function (r, i) {
          if (!r || typeof r !== "object") { problems.push("rewards[" + i + "] is not an object"); return; }
          if (typeof r.id !== "string" || !r.id) problems.push("rewards[" + i + "].id must be a non-empty string");
          if (typeof r.name !== "string") problems.push("rewards[" + i + "].name must be a string");
          if (typeof r.cost !== "number" || !isFinite(r.cost) || r.cost < 0 || r.cost > CONFIG.LEDGER_MAX_ABS_AMOUNT) problems.push("rewards[" + i + "].cost out of range");
        });
      }
      if (raw.economy && raw.economy.requests !== undefined) {
        if (!Array.isArray(raw.economy.requests)) problems.push("economy.requests must be an array");
        else raw.economy.requests.forEach(function (q, i) {
          if (!q || typeof q !== "object") { problems.push("requests[" + i + "] is not an object"); return; }
          if (typeof q.id !== "string" || !q.id) problems.push("requests[" + i + "].id must be a non-empty string");
          if (typeof q.nameSnapshot !== "string") problems.push("requests[" + i + "].nameSnapshot must be a string");
          if (typeof q.costSnapshot !== "number" || !isFinite(q.costSnapshot) || q.costSnapshot < 0 || q.costSnapshot > CONFIG.LEDGER_MAX_ABS_AMOUNT) problems.push("requests[" + i + "].costSnapshot out of range");
          if (["requested", "approved", "rejected", "cancelled"].indexOf(q.status) === -1) problems.push("requests[" + i + "].status invalid");
        });
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
      } else if (raw.settings && raw.settings.falling !== undefined) {
        var rf = raw.settings.falling;
        if (!rf || typeof rf !== "object" || Array.isArray(rf)) {
          problems.push("settings.falling must be an object");
        } else {
          if (rf.enabled !== undefined && typeof rf.enabled !== "boolean") problems.push("settings.falling.enabled must be a boolean");
          if (rf.durationSec !== undefined && (typeof rf.durationSec !== "number" || rf.durationSec < CONFIG.FALLING.MIN_DURATION_SEC || rf.durationSec > CONFIG.FALLING.MAX_DURATION_SEC)) {
            problems.push("settings.falling.durationSec out of range");
          }
          if (rf.options !== undefined && (typeof rf.options !== "number" || rf.options < CONFIG.FALLING.MIN_OPTIONS || rf.options > CONFIG.FALLING.MAX_OPTIONS)) {
            problems.push("settings.falling.options out of range");
          }
        }
      }
      if (raw.carryover !== undefined && !Array.isArray(raw.carryover)) {
        problems.push("carryover must be an array");
      }
      if (raw.map !== undefined) {
        if (!raw.map || typeof raw.map !== "object" || Array.isArray(raw.map)) problems.push("map must be an object");
        else if (raw.map.reached !== undefined) {
          if (!raw.map.reached || typeof raw.map.reached !== "object" || Array.isArray(raw.map.reached)) problems.push("map.reached must be an object");
          else Object.keys(raw.map.reached).forEach(function (k) {
            var n = Number(k);
            if (!(n >= CONFIG.FACTS_MIN && n <= CONFIG.FACTS_MAX) || typeof raw.map.reached[k] !== "number") problems.push("map.reached[" + k + "] invalid");
          });
        }
      }
      [["active", raw.active], ["parked", raw.parked]].forEach(function (pair) {
        var name = pair[0], val = pair[1];
        if (val === undefined || val === null) return;
        if (typeof val !== "object" || Array.isArray(val)) { problems.push(name + " must be an object or null"); return; }
        if (!Array.isArray(val.planned)) problems.push(name + ".planned must be an array");
        if (!Array.isArray(val.queue)) problems.push(name + ".queue must be an array");
        if (!Array.isArray(val.retryQueue)) problems.push(name + ".retryQueue must be an array");
        if (!Array.isArray(val.attempts)) problems.push(name + ".attempts must be an array");
      });
      if (raw.active !== undefined && raw.active !== null) {
        if (typeof raw.active !== "object" || Array.isArray(raw.active)) {
          /* reported above */
        } else {
          var a = raw.active;
          if (!Array.isArray(a.planned)) problems.push("active.planned must be an array");
          if (!Array.isArray(a.queue)) problems.push("active.queue must be an array");
          if (!Array.isArray(a.retryQueue)) problems.push("active.retryQueue must be an array");
          if (!Array.isArray(a.attempts)) problems.push("active.attempts must be an array");
          if (typeof a.id !== "string" || !a.id) problems.push("active.id must be a non-empty string");
          if (a.current !== undefined && a.current !== null) {
            var c = a.current;
            if (typeof c !== "object" || Array.isArray(c)) problems.push("active.current must be an object or null");
            else {
              if (typeof c.asked !== "string" || !/^\d+x\d+$/.test(c.asked)) problems.push("active.current.asked must be like \"7x2\"");
              if (typeof c.key !== "string" || !/^\d+x\d+$/.test(c.key)) problems.push("active.current.key must be like \"2x7\"");
              if (typeof c.shownAt !== "number") problems.push("active.current.shownAt must be a number");
            }
          }
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
  // Ratchet snapshot: only ever replaced by a state with at least as many
  // sessions, so an empty/fresh state (transient IDB failure at boot, a re-run
  // parent setup, an accidental reset) can never wipe the last real progress.
  var LASTGOOD_KEY = "mathtrainer.v1.lastgood";

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
    this._ratchet();
  };

  function sessionCount(state) {
    return state && Array.isArray(state.sessions) ? state.sessions.length : 0;
  }

  StorageInstance.prototype._ratchet = function () {
    try {
      if (this._lastGoodCount === undefined) {
        var existing = this.readLastGood(); // parsed once per window, then cached
        this._lastGoodCount = existing ? sessionCount(existing.state) : -1;
      }
      var mine = sessionCount(this.state);
      if (this._lastGoodCount > mine) return; // never shrink; at equal counts the latest wins
      this.localStorage.setItem(LASTGOOD_KEY, JSON.stringify({ rev: this.rev, savedAt: this.state && this.state.savedAt, state: this.state }));
      this._lastGoodCount = mine;
    } catch (e) { /* best-effort */ }
  };

  // A deliberate, PIN-confirmed reset also forgets the snapshot (a fresh start
  // for another child must not keep the previous child's data on the device);
  // an accidental reset is still covered by undoLastReplace (IDB backup record).
  StorageInstance.prototype.clearLastGood = function () {
    try { this.localStorage.removeItem(LASTGOOD_KEY); } catch (e) { /* ignore */ }
    this._lastGoodCount = -1;
  };

  // Pure serialization for export (no PIN material); marking lastExportAt is
  // separate so a cancelled share sheet does not count as a backup.
  StorageInstance.prototype.serializeForExport = function () {
    return JSON.stringify(this.state, function (key, value) {
      if (key === "pinHash" || key === "recoveryHash" || key === "cloud") return undefined;
      return value;
    });
  };

  StorageInstance.prototype.markExported = function (now) {
    return this.save(function (s) { s.lastExportAt = now; }, now);
  };

  StorageInstance.prototype.readLastGood = function () {
    try {
      var raw = this.localStorage.getItem(LASTGOOD_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  // Restores the ratchet snapshot over the current state (through the same
  // atomic backup-then-replace path as import), keeping the CURRENT device
  // PIN/recovery when the current state has them (the parent just typed them).
  // If the current state has no PIN (setup screen), the restored state gets
  // none either: the parent then completes setup normally — a new PIN and a
  // fresh recovery code — on top of the restored progress (review 2026-08-27 #1).
  StorageInstance.prototype.restoreLastGood = function (now) {
    var self = this;
    return Promise.resolve()
      .then(function () {
        var snapshot = self.readLastGood();
        if (!snapshot || !snapshot.state) return { ok: false, error: "no snapshot" };
        var restored = Migrate.migrate(snapshot.state); // may throw SCHEMA_TOO_NEW → caught below
        var cur = self.state && self.state.settings;
        var hasPin = !!(cur && cur.pinHash);
        restored.settings.pinHash = hasPin ? cur.pinHash : null;
        restored.settings.recoveryHash = hasPin ? cur.recoveryHash : null;
        if (cur && cur.cloud && cur.cloud.token) restored.settings.cloud = cur.cloud; // keep the token the parent set now
        // Retry IDB if the boot never opened it; adopt the stored rev so the CAS
        // write below compares against what is really on disk.
        var ready = self.db ? Promise.resolve() : idbOpen(self.idb, self.dbName).then(function (db) {
          self.db = db;
          return idbGet(db, RECORD_ID).then(function (rec) { if (rec && typeof rec.rev === "number") self.rev = rec.rev; });
        });
        return ready.then(function () { return self.backupThenReplace(restored, now); });
      })
      .catch(function (err) { return { ok: false, error: String((err && err.message) || err) }; });
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
    // Cloud settings are device configuration, never adopted from a file (a
    // crafted backup could otherwise install a foreign token — review 2026-08-27 #2).
    imported.settings.cloud = self.state && self.state.settings.cloud ? self.state.settings.cloud : { token: null, gistId: null, lastOkAt: null, lastError: null };
    return self.backupThenReplace(imported, now);
  };

  // --------------------------------------------------------------------
  // Cloud — automatic backup to a private GitHub Gist (Marat, 2026-08-27).
  // Pure over an injected fetch. The token is the parent's own (gist scope
  // only), lives in settings.cloud on the device, never in export files.
  // --------------------------------------------------------------------
  var CLOUD_API = "https://api.github.com";
  var CLOUD_FILE = "math-progress.json";

  function cloudHeaders(token) {
    return { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "Content-Type": "application/json" };
  }

  var Cloud = {
    apiBase: CLOUD_API,
    fileName: CLOUD_FILE,

    // GET /gists?per_page=1 — 200 means the token works and has gist scope.
    verifyToken: function (fetchFn, token) {
      if (!token) return Promise.resolve({ ok: false, error: "no token" });
      return fetchFn(CLOUD_API + "/gists?per_page=1", { headers: cloudHeaders(token) })
        .then(function (res) { return res.ok ? { ok: true } : { ok: false, error: "HTTP " + res.status }; })
        .catch(function (err) { return { ok: false, error: String((err && err.message) || err) }; });
    },

    // Creates the private gist on first use, then PATCHes the same one.
    backup: function (fetchFn, cloud, json) {
      if (!cloud || !cloud.token) return Promise.resolve({ ok: false, error: "no token" });
      var body = { description: "לוח הכפל — backup", public: false, files: {} };
      body.files[CLOUD_FILE] = { content: json };
      var url = cloud.gistId ? CLOUD_API + "/gists/" + encodeURIComponent(cloud.gistId) : CLOUD_API + "/gists";
      var method = cloud.gistId ? "PATCH" : "POST";
      var payload = JSON.stringify(body);
      var opts = { method: method, headers: cloudHeaders(cloud.token), body: payload };
      if (payload.length < 60000) opts.keepalive = true; // survives page suspension (browser limit ~64 KB)
      return fetchFn(url, opts)
        .then(function (res) {
          if (res.status === 404 && cloud.gistId) {
            // the gist was deleted on GitHub: create a fresh one
            return Cloud.backup(fetchFn, { token: cloud.token, gistId: null }, json);
          }
          if (!res.ok) return { ok: false, error: "HTTP " + res.status };
          return res.json().then(function (data) { return { ok: true, gistId: data.id }; });
        })
        .catch(function (err) { return { ok: false, error: String((err && err.message) || err) }; });
    },

    // Latest backup content (follows raw_url when the API truncates >1 MB).
    fetchLatest: function (fetchFn, cloud) {
      if (!cloud || !cloud.token || !cloud.gistId) return Promise.resolve({ ok: false, error: "no gist" });
      return fetchFn(CLOUD_API + "/gists/" + encodeURIComponent(cloud.gistId), { headers: cloudHeaders(cloud.token) })
        .then(function (res) {
          if (!res.ok) return { ok: false, error: "HTTP " + res.status };
          return res.json().then(function (data) {
            var f = data.files && data.files[CLOUD_FILE];
            if (!f) return { ok: false, error: "no backup file in gist" };
            if (f.truncated && f.raw_url) {
              return fetchFn(f.raw_url).then(function (r2) { // secret-gist raw URLs need no token
                return r2.ok ? r2.text().then(function (t) { return { ok: true, json: t, updatedAt: data.updated_at }; }) : { ok: false, error: "HTTP " + r2.status };
              });
            }
            return { ok: true, json: f.content, updatedAt: data.updated_at };
          });
        })
        .catch(function (err) { return { ok: false, error: String((err && err.message) || err) }; });
    },

    // Finds this app's backup gist for a token that has no gistId yet (new device).
    findGist: function (fetchFn, token) {
      return fetchFn(CLOUD_API + "/gists?per_page=100", { headers: cloudHeaders(token) })
        .then(function (res) {
          if (!res.ok) return { ok: false, error: "HTTP " + res.status };
          return res.json().then(function (list) {
            var hit = (list || []).filter(function (g) { return g.files && g.files[CLOUD_FILE]; })
              .sort(function (a, b) { return (a.updated_at < b.updated_at) ? 1 : -1; })[0];
            return hit ? { ok: true, gistId: hit.id } : { ok: false, error: "no backup found" };
          });
        })
        .catch(function (err) { return { ok: false, error: String((err && err.message) || err) }; });
    },
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
    Map: Map,
    Falling: Falling,
    Cloud: Cloud,
    SessionCore: SessionCore,
    Storage: Storage,
    Pin: Pin,
    Stats: Stats,
    Migrate: Migrate,
  };
});
