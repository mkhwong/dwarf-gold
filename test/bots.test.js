global.window = {}; global.document = { getElementById: () => ({ hidden: true }) };
window.SabRules = require('../public/rules.js');
window.DGGame = require('../game.js');
require('../preview/local-server.js');
const { Game } = window.DGGame;
const tally = { digger: 0, saboteur: 0 };
for (const n of [4, 5, 6, 7]) for (let t = 0; t < 60; t++) {
  const g = new Game(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })));
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 500) {
    const p = g.current(); const a = window.__botMove(g, p);
    try {
      ({ path: () => g.playPath(p, a.cardId, a.x, a.y, a.flipped), tool: () => g.playTool(p, a.cardId, a.target, a.tool),
         rockfall: () => g.playRockfall(p, a.cardId, a.x, a.y), map: () => g.playMap(p, a.cardId, a.goalIdx), discard: () => g.discard(p, a.cardId) })[a.kind]();
    } catch (e) { console.error('illegal bot move', a.kind, e.message); g.discard(p, g.hands[p][0].id); }
  }
  tally[g.result.winner]++;
}
console.log(tally);
