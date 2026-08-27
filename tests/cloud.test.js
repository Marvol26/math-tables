"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Cloud, Migrate } = require("../core.js");

function fakeFetch(routes) {
  const calls = [];
  const fn = (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || "GET", headers: opts && opts.headers, body: opts && opts.body });
    const route = routes.find((r) => r.match(url, opts));
    if (!route) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}), text: () => Promise.resolve("") });
    const res = route.res(url, opts);
    return Promise.resolve({ ok: res.status >= 200 && res.status < 300, status: res.status, json: () => Promise.resolve(res.body), text: () => Promise.resolve(res.text || "") });
  };
  fn.calls = calls;
  return fn;
}

test("backup: POST creates a private gist on first use, PATCH updates it afterwards", async () => {
  const f = fakeFetch([
    { match: (u, o) => u.endsWith("/gists") && o.method === "POST", res: (u, o) => ({ status: 201, body: { id: "g1" } }) },
    { match: (u, o) => u.endsWith("/gists/g1") && o.method === "PATCH", res: () => ({ status: 200, body: { id: "g1" } }) },
  ]);
  const first = await Cloud.backup(f, { token: "t", gistId: null }, '{"a":1}');
  assert.deepEqual(first, { ok: true, gistId: "g1" });
  const body = JSON.parse(f.calls[0].body);
  assert.equal(body.public, false);
  assert.equal(body.files["math-progress.json"].content, '{"a":1}');
  assert.equal(f.calls[0].headers.Authorization, "Bearer t");
  const second = await Cloud.backup(f, { token: "t", gistId: "g1" }, '{"a":2}');
  assert.equal(second.ok, true);
  assert.equal(f.calls[1].method, "PATCH");
});

test("backup: a deleted gist (404 on PATCH) is recreated", async () => {
  const f = fakeFetch([
    { match: (u, o) => u.endsWith("/gists/gone") && o.method === "PATCH", res: () => ({ status: 404, body: {} }) },
    { match: (u, o) => u.endsWith("/gists") && o.method === "POST", res: () => ({ status: 201, body: { id: "g2" } }) },
  ]);
  const r = await Cloud.backup(f, { token: "t", gistId: "gone" }, "{}");
  assert.deepEqual(r, { ok: true, gistId: "g2" });
});

test("backup/verify: bad token or network error is reported, never thrown", async () => {
  const f = fakeFetch([{ match: () => true, res: () => ({ status: 401, body: {} }) }]);
  assert.equal((await Cloud.verifyToken(f, "bad")).ok, false);
  assert.equal((await Cloud.backup(f, { token: "bad" }, "{}")).error, "HTTP 401");
  const boom = () => Promise.reject(new Error("offline"));
  assert.equal((await Cloud.backup(boom, { token: "t" }, "{}")).error, "offline");
  assert.equal((await Cloud.backup(boom, { token: null }, "{}")).ok, false);
});

test("fetchLatest: returns content, follows raw_url when truncated; findGist picks the newest backup gist", async () => {
  const f = fakeFetch([
    { match: (u) => u.endsWith("/gists/g1"), res: () => ({ status: 200, body: { updated_at: "2026-08-27T10:00:00Z", files: { "math-progress.json": { content: "{\"x\":1}", truncated: false } } } }) },
    { match: (u) => u.endsWith("/gists/big"), res: () => ({ status: 200, body: { updated_at: "2026-08-27T11:00:00Z", files: { "math-progress.json": { content: "", truncated: true, raw_url: "https://gist.githubusercontent.com/raw/big" } } } }) },
    { match: (u) => u.includes("/raw/big"), res: () => ({ status: 200, text: "{\"x\":2}" }) },
    { match: (u) => u.includes("/gists?per_page=100"), res: () => ({ status: 200, body: [
      { id: "other", updated_at: "2026-08-01T00:00:00Z", files: { "notes.txt": {} } },
      { id: "old", updated_at: "2026-08-02T00:00:00Z", files: { "math-progress.json": {} } },
      { id: "new", updated_at: "2026-08-20T00:00:00Z", files: { "math-progress.json": {} } },
    ] }) },
  ]);
  assert.equal((await Cloud.fetchLatest(f, { token: "t", gistId: "g1" })).json, "{\"x\":1}");
  assert.equal((await Cloud.fetchLatest(f, { token: "t", gistId: "big" })).json, "{\"x\":2}");
  assert.equal((await Cloud.findGist(f, "t")).gistId, "new");
});

test("settings.cloud: defaulted by migrate, stripped from export, kept on import", () => {
  const s = Migrate.emptyState();
  assert.deepEqual(s.settings.cloud, { token: null, gistId: null, lastOkAt: null, lastError: null, restoreFromGistId: null });
  const raw = Migrate.emptyState(); raw.settings.cloud = { token: "t", gistId: "g", lastOkAt: 5, lastError: null };
  assert.equal(Migrate.migrate(raw).settings.cloud.token, "t");
  assert.equal(Migrate.validateImport(raw).ok, true);
});
