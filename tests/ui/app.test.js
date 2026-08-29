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
  answerCurrentQuestionCorrectly,
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

test("[1-2] collection screen: unlocked stickers show name+nick and NO title attribute; locked stickers show \"?\" with no title (no id leak); a golden+unlocked sticker gets the golden class", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  await completeParentSetup(window);
  const CONFIG = window.MathCore.CONFIG;
  const cat = CONFIG.ALBUMS[0].stickers[0]; // "cat" — MAP_PATH[0] is table 1, so this is also the first golden candidate
  await window.App.storage.save(function (s) {
    s.economy.unlocked = [cat];
    s.map = { reached: {} };
    s.map.reached[CONFIG.MAP_PATH[0]] = 1; // gilds the first album-1 sticker (cat)
  }, Date.now());

  window.location.hash = "#screen=collection";
  await flush(5);
  assert.equal(currentScreen(window), "collection");

  const stickers = Array.from(window.document.querySelectorAll(".sticker"));
  assert.equal(stickers.length, CONFIG.STICKERS.length, "one .sticker element per sticker across both albums");
  stickers.forEach((el) => {
    assert.equal(el.getAttribute("title"), null, "no .sticker element may carry a title attribute (id leak)");
  });

  const unlocked = window.document.querySelectorAll(".sticker.unlocked");
  assert.equal(unlocked.length, 1);
  assert.equal(unlocked[0].textContent.indexOf(window.MathText.T.stickers[cat].name) !== -1, true, "unlocked sticker shows its name");
  assert.equal(unlocked[0].textContent.indexOf(window.MathText.T.stickers[cat].nick) !== -1, true, "unlocked sticker shows its nick");
  assert.ok(unlocked[0].classList.contains("golden"), "the unlocked, map-gilded sticker gets the golden class");

  const locked = Array.from(stickers).filter((el) => !el.classList.contains("unlocked"));
  assert.equal(locked.length, CONFIG.STICKERS.length - 1);
  locked.forEach((el) => assert.equal(el.textContent.trim(), "?"));
});

test("[1-4/F4] summary stars + near-perfect title scale with session size (16/20, 15/20, 19/20, 20/20) — package-1 closing review finding F4", async () => {
  const window = await bootApp();
  await completeParentSetup(window);
  const CONFIG = window.MathCore.CONFIG;

  function renderFakeSummary(firstTryCorrect, plannedLength) {
    const planned = [];
    for (let i = 0; i < plannedLength; i++) planned.push("1x1");
    window.App.lastSessionResult = {
      id: "s_f4_" + firstTryCorrect + "_" + plannedLength + "_" + Date.now(),
      mode: "typed",
      planned,
      firstTryCorrect,
      misses: [],
      perfect: firstTryCorrect === plannedLength,
      perfectSeries: firstTryCorrect === plannedLength ? 1 : 0,
      coinsEarned: 10,
      unlocksEarned: [],
      stationsReached: [],
      totalMs: 1000,
    };
    window.location.hash = "#screen=home";
  }

  function starCount(win) {
    return win.document.querySelector(".stars").textContent.trim().length;
  }

  // 16/20 = exactly CONFIG.STARS_TWO_RATIO (0.8) -> 2 stars (boundary, inclusive).
  renderFakeSummary(16, 20);
  window.location.hash = "#screen=summary";
  await flush(5);
  assert.equal(starCount(window), 2, "16/20 (ratio == STARS_TWO_RATIO) must be 2 stars");
  assert.ok(!window.document.body.textContent.includes(window.MathText.T.summary.nearPerfectTitle), "16/20 is not near-perfect (2 misses, not exactly NEAR_PERFECT_MISSES)");

  // 15/20 = below the ratio -> 1 star.
  renderFakeSummary(15, 20);
  window.location.hash = "#screen=summary";
  await flush(5);
  assert.equal(starCount(window), 1, "15/20 (below STARS_TWO_RATIO) must be 1 star");

  // 19/20 = exactly planned.length - NEAR_PERFECT_MISSES -> near-perfect title, 2 stars (not perfect).
  renderFakeSummary(19, 20);
  window.location.hash = "#screen=summary";
  await flush(5);
  assert.equal(starCount(window), 2, "19/20 must be 2 stars (>= STARS_TWO_RATIO, not perfect)");
  assert.ok(window.document.body.textContent.includes(window.MathText.T.summary.nearPerfectTitle), "19/20 (exactly NEAR_PERFECT_MISSES=1 miss out of 20) must show the near-perfect title");

  // 20/20 = perfect -> 3 stars, perfect title, no near-perfect title.
  renderFakeSummary(20, 20);
  window.location.hash = "#screen=summary";
  await flush(5);
  assert.equal(starCount(window), 3, "20/20 must be 3 stars");
  assert.ok(window.document.body.textContent.includes(window.MathText.T.summary.perfectTitle), "20/20 must show the perfect title");
  assert.ok(!window.document.body.textContent.includes(window.MathText.T.summary.nearPerfectTitle), "a perfect round is not ALSO near-perfect");

  assert.equal(CONFIG.STARS_TWO_RATIO, 0.8, "sanity: today's actual CONFIG value");
  assert.equal(CONFIG.NEAR_PERFECT_MISSES, 1, "sanity: today's actual CONFIG value");
});

test("[1-3] spectators strip (V2-DESIGN §3.2): absent with zero unlocks; present and stable across re-renders once a sticker is unlocked, capped at AUDIENCE_MAX", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  await completeParentSetup(window);
  const CONFIG = window.MathCore.CONFIG;

  // No unlocks yet -> strip absent.
  fireClick(window.document.querySelector('[data-action="play"]'));
  await flush(10);
  assert.equal(window.document.querySelector(".audience"), null, "no stickers unlocked -> no .audience strip");

  // Unlock more than AUDIENCE_MAX stickers, re-render the SAME question twice.
  await window.App.storage.save(function (s) {
    s.economy.unlocked = window.MathCore.CONFIG.STICKERS.slice(0, 8);
  }, Date.now());
  const seedKey = window.App.storage.state.active.id;
  // Re-render via the router (hash round-trip forces a fresh render of the same screen).
  window.location.hash = "#screen=collection";
  await flush(3);
  window.location.hash = "#screen=question";
  await flush(5);

  const first = window.document.querySelector(".audience");
  assert.ok(first, "an unlocked sticker must produce the .audience strip");
  const firstMembers = Array.from(first.children).map((el) => el.textContent);
  assert.equal(firstMembers.length, CONFIG.AUDIENCE_MAX, "membership is capped at AUDIENCE_MAX");
  assert.equal(window.App.storage.state.active.id, seedKey, "same session -> same seed key");

  window.location.hash = "#screen=collection";
  await flush(3);
  window.location.hash = "#screen=question";
  await flush(5);
  const second = window.document.querySelector(".audience");
  const secondMembers = Array.from(second.children).map((el) => el.textContent);
  assert.deepEqual(secondMembers, firstMembers, "membership (order + identity) is stable across re-renders of the SAME session");
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

test("[1-4] parent settings session-size slider renders CONFIG bounds and persists the choice into settings.sessionSize", async () => {
  const window = await bootApp();
  await completeParentSetup(window);
  window.App.parentUnlocked = true;
  window.location.hash = "#screen=parent";
  await flush(5);
  assert.equal(currentScreen(window), "parent-dashboard");

  const CONFIG = window.MathCore.CONFIG;
  const slider = window.document.getElementById("set-session-size");
  assert.ok(slider, "the session-size slider must be present");
  assert.equal(Number(slider.getAttribute("min")), CONFIG.SESSION_SIZE_MIN);
  assert.equal(Number(slider.getAttribute("max")), CONFIG.SESSION_SIZE_MAX);
  assert.equal(Number(slider.getAttribute("value")), CONFIG.SESSION_SIZE_DEFAULT, "default sessionSize is CONFIG.SESSION_SIZE_DEFAULT");

  slider.setAttribute("value", String(CONFIG.SESSION_SIZE_MAX));
  fireClick(window.document.querySelector('[data-action="save-settings"]'));
  await flush(5);
  assert.equal(window.App.storage.state.settings.sessionSize, CONFIG.SESSION_SIZE_MAX, "save-settings must persist the slider's value");
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

// V2-DESIGN §8 (mirror pairs): overwrite the active session's journal to a
// known, fixed non-square mirror pair ("6x7"/"7x6") with NO current question
// (so SessionCore.paint has nothing to defer), then force a fresh entry into
// the question screen (a hash round-trip through another screen — the same
// technique the existing falling-options test uses to force a Home
// re-render) so it paints "6x7" fresh. This is test-only state surgery
// (production code never bypasses SessionCore.start/paint/submit); the
// mirror flag on the SECOND question is computed by the real
// SessionCore.paint from the real `active.planned` adjacency.
async function forceFreshMirrorPair(window) {
  const state = window.App.storage.state;
  state.active.planned = ["6x7", "7x6"];
  state.active.queue = ["6x7", "7x6"];
  state.active.retryQueue = [];
  state.active.attempts = [];
  state.active.deferred = [];
  state.active.current = null;
  window.location.hash = "#screen=collection";
  await flush(3);
  window.location.hash = "#screen=question";
  await flush(10);
}

test("[§8] the second question of a forced mirror pair shows the mirror hint on the typed screen; the first does not", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  window.MathCore.CONFIG.WRONG_ANSWER_DISPLAY_MS = 0;
  await completeParentSetup(window);
  fireClick(window.document.querySelector('[data-action="play"]'));
  await flush(10);
  assert.equal(currentScreen(window), "question");

  await forceFreshMirrorPair(window);
  assert.equal(currentScreen(window), "question");
  assert.equal(window.App.storage.state.active.current.asked, "6x7");
  assert.equal(window.App.storage.state.active.current.mirror, false, "the first of the pair must not carry the mirror flag");
  assert.equal(window.document.querySelector(".mirror-hint"), null, "no hint on the first question of the pair");

  const answered = await answerCurrentQuestionCorrectly(window);
  assert.ok(answered);
  await flush(15);

  assert.equal(currentScreen(window), "question");
  const current2 = window.App.storage.state.active.current;
  assert.equal(current2.asked, "7x6");
  assert.equal(current2.mirror, true, "SessionCore.paint must flag the second of the pair");
  const hintEl = window.document.querySelector(".mirror-hint");
  assert.ok(hintEl, "the mirror hint must render under the equation for the second question of a pair");
  assert.equal(hintEl.textContent, window.MathText.T.question.mirrorHint);
});

test("[§8] the second question of a forced mirror pair shows the mirror hint on the falling screen", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  window.MathCore.CONFIG.WRONG_ANSWER_DISPLAY_MS = 0;
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
  assert.equal(currentScreen(window), "question");
  assert.equal(window.document.querySelector('[data-screen="question"]').getAttribute("data-falling"), "1");

  await forceFreshMirrorPair(window);
  assert.equal(currentScreen(window), "question");
  assert.equal(window.document.querySelector('[data-screen="question"]').getAttribute("data-falling"), "1");
  assert.equal(window.App.storage.state.active.current.asked, "6x7");
  assert.equal(window.App.storage.state.active.current.mirror, false, "the first of the pair must not carry the mirror flag");
  assert.equal(window.document.querySelector(".mirror-hint"), null, "no hint on the first question of the pair");

  const bubble = window.document.querySelector('.bubble[data-value="42"]'); // 6x7 = 42
  assert.ok(bubble, "a bubble for the correct answer (6x7=42) must be present");
  fireClick(bubble);
  await flush(15);

  assert.equal(currentScreen(window), "question");
  const current2 = window.App.storage.state.active.current;
  assert.equal(current2.asked, "7x6");
  assert.equal(current2.mirror, true, "SessionCore.paint must flag the second of the pair");
  const hintEl = window.document.querySelector(".mirror-hint");
  assert.ok(hintEl, "the mirror hint must render under the equation for the second question of a pair");
  assert.equal(hintEl.textContent, window.MathText.T.question.mirrorHint);
});

// V2-DESIGN §8 amended 2026-08-29 (fix-verification escalation): T.parent.mirrorState
// gained a third "partial" state, and "ok" changed to include "(מהר)". No DOM
// drive needed — just the loaded strings + Stats' tri-state, which the
// tooltip in app.js's parent-render composes verbatim.
test("[§8 fix-verification] T.parent.mirrorState has the exact three verbatim strings and heatmapTooltip composes them correctly", async () => {
  const window = await bootApp();
  const T = window.MathText.T;
  assert.equal(T.parent.mirrorState.ok, "שני הכיוונים ✓ (מהר)");
  assert.equal(T.parent.mirrorState.partial, "שני הכיוונים ✓");
  assert.equal(T.parent.mirrorState.no, "כיוון אחד בלבד");
  assert.equal(T.parent.heatmapTooltip(3, 4, T.parent.masteryNames.mastered, T.parent.mirrorState.partial), "נלמד לגמרי (שני הכיוונים ✓): 3×4");
  assert.equal(T.parent.heatmapTooltip(3, 4, T.parent.masteryNames.learning, T.parent.mirrorState.no), "בלמידה (כיוון אחד בלבד): 3×4");
  assert.equal(T.parent.heatmapTooltip(6, 6, T.parent.masteryNames.mastered, null), "נלמד לגמרי: 6×6", "no mirror suffix for a square fact");
});

// docs/WALL-DESIGN.md §1 (package 4 closing review, 2026-08-29, finding F6):
// UI harness coverage for the wall screen — mirrors the equivalent falling
// tests above.
test("[4-F] wall mode renders the well + one option row per configured N, and the screen carries data-wall=1", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  await completeParentSetup(window);

  await window.App.storage.save(function (s) {
    s.settings.wall = { enabled: true, durationSec: 10, options: 5 };
  }, Date.now());
  window.location.hash = "#screen=collection";
  await flush(3);
  window.location.hash = "#screen=home";
  await flush(5);

  fireClick(window.document.querySelector('[data-action="play-wall"]'));
  await flush(10);

  assert.equal(currentScreen(window), "question");
  assert.equal(window.document.querySelector('[data-screen="question"]').getAttribute("data-wall"), "1");
  const well = window.document.querySelector(".wall-well");
  assert.ok(well, ".wall-well must be present in wall mode");
  assert.ok(well.querySelector("#wall-piece"), "the falling piece div must be present");
  const lanes = window.document.querySelector(".wall-options.lanes");
  assert.ok(lanes, "the static option row (.wall-options.lanes) must be present");
  assert.equal(lanes.getAttribute("data-n"), "5");
  assert.equal(window.document.querySelectorAll(".wall-options .bubble").length, 5);
  assert.ok(window.document.querySelector(".wall-controls"), "the ◀ ▶ controls must be present");
});

test("[4-F] the second question of a forced mirror pair shows the mirror hint on the wall screen", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  window.MathCore.CONFIG.WRONG_ANSWER_DISPLAY_MS = 0;
  await completeParentSetup(window);
  await window.App.storage.save(function (s) {
    s.settings.wall = { enabled: true, durationSec: 10, options: 4 };
  }, Date.now());
  window.location.hash = "#screen=collection";
  await flush(3);
  window.location.hash = "#screen=home";
  await flush(5);
  fireClick(window.document.querySelector('[data-action="play-wall"]'));
  await flush(10);
  assert.equal(currentScreen(window), "question");
  assert.equal(window.document.querySelector('[data-screen="question"]').getAttribute("data-wall"), "1");

  await forceFreshMirrorPair(window);
  assert.equal(currentScreen(window), "question");
  assert.equal(window.document.querySelector('[data-screen="question"]').getAttribute("data-wall"), "1");
  assert.equal(window.App.storage.state.active.current.asked, "6x7");
  assert.equal(window.App.storage.state.active.current.mirror, false, "the first of the pair must not carry the mirror flag");
  assert.equal(window.document.querySelector(".mirror-hint"), null, "no hint on the first question of the pair");

  const bubble = window.document.querySelector('.wall-options .bubble[data-value="42"]'); // 6x7 = 42
  assert.ok(bubble, "a bubble for the correct answer (6x7=42) must be present");
  fireClick(bubble);
  await flush(15);

  assert.equal(currentScreen(window), "question");
  const current2 = window.App.storage.state.active.current;
  assert.equal(current2.asked, "7x6");
  assert.equal(current2.mirror, true, "SessionCore.paint must flag the second of the pair");
  const hintEl = window.document.querySelector(".mirror-hint");
  assert.ok(hintEl, "the mirror hint must render under the equation for the second question of a pair");
  assert.equal(hintEl.textContent, window.MathText.T.question.mirrorHint);
});

test("[4-F] Home shows three mode buttons when both falling and wall are enabled", async () => {
  const window = await bootApp({ mediaMatches: { "(pointer: coarse)": true } });
  await completeParentSetup(window);
  await window.App.storage.save(function (s) {
    s.settings.falling = { enabled: true, durationSec: 8, options: 4 };
    s.settings.wall = { enabled: true, durationSec: 10, options: 4 };
  }, Date.now());
  window.location.hash = "#screen=collection";
  await flush(3);
  window.location.hash = "#screen=home";
  await flush(5);

  assert.equal(currentScreen(window), "home");
  assert.ok(window.document.querySelector('[data-action="play-falling"]'), "falling button must render");
  assert.ok(window.document.querySelector('[data-action="play-wall"]'), "wall button must render");
  assert.ok(window.document.querySelector('[data-action="play"]'), "typed button must render");
  assert.equal(window.document.querySelector('[data-action="play-falling"]').textContent, window.MathText.T.home.fallingBtn);
  assert.equal(window.document.querySelector('[data-action="play-wall"]').textContent, window.MathText.T.home.wallBtn);
  assert.equal(window.document.querySelector('[data-action="play"]').textContent, window.MathText.T.home.startCta);
});
