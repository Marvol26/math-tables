"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Facts, Migrate, SessionCore } = require("../core.js");
const rng = () => 0.5;

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
  const state = Migrate.emptyState();
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
  const state = Migrate.emptyState();
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
  const state = Migrate.emptyState();
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
