const assert = require('assert');
const { io } = require('socket.io-client');
const R = require('../public/rules.js');
process.env.PORT = 0;
const { server } = require('../server.js');

server.listen(0, async () => {
  const url = 'http://localhost:' + server.address().port;
  const mk = () => new Promise(r => { const s = io(url, { transports: ['websocket'] }); s.on('connect', () => r(s)); });
  const call = (s, ev, d) => new Promise(r => s.emit(ev, d, r));
  const N = 5;
  const bots = [];
  for (let i = 0; i < N; i++) { const s = await mk(); s.st = null; s.on('state', st => s.st = st); bots.push(s); }
  const c = await call(bots[0], 'create', { name: '房主', token: 't0' });
  assert(c.ok && /^[A-Z]{4}$/.test(c.code));
  assert(!(await call(bots[1], 'join', { code: 'ZZZZ', name: 'x', token: 't1' })).ok);
  for (let i = 1; i < N; i++) assert((await call(bots[i], 'join', { code: c.code.toLowerCase(), name: '玩家' + i, token: 't' + i })).ok);
  assert(!(await call(bots[1], 'start')).ok, 'non-host cannot start');
  assert((await call(bots[0], 'start')).ok);
  const late = await mk();
  assert(!(await call(late, 'join', { code: c.code, name: 'late', token: 'tl' })).ok, 'no join mid-game');
  await new Promise(r => setTimeout(r, 100));

  // reconnect test: drop bot 2 and resume with same token
  bots[2].disconnect();
  await new Promise(r => setTimeout(r, 100));
  const b2 = await mk(); b2.on('state', st => b2.st = st); bots[2] = b2;
  assert((await call(b2, 'resume', { code: c.code, token: 't2' })).ok);
  await new Promise(r => setTimeout(r, 100));

  const outcomes = [];
  let moves = 0, pathMoves = 0, actionMoves = 0;
  for (let round = 1; round <= 3; round++) {
    let guard = 0;
    while (guard++ < 400) {
      const st = bots[0].st;
      if (st.game.phase !== 'playing') break;
      const bot = bots.find(b => b.st && b.st.me === st.game.turnPid);
      const g = bot.st.game;
      // other players must never see hidden info
      for (const o of bots) if (o !== bot) {
        assert(o.st.game.hand.every(cc => !g.hand.some(h => h.id === cc.id)));
        assert(o.st.game.board.filter(b => b.kind === 'goal' && b.hidden).every(b => b.goal === undefined));
      }
      const board = {}; g.board.forEach(cc => board[R.key(cc.x, cc.y)] = cc);
      const broken = g.seats.find(s => s.id === g.turnPid).broken;
      let done = false;
      // prefer path moves heading east (toward goals), else actions, else discard
      if (!(broken.pick || broken.lamp || broken.cart)) {
        let best = null;
        for (const card of g.hand.filter(x => x.type === 'path'))
          for (const f of [false, true])
            for (const [x, y] of R.validPlacements(board, card.shape, f)) {
              const sc = x * 10 - Math.abs(y) + (R.SHAPES[card.shape].some(gr => gr.length === 1) ? -50 : 0);
              if (!best || sc > best.sc) best = { sc, card, x, y, f };
            }
        if (best) {
          const r = await call(bot, 'play', { kind: 'path', cardId: best.card.id, x: best.x, y: best.y, flipped: best.f });
          assert(r.ok, r.error); done = true; pathMoves++;
        }
      }
      if (!done) {
        const rep = g.hand.find(x => x.type === 'repair' && x.tools.some(t => broken[t]));
        const mp = g.hand.find(x => x.type === 'map');
        if (rep) { const r = await call(bot, 'play', { kind: 'tool', cardId: rep.id, target: g.turnPid, tool: rep.tools.find(t => broken[t]) }); assert(r.ok, r.error); done = true; actionMoves++; }
        else if (mp && g.board.some(b => b.hidden)) {
          const gi = g.board.find(b => b.hidden).goalIdx;
          const r = await call(bot, 'play', { kind: 'map', cardId: mp.id, goalIdx: gi });
          assert(r.ok && r.peek && ['gold', 'coal'].includes(r.peek.goal), JSON.stringify(r)); done = true; actionMoves++;
        }
      }
      if (!done) {
        const br = g.hand.find(x => x.type === 'broken');
        const tgt = br && g.seats.find(s => s.id !== g.turnPid && !s.broken[br.tool]);
        if (br && tgt && Math.random() < 0.3) { const r = await call(bot, 'play', { kind: 'tool', cardId: br.id, target: tgt.id }); assert(r.ok, r.error); done = true; actionMoves++; }
      }
      if (!done) { const r = await call(bot, 'play', { kind: 'discard', cardId: g.hand[0].id }); assert(r.ok, r.error); }
      // wrong-turn move must be rejected
      const other = bots.find(b => b.st.me !== bots[0].st.game.turnPid && b.st.game.hand.length);
      if (other && bots[0].st.game.phase === 'playing') assert(!(await call(other, 'play', { kind: 'discard', cardId: other.st.game.hand[0].id })).ok);
      moves++;
      await new Promise(r => setTimeout(r, 5));
    }
    const st = bots[0].st;
    assert(['roundEnd', 'gameEnd'].includes(st.game.phase), 'round ended: ' + st.game.phase);
    outcomes.push(st.game.result.winner); console.log('maxX', Math.max(...st.game.board.filter(b=>b.kind==='path').map(b=>b.x)), st.game.log.filter(l=>/礦|勝/.test(l.text)).map(l=>l.text).join(' | '));
    if (round < 3) { assert((await call(bots[0], 'next_round')).ok); await new Promise(r => setTimeout(r, 50)); }
  }
  const st = bots[0].st;
  assert.strictEqual(st.game.phase, 'gameEnd');
  console.log('outcomes', outcomes, 'moves', moves, 'paths', pathMoves, 'actions', actionMoves);
  console.log('scores', st.game.seats.map(s => s.score));
  assert((await call(bots[0], 'to_lobby')).ok);
  await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(bots[3].st.phase, 'lobby');
  console.log('simulation passed');
  process.exit(0);
});
