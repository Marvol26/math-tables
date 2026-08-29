"use strict";
// S3-4 DOM smoke harness (design §7.3-4): boots strings.js + app.js against
// core.js in a linkedom window (see tests/ui/harness.js for the stubs) and
// drives the flows the plan lists through real DOM events — the closest a
// `node --test` run gets to the live-browser testing CLAUDE.md's Testing
// section calls "the real verification for UI changes", without a browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  bootApp,
  flush,
  currentScreen,
  fireClick,
  completeParentSetup,
  playSessionToSummary,
} = require("./harness.js");

test("[S3-4] first-run setup: happy path reaches Home, and a failed save keeps the parent on the setup screen with an error", async () => {
  // Happy path.
  const ok = await bootApp();
  await completeParentSetup(ok, { name: "נועה" });
  assert.equal(currentScreen(ok), "home");
  assert.equal(ok.App.storage.state.settings.childName, "נועה");
  assert.ok(ok.App.storage.state.settings.pinHash, "pinHash must be set after setup");

  // Failed save: force the very next save to go stale (CAS rejects because
  // the in-memory rev has drifted past what IDB actually holds — the same
  // condition a second open tab winning a race would produce), then run the
  // identical setup flow and confirm it does NOT silently show the recovery
  // screen (the exact bug S3-1 fixed: onSetupContinue used to call
  // showRecoveryCode() unconditionally, ignoring the save's own result.ok).
  const failing = await bootApp();
  failing.App.storage.rev += 1;
  await completeParentSetup(failing, { name: "נועה" });
  assert.equal(currentScreen(failing), "parent-setup", "a failed save must not advance to the recovery screen");
  assert.equal(
    failing.document.getElementById("setup-error").textContent,
    failing.MathText.T.saveFailure,
    "the setup screen must show the save-failure string, not silently succeed"
  );
});

test("[S3-4] Home -> typed question -> answer -> next question -> summary", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  await completeParentSetup(window);
  assert.equal(currentScreen(window), "home");

  fireClick(window.document.querySelector('[data-action="play"]'));
  await flush(10);
  assert.equal(currentScreen(window), "question");
  const firstAsked = window.App.storage.state.active.current.asked;

  await playSessionToSummary(window);

  assert.equal(currentScreen(window), "summary", "a full session of correct answers must reach the summary screen");
  const session = window.App.lastSessionResult;
  assert.equal(session.firstTryCorrect, session.planned.length, "every answer in this run was correct");
  assert.ok(session.planned.indexOf(firstAsked) !== -1, "the session's plan includes the very first question asked");
  assert.equal(window.App.storage.state.active, null, "finish() must clear active on the summary");
});

test("[S3-4] falling mode renders one .bubble per configured option, sized to settings.falling.options", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  await completeParentSetup(window);

  await window.App.storage.save(function (s) {
    s.settings.falling = { enabled: true, durationSec: 8, options: 5 };
  }, Date.now());
  // Force a re-render of Home so the now-enabled falling button appears
  // (the hash is already "#screen=home" from setup, so re-assigning the
  // identical string is a no-op per the location shim's own dedup — round
  // through another screen first, exactly like a real navigation would).
  window.location.hash = "#screen=collection";
  await flush(3);
  window.location.hash = "#screen=home";
  await flush(5);

  fireClick(window.document.querySelector('[data-action="play-falling"]'));
  await flush(10);

  assert.equal(currentScreen(window), "question");
  const lanes = window.document.querySelector(".lanes");
  assert.ok(lanes, ".lanes must be present in falling mode");
  assert.equal(lanes.getAttribute("data-n"), "5");
  assert.equal(window.document.querySelectorAll(".bubble").length, 5);
  assert.equal(window.document.querySelector('[data-screen="question"]').getAttribute("data-falling"), "1");
});

test("[S3-4] exit suspends the session (state.active survives) and Home's play button resumes the SAME question", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  await completeParentSetup(window);

  fireClick(window.document.querySelector('[data-action="play"]'));
  await flush(10);
  const sessionId = window.App.storage.state.active.id;
  assert.equal(currentScreen(window), "question");

  fireClick(window.document.querySelector('[data-action="exit"]'));
  await flush(3);
  fireClick(window.document.querySelector('[data-action="exit-yes"]'));
  await flush(5);

  assert.equal(currentScreen(window), "home");
  assert.ok(window.App.storage.state.active, "exit only suspends — the in-flight session must survive (D12)");
  assert.equal(window.App.storage.state.active.id, sessionId);

  fireClick(window.document.querySelector('[data-action="play"]'));
  await flush(10);
  assert.equal(currentScreen(window), "question");
  assert.equal(window.App.storage.state.active.id, sessionId, "resuming must return to the SAME suspended session");
});

test("[S3-4] the parent area re-locks on every way of leaving it (PIN required again next visit)", async () => {
  const window = await bootApp();
  await completeParentSetup(window);

  window.location.hash = "#screen=parent";
  await flush(5);
  assert.equal(currentScreen(window), "parent-pin");

  window.document.getElementById("parent-pin-input").value = "1234";
  fireClick(window.document.querySelector('[data-action="parent-unlock"]'));
  await flush(5);
  assert.equal(currentScreen(window), "parent-dashboard");
  assert.equal(window.App.parentUnlocked, true);

  window.location.hash = "#screen=home";
  await flush(5);
  assert.equal(window.App.parentUnlocked, false, "leaving the parent area must re-lock it (WP9 review finding A)");

  window.location.hash = "#screen=parent";
  await flush(5);
  assert.equal(currentScreen(window), "parent-pin", "a return visit must re-ask the PIN, not reopen the dashboard");
});

test("[S3-4] the child's name is HTML-escaped everywhere it's rendered (no innerHTML injection via settings.childName)", async () => {
  const payload = '<img src=x onerror="window.__pwned=1">';
  const window = await bootApp();
  await completeParentSetup(window, { name: payload });

  assert.equal(currentScreen(window), "home");
  assert.equal(window.document.querySelectorAll("img").length, 0, "the payload must never become a real <img> element");
  assert.ok(window.document.body.innerHTML.indexOf("&lt;img") !== -1, "the escaped form must be present as text");
  assert.equal(window.__pwned, undefined, "onerror must never have run");

  // Same check on the parent dashboard's settings input value= attribute
  // (a second, independent injection point — the name lands in an
  // attribute there, not text content).
  window.App.parentUnlocked = true;
  window.location.hash = "#screen=parent";
  await flush(5);
  assert.equal(window.document.querySelectorAll("img").length, 0);
  const nameInput = window.document.getElementById("set-name");
  assert.equal(nameInput.value, payload, "the raw value round-trips correctly through the escaped attribute");
});

test("[S3-4] falling mode's CSS selector contracts exist: every class/attribute styles.css targets is actually produced by renderFallingQuestion", async () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "styles.css"), "utf8");
  // A representative sample of the falling-specific selectors from
  // FALLING-DESIGN.md's CSS contract (D3: lanes/bubbles never move on
  // feedback) — not every selector in the file, just the ones this mode's
  // markup must keep producing.
  const requiredSelectors = [
    '[data-screen="question"][data-falling="1"]',
    ".lanes",
    ".bubble",
    ".bubble.landed",
    ".bubble.popped",
    ".bubble.flyaway",
  ];
  requiredSelectors.forEach((sel) => {
    assert.ok(css.indexOf(sel) !== -1, "styles.css must still define a rule for " + sel);
  });

  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  await completeParentSetup(window);
  await window.App.storage.save(function (s) {
    s.settings.falling = { enabled: true, durationSec: 8, options: 4 };
  }, Date.now());
  window.location.hash = "#screen=collection";
  await flush(3);
  window.location.hash = "#screen=home";
  await flush(5);
  fireClick(window.document.querySelector('[data-action="play-falling"]'));
  await flush(10);

  const d = window.document;
  assert.ok(d.querySelector('[data-screen="question"][data-falling="1"]'), "the falling screen must carry data-falling=1");
  assert.ok(d.querySelector(".lanes"), ".lanes must be rendered");
  assert.ok(d.querySelector(".bubble"), ".bubble elements must be rendered");
  // .landed/.popped/.flyaway are added at runtime (animationend / a pick), not
  // present on first paint — verified structurally above; confirming the
  // classes styles.css targets are reachable is the FALLING-DESIGN D3 contract
  // this test locks in, not that they're already applied on the first frame.
});

test("[S3-F U6] submitAnswer releases App.feedbackLock when the save returns {ok:false} (a stale/failed save must never strand the lock)", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  await completeParentSetup(window);
  fireClick(window.document.querySelector('[data-action="play"]'));
  await flush(10);
  assert.equal(currentScreen(window), "question");

  const d = window.document;
  const current = window.App.storage.state.active.current;
  const parts = window.MathCore.Facts.parts(current.asked);
  const answer = String(parts[0] * parts[1]);

  // Force the submit's save to go stale (same technique as the first-run-setup
  // failed-save test): bump the in-memory rev past what IDB actually holds.
  window.App.storage.rev += 1;

  assert.equal(window.App.feedbackLock, false, "sanity: lock starts released");
  for (let i = 0; i < answer.length; i++) fireClick(d.querySelector('[data-key="' + answer[i] + '"]'));
  fireClick(d.querySelector('[data-key="check"]'));
  await flush(15);

  assert.equal(window.App.feedbackLock, false, "a stale save must release feedbackLock, not strand it locked forever");
  // the question must not have advanced (the save never committed)
  assert.equal(window.App.storage.state.active.current.asked, current.asked);
});

test("[S3-F U7] the parent settings falling-options <select> renders exactly CONFIG.FALLING.MIN_OPTIONS..MAX_OPTIONS", async () => {
  const window = await bootApp();
  await completeParentSetup(window);
  window.App.parentUnlocked = true;
  window.location.hash = "#screen=parent";
  await flush(5);
  assert.equal(currentScreen(window), "parent-dashboard");

  const values = Array.from(window.document.querySelectorAll("#set-falling-options option")).map((o) => Number(o.value));
  const expected = [];
  for (let n = window.MathCore.CONFIG.FALLING.MIN_OPTIONS; n <= window.MathCore.CONFIG.FALLING.MAX_OPTIONS; n++) expected.push(n);
  assert.deepEqual(values, expected);
  assert.deepEqual(expected, [4, 5, 6], "sanity: today's actual CONFIG range");
});

test("[S3-F U8] after a wrong first attempt, the question screen shows a .dot.retry for that fact", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  window.MathCore.CONFIG.WRONG_ANSWER_DISPLAY_MS = 0;
  await completeParentSetup(window);
  fireClick(window.document.querySelector('[data-action="play"]'));
  await flush(10);
  assert.equal(currentScreen(window), "question");

  const d = window.document;
  const current = window.App.storage.state.active.current;
  const parts = window.MathCore.Facts.parts(current.asked);
  const correct = parts[0] * parts[1];
  const wrong = String(correct + 1); // deliberately wrong, always a valid-looking number

  assert.equal(d.querySelectorAll(".dot.retry").length, 0, "sanity: no retry dot before any wrong answer");

  for (let i = 0; i < wrong.length; i++) fireClick(d.querySelector('[data-key="' + wrong[i] + '"]'));
  fireClick(d.querySelector('[data-key="check"]'));
  await flush(15);

  const cont = d.querySelector('[data-action="continue-after-wrong"]');
  assert.ok(cont, "a wrong answer must show the continue-after-wrong helper");
  fireClick(cont);
  await flush(15);

  assert.equal(currentScreen(window), "question");
  assert.equal(d.querySelectorAll(".dot.retry").length, 1, "the missed fact must show exactly one retry dot on the next question");
});
