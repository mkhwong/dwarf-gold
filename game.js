// 矮人掘金 — authoritative game state (server only)
const R = require('./public/rules.js');

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

function buildDeck() {
  let n = 0;
  const id = () => 'c' + n++;
  const deck = [];
  for (const [shape, count] of Object.entries(R.PATH_COUNTS))
    for (let i = 0; i < count; i++) deck.push({ id: id(), type: 'path', shape });
  for (const t of R.TOOLS) for (let i = 0; i < 3; i++) deck.push({ id: id(), type: 'broken', tool: t });
  for (const t of R.TOOLS) for (let i = 0; i < 2; i++) deck.push({ id: id(), type: 'repair', tools: [t] });
  [['pick', 'lamp'], ['pick', 'cart'], ['lamp', 'cart']].forEach((ts) => deck.push({ id: id(), type: 'repair', tools: ts }));
  for (let i = 0; i < 6; i++) deck.push({ id: id(), type: 'map' });
  for (let i = 0; i < 3; i++) deck.push({ id: id(), type: 'rockfall' });
  return shuffle(deck);
}

const ROLE_NAME = { digger: '金礦工', saboteur: '破壞者' };

class Game {
  constructor(players, opts = {}) {
    this.players = players.map((p) => p.id); // seat order
    this.names = Object.fromEntries(players.map((p) => [p.id, p.name]));
    this.totalRounds = opts.rounds || 3;
    this.round = 0;
    this.scores = Object.fromEntries(this.players.map((p) => [p, 0]));
    this.goldDeck = shuffle([...Array(16).fill(1), ...Array(8).fill(2), ...Array(4).fill(3)]);
    this.startIdx = Math.floor(Math.random() * this.players.length);
    this.log = [];
    this.logSeq = 0;
    this.startRound();
  }

  addLog(text) {
    this.log.push({ id: ++this.logSeq, text });
    if (this.log.length > 80) this.log.shift();
  }
  nm(pid) { return this.names[pid] || '?'; }

  startRound() {
    const n = this.players.length;
    this.round++;
    this.phase = 'playing';
    this.result = null;
    this.goldFinder = null;

    const [sab, dig] = R.ROLE_TABLE[n];
    const pool = shuffle([...Array(sab).fill('saboteur'), ...Array(dig).fill('digger')]);
    this.roles = Object.fromEntries(this.players.map((p, i) => [p, pool[i]]));

    this.deck = buildDeck();
    const hs = R.handSize(n);
    this.hands = Object.fromEntries(this.players.map((p) => [p, this.deck.splice(0, hs)]));
    this.broken = Object.fromEntries(this.players.map((p) => [p, { pick: false, lamp: false, cart: false }]));
    this.knownGoals = Object.fromEntries(this.players.map((p) => [p, {}]));

    this.board = {};
    this.board[R.key(0, 0)] = { x: 0, y: 0, kind: 'start', shape: 'start', flipped: false };
    const goals = shuffle(['gold', 'coal1', 'coal2']);
    R.GOAL_POS.forEach(([x, y], i) => {
      this.board[R.key(x, y)] = { x, y, kind: 'goal', goal: goals[i], goalIdx: i, hidden: true, flipped: false };
    });

    this.turnIdx = this.startIdx;
    this.addLog(`── 第 ${this.round} 回合開始，由 ${this.nm(this.current())} 先行 ──`);
  }

  current() { return this.players[this.turnIdx]; }

  assertTurn(pid) {
    if (this.phase !== 'playing') fail('而家唔係出牌階段');
    if (this.current() !== pid) fail('未輪到你');
  }
  card(pid, cardId) {
    const c = (this.hands[pid] || []).find((x) => x.id === cardId);
    if (!c) fail('你手上冇呢張牌');
    return c;
  }
  discardFromHand(pid, cardId) {
    this.hands[pid] = this.hands[pid].filter((c) => c.id !== cardId);
  }
  hasBroken(pid) {
    const b = this.broken[pid];
    return b.pick || b.lamp || b.cart;
  }

  // ---------- actions ----------
  playPath(pid, cardId, x, y, flipped) {
    this.assertTurn(pid);
    const c = this.card(pid, cardId);
    if (c.type !== 'path') fail('呢張唔係通道牌');
    if (this.hasBroken(pid)) fail('你有工具壞咗，修好先可以放通道');
    x = Number(x); y = Number(y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) fail('位置錯誤');
    if (!R.canPlacePath(this.board, c.shape, !!flipped, x, y)) fail('呢個位置放唔到');
    this.board[R.key(x, y)] = { x, y, kind: 'path', shape: c.shape, flipped: !!flipped };
    this.discardFromHand(pid, cardId);
    this.addLog(`${this.nm(pid)} 挖咗一條通道`);
    this.checkGoals(pid);
    this.endTurn();
  }

  checkGoals(pid) {
    for (let guard = 0; guard < 5; guard++) {
      const { touchedGoals } = R.computeReach(this.board);
      const keys = Object.keys(touchedGoals);
      if (!keys.length) return;
      for (const k of keys) {
        const g = this.board[k];
        g.hidden = false;
        const open = R.openEdges(R.groupsFor(g.goal, false));
        g.flipped = ![...touchedGoals[k]].some((e) => open.has(e));
        const label = R.GOAL_LABEL[g.goalIdx];
        if (g.goal === 'gold') {
          this.addLog(`💰 ${this.nm(pid)} 挖到${label}方嘅金礦！`);
          this.goldFinder = this.goldFinder || pid;
        } else {
          this.addLog(`⚫ ${label}方目標係煤礦…`);
        }
      }
    }
  }

  playTool(pid, cardId, targetId, tool) {
    this.assertTurn(pid);
    const c = this.card(pid, cardId);
    if (!this.players.includes(targetId)) fail('搵唔到目標玩家');
    const tb = this.broken[targetId];
    if (c.type === 'broken') {
      if (targetId === pid) fail('唔可以破壞自己嘅工具');
      if (tb[c.tool]) fail(`${this.nm(targetId)} 嘅${R.TOOL_NAME[c.tool]}已經壞咗`);
      tb[c.tool] = true;
      this.addLog(`${this.nm(pid)} 破壞咗 ${this.nm(targetId)} 嘅${R.TOOL_ICON[c.tool]}${R.TOOL_NAME[c.tool]}`);
    } else if (c.type === 'repair') {
      let t = tool;
      if (!t) {
        const opts = c.tools.filter((x) => tb[x]);
        if (opts.length !== 1) fail(opts.length ? '請揀要修理邊件工具' : '對方冇可以修理嘅工具');
        t = opts[0];
      }
      if (!c.tools.includes(t)) fail('呢張牌修唔到呢件工具');
      if (!tb[t]) fail(`${this.nm(targetId)} 嘅${R.TOOL_NAME[t]}冇壞`);
      tb[t] = false;
      this.addLog(`${this.nm(pid)} 修好咗 ${targetId === pid ? '自己' : this.nm(targetId)} 嘅${R.TOOL_ICON[t]}${R.TOOL_NAME[t]}`);
    } else fail('呢張唔係工具牌');
    this.discardFromHand(pid, cardId);
    this.endTurn();
  }

  playRockfall(pid, cardId, x, y) {
    this.assertTurn(pid);
    const c = this.card(pid, cardId);
    if (c.type !== 'rockfall') fail('呢張唔係坍方牌');
    const k = R.key(Number(x), Number(y));
    const cell = this.board[k];
    if (!cell || cell.kind !== 'path') fail('只可以炸走普通通道牌');
    delete this.board[k];
    this.discardFromHand(pid, cardId);
    this.addLog(`💥 ${this.nm(pid)} 炸塌咗一段通道`);
    this.endTurn();
  }

  playMap(pid, cardId, goalIdx) {
    this.assertTurn(pid);
    const c = this.card(pid, cardId);
    if (c.type !== 'map') fail('呢張唔係地圖牌');
    const g = Object.values(this.board).find((x) => x.kind === 'goal' && x.goalIdx === Number(goalIdx));
    if (!g) fail('搵唔到目標');
    if (!g.hidden) fail('呢張目標已經揭開咗');
    this.knownGoals[pid][g.goalIdx] = g.goal === 'gold' ? 'gold' : 'coal';
    this.discardFromHand(pid, cardId);
    this.addLog(`🗺️ ${this.nm(pid)} 偷睇咗${R.GOAL_LABEL[g.goalIdx]}方目標`);
    this.endTurn();
    return { goalIdx: g.goalIdx, goal: this.knownGoals[pid][g.goalIdx] };
  }

  discard(pid, cardId) {
    this.assertTurn(pid);
    this.card(pid, cardId);
    this.discardFromHand(pid, cardId);
    this.addLog(`${this.nm(pid)} 棄咗一張牌（跳過）`);
    this.endTurn();
  }

  forceSkip() {
    if (this.phase !== 'playing') fail('而家唔係出牌階段');
    const pid = this.current();
    const h = this.hands[pid];
    const c = h[Math.floor(Math.random() * h.length)];
    this.discardFromHand(pid, c.id);
    this.addLog(`房主跳過咗 ${this.nm(pid)}（自動棄一張牌）`);
    this.endTurn();
  }

  // ---------- turn / round flow ----------
  endTurn() {
    const pid = this.current();
    if (this.deck.length) this.hands[pid].push(this.deck.shift());
    if (this.goldFinder) return this.finishRound('digger', this.goldFinder);
    if (this.players.every((p) => this.hands[p].length === 0)) return this.finishRound('saboteur');
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (this.turnIdx + i) % n;
      if (this.hands[this.players[idx]].length) { this.turnIdx = idx; return; }
    }
  }

  drawGold() { return this.goldDeck.length ? this.goldDeck.shift() : 1; }

  finishRound(winner, finder) {
    const n = this.players.length;
    const gains = Object.fromEntries(this.players.map((p) => [p, 0]));
    if (winner === 'digger') {
      const fi = this.players.indexOf(finder);
      const order = [];
      for (let i = 0; i < n; i++) {
        const p = this.players[(fi - i + n) % n]; // finder first, then anticlockwise
        if (this.roles[p] === 'digger') order.push(p);
      }
      const nuggets = Array.from({ length: n }, () => this.drawGold()).sort((a, b) => b - a);
      nuggets.forEach((v, i) => { gains[order[i % order.length]] += v; });
      this.addLog(`🏆 金礦工勝利！`);
    } else {
      const sabs = this.players.filter((p) => this.roles[p] === 'saboteur');
      const each = sabs.length === 1 ? 4 : sabs.length <= 3 ? 3 : 2;
      sabs.forEach((p) => { gains[p] += each; });
      this.addLog(sabs.length ? `🧨 破壞者勝利！` : `今回合冇破壞者，亦冇人挖到金…`);
    }
    for (const p of this.players) this.scores[p] += gains[p];
    this.result = { winner, finder: finder || null, roles: { ...this.roles }, gains };
    this.phase = this.round >= this.totalRounds ? 'gameEnd' : 'roundEnd';
    this.startIdx = (this.turnIdx + 1) % n;
  }

  nextRound() {
    if (this.phase !== 'roundEnd') fail('而家唔可以開始下一回合');
    this.startRound();
  }

  // ---------- per-player view ----------
  view(pid) {
    const reveal = this.phase !== 'playing';
    const board = Object.values(this.board).map((c) => {
      const o = { x: c.x, y: c.y, kind: c.kind, flipped: c.flipped };
      if (c.kind === 'goal') {
        o.goalIdx = c.goalIdx;
        if (c.hidden && !reveal) o.hidden = true;
        else { o.goal = c.goal; if (c.hidden) o.lateReveal = true; }
      } else o.shape = c.shape;
      return o;
    });
    return {
      round: this.round,
      totalRounds: this.totalRounds,
      phase: this.phase,
      deckCount: this.deck.length,
      board,
      turnPid: this.phase === 'playing' ? this.current() : null,
      hand: this.hands[pid] || [],
      role: this.roles[pid] || null,
      knownGoals: this.knownGoals[pid] || {},
      seats: this.players.map((p) => ({
        id: p, handCount: this.hands[p].length, broken: this.broken[p], score: this.scores[p],
      })),
      log: this.log.slice(-40),
      result: this.result,
    };
  }
}

module.exports = { Game, GameError, ROLE_NAME, buildDeck };
