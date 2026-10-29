const assert = require('assert');
const R = require('../public/rules.js');
const { Game, buildDeck } = require('../game.js');

// deck composition
const d = buildDeck();
assert.strictEqual(d.length, 67);
assert.strictEqual(d.filter(c => c.type === 'path').length, 40);
assert.strictEqual(d.filter(c => c.type !== 'path').length, 27);

// basic placement
const board = { '0,0': { x: 0, y: 0, kind: 'start', shape: 'start' } };
assert(R.canPlacePath(board, 'ew', false, 1, 0));
assert(!R.canPlacePath(board, 'ns', false, 1, 0), 'closed W edge must not touch open E of start');
assert(!R.canPlacePath(board, 'ew', false, 2, 0), 'must touch neighbour');
board['1,0'] = { x: 1, y: 0, kind: 'path', shape: 'xEW' }; // dead end
assert(!R.canPlacePath(board, 'ew', false, 2, 0), 'cannot extend through dead end');
assert(R.canPlacePath(board, 'ns', false, 0, 1));
// flip: se flipped = nw ; at (0,1) needs N open
assert(!R.canPlacePath(board, 'se', false, 0, 1));
assert(R.canPlacePath(board, 'se', true, 0, 1));

// full game: straight line to middle goal
for (let trial = 0; trial < 50; trial++) {
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }]);
  for (let x = 1; x <= 7; x++) g.board[R.key(x, 0)] = { x, y: 0, kind: 'path', shape: 'ew', flipped: false };
  const mid = g.board['8,0'];
  const p = g.current();
  g.hands[p].push({ id: 'zz', type: 'map' });
  g.playMap(p, 'zz', 1);
  g.checkGoals(p);
  assert(!mid.hidden);
  if (mid.goal === 'gold') {
    g.endTurn();
    assert(g.phase === 'roundEnd');
    assert.strictEqual(g.result.winner, 'digger');
    const total = Object.values(g.result.gains).reduce((a, b) => a + b, 0);
    assert(total >= 4);
    for (const [pid, v] of Object.entries(g.result.gains)) if (g.roles[pid] === 'saboteur') assert.strictEqual(v, 0);
  } else {
    // coal must be oriented to connect W
    assert(R.groupsFor(mid.goal, mid.flipped)[0].includes('W'));
  }
}

// exhaust deck → saboteurs win, 3 rounds → gameEnd
const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
for (let r = 1; r <= 3; r++) {
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 500) { const p = g.current(); g.discard(p, g.hands[p][0].id); }
  assert.strictEqual(g.result.winner, 'saboteur');
  if (r < 3) { assert.strictEqual(g.phase, 'roundEnd'); g.nextRound(); }
}
assert.strictEqual(g.phase, 'gameEnd');
// tools
const g2 = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
const p = g2.current(), other = g2.players.find(x => x !== p);
g2.hands[p].push({ id: 'br', type: 'broken', tool: 'pick' });
g2.playTool(p, 'br', other, 'pick');
assert(g2.broken[other].pick);
g2.turnIdx = g2.players.indexOf(other);
g2.hands[other].push({ id: 'pp', type: 'path', shape: 'ew' });
assert.throws(() => g2.playPath(other, 'pp', 1, 0, false), /工具壞咗/);
g2.hands[other].push({ id: 'rp', type: 'repair', tools: ['pick', 'lamp'] });
g2.playTool(other, 'rp', other);
assert(!g2.broken[other].pick);
console.log('rules tests passed');
