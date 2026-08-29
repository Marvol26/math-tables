(function () {
  "use strict";
  var MathCore = window.MathCore;
  var CONFIG = MathCore.CONFIG;

  // ------------------------------------------------------------------
  // T — every user-visible string lives here (I7), feminine register.
  // ------------------------------------------------------------------
  var T = window.MathText.T, escapeHtml = window.MathText.escapeHtml, tableTag = window.MathText.tableTag, bdi = window.MathText.bdi;

  // Sticker artwork (UI concern — core.js only knows the ids). P2.
  // Album 2 emoji (V2-DESIGN §3.4) extracted programmatically from
  // docs/V2-DESIGN.md line 63 to avoid any transcription error, incl. the
  // variation-selector glyphs (racecar, island, map).
  var STICKER_EMOJI = {
    cat: "🐱", dog: "🐶", fox: "🦊", owl: "🦉", bee: "🐝", frog: "🐸",
    fish: "🐠", duck: "🦆", panda: "🐼", koala: "🐨", lion: "🦁", tiger: "🐯",
    zebra: "🦓", giraffe: "🦒", elephant: "🐘", monkey: "🐵", rabbit: "🐰", hedgehog: "🦔",
    turtle: "🐢", dolphin: "🐬", butterfly: "🦋", ladybug: "🐞", unicorn: "🦄", dragon: "🐉",
    rocket: "🚀", ufo: "🛸", planet: "🪐", moon: "🌙", star: "⭐", rainbow: "🌈",
    castle: "🏰", ferris: "🎡", carousel: "🎠", circus: "🎪", train: "🚂", helicopter: "🚁",
    sailboat: "⛵", racecar: "🏎️", tractor: "🚜", canoe: "🛶", volcano: "🌋", island: "🏝️",
    tent: "⛺", balloon: "🎈", kite: "🪁", compass: "🧭", map: "🗺️", crown: "👑",
  };
  function stickerArt(id) { return STICKER_EMOJI[id] || "🎁"; }

  // ------------------------------------------------------------------
  // Sound (P4): tiny WebAudio blips, gated by settings.sound. The context is
  // created on the first user gesture (iOS requires it) and reused.
  // ------------------------------------------------------------------
  var audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { audioCtx = new AC(); } catch (e) { audioCtx = null; }
  }
  document.addEventListener("pointerdown", ensureAudio, { passive: true });
  document.addEventListener("keydown", ensureAudio);
  function blip(pattern) {
    if (!audioCtx || !App.storage || !S().settings.sound) return;
    if (audioCtx.state === "suspended") { audioCtx.resume().catch(function () {}); }
    var t0 = audioCtx.currentTime;
    pattern.forEach(function (step, i) {
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = step[0];
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.12 + step[1]);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + i * 0.12);
      osc.stop(t0 + i * 0.12 + step[1] + 0.02);
    });
  }
  var SOUNDS = {
    correct: [[660, 0.1], [880, 0.14]],
    fast: [[660, 0.08], [880, 0.08], [1320, 0.18]],
    wrong: [[330, 0.18]],
    unlock: [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.25]],
    perfect: [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.1], [1319, 0.3]],
  };

  // ------------------------------------------------------------------
  // Cloud backup glue: debounced after every completed session / approval.
  // Only api.github.com is ever contacted, only with the parent's own token.
  // ------------------------------------------------------------------
  var cloudTimer = null;
  function cloudBackupSoon() {
    var st = S();
    if (!st || !st.settings.cloud || !st.settings.cloud.token) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(cloudBackupNow, 4000);
  }
  function cloudBackupNow() {
    var st = S();
    if (!st || !st.settings.cloud || !st.settings.cloud.token) return Promise.resolve({ ok: false, error: "no token" });
    // Never upload an empty state over a real backup (the data-loss incident, review #1).
    if (!st.sessions || st.sessions.length === 0) return Promise.resolve({ ok: false, error: T.parent.cloudEmptySkipped, skipped: true });
    var json = App.storage.serializeForExport();
    var cloud = st.settings.cloud;
    return MathCore.Cloud.backup(window.fetch.bind(window), cloud, json).then(function (result) {
      return save(function (s) {
        if (result.ok) { s.settings.cloud.gistId = result.gistId; s.settings.cloud.lastOkAt = Date.now(); s.settings.cloud.lastError = null; }
        else { s.settings.cloud.lastError = result.error || "?"; }
      }).then(function () { return result; });
    });
  }
  // iOS may kill the app before the 4 s debounce fires — flush on hide.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && cloudTimer) { clearTimeout(cloudTimer); cloudTimer = null; cloudBackupNow(); }
  });

  // Fetches the latest cloud backup without applying it (preview step).
  function cloudPeek(token, gistId) {
    var fetchFn = window.fetch.bind(window);
    var found = gistId ? Promise.resolve({ ok: true, gistId: gistId }) : MathCore.Cloud.findGist(fetchFn, token);
    return found.then(function (f) {
      if (!f.ok) return f;
      return MathCore.Cloud.fetchLatest(fetchFn, { token: token, gistId: f.gistId }).then(function (latest) {
        if (!latest.ok) return latest;
        var count = 0;
        try { var parsed = JSON.parse(latest.json); count = Array.isArray(parsed.sessions) ? parsed.sessions.length : 0; } catch (e) { return { ok: false, error: "invalid JSON" }; }
        return { ok: true, gistId: f.gistId, json: latest.json, updatedAt: latest.updatedAt, sessions: count };
      });
    });
  }

  function cloudApply(token, gistId, json) {
    return App.storage.importJson(json, Date.now()).then(function (imp) {
      if (!imp.ok) return { ok: false, error: (imp.problems || [imp.error || "?"]).join(", ") };
      return maybeRebuildEvidence().then(function () {
        return save(function (s) { s.settings.cloud = { token: token, gistId: gistId, lastOkAt: Date.now(), lastError: null, restoreFromGistId: null }; }).then(function (result) {
          return result.ok ? { ok: true } : { ok: false, error: T.saveFailure };
        });
      });
    });
  }

  function cloudRestore(token, gistId) {
    var fetchFn = window.fetch.bind(window);
    var found = gistId ? Promise.resolve({ ok: true, gistId: gistId }) : MathCore.Cloud.findGist(fetchFn, token);
    return found.then(function (f) {
      if (!f.ok) return f;
      return MathCore.Cloud.fetchLatest(fetchFn, { token: token, gistId: f.gistId }).then(function (latest) {
        if (!latest.ok) return latest;
        return App.storage.importJson(latest.json, Date.now()).then(function (imp) {
          if (!imp.ok) return { ok: false, error: (imp.problems || [imp.error || "?"]).join(", ") };
          return maybeRebuildEvidence().then(function () {
            return save(function (s) { s.settings.cloud = { token: token, gistId: f.gistId, lastOkAt: Date.now(), lastError: null }; }).then(function (result) {
              return result.ok ? { ok: true, updatedAt: latest.updatedAt } : { ok: false, error: T.saveFailure };
            });
          });
        });
      });
    });
  }

  // Confetti burst (P3): CSS-only pieces, removed after they fall.
  function confettiBurst(count) {
    var layer = document.createElement("div");
    layer.className = "confetti-layer";
    var colors = ["#4F7CFF", "#3CC97A", "#FFC93C", "#FF9F68", "#FF6FB5"];
    for (var i = 0; i < count; i++) {
      var piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "vw";
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty("--dur", (0.9 + Math.random() * 0.8) + "s");
      piece.style.animationDelay = Math.random() * 0.25 + "s";
      layer.appendChild(piece);
    }
    document.body.appendChild(layer);
    setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, CONFIG.ANIMATION_MAX_MS + 300);
  }

  function fireworksShow() {
    var layer = document.createElement("div");
    layer.className = "fireworks";
    var colors = ["#4F7CFF", "#3CC97A", "#FFC93C", "#FF9F68", "#FF6FB5"];
    for (var i = 0; i < 6; i++) {
      var f = document.createElement("span");
      f.className = "firework";
      f.style.left = 15 + Math.random() * 70 + "vw";
      f.style.top = 10 + Math.random() * 50 + "vh";
      f.style.color = colors[i % colors.length];
      f.style.animationDelay = i * 0.35 + "s";
      layer.appendChild(f);
    }
    document.body.appendChild(layer);
    setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 4500);
  }

  var APP_VERSION = "0.17.0"; // set by tools/bump-version.js — do not hand-edit

  // ------------------------------------------------------------------
  // Boot / storage glue
  // ------------------------------------------------------------------
  var mapSelectedStation = null; // journey map: tapped station (reset when leaving the map)
  var App = { pendingContinue: null, storage: null, channel: null, questionTimer: null, feedbackLock: false, lastSessionResult: null, parentUnlocked: false, pendingImport: null, updateAvailable: false };
  window.App = App;

  function S() { return App.storage.state; }

  // docs/WALL-DESIGN.md §1 / V2-DESIGN §4.4 (package 4): the parked session
  // of `mode`, if any — schema 3 replaces the single `state.parked` object
  // with `state.parkedSessions` (array, at most two).
  function parkedOf(state, mode) {
    var list = state.parkedSessions;
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) {
      if ((list[i].mode || "typed") === mode) return list[i];
    }
    return null;
  }

  function anySuspended(state) {
    return !!(state.active || (Array.isArray(state.parkedSessions) && state.parkedSessions.length > 0));
  }

  function showStale() {
    var el = document.getElementById("stale-card");
    el.textContent = T.staleCard;
    el.style.display = "flex";
  }

  function showSaveFailureBanner(message) {
    var el = document.getElementById("save-failure-banner");
    el.textContent = message || T.saveFailure;
    el.style.display = "block";
  }

  function hideSaveFailureBanner() {
    document.getElementById("save-failure-banner").style.display = "none";
  }

  function wireStorageReactions() {
    var originalSave = App.storage.save.bind(App.storage);
    App.storage.save = function (mutator, now) {
      return originalSave(mutator, now == null ? Date.now() : now).then(function (result) {
        if (result.ok) {
          hideSaveFailureBanner();
          if (App.channel) App.channel.postMessage({ type: "saved", rev: App.storage.rev });
        } else if (result.stale) {
          showStale();
        } else {
          showSaveFailureBanner();
        }
        return result;
      });
    };
  }

  function save(mutator) {
    return App.storage.save(mutator, Date.now());
  }

  // Closing-review 0-R MEDIUM-2: import/restore (backupThenReplace) does not
  // itself trigger the evidence rebuild — without this, an imported backup
  // stays un-rebuilt until the NEXT cold boot. Every UI path that lands a new
  // state via backupThenReplace (import confirm, restore-lastgood, cloud
  // restore/apply) calls this immediately after success, before rendering.
  function maybeRebuildEvidence() {
    if (MathCore.Migrate.evidenceRebuildPending(S())) {
      return save(function (s) { MathCore.Migrate.rebuildEvidence(s, Date.now()); });
    }
    return Promise.resolve();
  }

  function isCoarsePointer() {
    return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  }

  function isStandaloneDisplay() {
    return window.matchMedia && window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  // ------------------------------------------------------------------
  // Router
  // ------------------------------------------------------------------
  var Screens = {};

  function currentHashScreen() {
    var m = /screen=([a-zA-Z-]+)/.exec(location.hash);
    return m ? m[1] : "home";
  }

  // Routes exactly once per navigation: if the hash actually changes, the
  // `hashchange` listener below calls route(); if the target hash is already
  // current (hashchange would not fire), call route() here instead. Never
  // both — a double route() call raced SessionCore.paint()'s own
  // already-current-question "resume" detection and wrongly marked the
  // very first question of a session as interrupted (caught via live
  // browser testing, not by any unit test).
  function navigate(screen) {
    var target = "#screen=" + screen;
    if (location.hash === target) {
      route();
    } else {
      location.hash = target;
    }
  }

  function render(html) {
    document.getElementById("app").innerHTML = html;
  }

  // Tracks the screen route() last rendered so the parent re-lock below
  // fires on ANY way of leaving "parent" — not just navigate() calls.
  // A browser/PWA back-gesture or hash edit fires hashchange -> route()
  // directly, bypassing navigate() entirely; re-locking only inside
  // navigate() left the dashboard unlocked for whoever opened it next
  // (WP9 review finding A).
  var lastRoutedScreen = null;

  function route() {
    clearInterval(challengeTimerHandle); // never leave a challenge timer running behind a navigated-away screen
    clearTimeout(App.feedbackTimer); // P9: a pending answer-feedback timer must not paint a question over another screen
    clearFallingKeyHandler(); // never leave a falling-mode document keydown listener behind a navigated-away screen
    clearWallKeyHandler(); // ditto for wall mode
    clearWallCountdown(); // never leave a wall reduced-motion countdown ticking behind a navigated-away screen
    App.pendingContinue = null;
    App.feedbackLock = false;
    var layers = document.querySelectorAll(".confetti-layer, .fireworks");
    for (var li = 0; li < layers.length; li++) layers[li].parentNode.removeChild(layers[li]);
    // Leaving the parent area re-locks it (PIN required again next time),
    // regardless of how we got here.
    if (lastRoutedScreen === "parent" && currentHashScreen() !== "parent") {
      App.parentUnlocked = false;
    }
    if (lastRoutedScreen === "map" && currentHashScreen() !== "map") mapSelectedStation = null; // any way of leaving
    var state = S();
    if (!state.settings.pinHash) {
      Screens.parentSetup();
      return;
    }
    var name = currentHashScreen();
    lastRoutedScreen = name;
    var fn = Screens[name] || Screens.home;
    fn();
    refreshUpdateToast();
  }

  window.addEventListener("hashchange", route);

  // Update toast only ever shows on Home (DESIGN §11 "never mid-session") —
  // re-evaluated on every route() call, not just when the SW message
  // arrives, so navigating to/away from Home while an update is pending
  // shows/hides it correctly.
  function refreshUpdateToast() {
    var el = document.getElementById("update-toast");
    var show = App.updateAvailable && currentHashScreen() === "home";
    el.style.display = show ? "flex" : "none";
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    // P7: on the very first visit there is no controller yet; the SW's first
    // activation then posts "updated", which is an install, not an update.
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch(function () { /* best-effort */ });
    navigator.serviceWorker.addEventListener("message", function (ev) {
      if (ev.data && ev.data.type === "updated" && hadController) {
        App.updateAvailable = true;
        document.getElementById("update-toast-text").textContent = T.misc.updateAvailable;
        refreshUpdateToast();
      }
    });
  }

  // ------------------------------------------------------------------
  // Screen: Parent setup (D15) — gates everything else until pinHash is set.
  // ------------------------------------------------------------------
  Screens.parentSetup = function () {
    var snapshot = App.storage.readLastGood();
    var snapSessions = snapshot && snapshot.state && Array.isArray(snapshot.state.sessions) ? snapshot.state.sessions.length : 0;
    var currentSessions = App.storage.state && Array.isArray(App.storage.state.sessions) ? App.storage.state.sessions.length : 0;
    var restoreHtml = snapSessions > currentSessions
      ? '<div class="restore-banner">' + T.parentSetup.restoreFound(snapSessions) + '<br><br><button data-action="restore-lastgood">' + T.parentSetup.restoreBtn + "</button></div>"
      : "";
    var cloudHtml =
      '<div class="muted" style="margin-top:1rem">' + T.parentSetup.cloudRestoreTitle + "</div>" +
      '<input id="setup-cloud-token" type="password" autocomplete="off" placeholder="' + T.parent.cloudTokenPlaceholder + '" style="width:min(300px,80vw)" /> ' +
      '<button class="secondary" data-action="setup-cloud-restore">' + T.parentSetup.cloudRestoreBtn + "</button>" +
      '<div id="setup-cloud-msg" class="muted" style="min-height:1.2em"></div>';
    render(
      '<div class="screen" data-screen="parent-setup">' +
        '<div class="card" style="width:min(420px,92vw)">' +
        restoreHtml +
        "<h1>" + T.parentSetup.title + "</h1>" +
        '<div class="muted" id="setup-error" style="min-height:1.2em"></div>' +
        '<label>' + T.parentSetup.nameLabel + '<br>' +
        '<input id="setup-name" type="text" placeholder="' + T.parentSetup.namePlaceholder + '" /></label><br><br>' +
        '<label>' + T.parentSetup.pinLabel + '<br>' +
        '<input id="setup-pin" type="password" inputmode="numeric" maxlength="4" /></label><br><br>' +
        '<label>' + T.parentSetup.pinConfirmLabel + '<br>' +
        '<input id="setup-pin-confirm" type="password" inputmode="numeric" maxlength="4" /></label><br><br>' +
        '<button data-action="setup-continue">' + T.parentSetup.continueBtn + "</button>" +
        cloudHtml +
        "</div></div>"
    );
    bindAction("setup-cloud-restore", function () {
      var token = (document.getElementById("setup-cloud-token").value || "").trim();
      var m = document.getElementById("setup-cloud-msg");
      if (!token) return;
      m.textContent = T.parent.cloudChecking;
      cloudRestore(token, null).then(function (r) {
        if (r.ok) { route(); var e = document.getElementById("setup-error"); if (e) e.textContent = T.parentSetup.restoreThenSetup; }
        else m.textContent = T.parent.restoreFailed(r.error || "?");
      });
    });
    document.querySelector('[data-action="setup-continue"]').addEventListener("click", onSetupContinue);
    bindAction("restore-lastgood", function () {
      App.storage.restoreLastGood(Date.now()).then(function (result) {
        if (result.ok) {
          maybeRebuildEvidence().then(function () {
            route();
            var e = document.getElementById("setup-error");
            if (e) e.textContent = T.parentSetup.restoreThenSetup;
          });
        }
        else { document.getElementById("setup-error").textContent = T.parentSetup.restoreFailed(result.error || result.stale && T.staleCard || "?"); }
      });
    });
  };

  function onSetupContinue() {
    var name = document.getElementById("setup-name").value.trim();
    var pin = document.getElementById("setup-pin").value;
    var pinConfirm = document.getElementById("setup-pin-confirm").value;
    var errorEl = document.getElementById("setup-error");

    if (!name) { errorEl.textContent = T.parentSetup.errorName; return; }
    if (!MathCore.Pin.isValidFormat(pin)) { errorEl.textContent = T.parentSetup.errorPinFormat; return; }
    if (pin !== pinConfirm) { errorEl.textContent = T.parentSetup.errorPinMismatch; return; }

    var cryptoObj = window.crypto;
    var recoveryCode = MathCore.Pin.generateRecoveryCode(cryptoObj);
    MathCore.Pin.hash(cryptoObj, pin).then(function (pinHash) {
      return MathCore.Pin.hash(cryptoObj, recoveryCode).then(function (recoveryHash) {
        return save(function (s) {
          s.settings.childName = name;
          s.settings.pinHash = pinHash;
          s.settings.recoveryHash = recoveryHash;
        });
      });
    }).then(function (result) {
      if (result.ok) showRecoveryCode(recoveryCode);
      else errorEl.textContent = T.saveFailure;
    });
  }

  function showRecoveryCode(code) {
    render(
      '<div class="screen" data-screen="parent-setup-recovery">' +
        '<div class="card" style="width:min(420px,92vw)">' +
        "<h1>" + T.parentSetup.recoveryTitle + "</h1>" +
        '<p class="ltr" style="font-size:2rem;font-weight:bold;letter-spacing:0.2em">' + escapeHtml(code) + "</p>" +
        "<p>" + T.parentSetup.recoveryHint + "</p>" +
        '<label><input type="checkbox" id="recovery-ack" /> ' + T.parentSetup.recoveryCheckbox + "</label><br><br>" +
        '<button id="recovery-finish" disabled>' + T.parentSetup.finishBtn + "</button>" +
        "</div></div>"
    );
    var ack = document.getElementById("recovery-ack");
    var finishBtn = document.getElementById("recovery-finish");
    ack.addEventListener("change", function () { finishBtn.disabled = !ack.checked; });
    finishBtn.addEventListener("click", function () { navigate("home"); });
  }

  // Shared by Home and the falling screen (WP-A, Marat 2026-08-28): the same
  // "🐢 station X/Y" or "reached the castle" line, computed once.
  function mapStatusLine(state) {
    var station = MathCore.Map.currentStation(state);
    return station === null ? T.home.mapDone : T.home.mapStatus(station, MathCore.Map.progress(state, station), CONFIG.STATION_REQUIRED);
  }

  // ------------------------------------------------------------------
  // Screen: Home (DESIGN §9.1)
  // ------------------------------------------------------------------
  Screens.home = function () {
    var state = S();
    var totals = MathCore.Stats.totals(state, Date.now());
    var hasActive = !!state.active;
    var showInstall = !isStandaloneDisplay() && /iPad|iPhone|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent);
    var lastExport = state.lastExportAt;
    var daysSinceExport = lastExport ? (Date.now() - lastExport) / (1000 * 60 * 60 * 24) : Infinity;
    var showBackup = daysSinceExport > 14 && state.sessions.length > 0;
    var childName = (state.settings.childName || "").trim();
    var mapLine = mapStatusLine(state);
    var activeMode = hasActive ? (state.active.mode || "typed") : null;
    var typedOpen = activeMode === "typed" || !!parkedOf(state, "typed");
    var fallingOpen = activeMode === "falling" || !!parkedOf(state, "falling");
    var wallOpen = activeMode === "wall" || !!parkedOf(state, "wall");
    var showFallingBtn = !!(state.settings.falling && state.settings.falling.enabled) || fallingOpen;
    var showWallBtn = !!(state.settings.wall && state.settings.wall.enabled) || wallOpen;

    render(
      '<div class="screen" data-screen="home">' +
        "<h1>" + T.appTitle + "</h1>" +
        (childName ? "<h2>" + T.home.greeting(escapeHtml(childName)) + "</h2>" : "") +
        '<div class="coin-pill">🪙 ' + bdi(totals.lifetimeCoins) + "</div>" +
        (totals.dailyStreak > 1 ? '<div class="muted">' + T.home.streakLabel(totals.dailyStreak) + "</div>" : "") +
        '<div class="map-status">' + mapLine + "</div>" +
        (showFallingBtn ? '<div><button data-action="play-falling">' + (fallingOpen ? T.home.resumeFallingCta : T.home.fallingBtn) + "</button></div>" : "") +
        (showWallBtn ? '<div><button data-action="play-wall">' + (wallOpen ? T.home.resumeWallCta : T.home.wallBtn) + "</button></div>" : "") +
        '<div><button data-action="play">' + (typedOpen ? T.home.resumeCta : T.home.startCta) + "</button></div>" +
        '<div><button class="secondary" data-action="nav-map">' + T.home.mapBtn + "</button> " +
        '<button class="secondary" data-action="nav-collection">' + T.home.collectionBtn + "</button> " +
        '<button class="secondary" data-action="nav-rewards">' + T.home.rewardsBtn + "</button></div>" +
        (showInstall ? '<div id="install-banner">' + T.home.installBanner + "</div>" : "") +
        (showBackup ? '<div id="backup-banner">' + T.home.backupBanner + "</div>" : "") +
        '<button class="ghost" data-action="nav-parent">' + T.home.parentBtn + "</button>" +
        "</div>"
    );

    bindAction("play", startOrResumeSession);
    bindAction("play-falling", startFallingSession);
    bindAction("play-wall", startWallSession);
    bindAction("nav-collection", function () { navigate("collection"); });
    bindAction("nav-rewards", function () { navigate("rewards"); });
    bindAction("nav-map", function () { navigate("map"); });
    bindAction("nav-parent", function () { navigate("parent"); });
  };

  // P8: Enter on Home starts/resumes (DESIGN §9.1).
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" || ev.repeat) return;
    if (currentHashScreen() !== "home") return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return; // a focused button handles Enter itself
    if (!App.storage || !App.storage.state || !App.storage.state.settings.pinHash) return;
    startOrResumeSession();
  });

  // Typed mode: resume (with the parent's CURRENT settings) or start; a
  // suspended session of another mode is parked meanwhile and returns when
  // this one ends (docs/WALL-DESIGN.md §1 / V2-DESIGN §4.4 — up to two
  // other modes can be parked at once, state.parkedSessions).
  function startOrResumeSession() { switchMode("typed"); }

  function switchMode(mode) {
    save(function (s) { MathCore.SessionCore.switchTo(s, mode, Math.random, Date.now()); }).then(function (result) {
      if (result.ok) { navigate("question"); }
    }).catch(function (err) { showSaveFailureBanner(String((err && err.message) || err)); }); // e.g. PARKED_FULL from a hand-edited backup — never a silently dead button
  }

  // Falling mode entry (docs/FALLING-DESIGN.md F1). Since 2026-08-28 a suspended
  // session of another mode is parked (state.parkedSessions) and returns when
  // this one ends, so the balloon game is always reachable.
  function startFallingSession() { switchMode("falling"); }

  // Wall mode entry (docs/WALL-DESIGN.md §1) — same parking behaviour as falling.
  function startWallSession() { switchMode("wall"); }

  function bindAction(action, handler) {
    var el = document.querySelector('[data-action="' + action + '"]');
    if (el) el.addEventListener("click", handler);
  }

  // ------------------------------------------------------------------
  // Screen: Question (DESIGN §9.2, §7 timing, §6 runtime)
  // ------------------------------------------------------------------
  var questionInput = "";

  Screens.question = function () {
    var state = S();
    if (!state.active) { navigate("home"); return; }
    App.feedbackLock = false;
    paintNextQuestion();
  };

  // requestAnimationFrame alone never fires while the document is hidden
  // (backgrounded tab / momentarily unfocused) — confirmed live: a bare
  // rAF() left the app permanently stuck on a stale screen with the correct
  // hash but no re-render, no error, no way forward. Race it against a
  // short timeout so painting the next question — a correctness-critical
  // operation, not just an animation — always eventually happens; rAF still
  // wins (and keeps the "capture shownAt after an actual paint" precision
  // DESIGN §7 wants) in the overwhelmingly common foreground case.
  function nextFrame(callback) {
    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      callback();
    }
    requestAnimationFrame(fire);
    setTimeout(fire, 50);
  }

  function paintNextQuestion() {
    var state = S();
    if (!state.active) { navigate("home"); return; }
    // A leftover `current` (return visit / relaunch / parked) is deferred by
    // SessionCore.paint itself, so every arrival paints a fresh question with
    // a live clock (2026-08-28). The old "mark interrupted" branch is gone.

    nextFrame(function () {
      save(function (s) { return MathCore.SessionCore.paint(s, Date.now()); }).then(function (result) {
        if (!result.ok) return; // stale/error already surfaced via banner/stale card
        if (!result.value) { finishSession(); } else { renderCurrentQuestion(); }
      });
    });
  }

  // Screens.question dispatches on active.mode (docs/FALLING-DESIGN.md F1-F10):
  // typed keeps the existing renderQuestion; falling gets renderFallingQuestion.
  // Everything upstream of this call (paintNextQuestion, SessionCore.paint/
  // submit/finish, showFeedback, finishSession) is shared between both modes.
  function renderCurrentQuestion() {
    var state = S();
    var mode = state.active && state.active.mode;
    if (mode === "falling") renderFallingQuestion();
    else if (mode === "wall") renderWallQuestion();
    else renderQuestion();
  }

  // S3-3: shared by renderQuestion and renderFallingQuestion — both need the
  // same current-question dots/done-count/coin value, computed identically.
  // Dots reflect actual per-fact resolution state, not just "how many
  // attempts have happened so far" — a wrong first attempt must show as
  // pending-retry (DESIGN §6 "retries show 🔁"), not as done (caught via
  // live browser testing: a missed question's dot was rendering green).
  function questionViewModel(state) {
    var active = state.active;
    var current = active.current;
    if (!current) return null;
    var parts = MathCore.Facts.parts(current.asked);
    var retrySet = {};
    active.retryQueue.forEach(function (asked) { retrySet[asked] = true; });
    var resolvedSet = {};
    active.attempts.forEach(function (a) { if (a.ok) resolvedSet[a.asked] = true; });
    var dotsHtml = active.planned.map(function (asked) {
      var cls = "dot";
      if (retrySet[asked]) cls = "dot retry";
      else if (resolvedSet[asked]) cls = "dot done";
      return '<span class="' + cls + '"></span>';
    }).join("");
    var doneOrRetryCount = active.planned.filter(function (asked) { return resolvedSet[asked] || retrySet[asked]; }).length;
    var value = MathCore.Facts.value(state, current.key);
    return { active: active, current: current, parts: parts, dotsHtml: dotsHtml, doneOrRetryCount: doneOrRetryCount, value: value };
  }

  function renderQuestion() {
    var state = S();
    var vm = questionViewModel(state);
    if (!vm) return;
    var active = vm.active, current = vm.current, parts = vm.parts, dotsHtml = vm.dotsHtml, doneOrRetryCount = vm.doneOrRetryCount, value = vm.value;
    questionInput = "";
    var coarse = state.settings.forceNumpad !== false && (isCoarsePointer() || state.settings.forceNumpad === true);
    var challengeOn = active.settingsSnapshot.challengeOn && !current.interrupted;

    // Two groups (.question-info / .question-input) so a landscape/short-height
    // layout (iPhone SE landscape, iPad Split View — real device heights as
    // low as ~330px, confirmed via live browser resize testing) can place
    // them side-by-side instead of stacked; a 4-row numpad plus equation
    // simply does not fit a ~330px viewport stacked vertically regardless of
    // how much the equation font shrinks.
    render(
      '<div class="screen" data-screen="question">' +
        audienceHtml(state, active.id) +
        '<button class="ghost" data-action="exit" style="position:absolute;top:0.5rem;inset-inline-end:0.5rem">' + T.question.exitButton + "</button>" +
        '<div class="question-info">' +
        '<div class="dots">' + dotsHtml + "</div>" +
        '<div class="dots-text muted">' + doneOrRetryCount + "/" + active.planned.length + "</div>" +
        (current.interrupted ? '<div class="muted">' + T.question.interruptedLabel + "</div>" :
          challengeOn ? '<div class="turtle-track" id="turtle-track"><div class="turtle-path"></div><span class="turtle-flag">🏁</span><span class="turtle" id="turtle">🐢</span></div>' : "") +
        '<div class="coin-pill">' + T.question.equalsCoin(value) + "</div>" +
        '<div class="equation ltr" id="equation">' +
        "<span>" + parts[0] + "</span><span>×</span><span>" + parts[1] + "</span><span>=</span>" +
        '<input id="answer-input" ' + (coarse ? 'readonly inputmode="none"' : 'inputmode="numeric"') + ' value="" />' +
        "</div>" +
        (current.mirror ? '<div class="muted mirror-hint">' + T.question.mirrorHint + "</div>" : "") +
        "</div>" +
        '<div class="question-input">' +
        (coarse ? renderNumpad() : "") +
        '<button class="ghost" data-action="toggle-keyboard">' + (coarse ? T.question.showKeyboard : T.question.showNumpad) + "</button>" +
        '<button class="ghost" data-action="exit-bottom">' + T.question.exitBottom + "</button>" +
        "</div>" +
        "</div>"
    );

    bindAction("exit", onExitClick);
    bindAction("exit-bottom", onExitClick);
    bindAction("toggle-keyboard", function () {
      save(function (s) { s.settings.forceNumpad = !coarse; }).then(function (result) { if (result.ok) renderQuestion(); });
    });

    if (coarse) {
      document.querySelectorAll(".numpad button").forEach(function (btn) {
        btn.addEventListener("click", function () { onNumpadPress(btn.dataset.key); });
      });
    } else {
      var input = document.getElementById("answer-input");
      input.removeAttribute("readonly");
      input.focus();
      input.addEventListener("keydown", onKeyboardKeydown);
    }

    if (challengeOn) startChallengeTimer(active.settingsSnapshot.timeLimitSec);
  }

  // ------------------------------------------------------------------
  // Screen: Falling question (docs/FALLING-DESIGN.md) — shares dots/coin
  // badge/exit buttons/paintNextQuestion/submitAnswer(value)/showFeedback/
  // finishSession with the typed screen; only the candidate layout differs.
  // ------------------------------------------------------------------
  var fallingKeyHandler = null;

  function clearFallingKeyHandler() {
    if (fallingKeyHandler) {
      document.removeEventListener("keydown", fallingKeyHandler);
      fallingKeyHandler = null;
    }
  }

  // A tiny seeded PRNG (mulberry32): the candidate set is a pure function of
  // (active.id, current.asked, current.shownAt), so ANY re-render of the SAME
  // `current` reproduces the same candidates without core.js needing to
  // persist them on state.active.
  function seededRngFromString(str) {
    var seed = 0;
    for (var i = 0; i < str.length; i++) seed = (Math.imul(seed, 31) + str.charCodeAt(i)) | 0;
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------
  // Spectators ("הקהל", V2-DESIGN §3.2): a purely decorative strip on both
  // question screens (and the summary when perfect). Zero layout impact by
  // construction — the caller places this HTML as an absolutely-positioned,
  // pointer-events:none sibling (see styles.css .audience); it never affects
  // .lanes/.question-info geometry. Membership is a pure function of
  // `seedKey` (active.id for a question screen, session.id for the summary)
  // so it stays stable across re-renders of the SAME screen. Members are the
  // newest unlocked sticker + up to AUDIENCE_MAX-1 others, seeded-shuffled;
  // drawn only from ids present in CONFIG.STICKERS (canonicalisation already
  // guarantees state.economy.unlocked contains only known ids).
  function audienceHtml(state, seedKey, opts) {
    var unlocked = (state.economy.unlocked || []).filter(function (id) { return CONFIG.STICKERS.indexOf(id) !== -1; });
    if (!unlocked.length) return ""; // no stickers yet -> strip absent
    var newest = unlocked[unlocked.length - 1];
    var rest = unlocked.slice(0, -1);
    var rng = seededRngFromString(String(seedKey) + ":audience");
    var shuffled = rest.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }
    var members = [newest].concat(shuffled.slice(0, CONFIG.AUDIENCE_MAX - 1));
    var goldenSet = {};
    MathCore.Economy.goldenStickers(state).forEach(function (id) { goldenSet[id] = true; });
    var allBounce = opts && opts.allBounce;
    var itemsHtml = members.map(function (id, i) {
      var cls = "audience-member" + (allBounce ? " audience-bounce" : "") + (goldenSet[id] ? " golden" : "");
      return '<span class="' + cls + '" style="--ai:' + i + '">' + stickerArt(id) + "</span>";
    }).join("");
    return '<div class="audience">' + itemsHtml + "</div>";
  }

  function renderFallingQuestion() {
    var state = S();
    var vm = questionViewModel(state);
    if (!vm) return;
    var active = vm.active, current = vm.current, parts = vm.parts, dotsHtml = vm.dotsHtml, doneOrRetryCount = vm.doneOrRetryCount, value = vm.value;
    clearFallingKeyHandler();

    var fallingSnapshot = active.settingsSnapshot.falling || {};
    var options = fallingSnapshot.options || CONFIG.FALLING.DEFAULT_OPTIONS;
    var durationSec = fallingSnapshot.durationSec || CONFIG.FALLING.DEFAULT_DURATION_SEC;
    var rng = seededRngFromString(active.id + ":" + current.asked + ":" + current.shownAt);
    var candidateValues = MathCore.Falling.candidates(parts[0], parts[1], options, rng);

    var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var visuallyLanded = !!current.interrupted || reducedMotion;

    var bubblesHtml = candidateValues.map(function (v, i) {
      // `v` is always a number from MathCore.Falling.candidates, never user input.
      return (
        '<div class="lane"><button class="bubble' + (visuallyLanded ? " landed" : "") + '" data-value="' + Number(v) + '" data-lane="' + i + '">' +
        Number(v) +
        "</button></div>"
      );
    }).join("");

    render(
      '<div class="screen" data-screen="question" data-falling="1" style="--fall:' + durationSec + 's;--fall-delay:' + CONFIG.FALLING.START_DELAY_MS + 'ms">' +
        '<div class="cloud" style="top:8%;--cd:46s;animation-delay:-12s"></div>' +
        '<div class="cloud" style="top:30%;--cd:60s;animation-delay:-35s;--cs:0.7"></div>' +
        '<div class="cloud" style="top:55%;--cd:52s;animation-delay:-5s;opacity:0.6"></div>' +
        audienceHtml(state, active.id) +
        '<button class="ghost" data-action="exit" style="position:absolute;top:0.5rem;inset-inline-end:0.5rem;z-index:4">' + T.question.exitButton + "</button>" +
        '<div class="question-info">' +
        '<div class="dots">' + dotsHtml + "</div>" +
        '<div class="dots-text muted">' + doneOrRetryCount + "/" + active.planned.length + "</div>" +
        '<div class="map-status">' + mapStatusLine(state) + "</div>" +
        (current.interrupted ? '<div class="muted interrupted-label">' + T.question.interruptedLabel + "</div>" : "") +
        '<div class="coin-pill">' + T.question.equalsCoin(value) + "</div>" +
        '<div class="equation ltr" id="equation">' +
        "<span>" + parts[0] + "</span><span>×</span><span>" + parts[1] + "</span>" +
        "</div>" +
        (current.mirror ? '<div class="muted mirror-hint">' + T.question.mirrorHint + "</div>" : "") +
        "</div>" +
        '<div class="lanes" data-n="' + Number(options) + '">' + bubblesHtml + "</div>" +
        '<div class="muted falling-landed-label" id="falling-landed-label">' + (visuallyLanded ? T.question.fallingLandedLabel : "") + "</div>" +
        '<button class="ghost" data-action="exit-bottom">' + T.question.exitBottom + "</button>" +
        "</div>"
    );

    bindAction("exit", onExitClick);
    bindAction("exit-bottom", onExitClick);

    var bubbleEls = document.querySelectorAll(".bubble");
    bubbleEls.forEach(function (btn) {
      if (!visuallyLanded) {
        btn.addEventListener("animationend", function (ev) {
          if (ev.animationName !== "bubble-fall") return; // sway/pop/deflate ends must not mark "landed"
          if (btn.classList.contains("popped") || btn.classList.contains("flyaway") || btn.classList.contains("wrongpick")) return;
          btn.classList.add("landed");
          var allLanded = Array.prototype.every.call(document.querySelectorAll(".bubble"), function (b) { return b.classList.contains("landed"); });
          if (allLanded) {
            var lbl = document.getElementById("falling-landed-label");
            if (lbl) lbl.textContent = T.question.fallingLandedLabel;
          }
        });
      }
      btn.addEventListener("click", function () {
        if (App.feedbackLock) return;
        document.querySelectorAll(".bubble.picked").forEach(function (b) { b.classList.remove("picked"); }); // a failed save must not leave a stale pick
        btn.classList.add("picked");
        submitAnswer(Number(btn.dataset.value));
      });
    });

    // Keyboard path (Mac): keys 1..N pick the bubble in that lane, left→right
    // (the lanes container is forced `direction:ltr`, so DOM order === visual
    // left→right order regardless of the page's own RTL direction).
    fallingKeyHandler = function (ev) {
      if (App.feedbackLock) return;
      if (document.querySelector('[data-action="exit-yes"]')) return; // exit-confirm overlay is open
      var n = Number(ev.key);
      if (!n || n < 1 || n > options) return;
      var btn = document.querySelector('.bubble[data-lane="' + (n - 1) + '"]');
      if (btn) { document.querySelectorAll(".bubble.picked").forEach(function (b) { b.classList.remove("picked"); }); btn.classList.add("picked"); submitAnswer(Number(btn.dataset.value)); }
    };
    document.addEventListener("keydown", fallingKeyHandler);
  }

  // ------------------------------------------------------------------
  // Screen: Wall question (docs/WALL-DESIGN.md) — "בונים קיר". Shares dots/
  // coin badge/exit buttons/paintNextQuestion/submitAnswer/showFeedback/
  // finishSession with the typed/falling screens; only the well + option
  // row differ. The well/column position is UI-local (never saved except
  // with the answer, per §1); the reducer (core.js Wall.step) is the only
  // source of truth for the grid — this screen only PREVIEWS the landing
  // row from the CURRENT (pre-answer) grid, which core.js computes the
  // exact same way, so the preview and the real placement never disagree.
  // ------------------------------------------------------------------
  var wallKeyHandler = null;
  var wallCountdownHandle = null;
  var wallX = null; // UI-local column, re-centred on every new question
  var wallQuestionKey = null;

  function clearWallKeyHandler() {
    if (wallKeyHandler) { document.removeEventListener("keydown", wallKeyHandler); wallKeyHandler = null; }
  }
  function clearWallCountdown() {
    clearInterval(wallCountdownHandle);
    wallCountdownHandle = null;
  }

  function showWallResetToast() {
    var el = document.createElement("div");
    el.className = "wall-toast";
    el.textContent = T.wall.full;
    document.body.appendChild(el);
    try { confettiBurst(24); } catch (e) { /* decoration only */ }
    // Reuses CONFIG.WRONG_ANSWER_DISPLAY_MS (I7: no new magic number for a
    // second transient-message duration that plays the same role).
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, CONFIG.WRONG_ANSWER_DISPLAY_MS);
  }

  function renderWallQuestion() {
    var state = S();
    var vm = questionViewModel(state);
    if (!vm) return;
    var active = vm.active, current = vm.current, parts = vm.parts, dotsHtml = vm.dotsHtml, doneOrRetryCount = vm.doneOrRetryCount, value = vm.value;
    clearWallKeyHandler();
    clearWallCountdown();

    var wallSnapshot = active.settingsSnapshot.wall || {};
    var options = wallSnapshot.options || CONFIG.WALL.DEFAULT_OPTIONS;
    var durationSec = wallSnapshot.durationSec || CONFIG.WALL.DEFAULT_DURATION_SEC;
    var rng = seededRngFromString(active.id + ":" + current.asked + ":" + current.shownAt);
    var candidateValues = MathCore.Falling.candidates(parts[0], parts[1], options, rng);

    var cols = CONFIG.WALL.COLS, rows = CONFIG.WALL.ROWS;
    var w = parts[0], h = parts[1];
    var grid = (active.wall && active.wall.grid) || MathCore.Wall.emptyGrid(rows, cols);

    // A deferred piece (or any new question) re-centres (§1 "a deferred
    // piece re-centres"); moving within the SAME question keeps its spot.
    var questionKey = current.asked + ":" + current.shownAt;
    if (wallQuestionKey !== questionKey || wallX === null) {
      wallX = Math.max(0, Math.min(cols - w, Math.floor((cols - w) / 2)));
      wallQuestionKey = questionKey;
    }
    wallX = Math.max(0, Math.min(cols - w, wallX));

    var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var deadline = current.shownAt + durationSec * 1000;
    var alreadyLanded = !!current.interrupted;

    function previewLandingRow(x) {
      var y = MathCore.Wall.landingRow(grid, x, w, h);
      return y < 0 ? rows - h : y; // a full well always resets into a FRESH (empty) one, which lands at the floor
    }

    var cellsHtml = "";
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var cellV = grid[r][c];
        if (cellV) {
          cellsHtml += '<div class="wall-cell wall-cell-' + cellV + '" style="left:' + (c / cols * 100) + '%;top:' + (r / rows * 100) + '%;width:' + (100 / cols) + '%;height:' + (100 / rows) + '%"></div>';
        }
      }
    }

    var landingTopPct = previewLandingRow(wallX) / rows * 100;
    var startTopPct = -(h / rows * 100);
    var pieceStartsLanded = alreadyLanded; // reduced motion starts NOT landed (counts down first)
    var initialTopPct = pieceStartsLanded ? landingTopPct : startTopPct;
    var pieceHtml =
      '<div class="wall-piece' + (pieceStartsLanded ? " landed" : "") + '" id="wall-piece" style="left:' + (wallX / cols * 100) + '%;top:' + initialTopPct + '%;width:' + (w / cols * 100) + '%;height:' + (h / rows * 100) + '%">' +
      parts[0] + "×" + parts[1] +
      "</div>";

    // Option row: static bubbles reusing `.lanes`/`.lane`/`.bubble` styling
    // (docs/WALL-DESIGN.md §1's rendering note) — always `.landed`, never the
    // falling animation, since these never fall.
    var bubblesHtml = candidateValues.map(function (v, i) {
      return '<div class="lane"><button class="bubble landed" data-value="' + Number(v) + '" data-lane="' + i + '">' + Number(v) + "</button></div>";
    }).join("");

    render(
      '<div class="screen" data-screen="question" data-wall="1" style="--wall-cols:' + cols + ';--wall-rows:' + rows + ';--wall-duration:' + durationSec + 's">' +
        audienceHtml(state, active.id) +
        '<button class="ghost" data-action="exit" style="position:absolute;top:0.5rem;inset-inline-end:0.5rem;z-index:4">' + T.question.exitButton + "</button>" +
        '<div class="question-info">' +
        '<div class="dots">' + dotsHtml + "</div>" +
        '<div class="dots-text muted">' + doneOrRetryCount + "/" + active.planned.length + "</div>" +
        '<div class="map-status">' + mapStatusLine(state) + "</div>" +
        (current.interrupted ? '<div class="muted interrupted-label">' + T.question.interruptedLabel + "</div>" : "") +
        '<div class="coin-pill">' + T.question.equalsCoin(value) + "</div>" +
        '<div class="equation ltr" id="equation"><span>' + parts[0] + "</span><span>×</span><span>" + parts[1] + "</span></div>" +
        (current.mirror ? '<div class="muted mirror-hint">' + T.question.mirrorHint + "</div>" : "") +
        "</div>" +
        '<div class="wall-wrap">' +
        '<div class="wall-well" id="wall-well">' + cellsHtml + pieceHtml + "</div>" +
        '<div class="wall-controls"><button class="secondary" data-action="wall-left">◀</button><button class="secondary" data-action="wall-right">▶</button></div>' +
        "</div>" +
        '<div class="lanes wall-options" data-n="' + Number(options) + '">' + bubblesHtml + "</div>" +
        '<div class="muted falling-landed-label" id="wall-landed-label">' + (pieceStartsLanded ? T.question.fallingLandedLabel : "") + "</div>" +
        '<button class="ghost" data-action="exit-bottom">' + T.question.exitBottom + "</button>" +
        "</div>"
    );

    bindAction("exit", onExitClick);
    bindAction("exit-bottom", onExitClick);

    function moveWallPiece(newX) {
      if (App.feedbackLock) return;
      wallX = Math.max(0, Math.min(cols - w, newX));
      var pieceEl = document.getElementById("wall-piece");
      if (!pieceEl) return;
      pieceEl.style.left = (wallX / cols * 100) + "%";
      var topPct = previewLandingRow(wallX) / rows * 100;
      if (pieceEl.classList.contains("landed") || reducedMotion) {
        pieceEl.style.top = topPct + "%"; // already landed/stationary: move instantly, no fall
      } else {
        // F1 LOW (closing review 2026-08-29): re-targeting `top` mid-fall with
        // the FULL `--wall-duration` would restart a whole new multi-second
        // transition from wherever the piece currently sits, landing well
        // after the real `deadline` (and visually travelling UPWARD if the
        // new column lands higher) — retarget with only the time REMAINING
        // until `deadline` instead, so it still visually lands on time.
        var remainingSec = Math.max(0.05, (deadline - Date.now()) / 1000);
        pieceEl.style.transitionDuration = remainingSec + "s";
        pieceEl.style.top = topPct + "%";
      }
    }

    bindAction("wall-left", function () { moveWallPiece(wallX - 1); });
    bindAction("wall-right", function () { moveWallPiece(wallX + 1); });

    var wellEl = document.getElementById("wall-well");
    if (wellEl) {
      wellEl.addEventListener("click", function (ev) {
        var rect = wellEl.getBoundingClientRect();
        var frac = (ev.clientX - rect.left) / rect.width;
        var col = Math.max(0, Math.min(cols - 1, Math.floor(frac * cols)));
        moveWallPiece(col - Math.floor(w / 2)); // centre the piece under the tap
      });
    }

    var bubbleEls = document.querySelectorAll(".wall-options .bubble");
    bubbleEls.forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (App.feedbackLock) return;
        document.querySelectorAll(".wall-options .bubble.picked").forEach(function (b) { b.classList.remove("picked"); });
        btn.classList.add("picked");
        submitAnswer(Number(btn.dataset.value), { x: wallX });
      });
    });

    wallKeyHandler = function (ev) {
      if (App.feedbackLock) return;
      if (document.querySelector('[data-action="exit-yes"]')) return; // exit-confirm overlay is open
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
        moveWallPiece(wallX + (ev.key === "ArrowLeft" ? -1 : 1));
        ev.preventDefault();
        return;
      }
      var n = Number(ev.key);
      if (!n || n < 1 || n > options) return;
      var btn = document.querySelector('.wall-options .bubble[data-lane="' + (n - 1) + '"]');
      if (btn) { document.querySelectorAll(".wall-options .bubble.picked").forEach(function (b) { b.classList.remove("picked"); }); btn.classList.add("picked"); submitAnswer(Number(btn.dataset.value), { x: wallX }); }
    };
    document.addEventListener("keydown", wallKeyHandler);

    var pieceEl0 = document.getElementById("wall-piece");
    if (!pieceStartsLanded && !reducedMotion) {
      // Trigger the CSS `top` transition one frame after mount (the falling
      // screen's `nextFrame` pattern) — `transitionend` only ever toggles the
      // VISUAL `.landed` class; core.js's `deadline` stays the source of
      // truth for ×2, exactly like falling.
      nextFrame(function () {
        var el = document.getElementById("wall-piece");
        if (!el) return;
        // F1 HIGH (closing review 2026-08-29): without a forced style flush
        // here, the browser can coalesce the insertion style (`top:startTopPct`)
        // and this target-style write into a single paint — no "from" state is
        // ever committed, so the CSS transition never plays: no visible fall,
        // no `transitionend`, `.landed`/the landed label never appear, and the
        // piece silently sits at its landing row from t=0 (confirmed by the
        // reviewer's rv-ui2.js sampler and this build's own wall-390x844-midfall
        // screenshot). Reading a layout property forces the flush.
        void el.offsetHeight;
        el.style.top = landingTopPct + "%";
      });
      if (pieceEl0) {
        pieceEl0.addEventListener("transitionend", function onEnd(ev) {
          if (ev.propertyName !== "top") return;
          pieceEl0.classList.add("landed");
          var lbl = document.getElementById("wall-landed-label");
          if (lbl) lbl.textContent = T.question.fallingLandedLabel;
        });
      }
    } else if (!pieceStartsLanded && reducedMotion) {
      // Reduced motion (§1 rendering note): stationary at the top with a
      // numeric countdown; jumps to the landed position (and gets `.landed`)
      // only once the deadline passes — the phase/×2 rule is unchanged.
      var lbl0 = document.getElementById("wall-landed-label");
      var tick = function () {
        var remaining = deadline - Date.now();
        if (remaining <= 0) {
          clearWallCountdown();
          var el = document.getElementById("wall-piece");
          if (el) { el.style.top = landingTopPct + "%"; el.classList.add("landed"); }
          if (lbl0) lbl0.textContent = T.question.fallingLandedLabel;
          return;
        }
        if (lbl0) lbl0.textContent = bdi(Math.ceil(remaining / 1000));
      };
      tick();
      wallCountdownHandle = setInterval(tick, 1000);
    }
  }

  function renderNumpad() {
    var keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "check"];
    return '<div class="numpad">' + keys.map(function (k) {
      if (k === "clear") return '<button data-key="clear">' + T.question.clear + "</button>";
      if (k === "check") return '<button class="check" data-key="check">' + T.question.check + "</button>";
      return '<button data-key="' + k + '">' + k + "</button>";
    }).join("") + "</div>";
  }

  function onNumpadPress(key) {
    if (App.feedbackLock) return;
    if (key === "clear") { questionInput = questionInput.slice(0, -1); }
    else if (key === "check") {
      if (!questionInput) { wobbleInput(); return; }
      submitAnswer();
      return;
    }
    else { questionInput += key; }
    document.getElementById("answer-input").value = questionInput;
  }

  function onKeyboardKeydown(ev) {
    if (App.feedbackLock) {
      ev.preventDefault();
      if (ev.key === "Enter" && !ev.repeat && App.pendingContinue) App.pendingContinue();
      return;
    }
    if (ev.key === "Enter") {
      if (ev.repeat) { ev.preventDefault(); return; } // holding Enter must not repeat-submit
      var current = document.getElementById("answer-input").value;
      if (!current) { wobbleInput(); return; }
      submitAnswer();
      return;
    }
    if (ev.key === "Backspace") return; // native input handles it
    if (/^[0-9]$/.test(ev.key)) return; // native input handles it
    ev.preventDefault();
  }

  function wobbleInput() {
    var el = document.getElementById("answer-input");
    if (!el) return;
    el.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 200 });
  }

  var challengeTimerHandle = null;
  function startChallengeTimer(limitSec) {
    var startedAt = performance.now();
    var turtle = document.getElementById("turtle");
    var track = document.getElementById("turtle-track");
    clearInterval(challengeTimerHandle);
    challengeTimerHandle = setInterval(function () {
      var elapsed = (performance.now() - startedAt) / 1000;
      var pct = Math.min(1, elapsed / limitSec);
      if (turtle && track) {
        var travel = track.clientWidth - turtle.offsetWidth - 28; // stop just before the flag
        turtle.style.left = Math.max(0, pct * travel) + "px";
      }
      if (elapsed >= limitSec) {
        clearInterval(challengeTimerHandle);
        onTimeout();
      }
    }, 100);
  }

  // The turtle reached the flag: it sits down and naps. Nothing is lost —
  // the question stays open (D8) and a correct answer still pays base coins.
  function onTimeout() {
    var el = document.getElementById("equation");
    if (el) {
      var msg = document.createElement("div");
      msg.className = "muted";
      msg.textContent = T.question.timeoutMessage;
      el.parentNode.insertBefore(msg, el.nextSibling);
    }
    var turtle = document.getElementById("turtle");
    if (turtle) {
      turtle.classList.add("resting");
      var zzz = document.createElement("span");
      zzz.className = "turtle-zzz";
      zzz.textContent = "💤";
      zzz.style.left = (turtle.offsetLeft + 18) + "px";
      turtle.parentNode.appendChild(zzz);
    }
  }

  // Wrong-answer helper: the fact as `a` rows of `b` dots, lighting up row by
  // row, captioned "a × b = product". Shown only AFTER a wrong answer (D3: no
  // clues while answering) — it explains, it never hints.
  // A one-line derivation strategy for the fact (research-based: doubles,
  // ×9 = ×10 − one, ×5 = half of ×10, ×6/×7 built from ×5). Picks the operand
  // with the most useful trick. Numbers only — no user input.
  function strategyHint(a, b) {
    var order = [1, 10, 9, 5, 2, 4, 8, 3, 6, 7]; // ×1 first: "anything × 1 stays" beats any other trick
    var n = null, m = null;
    for (var i = 0; i < order.length; i++) {
      if (a === order[i]) { n = a; m = b; break; }
      if (b === order[i]) { n = b; m = a; break; }
    }
    if (n === null) return "";
    var p = a * b;
    // S3-2: the Hebrew phrasing per trick lives in T.question.strategies now
    // (strings.js) — this just picks n/m/p and hands them to the template.
    var tpl = T.question.strategies[n] || T.question.strategies.default;
    return tpl(m, p);
  }

  function dotArrayHtml(asked) {
    var p = MathCore.Facts.parts(asked);
    var rows = p[0], cols = p[1];
    var cells = "";
    var rowDelay = Math.round(CONFIG.HELPER_CASCADE_MS / rows);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        cells += '<span style="animation-delay:' + (r * rowDelay) + 'ms"></span>';
      }
    }
    // Caption first: the answer must be visible even when a 10×10 grid pushes
    // the bottom of the card below a short landscape viewport.
    return (
      '<div class="dot-array-caption ltr">' + T.question.helperCaption(rows, cols, rows * cols) + "</div>" +
      (rows !== cols ? '<div class="muted">' + T.question.commutative(rows, cols, rows * cols) + "</div>" : "") +
      '<div class="muted strategy">' + T.question.strategyIntro + " " + strategyHint(rows, cols) + "</div>" +
      '<div class="muted">' + T.question.helperRows(rows, cols) + "</div>" +
      '<div class="dot-array" style="grid-template-columns:repeat(' + cols + ',var(--dot))">' + cells + "</div>"
    );
  }

  // `value` is passed directly by the falling/wall screens (the tapped
  // bubble's number); the typed screen calls this with no argument and it
  // reads the numpad/keyboard input exactly as before (WP-F3: one shared
  // submit path). `opts.x` (docs/WALL-DESIGN.md §1) is the wall screen's
  // UI-local column — SessionCore.submit runs the pure Wall reducer with it
  // inside this SAME save, only for mode:"wall" (ignored otherwise).
  function submitAnswer(value, opts) {
    if (App.feedbackLock) return;
    // A leftover falling bubble from the PREVIOUS question stays in the DOM
    // (paused, not removed) while the next question's paint save is still
    // in flight — a tap in that window must be a no-op, not a submit against
    // a `current` that no longer exists (SessionCore.submit would throw,
    // which rejects the save() promise and, without this guard, could strand
    // feedbackLock forever). This also guards the pre-existing typed-mode
    // "stale Enter" case for free (WP-F8 gate review, MEDIUM).
    var stateNow = S();
    if (!stateNow.active || !stateNow.active.current) return;
    if (value === undefined) {
      var input = document.getElementById("answer-input");
      value = input.tagName === "INPUT" && input.value !== undefined && !input.readOnly ? input.value : questionInput;
      if (value === "" || value == null) value = questionInput;
    }
    App.feedbackLock = true;
    clearInterval(challengeTimerHandle);
    document.querySelectorAll(".bubble").forEach(function (b) { if (!b.classList.contains("picked")) b.style.animationPlayState = "paused"; });
    save(function (s) { return MathCore.SessionCore.submit(s, Number(value), Date.now(), opts || {}); })
      .then(function (result) {
        if (!result.ok) { App.feedbackLock = false; return; } // stale/error already surfaced via banner/stale card
        showFeedback(result.value);
      })
      .catch(function () { App.feedbackLock = false; }); // a rejected save must never strand the lock
  }

  // Falling mode: the tapped balloon pops (right) or deflates (wrong); the
  // others float away, or the correct one glows so she sees it.
  function balloonReactions(result) {
    var bubbles = Array.prototype.slice.call(document.querySelectorAll(".bubble"));
    var picked = bubbles.filter(function (b) { return b.classList.contains("picked"); })[0];
    // Reaction classes replace the `animation` shorthand, which would drop the
    // fall's `forwards` fill and snap `top` back above the lanes — freeze each
    // balloon where it is first (review 2026-08-27 #2). `.landed` is kept.
    bubbles.forEach(function (b) { b.style.top = getComputedStyle(b).top; b.style.animationPlayState = ""; });
    if (result.ok) {
      bubbles.forEach(function (b) {
        if (b === picked) {
          var rect = b.getBoundingClientRect();
          b.classList.add("popped");
          var burst = document.createElement("div");
          burst.className = "pop-burst";
          burst.textContent = "🎉";
          burst.style.left = (rect.left + rect.width / 2) + "px";
          burst.style.top = (rect.top + rect.height / 2) + "px";
          burst.style.position = "fixed";
          document.body.appendChild(burst);
          setTimeout(function () { if (burst.parentNode) burst.parentNode.removeChild(burst); }, 900);
        } else { b.classList.add("flyaway"); }
      });
    } else {
      bubbles.forEach(function (b) {
        if (b === picked) b.classList.add("wrongpick");
        else if (Number(b.dataset.value) === Number(result.correctAnswer)) b.classList.add("reveal");
        else b.style.opacity = "0.45";
        b.style.pointerEvents = "none";
      });
    }
  }

  // Wall mode reaction (docs/WALL-DESIGN.md §1): the piece is already
  // animating (or already stationary, reduced motion/interrupted) toward
  // the exact spot core.js's Wall reducer just placed it — landing depends
  // only on the PRE-answer grid/x/w/h, which the screen previewed
  // identically, so no repositioning is needed here, only: snap it visually
  // `.landed`, colour it by outcome (1 correct / 2 wrong-grey / 3 retry —
  // matches core.js's cell semantics), disable further column moves, and
  // show the wall-complete toast when this submit overflowed the well.
  function wallReactions(result) {
    clearWallCountdown();
    var pieceEl = document.getElementById("wall-piece");
    if (pieceEl) {
      pieceEl.classList.add("landed");
      pieceEl.classList.remove("wall-piece-1", "wall-piece-2", "wall-piece-3");
      pieceEl.classList.add(result.retry ? "wall-piece-3" : (result.ok ? "wall-piece-1" : "wall-piece-2"));
    }
    var lbl = document.getElementById("wall-landed-label");
    if (lbl) lbl.textContent = T.question.fallingLandedLabel;
    document.querySelectorAll(".wall-controls button").forEach(function (b) { b.disabled = true; });
    if (result.wallReset) showWallResetToast();
  }

  function showFeedback(result) {
    var screenEl = document.querySelector('[data-screen="question"]');
    if (!screenEl) return; // the child left mid-save; route() already cleared the lock
    var fast = result.ok && result.withinLimit && !result.retry;
    if (screenEl) {
      screenEl.classList.add(result.ok ? "feedback-correct" : "feedback-wrong");
      if (fast) screenEl.classList.add("feedback-fast"); // classList.add takes one token per argument
    }
    if (screenEl && screenEl.dataset.falling) balloonReactions(result);
    if (screenEl && screenEl.dataset.wall) wallReactions(result);
    var equation = document.getElementById("equation");
    var note = document.createElement("div");
    if (!result.ok) {
      note.className = "wrong-helper";
      // The fact comes from our own state, never from input. If anything about
      // the picture fails, fall back to the plain answer line — feedback must
      // never die (the session would freeze behind feedbackLock).
      try {
        var askedKey = result.asked || (S().active && S().active.attempts.length ? S().active.attempts[S().active.attempts.length - 1].asked : null);
        note.innerHTML = askedKey ? dotArrayHtml(askedKey) : "";
      } catch (e) { note.innerHTML = ""; }
      if (!note.innerHTML) { note.className = "muted"; note.textContent = T.question.wrongAnswerWas(result.correctAnswer); }
    } else if (fast) {
      note.className = "fast-badge"; // P3: "something nice" for beating the clock
      note.textContent = T.question.beatClock;
    } else if (result.retry) {
      note.className = "muted";
      note.textContent = T.question.retryNowYouKnow; // P1: a correct retry gets its line
    }
    if (!result.ok) {
      // The picture stays until she taps "הבנתי" (or presses Enter) — no auto-advance,
      // so there is time to count the rows (Marat, 2026-08-27).
      var btn = document.createElement("button");
      btn.className = "continue-btn";
      btn.textContent = T.question.continueBtn;
      btn.setAttribute("data-action", "continue-after-wrong");
      note.appendChild(btn);
    }
    if (equation && note.textContent) equation.parentNode.insertBefore(note, equation.nextSibling);
    if (fast) {
      var t = document.getElementById("turtle");
      if (t) { t.textContent = "🐇"; t.classList.add("hopping"); t.classList.remove("resting"); }
    }
    if (result.ok && result.coins > 0) {
      var pill = document.querySelector(".coin-pill");
      if (pill) pill.innerHTML = bdi("+" + Number(result.coins)) + " 🪙"; // result.coins is always our own number, never user input
    }
    try {
      if (result.ok) { confettiBurst(fast ? 40 : 18); blip(fast ? SOUNDS.fast : SOUNDS.correct); }
      else { blip(SOUNDS.wrong); }
    } catch (e) { /* effects are decoration; the session must advance regardless */ }
    clearTimeout(App.feedbackTimer);
    App.pendingContinue = null;
    var advance = function () {
      if (currentHashScreen() !== "question") return; // P9: the child left mid-feedback
      App.pendingContinue = null;
      App.feedbackLock = false;
      var state = S();
      if (!state.active) { finishSession(); return; }
      if (state.active.queue.length === 0 && state.active.retryQueue.length === 0) {
        finishSession();
      } else {
        paintNextQuestion();
      }
    };
    if (result.ok) {
      App.feedbackTimer = setTimeout(advance, CONFIG.WRONG_ANSWER_DISPLAY_MS);
    } else {
      App.pendingContinue = advance; // wrong answer: wait for "הבנתי" / Enter
      var cont = document.querySelector('[data-action="continue-after-wrong"]');
      if (cont) cont.addEventListener("click", function () { if (App.pendingContinue) App.pendingContinue(); });
      if (cont && cont.focus) cont.focus();
    }
  }

  function finishSession() {
    var state = S();
    if (!state.active) { navigate("home"); return; }
    if (state.active.queue.length > 0 || state.active.retryQueue.length > 0) return;
    save(function (s) { return MathCore.SessionCore.finish(s, Date.now()); }).then(function (result) {
      // Summary is rendered only after finish()'s save resolved (DESIGN §6).
      if (result.ok && result.value) {
        App.lastSessionResult = result.value;
        cloudBackupSoon();
        navigate("summary");
      }
    });
  }

  function onExitClick() {
    var overlay = document.createElement("div");
    overlay.className = "screen";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(255,255,255,0.96)";
    overlay.style.zIndex = "500";
    overlay.innerHTML =
      '<div class="card">' +
      "<p>" + T.question.exitConfirmTitle + "</p>" +
      '<button data-action="exit-yes">' + T.question.exitConfirmYes + "</button> " +
      '<button class="secondary" data-action="exit-no">' + T.question.exitConfirmNo + "</button>" +
      "</div>";
    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="exit-yes"]').addEventListener("click", function () {
      document.body.removeChild(overlay); // exit only suspends (D12) — state.active already journaled
      // The in-flight question is deferred on the RETURN visit — SessionCore.paint()
      // itself defers a leftover `current`, not this handler — so every way of
      // leaving mid-question (this button, a back-gesture, a hand-edited hash)
      // is covered in one place instead of only this one exit path.
      navigate("home");
    });
    overlay.querySelector('[data-action="exit-no"]').addEventListener("click", function () {
      document.body.removeChild(overlay);
    });
  }

  // ------------------------------------------------------------------
  // Screen: Summary (DESIGN §9.3)
  // ------------------------------------------------------------------
  // Registered on Screens (not derived purely from state like the others)
  // so #screen=summary is reachable via the router/hashchange like every
  // other screen (WP3-1 done-when) instead of only via the direct call from
  // finishSession() — otherwise a hashchange-triggered route() would find no
  // Screens.summary, fall back to Home, and immediately stomp the summary
  // right after it rendered.
  Screens.summary = function () {
    if (!App.lastSessionResult) { navigate("home"); return; }
    renderSummary(App.lastSessionResult);
  };

  function renderSummary(session) {
    // V2-DESIGN §3.3: perfect -> 3 stars; >= STARS_TWO_RATIO of planned.length
    // first-try-correct -> 2; else 1. Near-perfect = exactly NEAR_PERFECT_MISSES misses.
    var stars = session.firstTryCorrect === session.planned.length
      ? 3
      : session.firstTryCorrect / session.planned.length >= CONFIG.STARS_TWO_RATIO
        ? 2
        : 1;
    var fallingSuffix = session.mode === "falling" ? " 🎈" : session.mode === "wall" ? " 🧱" : "";
    // D2 (Marat 2026-08-28): a perfect round that is 2nd+ in a row gets its own
    // title + series-bonus banner instead of the plain perfect title.
    var titleHtml = session.perfect && session.perfectSeries >= 2
      ? '<h1 class="summary-title-perfect">' + T.summary.perfectSeriesTitle(session.perfectSeries) + fallingSuffix + "</h1><p>" +
        (session.perfectSeries >= 3 ? T.summary.perfectSeriesSub3 : T.summary.perfectSeriesSub) + "</p>" +
        '<div class="station-banner">' + T.summary.seriesBonus(MathCore.Economy.perfectSeriesExtra(session.perfectSeries)) + "</div>"
      : session.perfect
        ? '<h1 class="summary-title-perfect">' + T.summary.perfectTitle + fallingSuffix + "</h1><p>" + T.summary.perfectSub + "</p>"
        : session.firstTryCorrect === session.planned.length - CONFIG.NEAR_PERFECT_MISSES
          ? "<h1>" + T.summary.nearPerfectTitle + fallingSuffix + "</h1>"
          : "<h1>" + T.summary.encouragingTitle + fallingSuffix + "</h1>";
    var learnedList = session.misses.length
      ? "<p>" + T.summary.learnedToday + ": " + session.misses.map(function (key) {
          var p = MathCore.Facts.parts(key); // P5: canonical key -> "a × b = product"
          return '<span class="ltr">' + T.summary.learnedItem(p[0], p[1], MathCore.Facts.answer(key)) + "</span>";
        }).join(", ") + "</p>"
      : "";
    var reached = session.stationsReached || [];
    // V2-DESIGN §3.4: a reached station shows its gilded (golden) sticker only
    // if that sticker is ALREADY unlocked (no reveal of a locked sticker
    // anywhere, including here) — the live post-finish state, not a snapshot.
    var goldenNowUnlocked = {};
    MathCore.Economy.goldenStickers(S()).forEach(function (id) { goldenNowUnlocked[id] = true; });
    var reachedGoldHtml = reached
      .map(function (table) {
        var idx = CONFIG.MAP_PATH.indexOf(table);
        var stickerId = idx !== -1 ? CONFIG.ALBUMS[0].stickers[idx] : null;
        return stickerId && goldenNowUnlocked[stickerId] ? '<span class="sticker-reveal">' + stickerArt(stickerId) + "</span>" : "";
      })
      .join("");
    var stationHtml = reached.length
      ? '<div class="station-banner">' + (reached.length === 1 ? T.summary.stationReached(reached[0]) : T.summary.stationsReached(reached)) + reachedGoldHtml + "</div>"
      : "";
    // V2-DESIGN §3.1: summary reveal shows emoji + name + nick (not just the emoji).
    var unlockHtml = session.unlocksEarned.length
      ? "<p>" + T.summary.unlockReveal + "</p><div>" + session.unlocksEarned.map(function (id) {
          var info = T.stickers[id];
          return '<span class="sticker-reveal">' + stickerArt(id) + "</span>" +
            (info ? '<div class="sticker-name">' + escapeHtml(info.name) + "</div><div class=\"sticker-nick\">" + escapeHtml(info.nick) + "</div>" : "");
        }).join(" ") + "</div>"
      : "";
    // docs/WALL-DESIGN.md §1 summary line, shown only for a wall session that
    // built at least one wall.
    var wallsBuiltHtml = session.mode === "wall" && session.wallsBuilt >= 1
      ? "<p>" + T.summary.wallsBuilt(session.wallsBuilt) + "</p>"
      : "";

    render(
      '<div class="screen" data-screen="summary">' +
        audienceHtml(S(), session.id, { allBounce: session.perfect }) +
        '<div class="stars">' + "⭐".repeat(stars) + "</div>" +
        titleHtml +
        "<p>" + bdi(session.firstTryCorrect + "/" + session.planned.length) + "</p>" +
        '<div class="coin-pill">' + T.summary.coinsEarned(session.coinsEarned) + "</div>" +
        learnedList +
        wallsBuiltHtml +
        stationHtml +
        unlockHtml +
        '<button data-action="again">' + T.summary.nextSessionBtn + "</button> " +
        '<button class="secondary" data-action="done">' + T.summary.doneBtn + "</button>" +
        "</div>"
    );
    bindAction("again", function () { switchMode(session.mode === "falling" || session.mode === "wall" ? session.mode : "typed"); }); // "עוד סבב" stays in the same game
    bindAction("done", function () { navigate("home"); });
    try {
      if (session.perfect && session.perfectSeries >= 3) {
        fireworksShow(); setTimeout(fireworksShow, 900); confettiBurst(140); blip(SOUNDS.perfect);
      } else if (session.perfect && session.perfectSeries >= 2) {
        fireworksShow(); setTimeout(fireworksShow, 900); confettiBurst(100); blip(SOUNDS.perfect);
      } else if (session.perfect) { fireworksShow(); confettiBurst(60); blip(SOUNDS.perfect); }
      else if ((session.stationsReached || []).length) { fireworksShow(); confettiBurst(40); blip(SOUNDS.unlock); }
      else if (session.unlocksEarned.length) { confettiBurst(30); blip(SOUNDS.unlock); }
      else { confettiBurst(12); }
    } catch (e) { /* decoration only */ }
  }

  // ------------------------------------------------------------------
  // Screen: Collection
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // Screen: Journey map (docs/MAP-DESIGN.md)
  // ------------------------------------------------------------------
  Screens.map = function () {
    var state = S();
    var rows = MathCore.Map.overview(state);
    var W = 400, stepY = 78, padTop = 30, R = 24;
    var H = padTop + stepY * rows.length + 60;
    var pts = rows.map(function (row, i) {
      var x = i % 2 === 0 ? 90 : 310; // zig-zag
      var y = padTop + i * stepY + R;
      return { x: x, y: y, row: row };
    });
    var castle = { x: pts[pts.length - 1].x === 90 ? 310 : 90, y: padTop + rows.length * stepY + R };
    var path = pts.map(function (p, i) { return (i === 0 ? "M" : "L") + p.x + " " + p.y; }).join(" ") + " L" + castle.x + " " + castle.y;
    var allDone = rows.every(function (r) { return r.reached; });
    var nodes = pts.map(function (p) {
      var row = p.row;
      var fill = row.reached ? "#FFC93C" : row.current ? "#4F7CFF" : "#CBD2E0";
      var ring = row.current ? '<circle class="map-current-ring" cx="' + p.x + '" cy="' + p.y + '" r="' + (R + 7) + '" fill="none" stroke="#4F7CFF" stroke-width="3" />' : "";
      var star = row.reached ? '<text x="' + (p.x + R - 4) + '" y="' + (p.y - R + 6) + '" font-size="16">' + (row.progress >= row.required ? "⭐" : "☆") + "</text>" : "";
      var turtle = row.current ? '<text class="map-turtle" x="' + (p.x + (p.x < 200 ? R + 10 : -R - 36)) + '" y="' + (p.y + 9) + '">🐢</text>' : "";
      return (
        '<g class="map-node" data-table="' + row.table + '" style="cursor:pointer">' + ring +
        '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (R + 12) + '" fill="transparent" />' + // ≥44 px hit area on small phones
        '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + R + '" fill="' + fill + '" />' +
        '<text class="map-station-label" x="' + p.x + '" y="' + (p.y + 6) + '" text-anchor="middle">×' + row.table + "</text>" +
        '<text class="map-progress-label" x="' + p.x + '" y="' + (p.y + R + 16) + '" text-anchor="middle">' + row.progress + "/" + row.required + "</text>" +
        star + turtle + "</g>"
      );
    }).join("");
    var castleNode = '<text x="' + castle.x + '" y="' + (castle.y + 12) + '" font-size="36" text-anchor="middle">' + T.map.castle + (allDone ? "👑" : "") + "</text>";
    var svg =
      '<svg class="map-svg" viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="' + path + '" fill="none" stroke="#E4E8F0" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />' +
      nodes + castleNode + "</svg>";

    var detail = "";
    if (mapSelectedStation !== null) {
      var row = rows.filter(function (r) { return r.table === mapSelectedStation; })[0];
      var chips = MathCore.Map.tableKeys(mapSelectedStation).map(function (key) {
        var p = MathCore.Facts.parts(key);
        var m = MathCore.Facts.mastery(MathCore.Facts.getFact(state, key));
        return '<span class="fact-chip ' + m + '">' + p[0] + " × " + p[1] + "</span>";
      }).join("");
      var status = row.reached ? T.map.reachedLabel : row.current ? T.map.currentLabel : T.map.aheadLabel;
      // V2-DESIGN §3.4: this station's gilded sticker is named ONLY if it is
      // already unlocked (no reveal of a locked sticker anywhere).
      var goldIdx = CONFIG.MAP_PATH.indexOf(mapSelectedStation);
      var goldStickerId = goldIdx !== -1 ? CONFIG.ALBUMS[0].stickers[goldIdx] : null;
      var goldUnlocked = goldStickerId && (state.economy.unlocked || []).indexOf(goldStickerId) !== -1;
      var goldsHtml = goldUnlocked
        ? '<div class="muted">' + T.map.goldsSticker(escapeHtml(T.stickers[goldStickerId] ? T.stickers[goldStickerId].name : "")) + "</div>"
        : "";
      detail =
        '<div class="card">' +
        "<h2>" + T.map.stationTitle(mapSelectedStation) + " · " + status + "</h2>" +
        goldsHtml +
        '<div class="fact-chips">' + chips + "</div>" +
        '<div class="muted" style="margin-top:0.5rem">' + T.map.chipsLegend + "</div></div>";
    }

    render(
      '<div class="screen" data-screen="map">' +
        "<h1>" + T.map.title + "</h1>" +
        (allDone ? "<p>" + T.map.doneAll + "</p>" : "") +
        (detail || '<div class="muted">' + T.map.tapHint + "</div>") + // above the map so a tap is always visible
        '<div class="map-wrap">' + svg + "</div>" +
        '<button class="secondary" data-action="back">' + T.map.backBtn + "</button>" +
        "</div>"
    );
    bindAction("back", function () { mapSelectedStation = null; navigate("home"); });
    document.querySelectorAll(".map-node").forEach(function (g) {
      g.addEventListener("click", function () {
        var t = Number(g.getAttribute("data-table"));
        mapSelectedStation = mapSelectedStation === t ? null : t;
        Screens.map();
        var card = document.querySelector('[data-screen="map"] .card');
        if (card && card.scrollIntoView) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    });
  };

  // V2-DESIGN §3.1/§3.4: one shelf per album; unlocked shows emoji + name +
  // nick, golden ring for a gilded (map-station) sticker; locked shows "?"
  // with NO title attribute (the old markup leaked the animal id via title=).
  Screens.collection = function () {
    var state = S();
    var totals = MathCore.Stats.totals(state, Date.now());
    var unlockedSet = {};
    (state.economy.unlocked || []).forEach(function (id) { unlockedSet[id] = true; });
    var goldenSet = {};
    MathCore.Economy.goldenStickers(state).forEach(function (id) { goldenSet[id] = true; });

    var shelvesHtml = CONFIG.ALBUMS.map(function (album) {
      var albumStickers = album.stickers;
      var unlockedCount = albumStickers.filter(function (id) { return unlockedSet[id]; }).length;
      var stickersHtml = albumStickers.map(function (id) {
        var cls = "sticker" + (unlockedSet[id] ? " unlocked" : "") + (goldenSet[id] ? " golden" : "");
        if (!unlockedSet[id]) return '<div class="' + cls + '">?</div>';
        var info = T.stickers[id];
        return (
          '<div class="' + cls + '">' + stickerArt(id) +
          (info ? '<span class="sticker-name">' + escapeHtml(info.name) + "</span><span class=\"sticker-nick\">" + escapeHtml(info.nick) + "</span>" : "") +
          "</div>"
        );
      }).join("");
      var doneHtml = unlockedCount >= albumStickers.length ? '<div class="station-banner">' + T.collection.albumDone + "</div>" : "";
      var titleText = T.albums[album.id] || "";
      return (
        (titleText ? '<div class="album-shelf-title">' + escapeHtml(titleText) + "</div>" : "") +
        '<div class="sticker-shelf">' + stickersHtml + "</div>" +
        doneHtml
      );
    }).join("");

    var nextIndex = (state.economy.unlocked || []).length; // 0-based count -> next threshold n = count+1
    var progressHtml;
    if (nextIndex >= CONFIG.UNLOCK_COUNT) {
      progressHtml = "<p>" + T.collection.allUnlocked + "</p>";
    } else {
      var remaining = Math.max(0, MathCore.Economy.unlockThreshold(nextIndex + 1) - totals.lifetimeCoins);
      progressHtml = "<p>" + T.collection.nextUnlockProgress(remaining) + "</p>";
    }
    render(
      '<div class="screen" data-screen="collection">' +
        "<h1>" + T.collection.title + "</h1>" +
        shelvesHtml +
        progressHtml +
        '<button class="secondary" data-action="back">' + T.collection.backBtn + "</button>" +
        "</div>"
    );
    bindAction("back", function () { navigate("home"); });
  };

  // ------------------------------------------------------------------
  // Screen: Rewards (child view)
  // ------------------------------------------------------------------
  Screens.rewards = function () {
    var state = S();
    var totals = MathCore.Stats.totals(state, Date.now());
    var active = (state.economy.rewards || []).filter(function (r) { return r.active; });
    var pendingByReward = {};
    (state.economy.requests || []).forEach(function (r) {
      if (r.status === "requested") pendingByReward[r.rewardId] = true;
    });
    var itemsHtml = active.length
      ? active.map(function (r) {
          var pending = pendingByReward[r.id];
          var canAfford = totals.balance >= r.cost;
          return (
            '<div class="reward-item card">' +
            "<span>" + escapeHtml(r.name) + " — " + r.cost + " 🪙</span>" +
            (pending
              ? "<span>" + T.rewards.pendingLabel + "</span>"
              : '<button data-reward="' + escapeHtml(r.id) + '" ' + (canAfford ? "" : "disabled") + ">" + T.rewards.requestBtn + "</button>") +
            "</div>"
          );
        }).join("")
      : "<p>" + T.rewards.noRewards + "</p>";
    render(
      '<div class="screen" data-screen="rewards">' +
        "<h1>" + T.rewards.title + "</h1>" +
        '<div class="coin-pill">🪙 ' + bdi(totals.balance) + "</div>" +
        itemsHtml +
        '<button class="secondary" data-action="back">' + T.rewards.backBtn + "</button>" +
        "</div>"
    );
    bindAction("back", function () { navigate("home"); });
    document.querySelectorAll("[data-reward]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        btn.disabled = true; // P11: no double-tap
        var rewardId = btn.dataset.reward;
        var requestId = "q_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
        save(function (s) { MathCore.Economy.requestReward(s, rewardId, requestId, Date.now()); }).then(function (result) {
          if (result.ok) Screens.rewards();
        });
      });
    });
  };

  // ------------------------------------------------------------------
  // Screen: Parent (PIN-gated) — placeholder; fleshed out in WP4.
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // Screen: Parent (PIN-gated) — DESIGN §9.6
  // ------------------------------------------------------------------
  Screens.parent = function () {
    if (!App.parentUnlocked) {
      renderParentPinEntry();
    } else {
      renderParentDashboard();
    }
  };

  function renderParentPinEntry() {
    render(
      '<div class="screen" data-screen="parent-pin" style="background:var(--parent-bg)">' +
        '<div class="card" style="width:min(360px,92vw)">' +
        "<h1>" + T.parent.pinPrompt + "</h1>" +
        '<div class="muted" id="parent-pin-error" style="min-height:1.2em"></div>' +
        '<input id="parent-pin-input" type="password" inputmode="numeric" maxlength="4" placeholder="' + T.parent.pinPlaceholder + '" /><br><br>' +
        '<button data-action="parent-unlock">' + T.parent.unlockBtn + "</button><br><br>" +
        '<button class="ghost" data-action="parent-forgot">' + T.parent.forgotPin + "</button> " +
        '<button class="ghost" data-action="back">' + T.collection.backBtn + "</button>" +
        "</div></div>"
    );
    bindAction("back", function () { navigate("home"); });
    bindAction("parent-forgot", function () { renderParentForgotPin(); });
    var submit = function () {
      var pin = document.getElementById("parent-pin-input").value;
      MathCore.Pin.verify(window.crypto, pin, S().settings.pinHash).then(function (ok) {
        if (ok) {
          App.parentUnlocked = true;
          renderParentDashboard();
        } else {
          document.getElementById("parent-pin-error").textContent = T.parent.wrongPin;
        }
      });
    };
    bindAction("parent-unlock", submit);
    document.getElementById("parent-pin-input").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") submit();
    });
  }

  function renderParentForgotPin() {
    render(
      '<div class="screen" data-screen="parent-forgot" style="background:var(--parent-bg)">' +
        '<div class="card" style="width:min(360px,92vw)">' +
        "<h1>" + T.parent.forgotPin + "</h1>" +
        '<div class="muted" id="forgot-error" style="min-height:1.2em"></div>' +
        "<p>" + T.parent.recoveryPrompt + "</p>" +
        '<input id="recovery-input" type="text" class="ltr" style="text-align:center;letter-spacing:0.15em" maxlength="6" /><br><br>' +
        '<button data-action="recovery-submit">' + T.parent.recoverySubmit + "</button> " +
        '<button class="ghost" data-action="parent-back-to-pin">' + T.parent.backToPin + "</button>" +
        "</div></div>"
    );
    bindAction("parent-back-to-pin", function () { renderParentPinEntry(); });
    bindAction("recovery-submit", function () {
      var code = document.getElementById("recovery-input").value.trim().toUpperCase();
      MathCore.Pin.verify(window.crypto, code, S().settings.recoveryHash).then(function (ok) {
        if (ok) {
          renderParentNewPin();
        } else {
          document.getElementById("forgot-error").textContent = T.parent.wrongRecovery;
        }
      });
    });
  }

  function renderParentNewPin() {
    render(
      '<div class="screen" data-screen="parent-new-pin" style="background:var(--parent-bg)">' +
        '<div class="card" style="width:min(360px,92vw)">' +
        "<h1>" + T.parent.newPinPrompt + "</h1>" +
        '<div class="muted" id="new-pin-error" style="min-height:1.2em"></div>' +
        '<input id="new-pin-1" type="password" inputmode="numeric" maxlength="4" placeholder="' + T.parent.newPinPrompt + '" /><br><br>' +
        '<input id="new-pin-2" type="password" inputmode="numeric" maxlength="4" placeholder="' + T.parent.newPinConfirmPrompt + '" /><br><br>' +
        '<button data-action="save-new-pin">' + T.parent.setNewPinBtn + "</button>" +
        "</div></div>"
    );
    bindAction("save-new-pin", function () {
      var p1 = document.getElementById("new-pin-1").value;
      var p2 = document.getElementById("new-pin-2").value;
      var errorEl = document.getElementById("new-pin-error");
      if (!MathCore.Pin.isValidFormat(p1)) { errorEl.textContent = T.parentSetup.errorPinFormat; return; }
      if (p1 !== p2) { errorEl.textContent = T.parentSetup.errorPinMismatch; return; }
      MathCore.Pin.hash(window.crypto, p1).then(function (pinHash) {
        return save(function (s) { s.settings.pinHash = pinHash; });
      }).then(function (result) {
        if (!result.ok) { errorEl.textContent = T.saveFailure; return; }
        App.parentUnlocked = true;
        renderParentDashboard();
      });
    });
  }

  function renderParentDashboard() {
    var state = S();
    render(
      '<div class="screen" data-screen="parent-dashboard" style="background:var(--parent-bg);justify-content:flex-start;padding-top:1rem">' +
        '<div style="width:min(720px,94vw)">' +
        '<button class="ghost" data-action="back">' + T.collection.backBtn + "</button>" +
        "<h1>" + T.parent.title + "</h1>" +
        renderSettingsSection(state) +
        renderStorageStatusSection() +
        renderRewardsSection(state) +
        renderStatsSection(state) +
        renderDataSection(state) +
        renderCloudSection(state) +
        "</div></div>"
    );
    bindAction("back", function () { navigate("home"); });
    wireCloudSection();
    wireSettingsSection();
    wireStorageStatusSection();
    wireRewardsSection();
    wireDataSection();
  }

  function renderSettingsSection(state) {
    var falling = state.settings.falling || { enabled: false, durationSec: CONFIG.FALLING.DEFAULT_DURATION_SEC, options: CONFIG.FALLING.DEFAULT_OPTIONS };
    var wall = state.settings.wall || { enabled: false, durationSec: CONFIG.WALL.DEFAULT_DURATION_SEC, options: CONFIG.WALL.DEFAULT_OPTIONS };
    return (
      '<div class="card" style="margin-bottom:1rem">' +
      "<h2>" + T.parent.settingsTitle + "</h2>" +
      "<label>" + T.parent.nameLabel + '<br><input id="set-name" type="text" value="' + escapeHtml(state.settings.childName) + '" /></label><br><br>' +
      '<label><input id="set-challenge" type="checkbox" ' + (state.settings.challengeOn ? "checked" : "") + " /> " + T.parent.challengeLabel + "</label><br><br>" +
      "<label>" + T.parent.timeLimitLabel + ': <span id="set-time-limit-value">' + state.settings.timeLimitSec + "</span><br>" +
      '<input id="set-time-limit" type="range" min="' + CONFIG.MIN_TIME_LIMIT_SEC + '" max="' + CONFIG.MAX_TIME_LIMIT_SEC + '" value="' + state.settings.timeLimitSec + '" /></label><br><br>' +
      '<label><input id="set-sound" type="checkbox" ' + (state.settings.sound ? "checked" : "") + " /> " + T.parent.soundLabel + "</label><br><br>" +
      '<label><input id="set-falling-enable" type="checkbox" ' + (falling.enabled ? "checked" : "") + " /> " + T.parent.fallingEnableLabel + "</label><br><br>" +
      "<label>" + T.parent.fallingDurationLabel + ': <span id="set-falling-duration-value">' + falling.durationSec + "</span><br>" +
      '<input id="set-falling-duration" type="range" min="' + CONFIG.FALLING.MIN_DURATION_SEC + '" max="' + CONFIG.FALLING.MAX_DURATION_SEC + '" value="' + falling.durationSec + '" /></label><br><br>' +
      "<label>" + T.parent.fallingOptionsLabel + '<br><select id="set-falling-options">' +
      (function () {
        var opts = "";
        for (var n = CONFIG.FALLING.MIN_OPTIONS; n <= CONFIG.FALLING.MAX_OPTIONS; n++) {
          opts += '<option value="' + n + '"' + (falling.options === n ? " selected" : "") + ">" + n + "</option>";
        }
        return opts;
      })() +
      "</select></label><br><br>" +
      '<label><input id="set-wall-enable" type="checkbox" ' + (wall.enabled ? "checked" : "") + " /> " + T.parent.wallEnableLabel + "</label><br><br>" +
      "<label>" + T.parent.wallDurationLabel + ': <span id="set-wall-duration-value">' + wall.durationSec + "</span><br>" +
      '<input id="set-wall-duration" type="range" min="' + CONFIG.WALL.MIN_DURATION_SEC + '" max="' + CONFIG.WALL.MAX_DURATION_SEC + '" value="' + wall.durationSec + '" /></label><br><br>' +
      "<label>" + T.parent.wallOptionsLabel + '<br><select id="set-wall-options">' +
      (function () {
        var opts = "";
        for (var n = CONFIG.WALL.MIN_OPTIONS; n <= CONFIG.WALL.MAX_OPTIONS; n++) {
          opts += '<option value="' + n + '"' + (wall.options === n ? " selected" : "") + ">" + n + "</option>";
        }
        return opts;
      })() +
      "</select></label><br><br>" +
      "<label>" + T.parent.sessionSizeLabel + ': <span id="set-session-size-value">' + state.settings.sessionSize + "</span><br>" +
      '<input id="set-session-size" type="range" min="' + CONFIG.SESSION_SIZE_MIN + '" max="' + CONFIG.SESSION_SIZE_MAX + '" value="' + state.settings.sessionSize + '" /></label><br><br>' +
      '<button data-action="save-settings">' + T.parent.saveSettingsBtn + "</button> " +
      '<button class="secondary" data-action="change-pin">' + T.parent.changePinBtn + "</button>" +
      '<div class="muted" id="settings-saved-msg" style="min-height:1.2em"></div>' +
      "</div>"
    );
  }

  function wireSettingsSection() {
    var rangeInput = document.getElementById("set-time-limit");
    rangeInput.addEventListener("input", function () {
      document.getElementById("set-time-limit-value").textContent = rangeInput.value;
    });
    var fallingRangeInput = document.getElementById("set-falling-duration");
    fallingRangeInput.addEventListener("input", function () {
      document.getElementById("set-falling-duration-value").textContent = fallingRangeInput.value;
    });
    var wallRangeInput = document.getElementById("set-wall-duration");
    wallRangeInput.addEventListener("input", function () {
      document.getElementById("set-wall-duration-value").textContent = wallRangeInput.value;
    });
    var sessionSizeInput = document.getElementById("set-session-size");
    sessionSizeInput.addEventListener("input", function () {
      document.getElementById("set-session-size-value").textContent = sessionSizeInput.value;
    });
    bindAction("save-settings", function () {
      var name = document.getElementById("set-name").value.trim();
      var challengeOn = document.getElementById("set-challenge").checked;
      var timeLimitSec = Number(document.getElementById("set-time-limit").value);
      var sound = document.getElementById("set-sound").checked;
      var fallingEnabled = document.getElementById("set-falling-enable").checked;
      var fallingDurationSec = Number(document.getElementById("set-falling-duration").value);
      var fallingOptions = Number(document.getElementById("set-falling-options").value);
      var wallEnabled = document.getElementById("set-wall-enable").checked;
      var wallDurationSec = Number(document.getElementById("set-wall-duration").value);
      var wallOptions = Number(document.getElementById("set-wall-options").value);
      var sessionSize = Number(document.getElementById("set-session-size").value);
      save(function (s) {
        s.settings.childName = name;
        s.settings.challengeOn = challengeOn;
        s.settings.timeLimitSec = timeLimitSec;
        s.settings.sound = sound;
        s.settings.falling = { enabled: fallingEnabled, durationSec: fallingDurationSec, options: fallingOptions };
        s.settings.wall = { enabled: wallEnabled, durationSec: wallDurationSec, options: wallOptions };
        s.settings.sessionSize = sessionSize;
      }).then(function (result) {
        if (result.ok) document.getElementById("settings-saved-msg").textContent = T.parent.settingsSaved;
      });
    });
    bindAction("change-pin", function () { renderParentNewPin(); });
  }

  function renderStorageStatusSection() {
    return (
      '<div class="card" style="margin-bottom:1rem">' +
      "<h2>" + T.parent.storageStatusTitle + "</h2>" +
      '<p class="ltr muted" id="storage-status-line">…</p>' +
      "</div>"
    );
  }

  function wireStorageStatusSection() {
    var el = document.getElementById("storage-status-line");
    var standalone = isStandaloneDisplay();
    var rev = App.storage.rev;
    function line(persistedText) {
      return "rev " + rev + " · " + (standalone ? T.parent.standaloneYes : T.parent.standaloneNo) + " · VERSION " + APP_VERSION + " · " + persistedText;
    }
    el.textContent = line(T.parent.persistedUnknown);
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (persisted) {
        el.textContent = line(persisted ? T.parent.persistedYes : T.parent.persistedNo);
      });
    }
  }

  function renderRewardsSection(state) {
    var rewardsHtml =
      state.economy.rewards
        .map(function (r) {
          return (
            '<div class="reward-item"><span>' + escapeHtml(r.name) + " — " + r.cost + " 🪙" + (r.active ? "" : T.parent.removedSuffix) + "</span>" +
            (r.active ? '<button class="secondary" data-deactivate-reward="' + escapeHtml(r.id) + '">' + T.parent.deactivateBtn + "</button>" : "") +
            "</div>"
          );
        })
        .join("") || '<p class="muted">' + T.rewards.noRewards + "</p>";

    var pending = state.economy.requests.filter(function (r) { return r.status === "requested"; });
    var pendingHtml = pending.length
      ? pending
          .map(function (req) {
            return (
              '<div class="reward-item"><span>' + escapeHtml(req.nameSnapshot) + " — " + Number(req.costSnapshot) + " 🪙</span>" +
              '<span><button data-approve-request="' + escapeHtml(req.id) + '">' + T.parent.approveBtn + "</button> " +
              '<button class="secondary" data-reject-request="' + escapeHtml(req.id) + '">' + T.parent.rejectBtn + "</button></span></div>"
            );
          })
          .join("")
      : '<p class="muted">' + T.parent.noPendingRequests + "</p>";

    return (
      '<div class="card" style="margin-bottom:1rem">' +
      "<h2>" + T.parent.rewardsTitle + "</h2>" +
      rewardsHtml +
      '<div style="margin-top:0.75rem">' +
      '<input id="new-reward-name" type="text" placeholder="' + T.parent.rewardNamePlaceholder + '" /> ' +
      '<input id="new-reward-cost" type="number" min="1" max="' + CONFIG.LEDGER_MAX_ABS_AMOUNT + '" placeholder="' + T.parent.rewardCostPlaceholder + '" style="width:6em" /> ' +
      '<button data-action="add-reward">' + T.parent.addRewardBtn + "</button>" +
      "</div>" +
      "<h2>" + T.parent.pendingRequestsTitle + "</h2>" +
      '<div id="pending-requests-msg" class="muted" style="min-height:1.2em"></div>' +
      pendingHtml +
      "</div>"
    );
  }

  function wireRewardsSection() {
    bindAction("add-reward", function () {
      var name = document.getElementById("new-reward-name").value.trim();
      var cost = Number(document.getElementById("new-reward-cost").value);
      if (!name || !isFinite(cost) || cost <= 0 || cost > CONFIG.LEDGER_MAX_ABS_AMOUNT) return;
      cost = Math.round(cost);
      var id = "r_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
      save(function (s) { s.economy.rewards.push({ id: id, name: name, cost: cost, active: true }); }).then(function (result) {
        if (result.ok) renderParentDashboard();
      });
    });
    document.querySelectorAll("[data-deactivate-reward]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.dataset.deactivateReward;
        save(function (s) { MathCore.Economy.deactivateReward(s, id); }).then(function (result) {
          if (result.ok) renderParentDashboard();
        });
      });
    });
    document.querySelectorAll("[data-approve-request]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.dataset.approveRequest;
        var ledgerId = "l_" + id + "_redeem";
        save(function (s) { return MathCore.Economy.approveRequest(s, id, ledgerId, Date.now()); }).then(function (result) {
          if (!result.ok) return; // stale/error already surfaced
          cloudBackupSoon();
          if (result.value && !result.value.ok) {
            document.getElementById("pending-requests-msg").textContent = T.parent.insufficientBalanceMsg;
          } else {
            renderParentDashboard();
          }
        });
      });
    });
    document.querySelectorAll("[data-reject-request]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.dataset.rejectRequest;
        save(function (s) { MathCore.Economy.rejectRequest(s, id); }).then(function (result) {
          if (result.ok) renderParentDashboard();
        });
      });
    });
  }

  function kpiTile(label, value) {
    return '<div class="card" style="min-width:100px"><div style="font-size:1.4rem;font-weight:bold">' + value + '</div><div class="muted">' + label + "</div></div>";
  }

  function chartBlock(label, svg) {
    return '<div><div class="muted">' + label + '</div><div dir="ltr">' + svg + "</div></div>";
  }

  function heatmapCellColor(cell) {
    if (cell.mastery === "mastered") return "#3CC97A";
    if (cell.mastery === "new") return "#E4E8F0";
    var acc = cell.accuracy == null ? 0 : cell.accuracy;
    return acc >= 0.7 ? "#FFC93C" : "#FF9F68";
  }

  // Inline SVG line chart with a <title> tooltip per point (DESIGN §9.6).
  // Line chart with readable numbers: y-axis min/max, a value label on every
  // point (last 12; older points keep the tooltip), a final-value badge and
  // "סבב N" labels under the first/last point. opts.fmt formats a value for
  // display; opts.format builds the tooltip.
  function lineChartSvg(values, opts) {
    var w = 320, h = 120, padL = 34, padR = 36, padT = 22, padB = 18;
    if (!values.length) return '<svg width="' + w + '" height="' + h + '"></svg>';
    var fmt = opts.fmt || function (v) { return String(Math.round(v)); };
    var max = Math.max.apply(null, values.concat([0]));
    var min = Math.min.apply(null, values.concat([0]));
    if (max === min) max = min + 1;
    var innerW = w - padL - padR, innerH = h - padT - padB;
    var stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
    var points = values.map(function (v, i) {
      var x = padL + i * stepX;
      var y = padT + innerH - ((v - min) / (max - min)) * innerH;
      return { x: x, y: y, v: v };
    });
    var polyline = points.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" ");
    // Label every k-th point (counting back from the newest) so labels never
    // crowd: k grows with the point count. Every point keeps its tooltip.
    var labelEvery = Math.max(1, Math.ceil(28 / (stepX || 28)));
    var circles = points
      .map(function (p, i) {
        var titleText = opts.format ? opts.format(p.v, i) : String(p.v);
        var showLabel = i !== values.length - 1 && (values.length - 1 - i) % labelEvery === 0;
        var label = showLabel
          ? '<text class="chart-value" x="' + p.x.toFixed(1) + '" y="' + (p.y - 6).toFixed(1) + '" text-anchor="middle">' + escapeHtml(fmt(p.v)) + "</text>"
          : "";
        return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" fill="#4F7CFF"><title>' + escapeHtml(titleText) + "</title></circle>" + label;
      })
      .join("");
    var last = points[points.length - 1];
    var badgeX = Math.min(last.x + 6, w - 30); // keep the badge inside the viewBox
    var lastBadge =
      '<rect x="' + badgeX.toFixed(1) + '" y="' + (last.y - 20).toFixed(1) + '" width="28" height="16" rx="8" fill="#FFC93C" />' +
      '<text class="chart-value" x="' + (badgeX + 14).toFixed(1) + '" y="' + (last.y - 8).toFixed(1) + '" text-anchor="middle">' + escapeHtml(fmt(last.v)) + "</text>";
    var grid =
      '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + padT + '" y2="' + padT + '" stroke="#E4E8F0" />' +
      '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + (padT + innerH / 2) + '" y2="' + (padT + innerH / 2) + '" stroke="#E4E8F0" stroke-dasharray="3 3" />' +
      '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + (padT + innerH) + '" y2="' + (padT + innerH) + '" stroke="#E4E8F0" />' +
      '<text class="chart-axis" x="' + (padL - 4) + '" y="' + (padT + 3) + '" text-anchor="end">' + escapeHtml(fmt(max)) + "</text>" +
      '<text class="chart-axis" x="' + (padL - 4) + '" y="' + (padT + innerH + 3) + '" text-anchor="end">' + escapeHtml(fmt(min)) + "</text>" +
      '<text class="chart-axis" x="' + padL + '" y="' + (h - 4) + '" text-anchor="start">' + escapeHtml(T.parent.sessionLabel(1)) + "</text>" +
      (values.length > 1 ? '<text class="chart-axis" x="' + (w - padR) + '" y="' + (h - 4) + '" text-anchor="end">' + escapeHtml(T.parent.sessionLabel(values.length)) + "</text>" : "");
    return (
      '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" style="max-width:100%">' +
      grid +
      '<polyline points="' + polyline + '" fill="none" stroke="#4F7CFF" stroke-width="2" />' +
      circles + lastBadge +
      "</svg>"
    );
  }

  // Multi-series variant of lineChartSvg (V2-DESIGN §2 B1) — one line per
  // game mode on a shared axis. `seriesList` = [{ key, values, stroke }];
  // `values[i] === null` breaks that series' line at position i (a session
  // played in a different mode) instead of interpolating across it. Value
  // labels are drawn only on each series' last 12 NON-NULL points, same
  // crowding rule as lineChartSvg. A legend line goes under the chart
  // (T.parent.modeLegend / T.parent.modeNames), not inside the SVG.
  function multiLineChartSvg(seriesList, opts) {
    var w = 320, h = 120, padL = 34, padR = 36, padT = 22, padB = 18;
    opts = opts || {};
    var fmt = opts.fmt || function (v) { return String(Math.round(v)); };
    var n = 0;
    seriesList.forEach(function (s) { n = Math.max(n, s.values.length); });
    if (!n) return '<svg width="' + w + '" height="' + h + '"></svg>';
    var allVals = [];
    seriesList.forEach(function (s) {
      s.values.forEach(function (v) { if (v !== null && v !== undefined) allVals.push(v); });
    });
    var max = Math.max.apply(null, allVals.concat([0]));
    var min = Math.min.apply(null, allVals.concat([0]));
    if (max === min) max = min + 1;
    var innerW = w - padL - padR, innerH = h - padT - padB;
    var stepX = n > 1 ? innerW / (n - 1) : 0;
    function toPoint(v, i) {
      return { x: padL + i * stepX, y: padT + innerH - ((v - min) / (max - min)) * innerH, v: v, i: i };
    }
    var labelEvery = Math.max(1, Math.ceil(28 / (stepX || 28)));

    var seriesSvg = seriesList.map(function (s) {
      var points = [];
      var segments = [];
      var current = [];
      s.values.forEach(function (v, i) {
        if (v === null || v === undefined) {
          if (current.length) { segments.push(current); current = []; }
          return;
        }
        var p = toPoint(v, i);
        current.push(p);
        points.push(p);
      });
      if (current.length) segments.push(current);
      var lines = segments
        .map(function (seg) {
          return '<polyline points="' + seg.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" ") + '" fill="none" stroke="' + s.stroke + '" stroke-width="2" />';
        })
        .join("");
      var last12 = points.slice(-12);
      var circles = points
        .map(function (p, idx) {
          var showLabel = last12.indexOf(p) !== -1 && (points.length - 1 - idx) % labelEvery === 0;
          var label = showLabel
            ? '<text class="chart-value" x="' + p.x.toFixed(1) + '" y="' + (p.y - 6).toFixed(1) + '" text-anchor="middle" fill="' + s.stroke + '">' + escapeHtml(fmt(p.v)) + "</text>"
            : "";
          return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="2.5" fill="' + s.stroke + '"><title>' + escapeHtml(s.key + ": " + fmt(p.v)) + "</title></circle>" + label;
        })
        .join("");
      return lines + circles;
    }).join("");

    var grid =
      '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + padT + '" y2="' + padT + '" stroke="#E4E8F0" />' +
      '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + (padT + innerH / 2) + '" y2="' + (padT + innerH / 2) + '" stroke="#E4E8F0" stroke-dasharray="3 3" />' +
      '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + (padT + innerH) + '" y2="' + (padT + innerH) + '" stroke="#E4E8F0" />' +
      '<text class="chart-axis" x="' + (padL - 4) + '" y="' + (padT + 3) + '" text-anchor="end">' + escapeHtml(fmt(max)) + "</text>" +
      '<text class="chart-axis" x="' + (padL - 4) + '" y="' + (padT + innerH + 3) + '" text-anchor="end">' + escapeHtml(fmt(min)) + "</text>" +
      '<text class="chart-axis" x="' + padL + '" y="' + (h - 4) + '" text-anchor="start">' + escapeHtml(T.parent.sessionLabel(1)) + "</text>" +
      (n > 1 ? '<text class="chart-axis" x="' + (w - padR) + '" y="' + (h - 4) + '" text-anchor="end">' + escapeHtml(T.parent.sessionLabel(n)) + "</text>" : "");

    return (
      '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" style="max-width:100%">' +
      grid + seriesSvg +
      "</svg>"
    );
  }

  function modeLegendHtml() {
    var order = ["typed", "falling", "wall"];
    var strokes = { typed: "#4F7CFF", falling: "#FF6F91", wall: "#3CC97A" };
    return (
      '<div class="muted" style="font-size:0.8em">' + escapeHtml(T.parent.modeLegend) + ": " +
      order.map(function (m) { return '<span style="color:' + strokes[m] + '">●</span> ' + escapeHtml(T.parent.modeNames[m]); }).join(" · ") +
      "</div>"
    );
  }

  function renderStatsSection(state) {
    var now = Date.now();
    var totals = MathCore.Stats.totals(state, now);
    var perFact = MathCore.Stats.perFactTable(state);
    var totalAttempts = perFact.reduce(function (sum, f) { return sum + f.attempts; }, 0);
    var totalCorrect = perFact.reduce(function (sum, f) { return sum + f.correct; }, 0);
    var overallAccuracy = totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    var trends = MathCore.Stats.trends(state, 30);
    var modeStrokes = { typed: "#4F7CFF", falling: "#FF6F91", wall: "#3CC97A" };
    var modeOrder = ["typed", "falling", "wall"];
    function nullMap(arr, fn) { return arr.map(function (v) { return v === null ? null : fn(v); }); }
    var chart1 = multiLineChartSvg(
      modeOrder.map(function (m) { return { key: T.parent.modeNames[m], values: nullMap(trends.accuracy[m], function (v) { return v * 100; }), stroke: modeStrokes[m] }; }),
      { fmt: function (v) { return Math.round(v) + "%"; } }
    ) + modeLegendHtml();
    var chart2 = multiLineChartSvg(
      modeOrder.map(function (m) { return { key: T.parent.modeNames[m], values: nullMap(trends.avgMs[m], function (v) { return v / 1000; }), stroke: modeStrokes[m] }; }),
      { fmt: function (v) { return v.toFixed(1); } }
    ) + modeLegendHtml();
    var chart3 = lineChartSvg(trends.masteredCount, { format: function (v, i) { return T.parent.sessionLabel(i + 1) + ": " + v; } });
    var chart4 = lineChartSvg(trends.coins, { format: function (v, i) { return T.parent.sessionLabel(i + 1) + ": " + v + " 🪙"; } });

    var heatmapGrid = MathCore.Stats.heatmap(state);
    // V2-DESIGN §2 B4: axis labels (1…10) on a header row + leading column,
    // and a colour-key legend under the grid — the grid had no numbers at all.
    var heatmapAxisLabels = [];
    for (var hn = CONFIG.FACTS_MIN; hn <= CONFIG.FACTS_MAX; hn++) heatmapAxisLabels.push(hn);
    var heatmapHtml =
      '<div class="ltr" style="display:grid;grid-template-columns:1.4em repeat(10,1fr);gap:2px;width:min(440px,92vw);margin:0.5rem auto;align-items:center">' +
      '<div></div>' +
      heatmapAxisLabels.map(function (n) { return '<div class="chart-axis" style="text-align:center">' + n + "</div>"; }).join("") +
      heatmapGrid
        .map(function (row, r) {
          return (
            '<div class="chart-axis" style="text-align:center">' + heatmapAxisLabels[r] + "</div>" +
            row
              .map(function (cell) {
                var cp = MathCore.Facts.parts(cell.key);
                // V2-DESIGN §8: mirror-state suffix after the mastery name, non-square facts only
                // (a square fact's `cell.mirror` is always "ok" — trivially, only one direction
                // exists — but showing that to a parent for every square would be noise).
                var mirrorSuffix = cp[0] === cp[1] ? null : T.parent.mirrorState[cell.mirror];
                return '<div title="' + T.parent.heatmapTooltip(cp[0], cp[1], T.parent.masteryNames[cell.mastery] || cell.mastery, mirrorSuffix) + '" style="aspect-ratio:1;border-radius:4px;background:' + heatmapCellColor(cell) + '"></div>';
              })
              .join("")
          );
        })
        .join("") +
      "</div>" +
      '<div class="muted" style="font-size:0.8em;text-align:center;margin-top:0.4rem">' + escapeHtml(T.parent.heatmapLegend) + "</div>";

    var weakest = MathCore.Stats.weakest(state, now, 8);
    var weakestHtml = weakest.length
      ? '<ul style="list-style:none;padding:0">' +
        weakest
          .map(function (key) {
            var fact = MathCore.Facts.getFact(state, key);
            var acc = fact.attempts ? Math.round((fact.correct / fact.attempts) * 100) : 0;
            return "<li>" + key.replace("x", "×") + " — " + acc + "%</li>";
          })
          .join("") +
        "</ul>"
      : '<p class="muted">' + T.parent.noDataYet + "</p>";

    var historyRows = state.sessions.slice(-20).reverse();
    var historyHtml =
      (anySuspended(state) ? '<div class="reward-item"><span>' + T.parent.historyOpen + "</span><span>—</span></div>" : "") +
      (historyRows.length
        ? historyRows
            .map(function (sess) {
              var dateStr = new Date(sess.endedAt).toLocaleDateString("he-IL");
              var fallingMark = sess.mode === "falling" ? " 🎈" : sess.mode === "wall" ? " 🧱" : "";
              var seriesMark = sess.perfectSeries >= 2 ? " 🔥" + bdi(sess.perfectSeries) : "";
              return '<div class="reward-item"><span>' + bdi(dateStr) + " — " + bdi(sess.firstTryCorrect + "/" + sess.planned.length) + fallingMark + seriesMark + "</span><span>" + bdi(sess.coinsEarned) + " 🪙</span></div>";
            })
            .join("")
        : '<p class="muted">' + T.parent.noSessionsYet + "</p>");

    return (
      '<div class="card" style="margin-bottom:1rem">' +
      "<h2>" + T.parent.statsTitle + "</h2>" +
      '<div style="display:flex;flex-wrap:wrap;gap:0.75rem;justify-content:center">' +
      kpiTile(T.parent.kpiSessions, totals.totalSessions) +
      kpiTile(T.parent.kpiCoins, totals.lifetimeCoins) +
      kpiTile(T.parent.kpiMastered, totals.masteredCount + "/" + MathCore.Facts.allKeys().length) +
      kpiTile(T.parent.kpiStreak, totals.dailyStreak) +
      kpiTile(T.parent.kpiMap, MathCore.Map.overview(state).filter(function (r) { return r.reached; }).length + "/" + CONFIG.MAP_PATH.length) +
      kpiTile(T.parent.kpiAccuracy, overallAccuracy + "%") +
      "</div>" +
      '<div style="display:flex;flex-wrap:wrap;gap:1rem;justify-content:center;margin-top:1rem">' +
      chartBlock(T.parent.trendAccuracy, chart1) +
      chartBlock(T.parent.trendSpeed, chart2) +
      chartBlock(T.parent.trendMastered, chart3) +
      chartBlock(T.parent.trendCoins, chart4) +
      "</div>" +
      "<h3>" + T.parent.heatmapTitle + "</h3>" + heatmapHtml +
      "<h3>" + T.parent.weakestTitle + "</h3>" + weakestHtml +
      "<h3>" + T.parent.historyTitle + "</h3>" + historyHtml +
      "</div>"
    );
  }

  function renderCloudSection(state) {
    var c = state.settings.cloud || {};
    var status = c.token
      ? (c.lastError ? T.parent.cloudLastError(escapeHtml(c.lastError)) : c.lastOkAt ? T.parent.cloudLastOk(new Date(c.lastOkAt).toLocaleString("he-IL")) : T.parent.cloudConnected)
      : T.parent.cloudNotConnected;
    return (
      '<div class="card" style="margin-bottom:1rem">' +
      "<h2>" + T.parent.cloudTitle + "</h2>" +
      '<p class="muted">' + T.parent.cloudHint + " " + T.parent.cloudSecretNote + "</p>" +
      '<p id="cloud-status">' + status + "</p>" +
      (c.token
        ? '<button data-action="cloud-backup-now">' + T.parent.cloudBackupNowBtn + "</button> " +
          '<button class="secondary" data-action="cloud-restore">' + T.parent.cloudRestoreBtn + "</button> " +
          '<button class="ghost" data-action="cloud-disconnect">' + T.parent.cloudDisconnectBtn + "</button>"
        : '<input id="cloud-token" type="password" autocomplete="off" placeholder="' + T.parent.cloudTokenPlaceholder + '" style="width:min(320px,80vw)" /> ' +
          '<button data-action="cloud-save">' + T.parent.cloudSaveBtn + "</button>") +
      '<div id="cloud-msg" class="muted" style="min-height:1.2em"></div>' +
      "</div>"
    );
  }

  function wireCloudSection() {
    var msg = function (t) { var el = document.getElementById("cloud-msg"); if (el) el.textContent = t; };
    bindAction("cloud-save", function () {
      var token = (document.getElementById("cloud-token").value || "").trim();
      if (!token) return;
      msg(T.parent.cloudChecking);
      MathCore.Cloud.verifyToken(window.fetch.bind(window), token).then(function (v) {
        if (!v.ok) { msg(T.parent.cloudTokenBad(v.error)); return; }
        // Adopt an existing backup gist only when this device already holds at
        // least as much history; otherwise future backups go to a NEW gist and
        // the bigger cloud copy stays untouched until the parent restores it.
        return cloudPeek(token, null).then(function (peek) {
          var local = (S().sessions || []).length;
          var adopt = peek.ok && peek.sessions <= local;
          return save(function (s) { s.settings.cloud = { token: token, gistId: adopt ? peek.gistId : null, lastOkAt: null, lastError: null, restoreFromGistId: peek.ok && !adopt ? peek.gistId : null }; }).then(function (result) {
            if (!result.ok) { msg(T.saveFailure); return; }
            if (peek.ok && !adopt) { renderParentDashboard(); var el = document.getElementById("cloud-msg"); if (el) el.textContent = T.parent.cloudFoundExisting + " " + T.parent.cloudRestorePreview(new Date(peek.updatedAt).toLocaleString("he-IL"), peek.sessions); return; }
            return cloudBackupNow().then(function (r) { renderParentDashboard(); var el2 = document.getElementById("cloud-msg"); if (el2 && r.skipped) el2.textContent = r.error; });
          });
        });
      });
    });
    bindAction("cloud-backup-now", function () {
      msg(T.parent.cloudChecking);
      cloudBackupNow().then(function (r) { renderParentDashboard(); var el = document.getElementById("cloud-msg"); if (el) el.textContent = r.ok ? T.parent.cloudBackupDone : T.parent.cloudLastError(r.error || "?"); });
    });
    bindAction("cloud-restore", function () {
      var c = S().settings.cloud;
      msg(T.parent.cloudChecking);
      cloudPeek(c.token, c.restoreFromGistId || c.gistId).then(function (p) { // prefer the bigger backup remembered at connect
        if (!p.ok) { msg(T.parent.restoreFailed(p.error || "?")); return; }
        var local = (S().sessions || []).length;
        var area = document.getElementById("cloud-msg");
        area.innerHTML =
          "<div>" + T.parent.cloudRestorePreview(new Date(p.updatedAt).toLocaleString("he-IL"), p.sessions) + "</div>" +
          (p.sessions < local ? '<div style="color:var(--wrong)">' + T.parent.cloudRestoreWarnSmaller + "</div>" : "") +
          '<button data-action="cloud-restore-confirm" style="margin-top:0.4rem">' + T.parent.cloudRestoreConfirmBtn + "</button>";
        bindAction("cloud-restore-confirm", function () {
          cloudApply(c.token, p.gistId, p.json).then(function (r) {
            if (r.ok) { renderParentDashboard(); var el = document.getElementById("cloud-msg"); if (el) el.textContent = T.parent.restoredMsg; }
            else msg(T.parent.restoreFailed(r.error || "?"));
          });
        });
      });
    });
    bindAction("cloud-disconnect", function () {
      save(function (s) { s.settings.cloud = { token: null, gistId: null, lastOkAt: null, lastError: null }; }).then(function (result) { if (result.ok) renderParentDashboard(); });
    });
  }

  // Closing-review 0-R LOW-6: parent-visible status for the one-time
  // evidence rebuild (V2-DESIGN §2 B2a), read straight from meta.evidenceRebuild.
  function evidenceRebuildStatusKey(state) {
    var ev = state.meta && state.meta.evidenceRebuild;
    if (!ev) return "pending";
    if (ev.reason === "rebuilt") return "rebuilt";
    if (ev.reason === "trimmed") return "trimmed";
    return "malformed";
  }

  function renderDataSection(state) {
    var lastExportText = state.lastExportAt ? T.parent.lastExportLabel(new Date(state.lastExportAt).toLocaleDateString("he-IL")) : T.parent.neverExported;
    return (
      '<div class="card" style="margin-bottom:1rem">' +
      "<h2>" + T.parent.dataTitle + "</h2>" +
      '<p class="muted">' + lastExportText + "</p>" +
      '<p class="muted">' + T.parent.evidenceRebuiltLabel + ": " + T.parent.evidenceRebuildStates[evidenceRebuildStatusKey(state)] + "</p>" +
      '<button data-action="export-data">' + T.parent.exportBtn + "</button> " +
      '<button class="secondary" data-action="trigger-import">' + T.parent.importBtn + "</button>" +
      '<input id="import-file-input" type="file" accept="application/json" style="display:none" /><br><br>' +
      '<button class="secondary" data-action="undo-last">' + T.parent.undoBtn + "</button> " +
      (function () {
        var snap = App.storage.readLastGood();
        var n = snap && snap.state && Array.isArray(snap.state.sessions) ? snap.state.sessions.length : 0;
        return n > (state.sessions || []).length ? '<button class="secondary" data-action="restore-lastgood">' + T.parent.restoreLocalBtn(n) + "</button>" : "";
      })() + "<br><br>" +
      '<button class="ghost" data-action="show-reset">' + T.parent.resetBtn + "</button>" +
      '<div id="data-section-msg" class="muted" style="min-height:1.2em"></div>' +
      '<div id="import-preview-area"></div>' +
      '<div id="reset-area"></div>' +
      "</div>"
    );
  }

  function wireDataSection() {
    bindAction("export-data", function () {
      var json = App.storage.serializeForExport();
      var dateStr = new Date().toISOString().slice(0, 10);
      var name = "math-progress-" + dateStr + ".json";
      var msg = document.getElementById("data-section-msg");
      // iOS (Home-Screen app or Safari) turns a download link into a preview
      // page with no "save" — seen live 2026-08-27. The share sheet offers
      // "Save to Files"; the download link stays as the desktop fallback.
      var file = null;
      try { file = new File([json], name, { type: "application/json" }); } catch (e) { file = null; }
      if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        msg.textContent = T.parent.exportShareHint;
        navigator.share({ files: [file], title: name }).then(function () {
          return App.storage.markExported(Date.now()).then(function () { renderParentDashboard(); document.getElementById("data-section-msg").textContent = T.parent.exportDone; });
        }).catch(function (err) {
          msg.textContent = err && err.name === "AbortError" ? T.parent.exportCancelled : T.parent.restoreFailed(String(err && err.message || err));
        });
        return;
      }
      var blob = new Blob([json], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      App.storage.markExported(Date.now()).then(function () { renderParentDashboard(); });
    });

    bindAction("trigger-import", function () {
      document.getElementById("import-file-input").click();
    });
    document.getElementById("import-file-input").addEventListener("change", function (ev) {
      var file = ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result);
        var raw;
        try {
          raw = JSON.parse(text);
        } catch (e) {
          document.getElementById("data-section-msg").textContent = T.parent.invalidFile;
          return;
        }
        var validation = MathCore.Migrate.validateImport(raw);
        if (!validation.ok) {
          document.getElementById("data-section-msg").textContent = T.parent.invalidFile + ": " + validation.problems.join(", ");
          return;
        }
        showImportPreview(raw, text);
      };
      reader.readAsText(file);
    });

    bindAction("restore-lastgood", function () {
      App.storage.restoreLastGood(Date.now()).then(function (result) {
        if (result.ok) {
          maybeRebuildEvidence().then(function () {
            document.getElementById("data-section-msg").textContent = T.parent.restoredMsg;
            renderParentDashboard();
          });
        }
        else { document.getElementById("data-section-msg").textContent = T.parent.restoreFailed(result.error || "stale"); }
      });
    });
    bindAction("undo-last", function () {
      App.storage.undoLastReplace(Date.now()).then(function (result) {
        if (result.ok) {
          document.getElementById("data-section-msg").textContent = T.parent.undoneMsg;
          renderParentDashboard();
        }
      });
    });

    bindAction("show-reset", function () { showResetConfirm(); });
  }

  function showImportPreview(raw, text) {
    var sessionsCount = Array.isArray(raw.sessions) ? raw.sessions.length : 0;
    var lifetimeCoins =
      raw.economy && Array.isArray(raw.economy.ledger)
        ? raw.economy.ledger.reduce(function (sum, e) { return e.type === "earn" ? sum + e.amount : sum; }, 0)
        : 0;
    var exportDate = raw.lastExportAt ? new Date(raw.lastExportAt).toLocaleDateString("he-IL") : "—";
    var warning = anySuspended(S()) ? '<p class="muted">' + T.parent.importWarningActive + "</p>" : "";
    var area = document.getElementById("import-preview-area");
    area.innerHTML =
      '<div class="card">' +
      "<h3>" + T.parent.importPreviewTitle + "</h3>" +
      "<p>" + T.parent.importSummary(sessionsCount, lifetimeCoins, exportDate) + "</p>" +
      warning +
      '<input id="import-pin" type="password" inputmode="numeric" maxlength="4" placeholder="' + T.parent.importPinPrompt + '" /><br><br>' +
      '<button data-action="confirm-import">' + T.parent.importConfirmBtn + "</button> " +
      '<button class="secondary" data-action="cancel-import">' + T.parent.importCancelBtn + "</button>" +
      '<div class="muted" id="import-error" style="min-height:1.2em"></div>' +
      "</div>";
    bindAction("confirm-import", function () {
      var pin = document.getElementById("import-pin").value;
      MathCore.Pin.verify(window.crypto, pin, S().settings.pinHash).then(function (ok) {
        if (!ok) { document.getElementById("import-error").textContent = T.parent.wrongPin; return; }
        App.storage.importJson(text, Date.now()).then(function (result) {
          if (result.ok) {
            maybeRebuildEvidence().then(function () { renderParentDashboard(); });
          } else {
            document.getElementById("import-error").textContent = (result.problems || [result.error || T.parent.genericError]).join(", ");
          }
        });
      });
    });
    bindAction("cancel-import", function () {
      document.getElementById("import-preview-area").innerHTML = "";
    });
  }

  function showResetConfirm() {
    var area = document.getElementById("reset-area");
    area.innerHTML =
      '<div class="card">' +
      "<p>" + T.parent.resetConfirmPrompt + "</p>" +
      "<label>" + T.parent.resetTypeLabel + '<br><input id="reset-type-input" type="text" class="ltr" /></label><br><br>' +
      "<label>" + T.parent.resetPinLabel + '<br><input id="reset-pin-input" type="password" inputmode="numeric" maxlength="4" /></label><br><br>' +
      '<button data-action="confirm-reset">' + T.parent.resetConfirmBtn + "</button> " +
      '<button class="secondary" data-action="cancel-reset">' + T.parent.resetCancelBtn + "</button>" +
      '<div class="muted" id="reset-error" style="min-height:1.2em"></div>' +
      "</div>";
    bindAction("cancel-reset", function () { document.getElementById("reset-area").innerHTML = ""; });
    bindAction("confirm-reset", function () {
      var typed = document.getElementById("reset-type-input").value;
      var pin = document.getElementById("reset-pin-input").value;
      var errorEl = document.getElementById("reset-error");
      if (typed !== T.parent.resetTypeConfirm) { errorEl.textContent = T.parent.resetTypeMismatch; return; }
      MathCore.Pin.verify(window.crypto, pin, S().settings.pinHash).then(function (ok) {
        if (!ok) { errorEl.textContent = T.parent.wrongPin; return; }
        var current = S();
        var fresh = MathCore.Migrate.emptyState();
        fresh.settings.pinHash = current.settings.pinHash;
        fresh.settings.recoveryHash = current.settings.recoveryHash;
        fresh.settings.childName = current.settings.childName;
        fresh.settings.cloud = { token: current.settings.cloud ? current.settings.cloud.token : null, gistId: null, lastOkAt: null, lastError: null }; // new gist for the fresh start; the old backup is kept
        App.storage.backupThenReplace(fresh, Date.now()).then(function (result) {
          if (result.ok) { App.storage.clearLastGood(); renderParentDashboard(); }
        });
      });
    });
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  async function boot() {
    App.storage = MathCore.Storage.create({
      indexedDB: window.indexedDB,
      localStorage: window.localStorage,
      dbName: "mathtrainer",
    });

    var raw = await App.storage.load();
    var state;
    try {
      state = MathCore.Migrate.migrate(raw);
    } catch (err) {
      if (err && err.code === "SCHEMA_TOO_NEW") {
        render("<p>" + T.schemaTooNew + "</p>");
        return;
      }
      throw err;
    }
    MathCore.Migrate.recompute(state);
    App.storage.state = state;

    wireStorageReactions();

    // One-time evidence rebuild (V2-DESIGN §2 B2a). save() mutates a CLONE of
    // App.storage.state and only adopts it on a successful CAS commit — a
    // failed save leaves App.storage.state byte-identical and the app runs
    // normally on it; the guard stays pending and the next boot retries.
    // Closing-review 0-R LOW-6: a done:false guard (still-malformed evidence)
    // must not force a save on EVERY boot when nothing changed — that's a
    // needless IDB write + rev bump forever on a device with genuinely
    // inconsistent history. Only save when the preflight's outcome differs
    // from what's already recorded (a first failure, or the reason changed).
    if (MathCore.Migrate.evidenceRebuildPending(state)) {
      var evidenceCheck = MathCore.Migrate.preflightEvidence(state);
      var existingGuard = state.meta && state.meta.evidenceRebuild;
      var sameFailureAsBefore =
        !evidenceCheck.ok && existingGuard && existingGuard.done === false && existingGuard.reason === evidenceCheck.reason;
      if (!sameFailureAsBefore) {
        // Closing-review 0-R LOW-5: never let a rebuild failure (or a save
        // failure) block boot — log and continue on the un-rebuilt state.
        try {
          await save(function (s) { MathCore.Migrate.rebuildEvidence(s, Date.now()); });
        } catch (e) {
          console.error("evidence rebuild failed; continuing on the un-rebuilt state", e);
        }
      }
    }

    if (navigator.storage && navigator.storage.persist) {
      try { await navigator.storage.persist(); } catch (e) { /* best-effort, DESIGN §11 */ }
    }

    // Courtesy-only: the real single-writer defense is Storage's
    // transactional rev check (DESIGN §8, R2 #3), not this message.
    if (typeof BroadcastChannel !== "undefined") {
      App.channel = new BroadcastChannel("mathtrainer");
      App.channel.onmessage = function (ev) {
        if (ev.data && ev.data.type === "saved" && ev.data.rev > App.storage.rev) {
          showStale();
        }
      };
    }

    document.addEventListener("visibilitychange", function () {
      var state = App.storage.state;
      if (document.hidden && state && state.active && state.active.current) {
        save(function (s) { MathCore.SessionCore.markInterrupted(s); }); // independent of submit
      }
    });

    document.querySelector('[data-action="reload-for-update"]').textContent = T.misc.reloadBtn;
    document.querySelector('[data-action="reload-for-update"]').addEventListener("click", function () {
      location.reload();
    });
    registerServiceWorker();

    if (!state.settings.pinHash) {
      Screens.parentSetup();
    } else {
      route();
    }
  }

  boot();
})();
