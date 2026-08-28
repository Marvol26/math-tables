#!/usr/bin/env node
"use strict";

// Deploy-contract version bump (v2-build-plan.md S1-1 / docs/V2-DESIGN.md §7.1).
// Node stdlib only. Run from the repo root: `node tools/bump-version.js <x.y.z>`.
//
// (a) sets APP_VERSION (in app.js if it exists, else index.html's inline script)
// (b) hashes every existing asset in ASSET_NAMES and rewrites its ?v= reference
//     in index.html to that hash
// (c) computes a release fingerprint over index.html + manifest + icons (in that
//     order, after the hashed URLs above were written)
// (d) rewrites the three generated lines in sw.js: APP_VERSION, RELEASE,
//     HASHED_ASSETS
//
// Not a build step: files are served as-is; this tool only edits the two files
// that reference assets (index.html, sw.js). Exits non-zero if any required
// file is missing. Running it twice in a row with no other changes is a no-op.

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var ASSET_NAMES = ["core.js", "strings.js", "app.js", "styles.css"];

function sha1Short(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex").slice(0, 10);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mustRead(p) {
  if (!fs.existsSync(p)) {
    console.error("bump-version: missing required file " + p);
    process.exit(1);
  }
  return fs.readFileSync(p);
}

function replaceOrFail(text, re, replacement, label, filePath) {
  if (!re.test(text)) {
    console.error("bump-version: " + label + " not found in " + filePath);
    process.exit(1);
  }
  return text.replace(re, replacement);
}

function main() {
  var version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("usage: node tools/bump-version.js <x.y.z>");
    process.exit(1);
  }

  var root = process.cwd();
  var indexPath = path.join(root, "index.html");
  var swPath = path.join(root, "sw.js");
  var appPath = path.join(root, "app.js");
  var manifestPath = path.join(root, "manifest.webmanifest");
  var icon180Path = path.join(root, "icon-180.png");
  var icon512Path = path.join(root, "icon-512.png");

  mustRead(indexPath);
  mustRead(swPath);
  mustRead(manifestPath);
  mustRead(icon180Path);
  mustRead(icon512Path);

  // (a) APP_VERSION
  var appVersionTarget = fs.existsSync(appPath) ? appPath : indexPath;
  var appVersionText = fs.readFileSync(appVersionTarget, "utf8");
  appVersionText = replaceOrFail(
    appVersionText,
    /var APP_VERSION = "[^"]*";/,
    'var APP_VERSION = "' + version + '";',
    "APP_VERSION declaration",
    appVersionTarget
  );
  fs.writeFileSync(appVersionTarget, appVersionText);

  // (b) hash existing assets, rewrite references in index.html
  var indexText = fs.readFileSync(indexPath, "utf8");
  var hashedAssets = [];
  ASSET_NAMES.forEach(function (name) {
    var p = path.join(root, name);
    if (!fs.existsSync(p)) return;
    var hash = sha1Short(fs.readFileSync(p));
    var url = name + "?v=" + hash;
    hashedAssets.push(url);
    var re = new RegExp('((?:src|href)=")' + escapeRegExp(name) + '\\?v=[^"]*(")', "g");
    if (!re.test(indexText)) {
      console.error("bump-version: asset " + name + " exists but index.html has no " + name + "?v= reference (add src/href=\"" + name + "?v=x\" first)");
      process.exit(1);
    }
    indexText = indexText.replace(re, "$1" + url + "$2");
  });
  fs.writeFileSync(indexPath, indexText);

  // (c) release fingerprint (index.html read back post-rewrite)
  var fpBuf = Buffer.concat([
    fs.readFileSync(indexPath),
    fs.readFileSync(manifestPath),
    fs.readFileSync(icon180Path),
    fs.readFileSync(icon512Path)
  ]);
  var fp = sha1Short(fpBuf);
  var release = version + "-" + fp;

  // (d) rewrite generated lines in sw.js
  var swText = fs.readFileSync(swPath, "utf8");
  swText = replaceOrFail(swText, /var APP_VERSION = "[^"]*";/, 'var APP_VERSION = "' + version + '";', "APP_VERSION", swPath);
  swText = replaceOrFail(swText, /var RELEASE = "[^"]*";/, 'var RELEASE = "' + release + '";', "RELEASE", swPath);
  var hashedAssetsLiteral =
    "var HASHED_ASSETS = [" + hashedAssets.map(function (u) { return JSON.stringify(u); }).join(", ") + "];";
  swText = replaceOrFail(swText, /var HASHED_ASSETS = \[[^\]]*\];/, hashedAssetsLiteral, "HASHED_ASSETS", swPath);
  fs.writeFileSync(swPath, swText);

  console.log("bump-version: " + version + " (release " + release + ")");
  hashedAssets.forEach(function (u) {
    console.log("  " + u);
  });
}

main();
