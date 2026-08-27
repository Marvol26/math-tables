const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG, Facts, Falling } = require("../core.js");

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function allFacts() {
  return Facts.allKeys().map((k) => Facts.parts(k));
}

test("distractors: count, unique, != p, all in 1..100", () => {
  const rng = seededRng(1);
  for (const [a, b] of allFacts()) {
    for (const count of [3, 4, 5]) {
      const d = Falling.distractors(a, b, count, rng);
      assert.equal(d.length, count, `${a}x${b} count ${count}`);
      assert.equal(new Set(d).size, count, `${a}x${b} unique`);
      const p = a * b;
      d.forEach((n) => {
        assert.notEqual(n, p);
        assert.ok(n >= 1 && n <= 100, `${n} in range for ${a}x${b}`);
      });
    }
  }
});

test("distractors: at least one same-table neighbour for 7x8, 6x9, 3x4", () => {
  const rng = seededRng(2);
  const cases = [
    [7, 8],
    [6, 9],
    [3, 4],
  ];
  cases.forEach(([a, b]) => {
    const neighbours = [(a - 1) * b, (a + 1) * b, a * (b - 1), a * (b + 1)].filter(
      (n) => n >= 1 && n <= 100 && n !== a * b
    );
    const d = Falling.distractors(a, b, 4, rng);
    const hasNeighbour = neighbours.some((n) => d.includes(n));
    assert.ok(hasNeighbour, `${a}x${b} distractors ${d} should include one of ${neighbours}`);
  });
});

test("distractors: deterministic under a fixed rng", () => {
  const d1 = Falling.distractors(7, 8, 5, seededRng(42));
  const d2 = Falling.distractors(7, 8, 5, seededRng(42));
  assert.deepEqual(d1, d2);
});

test("candidates: contains p exactly once for all 55 facts x options 4/5/6", () => {
  const rng = seededRng(3);
  for (const [a, b] of allFacts()) {
    for (const options of [4, 5, 6]) {
      const c = Falling.candidates(a, b, options, rng);
      const p = a * b;
      assert.equal(c.length, options, `${a}x${b} options ${options}`);
      assert.equal(c.filter((n) => n === p).length, 1, `${a}x${b} exactly one ${p} in ${c}`);
      assert.equal(new Set(c).size, options, `${a}x${b} all unique`);
    }
  }
});

test("CONFIG.FALLING has the designed ranges", () => {
  assert.equal(CONFIG.FALLING.DEFAULT_DURATION_SEC, 8);
  assert.equal(CONFIG.FALLING.MIN_DURATION_SEC, 3);
  assert.equal(CONFIG.FALLING.MAX_DURATION_SEC, 20);
  assert.equal(CONFIG.FALLING.DEFAULT_OPTIONS, 4);
  assert.equal(CONFIG.FALLING.MIN_OPTIONS, 4);
  assert.equal(CONFIG.FALLING.MAX_OPTIONS, 6);
});
