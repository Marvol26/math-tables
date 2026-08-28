"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Facts, Migrate, SessionCore } = require("../core.js");
const rng = () => 0.5;
function fresh() { const s = Migrate.emptyState(); s.settings.falling = { enabled: true, durationSec: 8, options: 4 }; return s; }

test("refreshSettings: a challenge toggled on while a typed session is suspended applies on resume", () => {
  const state = Migrate.emptyState();
  SessionCore.start(state, rng, 1000);
  assert.equal(state.active.settingsSnapshot.challengeOn, false);
  state.settings.challengeOn = true; state.settings.timeLimitSec = 12;
  SessionCore.switchTo(state, "typed", rng, 2000); // resume
  assert.equal(state.active.settingsSnapshot.challengeOn, true);
  assert.equal(state.active.settingsSnapshot.timeLimitSec, 12);
});

test("switchTo(falling) parks a suspended typed session; finishing the falling round brings it back intact", () => {
  const state = fresh();
  SessionCore.start(state, rng, 1000);
  SessionCore.paint(state, 1100);
  SessionCore.submit(state, Facts.answer(state.active.current.asked), 1500, {});
  const typedId = state.active.id;
  SessionCore.switchTo(state, "falling", rng, 2000);
  assert.equal(state.active.mode, "falling");
  assert.equal(state.parked.id, typedId);
  assert.equal(state.parked.attempts.length, 1);
  let guard = 0;
  while (state.active && state.active.mode === "falling" && guard++ < 40) {
    SessionCore.paint(state, 3000 + guard * 100);
    SessionCore.submit(state, Facts.answer(state.active.current.asked), 3050 + guard * 100, {});
    if (!state.active.queue.length && !state.active.retryQueue.length) SessionCore.finish(state, 9000);
  }
  assert.equal(state.parked, null);
  assert.equal(state.active.id, typedId, "the typed session is active again");
  assert.equal(state.active.attempts.length, 1);
});

test("switchTo swaps between an active and a parked session of the other mode; same mode just resumes", () => {
  const state = fresh();
  SessionCore.start(state, rng, 1000);
  const typedId = state.active.id;
  SessionCore.switchTo(state, "falling", rng, 2000);
  const fallingId = state.active.id;
  SessionCore.switchTo(state, "typed", rng, 3000);
  assert.equal(state.active.id, typedId);
  assert.equal(state.parked.id, fallingId);
  SessionCore.switchTo(state, "typed", rng, 4000);
  assert.equal(state.active.id, typedId);
  assert.equal(state.parked.id, fallingId);
  SessionCore.switchTo(state, "falling", rng, 5000);
  assert.equal(state.active.id, fallingId);
});

test("a parked session's in-flight question resumes as interrupted; migrate/validateImport handle parked", () => {
  const state = fresh();
  SessionCore.start(state, rng, 1000);
  SessionCore.paint(state, 1100);
  SessionCore.switchTo(state, "falling", rng, 2000);
  SessionCore.switchTo(state, "typed", rng, 3000);
  assert.equal(state.active.current.interrupted, true);
  const raw = JSON.parse(JSON.stringify(state));
  assert.equal(Migrate.validateImport(raw).ok, true);
  assert.equal(Migrate.migrate(raw).parked.mode, "falling");
  raw.parked = { id: "x" };
  assert.equal(Migrate.validateImport(raw).ok, false);
  const old = Migrate.emptyState(); delete old.parked;
  assert.equal(Migrate.migrate(old).parked, null);
});

test("[review] switchTo(falling) starts a NEW falling session only when the parent enabled the mode; a parked one stays resumable", () => {
  const state = Migrate.emptyState();
  state.settings.falling = { enabled: false, durationSec: 8, options: 4 };
  SessionCore.switchTo(state, "falling", rng, 1000);
  assert.equal(state.active.mode, "typed", "disabled → falls back to typed");
  state.settings.falling.enabled = true;
  SessionCore.switchTo(state, "falling", rng, 2000);
  assert.equal(state.active.mode, "falling");
  state.settings.falling.enabled = false;
  SessionCore.switchTo(state, "typed", rng, 3000); // park the falling one
  assert.equal(state.parked.mode, "falling");
  SessionCore.switchTo(state, "falling", rng, 4000); // resume parked even though disabled
  assert.equal(state.active.mode, "falling");
});

test("[review] validateImport rejects active+parked of the same mode and reports each problem once", () => {
  const raw = Migrate.emptyState();
  raw.active = { id: "a", mode: "typed", planned: [], queue: [], retryQueue: [], attempts: [], current: null };
  raw.parked = { id: "b", mode: "typed", planned: [], queue: [], retryQueue: [], attempts: [], current: null };
  const v = Migrate.validateImport(raw);
  assert.equal(v.ok, false);
  raw.parked.mode = "falling";
  assert.equal(Migrate.validateImport(raw).ok, true);
  raw.active.current = {};
  const problems = Migrate.validateImport(raw).problems.filter((p) => /active\.current\.asked/.test(p));
  assert.equal(problems.length, 1);
});

test("[review] disabled-falling tap with a parked typed session and no active one resumes the parked session (no duplicate)", () => {
  const state = fresh();
  SessionCore.start(state, rng, 1000);
  const typedId = state.active.id;
  state.parked = state.active; state.active = null; // the idempotent-finish shape
  state.settings.falling.enabled = false;
  SessionCore.switchTo(state, "falling", rng, 2000);
  assert.equal(state.active.id, typedId);
  assert.equal(state.parked, null);
});
