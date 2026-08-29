"use strict";
// S3-4: DOM smoke harness — boots strings.js + app.js against core.js inside a
// linkedom window (pinned dev dep, --ignore-scripts), with the stubs the
// plan lists (matchMedia, serviceWorker, AudioContext, rAF, navigator.storage,
// crypto.subtle via Node's webcrypto, fetch throwing, IndexedDB from
// fake-indexeddb) plus a minimal `location`/hashchange shim linkedom itself
// does not provide (needed for the app's hash router).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { parseHTML } = require("linkedom");
const { IDBFactory } = require("fake-indexeddb");
const nodeCrypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");

// Mirrors the static markup index.html carries around the three <script>
// tags — every element id/attribute app.js's boot() and render() touch
// directly (not through Screens.* HTML, which app.js writes into #app itself).
function baseHtml() {
  return (
    "<!doctype html><html lang=\"he\" dir=\"rtl\"><head></head><body>" +
    '<div id="app">טוענת...</div>' +
    '<div id="stale-card" role="alert"></div>' +
    '<div id="save-failure-banner" class="banner" role="alert"></div>' +
    '<div id="update-toast" class="banner" role="status" style="display:none">' +
    '<span id="update-toast-text"></span>' +
    '<button data-action="reload-for-update"></button>' +
    "</div>" +
    "</body></html>"
  );
}

function makeMatchMedia(overrides) {
  overrides = overrides || {};
  return function (query) {
    return {
      matches: !!overrides[query],
      media: query,
      addListener: function () {},
      removeListener: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
    };
  };
}

function installLocation(window) {
  var hash = "";
  window.location = {
    get hash() { return hash; },
    set hash(v) {
      v = String(v);
      if (v === hash) return;
      hash = v;
      window.dispatchEvent(new window.Event("hashchange"));
    },
    reload: function () {},
    href: "http://localhost/index.html",
  };
}

function installAudio(window) {
  function FakeAudioContext() {
    this.currentTime = 0;
    this.state = "running";
    this.destination = {};
  }
  FakeAudioContext.prototype.resume = function () { this.state = "running"; return Promise.resolve(); };
  FakeAudioContext.prototype.createOscillator = function () {
    return {
      type: "sine",
      frequency: { value: 0, setValueAtTime: function () {} },
      connect: function () { return this; },
      start: function () {},
      stop: function () {},
    };
  };
  FakeAudioContext.prototype.createGain = function () {
    return {
      gain: {
        value: 0,
        setValueAtTime: function () {},
        linearRampToValueAtTime: function () {},
        exponentialRampToValueAtTime: function () {},
      },
      connect: function () { return this; },
    };
  };
  window.AudioContext = FakeAudioContext;
}

// Builds a fresh linkedom window with every stub the app needs, WITHOUT
// loading core.js/strings.js/app.js yet (a test can tweak the window first —
// e.g. window.fetch, matchMedia overrides — before calling loadApp).
function buildWindow(opts) {
  opts = opts || {};
  var parsed = parseHTML(baseHtml());
  var window = parsed.window;
  window.window = window;
  window.globalThis = window;
  window.self = window;

  // linkedom leaks the HOST's CommonJS `module`/`exports`/`require` onto its
  // window (a Node-interop convenience) — core.js's UMD wrapper checks
  // `typeof module !== "undefined"` first and, left alone, would call
  // `module.exports = MathCore` on the wrong (host) module object instead of
  // setting `window.MathCore`, exactly like a real `<script src>` load must.
  delete window.module;
  delete window.exports;
  delete window.require;

  installLocation(window);
  installAudio(window);

  // IndexedDB — fresh per harness instance so tests never share state.
  window.indexedDB = new IDBFactory();

  // localStorage — linkedom has no Storage implementation; a tiny in-memory shim.
  var lsData = {};
  window.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(lsData, k) ? lsData[k] : null; },
    setItem: function (k, v) { lsData[k] = String(v); },
    removeItem: function (k) { delete lsData[k]; },
    clear: function () { Object.keys(lsData).forEach(function (k) { delete lsData[k]; }); },
  };

  // matchMedia — "no match" by default; pass opts.mediaMatches = { "<query>": true } to override.
  window.matchMedia = makeMatchMedia(opts.mediaMatches);

  // crypto — Node's real webcrypto (subtle.digest + getRandomValues), exactly
  // the API surface MathCore.Pin uses; not a stub, the real thing. linkedom
  // defines its own `window.crypto` as a getter-only accessor, so a plain
  // assignment throws — redefine the property outright.
  Object.defineProperty(window, "crypto", { value: nodeCrypto.webcrypto, configurable: true, writable: true });

  // fetch — disabled by default (plan: "fetch throwing"); a cloud-flow test
  // can overwrite window.fetch with its own stub before calling loadApp.
  window.fetch = opts.fetch || function () { return Promise.reject(new Error("fetch disabled in tests")); };

  // requestAnimationFrame/cancelAnimationFrame — linkedom has neither.
  window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(Date.now()); }, 0); };
  window.cancelAnimationFrame = function (id) { clearTimeout(id); };

  // navigator.storage/.share — app.js already guards these as optional
  // (`if (navigator.storage && ...)`); giving them here just avoids the
  // guard's false branch everywhere so boot's persist() call resolves.
  // linkedom's navigator silently swallows a plain `nav.storage = {}`
  // assignment (it's backed by a proxy with no `storage` trap) — defineProperty
  // is the one thing that actually lands.
  Object.defineProperty(window.navigator, "storage", {
    value: {
      persist: function () { return Promise.resolve(true); },
      persisted: function () { return Promise.resolve(true); },
    },
    configurable: true,
  });
  // Deliberately no navigator.serviceWorker: registerServiceWorker() checks
  // `"serviceWorker" in navigator` and no-ops when it's absent — the
  // correct stub for a harness that never needs a real service worker.

  // BroadcastChannel — no-op; each harness instance is its own single "window".
  window.BroadcastChannel = function () { this.onmessage = null; };
  window.BroadcastChannel.prototype.postMessage = function () {};
  window.BroadcastChannel.prototype.close = function () {};

  return window;
}

function loadApp(window) {
  var context = vm.createContext(window);
  ["core.js", "strings.js", "app.js"].forEach(function (f) {
    var src = fs.readFileSync(path.join(ROOT, f), "utf8");
    vm.runInContext(src, context, { filename: f });
  });
  return window;
}

function flush(times) {
  times = times || 1;
  var p = Promise.resolve();
  for (var i = 0; i < times; i++) {
    p = p.then(function () { return new Promise(function (resolve) { setTimeout(resolve, 0); }); });
  }
  return p;
}

// Builds a window, loads the three scripts (which self-invoke boot()), and
// waits long enough for the async boot sequence (IDB load, migrate, the
// evidence-rebuild save, navigator.storage.persist) to settle.
async function bootApp(opts) {
  var window = buildWindow(opts);
  loadApp(window);
  await flush(15);
  return window;
}

function currentScreen(window) {
  var el = window.document.querySelector("[data-screen]");
  return el ? el.getAttribute("data-screen") : null;
}

function fireClick(el) {
  el.dispatchEvent(new el.ownerDocument.defaultView.Event("click", { bubbles: true }));
}

// Drives the first-run parent-setup → recovery-code screens through to Home,
// the same three-tap flow a parent does once per device. Returns once Home
// has rendered (or the setup screen's error text, if the save failed).
async function completeParentSetup(window, opts) {
  opts = opts || {};
  var d = window.document;
  d.getElementById("setup-name").value = opts.name || "נועה";
  d.getElementById("setup-pin").value = opts.pin || "1234";
  d.getElementById("setup-pin-confirm").value = opts.pin || "1234";
  fireClick(d.querySelector('[data-action="setup-continue"]'));
  await flush(10);
  if (currentScreen(window) !== "parent-setup-recovery") return; // e.g. the save failed — caller inspects #setup-error
  d.getElementById("recovery-ack").checked = true;
  d.getElementById("recovery-ack").dispatchEvent(new window.Event("change", { bubbles: true }));
  fireClick(d.getElementById("recovery-finish"));
  await flush(10);
}

// Answers the CURRENT question correctly via the coarse-pointer numpad
// (bootApp must have been called with mediaMatches: {"(pointer: coarse)": true}).
// Also dismisses the wrong-answer "הבנתי" helper if a bug/typo ever lands here
// wrong, so a caller driving a whole session to completion never wedges.
async function answerCurrentQuestionCorrectly(window) {
  var d = window.document;
  var state = window.App.storage.state;
  var current = state.active && state.active.current;
  if (!current) return false;
  var parts = window.MathCore.Facts.parts(current.asked);
  var answer = String(parts[0] * parts[1]);
  for (var i = 0; i < answer.length; i++) {
    fireClick(d.querySelector('[data-key="' + answer[i] + '"]'));
  }
  fireClick(d.querySelector('[data-key="check"]'));
  await flush(15);
  var cont = d.querySelector('[data-action="continue-after-wrong"]');
  if (cont) { fireClick(cont); await flush(10); }
  return true;
}

// Plays a whole typed session to completion (summary screen), answering every
// question correctly. Sets CONFIG.WRONG_ANSWER_DISPLAY_MS to 0 first so the
// test doesn't wait out the real feedback delay — a test-only override of the
// loaded CONFIG object, not a change to app.js/core.js.
async function playSessionToSummary(window, maxQuestions) {
  window.MathCore.CONFIG.WRONG_ANSWER_DISPLAY_MS = 0;
  maxQuestions = maxQuestions || 30;
  for (var i = 0; i < maxQuestions; i++) {
    if (currentScreen(window) !== "question") break;
    var answered = await answerCurrentQuestionCorrectly(window);
    if (!answered) break;
  }
}

module.exports = {
  buildWindow,
  loadApp,
  flush,
  bootApp,
  currentScreen,
  baseHtml,
  fireClick,
  completeParentSetup,
  answerCurrentQuestionCorrectly,
  playSessionToSummary,
};
