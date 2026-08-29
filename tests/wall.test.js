const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG, Wall } = require("../core.js");

test("[4-1] emptyGrid: rows x cols, all zero", () => {
  const g = Wall.emptyGrid(3, 5);
  assert.equal(g.length, 3);
  g.forEach((row) => {
    assert.equal(row.length, 5);
    row.forEach((cell) => assert.equal(cell, 0));
  });
});

test("[4-1] landingRow: piece rests on the floor of an empty well", () => {
  const g = Wall.emptyGrid(4, 4);
  assert.equal(Wall.landingRow(g, 0, 2, 2), 2); // top row of a 2-tall piece resting on a 4-row floor
  assert.equal(Wall.landingRow(g, 0, 4, 1), 3); // 1-tall piece: floor is the last row
});

test("[4-1] landingRow: piece rests on top of an existing stack in its span", () => {
  let g = Wall.emptyGrid(4, 4);
  g = Wall.place(g, 0, 3, 2, 1, 1); // one cell filled at row 3, cols 0-1
  assert.equal(Wall.landingRow(g, 0, 2, 1), 2); // lands directly above the filled cell
  assert.equal(Wall.landingRow(g, 2, 2, 1), 3); // untouched columns still land on the floor
});

test("[4-1] landingRow: -1 (cannot fit) when the piece is taller than the well", () => {
  const g = Wall.emptyGrid(2, 4);
  assert.equal(Wall.landingRow(g, 0, 2, 3), -1);
  assert.equal(Wall.landingRow(g, 0, 2, 2), 0);
});

test("[4-1] landingRow: out-of-bounds x is rejected, not silently clamped", () => {
  const g = Wall.emptyGrid(4, 4);
  assert.equal(Wall.landingRow(g, 3, 2, 1), -1); // x+w > cols
  assert.equal(Wall.landingRow(g, -1, 2, 1), -1);
});

test("[4-1] place: never mutates the input grid; stamps exactly the given rect", () => {
  const g = Wall.emptyGrid(3, 3);
  const g2 = Wall.place(g, 1, 1, 2, 2, 2);
  assert.deepEqual(g, Wall.emptyGrid(3, 3)); // original untouched
  assert.deepEqual(g2, [
    [0, 0, 0],
    [0, 2, 2],
    [0, 2, 2],
  ]);
});

test("[4-1] step: places a fitting piece, no reset, wallsBuilt unchanged; cell value by outcome", () => {
  let ws = { grid: Wall.emptyGrid(4, 4), x: 0, wallsBuilt: 0 };
  const r1 = Wall.step(ws, { x: 0, w: 2, h: 1, cell: 1 }); // first-attempt correct
  assert.equal(r1.reset, false);
  assert.equal(r1.wallsBuilt, 0);
  assert.equal(r1.y, 3);
  assert.deepEqual(r1.grid[3], [1, 1, 0, 0]);

  const r2 = Wall.step(r1, { x: 0, w: 2, h: 1, cell: 2 }); // wrong -> grey
  assert.deepEqual(r2.grid[2], [2, 2, 0, 0]);

  const r3 = Wall.step(r2, { x: 2, w: 2, h: 1, cell: 3 }); // retry -> tainted/light
  assert.deepEqual(r3.grid[3], [1, 1, 3, 3]);
});

test("[4-1] step: overflow builds a fresh wall (wallsBuilt++) and the triggering piece lands in it, never discarded", () => {
  // A 1-row-tall well: the very first piece already fills it completely.
  let ws = { grid: Wall.emptyGrid(1, 2), x: 0, wallsBuilt: 0 };
  ws = Wall.step(ws, { x: 0, w: 2, h: 1, cell: 1 });
  assert.equal(ws.wallsBuilt, 0);
  assert.deepEqual(ws.grid, [[1, 1]]);

  // The next piece cannot fit anywhere -> wall complete, fresh grid, this
  // piece is placed in the NEW wall (not lost).
  const next = Wall.step(ws, { x: 0, w: 2, h: 1, cell: 1 });
  assert.equal(next.reset, true);
  assert.equal(next.wallsBuilt, 1);
  assert.deepEqual(next.grid, [[1, 1]]); // placed in the fresh (now full again) wall
});

test("[4-1] step: a full-width piece (w === COLS) still places and can trigger a reset", () => {
  let ws = { grid: Wall.emptyGrid(2, CONFIG.WALL.COLS), x: 0, wallsBuilt: 0 };
  ws = Wall.step(ws, { x: 0, w: CONFIG.WALL.COLS, h: 1, cell: 1 });
  ws = Wall.step(ws, { x: 0, w: CONFIG.WALL.COLS, h: 1, cell: 1 });
  assert.equal(ws.wallsBuilt, 0);
  assert.deepEqual(ws.grid[0], new Array(CONFIG.WALL.COLS).fill(1));
  assert.deepEqual(ws.grid[1], new Array(CONFIG.WALL.COLS).fill(1));

  const next = Wall.step(ws, { x: 0, w: CONFIG.WALL.COLS, h: 1, cell: 1 }); // well full -> reset
  assert.equal(next.reset, true);
  assert.equal(next.wallsBuilt, 1);
});

test("[4-1] step: x is clamped into [0, cols - w] before landing is computed", () => {
  const g = Wall.emptyGrid(4, 4);
  const r = Wall.step({ grid: g, x: 0, wallsBuilt: 0 }, { x: 99, w: 2, h: 1, cell: 1 });
  assert.equal(r.x, 2); // clamped to cols - w
});

test("[4-1] step: wallsBuilt accumulates across repeated overflows", () => {
  let ws = { grid: Wall.emptyGrid(1, 1), x: 0, wallsBuilt: 0 };
  for (let i = 0; i < 5; i++) {
    ws = Wall.step(ws, { x: 0, w: 1, h: 1, cell: 1 });
  }
  // Every submit after the first overflows this 1-cell well (it's already full).
  assert.equal(ws.wallsBuilt, 4);
});
