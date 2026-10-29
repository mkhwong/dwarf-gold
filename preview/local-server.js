/* 矮人掘金 — in-browser room + AI players (preview build only).
 * Mirrors server.js event names so app.js runs unchanged. */
(function () {
  const R = window.SabRules;
  const { Game, GameError } = window.DGGame;
  const BOT_NAMES = ['小美', '大雄', '阿珍', '志明', '春嬌', '阿強', '靜宜', '家豪', '肥仔', '細佬', '阿芬', '阿輝', '嘉欣', '子健', '曉晴', '偉文', '詠詩', '浩然', '美玲'];
  const listeners = {};
  let room = null;
  let botTimer = null;

  const fire = (ev, data) => (listeners[ev] || []).forEach((f) => f(data));
  const newId = () => Math.random().toString(36).slice(2, 10);
  const genCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
  const fail = (m) => { throw new GameError(m); };

  function stateFor(pid) {
    return {
      code: room.code, hostId: room.hostId, me: pid,
      phase: room.game ? room.game.phase : 'lobby',
      settings: room.settings,
      players: room.players.map((p) => ({ id: p.id, name: p.name, connected: true })),
      game: room.game ? room.game.view(pid) : null,
    };
  }
  function push() {
    if (!room) return;
    fire('state', stateFor(room.hostId));
    scheduleBot();
  }

  // ---------- bot brain ----------
  const isDead = (shape) => R.SHAPES[shape].some((g) => g.length === 1);
  function botMove(g, pid) {
    const hand = g.hands[pid], role = g.roles[pid], br = g.broken[pid];
    const broken = br.pick || br.lamp || br.cart;
    const known = g.knownGoals[pid];
    const goals = Object.values(g.board).filter((c) => c.kind === 'goal');
    // only what a real player could know: face-down goals, revealed gold, own map peeks
    let targets = goals.filter((c) => (c.hidden ? known[c.goalIdx] !== 'coal' : c.goal === 'gold'));
    const kg = goals.find((c) => c.hidden && known[c.goalIdx] === 'gold');
    if (kg) targets = [kg];
    if (!targets.length) targets = goals;
    const dist = (x, y) => Math.min(...targets.map((t) => Math.abs(t.x - x) + Math.abs(t.y - y)));

    if (broken) {
      const rep = hand.find((c) => c.type === 'repair' && c.tools.some((t) => br[t]));
      if (rep) return { kind: 'tool', cardId: rep.id, target: pid, tool: rep.tools.find((t) => br[t]) };
    }
    // how close the open tunnel frontier gets to a target (0 = touching a goal)
    const frontier = (board) => {
      let best = 99;
      for (const rk of R.computeReach(board).reached) {
        const [k, gi] = rk.split('#');
        const c = board[k];
        for (const d of R.cellGroups(c)[+gi]) {
          const nx = c.x + R.DELTA[d][0], ny = c.y + R.DELTA[d][1];
          const n = board[R.key(nx, ny)];
          if (!n) best = Math.min(best, dist(nx, ny));
          else if (n.hidden && targets.includes(n)) best = 0;
        }
      }
      return best;
    };
    const f0 = frontier(g.board);
    if (!broken) {
      let best = null;
      for (const c of hand.filter((x) => x.type === 'path'))
        for (const f of [false, true])
          for (const [x, y] of R.validPlacements(g.board, c.shape, f, g.range)) {
            const b2 = Object.assign({}, g.board, { [R.key(x, y)]: { x, y, kind: 'path', shape: c.shape, flipped: f } });
            const f1 = frontier(b2);
            const sc = role === 'digger'
              ? (f0 - f1) * 20 - (isDead(c.shape) ? 30 : 0) + Math.random() * 3
              : (f1 - f0) * 20 + (isDead(c.shape) ? 5 : 0) + Math.random() * 3;
            if (!best || sc > best.sc) best = { sc, c, x, y, f };
          }
      const threshold = role === 'digger' ? -5 : (Math.random() < 0.5 ? -5 : 10);
      if (best && best.sc > threshold) return { kind: 'path', cardId: best.c.id, x: best.x, y: best.y, flipped: best.f };
    }
    const others = g.players.filter((p) => p !== pid);
    if (role === 'digger') {
      const mp = hand.find((c) => c.type === 'map');
      const unknown = goals.filter((c) => c.hidden && !known[c.goalIdx]);
      if (mp && !kg && unknown.length) return { kind: 'map', cardId: mp.id, goalIdx: (unknown.find((c) => c.goalIdx === 1) || unknown[0]).goalIdx };
      const rf = hand.find((c) => c.type === 'rockfall');
      const block = Object.values(g.board).find((c) => c.kind === 'path' && isDead(c.shape) && dist(c.x, c.y) <= f0 + 1);
      if (rf && block) return { kind: 'rockfall', cardId: rf.id, x: block.x, y: block.y };
      const rep = hand.find((c) => c.type === 'repair');
      if (rep) for (const p of others) { const t = rep.tools.find((t) => g.broken[p][t]); if (t && Math.random() < 0.6) return { kind: 'tool', cardId: rep.id, target: p, tool: t }; }
    } else {
      const rf = hand.find((c) => c.type === 'rockfall');
      if (rf) {
        const cells = Object.values(g.board).filter((c) => c.kind === 'path' && !isDead(c.shape) && dist(c.x, c.y) <= Math.max(2, f0 + 1));
        if (cells.length) { const c = cells.sort((a, b) => dist(a.x, a.y) - dist(b.x, b.y))[0]; return { kind: 'rockfall', cardId: rf.id, x: c.x, y: c.y }; }
      }
      const bk = hand.find((c) => c.type === 'broken');
      if (bk) {
        const ts = others.filter((p) => !g.broken[p][bk.tool]);
        if (ts.length && Math.random() < 0.6) return { kind: 'tool', cardId: bk.id, target: ts[Math.floor(Math.random() * ts.length)] };
      }
    }
    // pass: throw away the least useful card for my side
    const junk = role === 'digger'
      ? hand.find((c) => c.type === 'path' && isDead(c.shape)) || hand.find((c) => c.type === 'broken') || hand.find((c) => c.type === 'rockfall')
      : hand.find((c) => c.type === 'path' && !isDead(c.shape)) || hand.find((c) => c.type === 'repair') || hand.find((c) => c.type === 'map');
    return { kind: 'discard', cardId: (junk || hand[0]).id };
  }

  function scheduleBot() {
    clearTimeout(botTimer);
    const g = room && room.game;
    if (!g || g.phase !== 'playing') return;
    const cur = room.players.find((p) => p.id === g.current());
    if (!cur || !cur.bot) return;
    botTimer = setTimeout(function tick() {
      const modalOpen = !document.getElementById('modal').hidden;
      if ((window.FX && window.FX.busy) || modalOpen) { botTimer = setTimeout(tick, 400); return; }
      if (!room.game || room.game.phase !== 'playing' || room.game.current() !== cur.id) return;
      try { act(cur.id, botMove(room.game, cur.id)); }
      catch (e) { const h = room.game.hands[cur.id]; room.game.discard(cur.id, h[0].id); }
      push();
    }, 900 + Math.random() * 600);
  }

  function act(pid, a) {
    const g = room.game;
    switch (a.kind) {
      case 'path': g.playPath(pid, a.cardId, a.x, a.y, a.flipped); return;
      case 'tool': g.playTool(pid, a.cardId, a.target, a.tool); return;
      case 'rockfall': g.playRockfall(pid, a.cardId, a.x, a.y); return;
      case 'map': return g.playMap(pid, a.cardId, a.goalIdx);
      case 'discard': g.discard(pid, a.cardId); return;
    }
    fail('未知動作');
  }

  // ---------- event handlers (same names as server.js) ----------
  const H = {
    create({ name }) {
      const me = { id: newId(), name: String(name).trim().slice(0, 12), bot: false };
      room = { code: genCode(), hostId: me.id, players: [me], game: null, settings: { twoSided: false } };
      push();
      return { code: room.code };
    },
    join() { fail('預覽版只可以開房同加 AI 玩家；真人連線要用 Render 伺服器版本'); },
    resume() { fail('冇房間'); },
    add_bot() {
      if (!room || room.game) fail('而家唔可以加人');
      const max = R.MAX_PLAYERS(room.settings.twoSided);
      if (room.players.length >= max) fail(`房間已滿（最多 ${max} 人）`);
      const used = new Set(room.players.map((p) => p.name));
      const name = BOT_NAMES.find((n) => !used.has(n)) || 'AI ' + room.players.length;
      room.players.push({ id: newId(), name, bot: true });
      push();
    },
    kick({ pid }) {
      if (room.game) fail('遊戲進行中唔可以踢人');
      room.players = room.players.filter((p) => p.id !== pid || p.id === room.hostId);
      push();
    },
    leave() { clearTimeout(botTimer); room = null; },
    settings({ twoSided }) {
      if (room.game && room.game.phase !== 'gameEnd') fail('遊戲進行中唔可以改設定');
      if (!twoSided && room.players.length > 10) fail('超過 10 人要用雙邊模式');
      room.settings.twoSided = !!twoSided;
      push();
    },
    start() {
      if (room.players.length < 3) fail('最少要 3 個玩家');
      room.game = new Game(room.players.map((p) => ({ id: p.id, name: p.name })), { twoSided: room.settings.twoSided });
      push();
    },
    next_round() { room.game.nextRound(); push(); },
    to_lobby() { room.game = null; push(); },
    skip() { fail('AI 玩家唔會離線'); },
    play(a) {
      if (!room || !room.game) fail('遊戲未開始');
      const peek = act(room.hostId, a);
      push();
      return peek ? { peek } : {};
    },
  };

  window.__botMove = botMove;
  window.LocalServer = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit(ev, data, ack) {
      setTimeout(() => {
        let r;
        try { r = { ok: true, ...((H[ev] ? H[ev](data || {}) : fail('未知指令')) || {}) }; }
        catch (e) { if (!(e instanceof GameError)) console.error(e); r = { ok: false, error: e instanceof GameError ? e.message : '出錯' }; }
        ack && ack(r);
      }, 0);
    },
  };
})();
