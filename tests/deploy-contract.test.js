"use strict";

// Deploy contract (v2-build-plan.md S1-3 / docs/V2-DESIGN.md §7.1): any
// deployable file changed without running `node tools/bump-version.js`
// fails this suite. Recomputes every asset hash and the release fingerprint
// straight from the files on disk and compares against what index.html and
// sw.js currently declare.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var root = path.join(__dirname, "..");
function escapeRegExp(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
var ASSET_NAMES = ["core.js", "strings.js", "app.js", "styles.css"];
var LOCAL_SCRIPT_ORDER = ["core.js", "strings.js", "app.js"];

function sha1Short(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex").slice(0, 10);
}

function computeExpected() {
  var indexPath = path.join(root, "index.html");
  var swPath = path.join(root, "sw.js");
  var manifestPath = path.join(root, "manifest.webmanifest");
  var icon180Path = path.join(root, "icon-180.png");
  var icon512Path = path.join(root, "icon-512.png");

  var hashByName = {};
  var hashedAssets = [];
  ASSET_NAMES.forEach(function (name) {
    var p = path.join(root, name);
    if (!fs.existsSync(p)) return;
    var hash = sha1Short(fs.readFileSync(p));
    hashByName[name] = hash;
    hashedAssets.push(name + "?v=" + hash);
  });

  var indexBuf = fs.readFileSync(indexPath);
  var fpBuf = Buffer.concat([
    indexBuf,
    fs.readFileSync(manifestPath),
    fs.readFileSync(icon180Path),
    fs.readFileSync(icon512Path)
  ]);
  var fp = sha1Short(fpBuf);

  return {
    hashByName: hashByName,
    hashedAssets: hashedAssets,
    fp: fp,
    indexText: indexBuf.toString("utf8"),
    swText: fs.readFileSync(swPath, "utf8")
  };
}

var expected = computeExpected();

test("deploy contract: index.html asset references match current hashes (i)", function () {
  ASSET_NAMES.forEach(function (name) {
    if (!(name in expected.hashByName)) return;
    var re = new RegExp('(?:src|href)="' + escapeRegExp(name) + '\\?v=([^"]*)"');
    var m = expected.indexText.match(re);
    assert.ok(m, name + " reference not found in index.html");
    assert.equal(m[1], expected.hashByName[name], name + "'s ?v= in index.html is stale — run node tools/bump-version.js");
  });
});

test("deploy contract: sw.js HASHED_ASSETS equals exactly the existing assets with current hashes (ii)", function () {
  var m = expected.swText.match(/var HASHED_ASSETS = (\[[^\]]*\]);/);
  assert.ok(m, "HASHED_ASSETS not found in sw.js");
  var actual = JSON.parse(m[1]);
  assert.deepEqual(actual.slice().sort(), expected.hashedAssets.slice().sort());
});

test("deploy contract: RELEASE derivation and APP_VERSION agreement (iii)", function () {
  // Mirror the bump tool: APP_VERSION lives in app.js once it exists (S2), else
  // in index.html's inline script — and never in both.
  var appJsPath = path.join(root, "app.js");
  var appSource = fs.existsSync(appJsPath) ? fs.readFileSync(appJsPath, "utf8") : expected.indexText;
  if (fs.existsSync(appJsPath)) assert.ok(!/var APP_VERSION = /.test(expected.indexText), "index.html must not declare APP_VERSION once app.js exists");
  var appVersionMatch = appSource.match(/var APP_VERSION = "([^"]*)";/);
  assert.ok(appVersionMatch, "APP_VERSION not found in " + (fs.existsSync(appJsPath) ? "app.js" : "index.html"));
  var appVersion = appVersionMatch[1];

  var swAppVersionMatch = expected.swText.match(/var APP_VERSION = "([^"]*)";/);
  assert.ok(swAppVersionMatch, "APP_VERSION not found in sw.js");
  assert.equal(swAppVersionMatch[1], appVersion, "sw.js APP_VERSION must equal the app's APP_VERSION");

  var releaseMatch = expected.swText.match(/var RELEASE = "([^"]*)";/);
  assert.ok(releaseMatch, "RELEASE not found in sw.js");
  assert.equal(releaseMatch[1], appVersion + "-" + expected.fp, "RELEASE must equal APP_VERSION + '-' + fp");
});

test("deploy contract: classic local scripts in order, no async/defer (iv)", function () {
  var scriptTagRe = /<script\b([^>]*)>/g;
  var tags = [];
  var m;
  while ((m = scriptTagRe.exec(expected.indexText))) {
    var attrs = m[1];
    var srcMatch = attrs.match(/src="([^"]+)"/);
    if (!srcMatch) continue;
    var src = srcMatch[1].split("?")[0];
    if (LOCAL_SCRIPT_ORDER.indexOf(src) === -1) continue;
    assert.ok(!/\basync\b/.test(attrs), src + " script tag must not have async");
    assert.ok(!/\bdefer\b/.test(attrs), src + " script tag must not have defer");
    tags.push(src);
  }
  var order = LOCAL_SCRIPT_ORDER.filter(function (name) {
    return fs.existsSync(path.join(root, name));
  });
  assert.deepEqual(tags, order);
});

test("deploy contract: precache covers index.html/manifest/icons unversioned, cache:reload used (v)", function () {
  var precacheMatch = expected.swText.match(
    /var PRECACHE_URLS = (\[[^\]]*\])\.concat\(\s*HASHED_ASSETS\s*,\s*(\[[^\]]*\])\s*\);/
  );
  assert.ok(precacheMatch, 'PRECACHE_URLS must be ["./", "index.html"].concat(HASHED_ASSETS, [...])');
  var baseArr = JSON.parse(precacheMatch[1]);
  var tailArr = JSON.parse(precacheMatch[2]);
  var hashedAssetsMatch = expected.swText.match(/var HASHED_ASSETS = (\[[^\]]*\]);/);
  var precache = baseArr.concat(JSON.parse(hashedAssetsMatch[1]), tailArr);

  ["index.html", "manifest.webmanifest", "icon-180.png", "icon-512.png"].forEach(function (name) {
    assert.ok(precache.indexOf(name) !== -1, name + " missing (unversioned) from PRECACHE_URLS");
  });
  // The construction site itself, not prose: a comment mentioning cache:"reload"
  // must not satisfy this (review 2026-08-28, S1 MEDIUM-1).
  var swCode = expected.swText.replace(/\/\/[^\n]*/g, "");
  assert.match(swCode, /new Request\(\s*url\s*,\s*\{\s*cache:\s*"reload"\s*\}\s*\)/, "precache requests must be constructed with cache:\"reload\"");
  assert.match(swCode, /HASHED_ASSETS\.filter\([\s\S]*?indexText\.indexOf\(url\) === -1/, "install must gate on index.html referencing every hashed asset (self-consistency gate)");
});

test("deploy contract: no unversioned duplicate of a hashed asset (vi)", function () {
  ASSET_NAMES.forEach(function (name) {
    if (!(name in expected.hashByName)) return;
    var unversionedInIndex = new RegExp('(?:src|href)="' + escapeRegExp(name) + '"');
    assert.ok(!unversionedInIndex.test(expected.indexText), name + " must not appear unversioned in index.html");

    var precacheMatch = expected.swText.match(
      /var PRECACHE_URLS = (\[[^\]]*\])\.concat\(\s*HASHED_ASSETS\s*,\s*(\[[^\]]*\])\s*\);/
    );
    var baseArr = JSON.parse(precacheMatch[1]);
    var tailArr = JSON.parse(precacheMatch[2]);
    assert.ok(baseArr.indexOf(name) === -1, name + " must not appear unversioned in sw.js PRECACHE_URLS base");
    assert.ok(tailArr.indexOf(name) === -1, name + " must not appear unversioned in sw.js PRECACHE_URLS tail");
  });
});
