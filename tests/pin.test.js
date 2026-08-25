const test = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const { Pin } = require("../core.js");

const cryptoObj = nodeCrypto.webcrypto;

test("isValidFormat accepts exactly 4 digits", () => {
  assert.equal(Pin.isValidFormat("1234"), true);
  assert.equal(Pin.isValidFormat("12"), false);
  assert.equal(Pin.isValidFormat("12a4"), false);
  assert.equal(Pin.isValidFormat("12345"), false);
});

test("hash() + verify(): correct PIN verifies, wrong PIN does not", async () => {
  const stored = await Pin.hash(cryptoObj, "4821");
  assert.equal(await Pin.verify(cryptoObj, "4821", stored), true);
  assert.equal(await Pin.verify(cryptoObj, "1234", stored), false);
});

test("hash() never stores the PIN in plain text", async () => {
  const stored = await Pin.hash(cryptoObj, "4821");
  assert.ok(!stored.includes("4821"));
});

test("hash() is salted: hashing the same PIN twice yields two different stored strings", async () => {
  const a = await Pin.hash(cryptoObj, "4821");
  const b = await Pin.hash(cryptoObj, "4821");
  assert.notEqual(a, b);
  // but both verify correctly
  assert.equal(await Pin.verify(cryptoObj, "4821", a), true);
  assert.equal(await Pin.verify(cryptoObj, "4821", b), true);
});

test("verify() against a null/empty stored hash is false, not a throw", async () => {
  assert.equal(await Pin.verify(cryptoObj, "4821", null), false);
});

test("generateRecoveryCode() produces a 6-char code from the unambiguous alphabet only", () => {
  for (let i = 0; i < 20; i++) {
    const code = Pin.generateRecoveryCode(cryptoObj);
    assert.equal(code.length, 6);
    for (const ch of code) {
      assert.ok(Pin.RECOVERY_ALPHABET.includes(ch));
      assert.ok(!"IL O0 1".includes(ch)); // no ambiguous characters
    }
  }
});
