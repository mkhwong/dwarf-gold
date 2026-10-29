/* 矮人掘金 — client */
(() => {
  const R = window.SabRules;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- identity ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  let token = store.get('dg_token');
  if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('dg_token', token); }

  const LOCAL = !!window.LocalServer;
  const socket = window.LocalServer || io({ transports: ['websocket', 'polling'] });
  let state = null;
  let selId = null, flipped = false;
  // board scale: 'fit' shows the whole mine without scrolling; +/- switch to manual zoom
  let zoomMode = 'fit', manualScale = 1;
  const BOARD_PAD = 8;
  let roleShownRound = 0, resultShownKey = '', centeredRound = 0;
  let prevBoardKeys = new Set();
  let roleVisible = false;

  // ---------- helpers ----------
  function toast(msg, ok) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (ok ? ' ok' : '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function emit(ev, data) {
    return new Promise((res) => {
      socket.emit(ev, data || {}, (r) => {
        if (!r || !r.ok) toast((r && r.error) || '連線出錯');
        res(r || { ok: false });
      });
    });
  }
  const nameOf = (pid) => (state && state.players.find((p) => p.id === pid) || {}).name || '?';
  const me = () => state && state.me;
  const myTurn = () => state && state.game && state.game.turnPid === me();
  const isHost = () => state && state.hostId === me();
  function showModal(html, onBind) {
    $('#modalCard').innerHTML = html;
    $('#modal').hidden = false;
    onBind && onBind($('#modalCard'));
  }
  const closeModal = () => { $('#modal').hidden = true; };

  // ---------- art assets ----------
  const CARD = (n) => `cards/${n}.webp`;
  const ART = (n) => `art/${n}.webp`;
  function roleArt(role, pid, round) {
    let h = 7;
    for (const ch of String(pid) + ':' + round) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return role === 'saboteur' ? CARD('sab-' + (h % 4 + 1)) : CARD('digger-' + (h % 7 + 1));
  }
  ['back', 'map', 'rockfall', 'broken-pick', 'broken-lamp', 'broken-cart', 'repair-pick', 'repair-lamp', 'repair-cart']
    .forEach((n) => { new Image().src = CARD(n); });
  ['dwarf-pick', 'dwarf-gold', 'dwarf-cart', 'dwarf-tired', 'dwarf-point', 'tnt', 'gold-pile', 'nugget', 'pickaxe']
    .forEach((n) => { new Image().src = ART(n); });

  // ---------- tile art ----------
  const PT = { N: [28, 0], S: [28, 80], E: [56, 40], W: [0, 40] };
  function tileSVG(groups, o = {}) {
    let s = `<svg viewBox="0 0 56 80" xmlns="http://www.w3.org/2000/svg">`;
    const bg = o.start ? '#6b5440' : o.gold ? '#6e5530' : '#5b4636';
    s += `<rect width="56" height="80" rx="4" fill="${bg}"/>`;
    s += `<g fill="#4a382b" opacity=".8"><circle cx="9" cy="12" r="3"/><circle cx="46" cy="68" r="4"/><circle cx="44" cy="14" r="2"/><circle cx="12" cy="66" r="2.5"/></g>`;
    let dead = false;
    const stroke = 'stroke="#e8d3a3" stroke-width="15"';
    for (const g of groups) {
      if (g.length === 1) {
        dead = true;
        const [ex, ey] = PT[g[0]];
        const mx = ex + (28 - ex) * 0.55, my = ey + (40 - ey) * 0.55;
        s += `<line x1="${ex}" y1="${ey}" x2="${mx}" y2="${my}" ${stroke}/>`;
      } else {
        for (const d of g) s += `<line x1="${PT[d][0]}" y1="${PT[d][1]}" x2="28" y2="40" ${stroke}/>`;
        s += `<circle cx="28" cy="40" r="7.5" fill="#e8d3a3"/>`;
      }
    }
    if (dead) s += `<circle cx="28" cy="40" r="9" fill="#2b211a" stroke="#1a1410" stroke-width="2"/><circle cx="25" cy="37" r="2.5" fill="#4b3b2e"/>`;
    if (o.start) s += `<rect x="20" y="31" width="16" height="18" rx="2" fill="#7a4b22" stroke="#3a220d" stroke-width="2"/><line x1="20" y1="37" x2="36" y2="37" stroke="#3a220d" stroke-width="2"/><line x1="20" y1="43" x2="36" y2="43" stroke="#3a220d" stroke-width="2"/>`;
    if (o.gold) s += `<g><polygon points="16,46 28,30 40,46 33,52 22,52" fill="#f6c93f" stroke="#8a5d0b" stroke-width="2"/><polygon points="22,40 28,32 31,40" fill="#fff3b0" opacity=".8"/></g>`;
    if (o.coal) s += `<g fill="#1b1b1d" stroke="#000" stroke-width="1"><circle cx="24" cy="44" r="6"/><circle cx="33" cy="40" r="5"/><circle cx="29" cy="49" r="4"/></g>`;
    s += `<rect width="56" height="80" rx="4" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="2"/>`;
    return s + '</svg>';
  }
  function goalBackSVG(idx) {
    return `<img class="gback" src="${CARD('back')}" alt="目標牌"><span class="glabel">${R.GOAL_LABEL[idx]}</span>`;
  }
  function cellSVG(c) {
    if (c.kind === 'goal') {
      if (c.hidden) return goalBackSVG(c.goalIdx);
      return tileSVG(R.groupsFor(c.goal, c.flipped), { gold: c.goal === 'gold', coal: c.goal !== 'gold' }) +
        (c.goal === 'gold' ? `<img class="goldart" src="${ART('gold-pile')}" alt="金礦">` : '');
    }
    return tileSVG(R.groupsFor(c.shape, c.flipped), { start: c.kind === 'start' });
  }
  function cardFace(card, isFlipped) {
    if (card.type === 'path') return tileSVG(R.groupsFor(card.shape, isFlipped));
    if (card.type === 'broken') return `<img class="cimg" src="${CARD('broken-' + card.tool)}" alt="破壞${R.TOOL_NAME[card.tool]}">`;
    if (card.type === 'repair') {
      if (card.tools.length === 1) return `<img class="cimg" src="${CARD('repair-' + card.tools[0])}" alt="修理${R.TOOL_NAME[card.tools[0]]}">`;
      return `<div class="cimg split"><img src="${CARD('repair-' + card.tools[0])}" alt=""><img src="${CARD('repair-' + card.tools[1])}" alt="">
        <span class="dual">${card.tools.map((t) => R.TOOL_ICON[t]).join('')}</span></div>`;
    }
    if (card.type === 'map') return `<img class="cimg" src="${CARD('map')}" alt="地圖">`;
    return `<img class="cimg" src="${CARD('rockfall')}" alt="坍方">`;
  }
  function cardDesc(card) {
    switch (card.type) {
      case 'path': return '通道牌：撳藍色虛線格放低，可以先轉向。';
      case 'broken': return `破壞牌：令一位玩家嘅${R.TOOL_NAME[card.tool]}壞咗，佢就唔可以挖通道。`;
      case 'repair': return `修理牌：修好${card.tools.map((t) => R.TOOL_NAME[t]).join(' 或 ')}（可以修自己）。`;
      case 'map': return '地圖牌：撳一張「？」目標牌，偷睇係金定煤。';
      case 'rockfall': return '坍方牌：撳一張紅框通道牌將佢炸走。';
    }
    return '';
  }

  // ---------- screens ----------
  function show(id) {
    for (const s of ['home', 'lobby', 'game']) $('#' + s).hidden = s !== id;
  }

  function render() {
    if (!state) { show('home'); return; }
    if (state.phase === 'lobby') { renderLobby(); show('lobby'); return; }
    show('game');
    renderGame();
  }

  function renderLobby() {
    $('#codeBig').textContent = state.code;
    $('#lobby .hint').textContent = LOCAL ? '預覽版：用「＋ 加 AI 玩家」代替朋友入房' : '撳代碼複製邀請連結';
    $('#lobbyCount').textContent = `${state.players.length}/10`;
    $('#lobbyList').innerHTML = state.players.map((p) => `
      <li><span class="nm">${esc(p.name)}${p.id === me() ? '（你）' : ''}</span>
        ${p.id === state.hostId ? '<span class="tag">房主</span>' : ''}
        ${p.connected ? '' : '<span class="tag off">離線</span>'}
        ${isHost() && p.id !== me() ? `<button class="kick" data-kick="${p.id}">踢走</button>` : ''}</li>`).join('');
    const n = state.players.length;
    $('#lobbyActions').innerHTML = isHost()
      ? (LOCAL ? `<button id="botBtn" class="btn" ${n >= 10 ? 'disabled' : ''}>＋ 加 AI 玩家</button>` : '') + `<button id="startBtn" class="btn primary big" ${n < 3 ? 'disabled' : ''}>${n < 3 ? `等多 ${3 - n} 個人…` : '開始遊戲'}</button>`
      : `<div class="waiting">等房主開始遊戲…</div>`;
  }

  // ---------- game ----------
  function boardObj() {
    const b = {};
    state.game.board.forEach((c) => { b[R.key(c.x, c.y)] = c; });
    return b;
  }
  function selCard() {
    return state.game && state.game.hand.find((c) => c.id === selId) || null;
  }

  function renderGame() {
    const g = state.game;
    const meId = me();
    $('#gCode').textContent = state.code;
    $('#gRound').textContent = `第 ${g.round}/${g.totalRounds} 回合`;
    $('#gDeck').innerHTML = `<img class="ico deck" src="${CARD('back')}" alt="牌堆"> ${g.deckCount}`;
    const rb = $('#roleBtn');
    rb.className = 'pill role-pill' + (roleVisible ? ' ' + g.role : '');
    rb.textContent = roleVisible ? (g.role === 'saboteur' ? '🧨 破壞者' : '⛏️ 金礦工') : '👁 身份';

    // seats
    $('#seats').innerHTML = g.seats.map((s) => {
      const p = state.players.find((x) => x.id === s.id) || {};
      const br = R.TOOLS.filter((t) => s.broken[t]).map((t) => R.TOOL_ICON[t]).join('');
      return `<div data-seat="${s.id}" class="seat ${s.id === g.turnPid ? 'turn' : ''} ${s.id === meId ? 'me' : ''} ${p.connected === false ? 'off' : ''}">
        <div class="s-name">${esc(p.name || '?')}</div>
        <div class="s-meta"><span>🂠${s.handCount}</span><span><img class="ico" src="${ART('nugget')}" alt="金">${s.score}</span></div>
        <div class="s-meta s-broken">${br ? br + ' 壞' : '&nbsp;'}</div></div>`;
    }).join('');

    // status
    const st = $('#status');
    if (g.phase !== 'playing') { st.className = 'status'; st.innerHTML = `${g.phase === 'gameEnd' ? '遊戲完結' : '回合完結'} <button class="ab-btn gold" id="reopenRes">睇結果</button>`; }
    else if (myTurn()) { st.className = 'status myturn'; st.textContent = '⛏️ 輪到你！揀一張牌'; }
    else {
      const cur = state.players.find((p) => p.id === g.turnPid);
      st.className = 'status';
      st.innerHTML = `輪到 <b>${esc(nameOf(g.turnPid))}</b>` +
        (cur && !cur.connected ? '（離線）' + (isHost() ? ' <button class="ab-btn danger" id="skipBtn">跳過佢</button>' : '') : '');
    }

    renderLog();
    renderHand();
    renderActionBar();
    renderBoard();
  }

  function renderBoard() {
    const g = state.game;
    const board = boardObj();
    const b = R.bounds(board);
    const minX = b.minX - 1, minY = b.minY - 1, maxX = b.maxX + 1, maxY = b.maxY + 1;
    const cols = maxX - minX + 1, rows = maxY - minY + 1;
    const view = $('#board');
    const availW = view.clientWidth - BOARD_PAD * 2, availH = view.clientHeight - BOARD_PAD * 2;
    const fit = Math.max(0.3, Math.min(availW / (cols * 56), availH / (rows * 80), 2));
    const z = zoomMode === 'fit' ? fit : manualScale;
    renderBoard.fitScale = fit;
    const cw = 56 * z, ch = 80 * z;
    const pos = (x, y) => `left:${(x - minX) * cw}px;top:${(y - minY) * ch}px;width:${cw}px;height:${ch}px`;

    const card = selCard();
    const canAct = myTurn() && g.phase === 'playing';
    let slots = [];
    if (canAct && card && card.type === 'path' && !hasBroken(me()))
      slots = R.validPlacements(board, card.shape, flipped);

    let html = '';
    const keys = new Set();
    for (const c of g.board) {
      const k = R.key(c.x, c.y);
      keys.add(k);
      let cls = 'cell';
      let data = '';
      if (canAct && card && card.type === 'rockfall' && c.kind === 'path') { cls += ' pick'; data = `data-rock="${c.x},${c.y}"`; }
      if (canAct && card && card.type === 'map' && c.kind === 'goal' && c.hidden) { cls += ' pick mapt'; data = `data-map="${c.goalIdx}"`; }
      if (prevBoardKeys.size && !prevBoardKeys.has(k)) cls += ' fresh';
      const known = c.kind === 'goal' && c.hidden && g.knownGoals[c.goalIdx];
      html += `<div class="${cls}" style="${pos(c.x, c.y)}" ${data}>${cellSVG(c)}${known ? `<span class="known">${known === 'gold' ? '💰' : '⚫'}</span>` : ''}</div>`;
    }
    for (const [x, y] of slots) html += `<div class="cell slot" style="${pos(x, y)}" data-slot="${x},${y}"></div>`;
    prevBoardKeys = keys;

    const inner = $('#boardInner');
    const innerW = cols * cw, innerH = rows * ch;
    inner.style.width = innerW + 'px';
    inner.style.height = innerH + 'px';
    inner.style.marginLeft = Math.max(BOARD_PAD, (view.clientWidth - innerW) / 2) + 'px';
    inner.style.marginTop = Math.max(BOARD_PAD, (view.clientHeight - innerH) / 2) + 'px';
    inner.innerHTML = html;

    renderBoard.geom = { minX, minY, cw, ch };
    if (zoomMode === 'fit') { view.scrollLeft = 0; view.scrollTop = 0; }
    else if (centeredRound !== g.round) { centeredRound = g.round; requestAnimationFrame(centerBoard); }
  }
  function centerBoard() {
    const geom = renderBoard.geom; if (!geom) return;
    const el = $('#board');
    // centre on the middle of the start→goal corridor
    const r = $('#boardInner');
    const cx = (4 - geom.minX + 0.5) * geom.cw + r.offsetLeft;
    const cy = (0 - geom.minY + 0.5) * geom.ch + r.offsetTop;
    el.scrollLeft = cx - el.clientWidth / 2;
    el.scrollTop = cy - el.clientHeight / 2;
  }

  function hasBroken(pid) {
    const s = state.game.seats.find((x) => x.id === pid);
    return s && (s.broken.pick || s.broken.lamp || s.broken.cart);
  }

  function renderLog() {
    const el = $('#log');
    el.innerHTML = state.game.log.map((l) => `<div>${esc(l.text)}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  function renderHand() {
    const g = state.game;
    if (selId && !g.hand.some((c) => c.id === selId)) { selId = null; flipped = false; }
    $('#hand').innerHTML = g.hand.length
      ? g.hand.map((c) => {
          const dim = c.type === 'path' && hasBroken(me());
          return `<button class="card ${c.id === selId ? 'sel' : ''} ${dim ? 'dim' : ''}" data-card="${c.id}">${cardFace(c, c.id === selId && flipped)}</button>`;
        }).join('')
      : `<div class="empty-hand"><img src="${ART('dwarf-tired')}" alt="">手上冇牌喇，等其他人出完…</div>`;
    fanHand();
  }
  // lay out the hand: one row if it fits, slight fan if overlap is small, otherwise two full-size rows
  function fanHand() {
    const el = $('#hand');
    const cards = [...el.querySelectorAll('.card')];
    cards.forEach((c) => { c.style.marginLeft = ''; c.style.width = ''; c.style.height = ''; });
    el.classList.remove('fan', 'grid');
    el.style.gridTemplateColumns = '';
    if (cards.length < 2 || getComputedStyle(el).flexWrap === 'wrap') return;
    const cs = getComputedStyle(el);
    const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const cw = cards[0].offsetWidth, gap = 8, n = cards.length;
    if (n * cw + (n - 1) * gap <= avail) return;
    const step = (avail - cw) / (n - 1);
    if (step / cw >= 0.7) {
      el.classList.add('fan');
      cards.slice(1).forEach((c) => { c.style.marginLeft = (step - cw) + 'px'; });
      return;
    }
    const cols = Math.ceil(n / 2);
    const w = Math.min(108, Math.floor((avail - gap * (cols - 1)) / cols));
    el.classList.add('grid');
    el.style.gridTemplateColumns = `repeat(${cols}, ${w}px)`;
    cards.forEach((c) => { c.style.width = w + 'px'; c.style.height = Math.round(w * 1.28) + 'px'; });
  }


  function renderActionBar() {
    const g = state.game;
    const card = selCard();
    const bar = $('#actionBar');
    if (!card || g.phase !== 'playing') { bar.innerHTML = ''; return; }
    let html = `<div class="ab-row"><div class="ab-desc">${cardDesc(card)}</div>`;
    const turn = myTurn();
    if (card.type === 'path') {
      html += `<button class="ab-btn blue" id="flipBtn">🔄 轉向</button>`;
      if (turn && hasBroken(me())) html += `<span class="ab-desc" style="color:#ff9d94">你有工具壞咗，唔可以放通道。</span>`;
      else if (turn) {
        const board = boardObj();
        const here = R.validPlacements(board, card.shape, flipped).length;
        const other = R.validPlacements(board, card.shape, !flipped).length;
        if (!here) html += `<span class="ab-desc">${other ? '呢個方向冇位放，試下轉向。' : '呢張牌冇位放，可以棄牌。'}</span>`;
      }
    }
    if (turn && (card.type === 'broken' || card.type === 'repair')) {
      for (const s of g.seats) {
        if (card.type === 'broken') {
          if (s.id === me() || s.broken[card.tool]) continue;
          html += `<button class="ab-btn danger" data-target="${s.id}">${R.TOOL_ICON[card.tool]} ${esc(nameOf(s.id))}</button>`;
        } else {
          for (const t of card.tools) if (s.broken[t])
            html += `<button class="ab-btn gold" data-target="${s.id}" data-tool="${t}">${R.TOOL_ICON[t]} ${s.id === me() ? '自己' : esc(nameOf(s.id))}</button>`;
        }
      }
      if (!/data-target/.test(html)) html += `<span class="ab-desc">而家冇合適目標。</span>`;
    }
    if (turn) html += `<button class="ab-btn" id="discardBtn">🗑 棄牌跳過</button>`;
    else html += `<span class="ab-desc">未輪到你。</span>`;
    html += `<button class="ab-btn" id="cancelBtn">取消</button></div>`;
    bar.innerHTML = html;
  }

  // ---------- transitions & modals ----------
  const after = (fn) => (window.FX ? window.FX.after(fn) : fn());
  function cellScreen(x, y, geom) {
    const r = $('#boardInner').getBoundingClientRect();
    return [r.left + (x - geom.minX + 0.5) * geom.cw, r.top + (y - geom.minY + 0.5) * geom.ch];
  }
  function fxEvents(pg, g, prevGeom) {
    const FX = window.FX;
    if (g.phase === 'playing' && roleShownRound !== g.round) {
      roleShownRound = g.round;
      roleVisible = false;
      closeModal();
      if (FX) FX.roundIntro(g.round, g.totalRounds);
      after(() => showRoleModal(true));
      return;
    }
    const resKey = g.round + g.phase;
    if (!pg || pg.round !== g.round) {
      if (g.phase !== 'playing' && resultShownKey !== resKey) { resultShownKey = resKey; after(showResultModal); }
      return;
    }
    const lastId = pg.log.reduce((m, l) => Math.max(m, l.id), 0);
    for (const l of g.log.filter((x) => x.id > lastId)) {
      const lab = l.text.match(/(上|中|下)方/);
      if (FX && l.text.startsWith('⚫') && lab) {
        const goal = g.board.find((c) => c.kind === 'goal' && c.goalIdx === R.GOAL_LABEL.indexOf(lab[1]));
        if (goal) FX.coal(...cellScreen(goal.x, goal.y, renderBoard.geom));
      }
      if (FX && l.text.startsWith('💰')) FX.goldStrike(esc(l.text.replace(/^💰\s*/, '').split(' 挖到')[0]));
      if (FX && l.text.startsWith('💥') && prevGeom) {
        const now = new Set(g.board.map((c) => R.key(c.x, c.y)));
        const gone = pg.board.find((c) => !now.has(R.key(c.x, c.y)));
        if (gone) FX.rockfall(...cellScreen(gone.x, gone.y, prevGeom), $('.board-wrap'));
      }
    }
    if (FX) for (const s of g.seats) {
      const ps = pg.seats.find((x) => x.id === s.id);
      if (!ps) continue;
      const el = document.querySelector(`[data-seat="${s.id}"]`);
      for (const t of R.TOOLS) {
        if (!ps.broken[t] && s.broken[t]) FX.toolHit(el, false);
        if (ps.broken[t] && !s.broken[t]) FX.toolHit(el, true);
      }
    }
    if (pg.phase === 'playing' && g.phase !== 'playing' && g.result) {
      if (FX && g.result.winner === 'saboteur') FX.sabWin($('#game'));
      resultShownKey = resKey;
      after(showResultModal);
    } else if (FX && g.phase === 'playing' && g.turnPid === me() && pg.turnPid !== me()) {
      FX.yourTurn();
    }
  }

  function showRoleModal(isNew) {
    const g = state.game;
    const sab = g.role === 'saboteur';
    showModal(`
      <h2>${isNew ? `第 ${g.round} 回合` : '你嘅身份'}</h2>
      <p>確保冇人望住你個 mon 先撳</p>
      <div class="flip big"><div class="flip-inner" id="roleFlip">
        <div class="front"><img src="${CARD('back')}" alt="身份牌背面"></div>
        <div class="back"><img src="${roleArt(g.role, me(), g.round)}" alt="${sab ? '破壞者' : '金礦工'}"></div>
      </div></div>
      <div id="roleReveal" hidden>
        <div class="role-name ${g.role}">${sab ? '破壞者' : '金礦工'}</div>
        <p>${sab ? '暗中阻止金礦工挖到金礦！' : '同伴合作，挖一條路去金礦！'}</p>
      </div>
      <button class="btn primary" id="revealBtn">👁 翻開身份牌</button>
      <button class="btn" id="closeRole" hidden>收埋 · 開始</button>`, (el) => {
      el.querySelector('#revealBtn').onclick = (e) => {
        el.querySelector('#roleFlip').classList.add('go');
        e.target.hidden = true;
        setTimeout(() => {
          el.querySelector('#roleReveal').hidden = false;
          el.querySelector('#closeRole').hidden = false;
        }, 500);
      };
      el.querySelector('#closeRole').onclick = () => {
        closeModal();
        if (myTurn() && window.FX) window.FX.yourTurn();
      };
    });
  }

  function showResultModal() {
    const g = state.game;
    const res = g.result;
    if (!res) return;
    const end = g.phase === 'gameEnd';
    const dig = res.winner === 'digger';
    const rows = [...g.seats].sort((a, b) => b.score - a.score).map((s) => {
      const role = res.roles[s.id];
      const won = role === res.winner;
      return `<tr class="${won ? 'win' : ''}"><td><img class="rthumb" src="${roleArt(role, s.id, g.round)}" alt="">${esc(nameOf(s.id))}<span class="badge ${role}">${role === 'saboteur' ? '破壞者' : '金礦工'}</span>${res.finder === s.id ? ` <img class="ico" src="${ART('nugget')}" alt="挖到金">` : ''}</td>
        <td class="r gain">${res.gains[s.id] ? '+' + res.gains[s.id] : ''}</td><td class="r">${s.score}</td></tr>`;
    }).join('');
    let title = dig ? '⛏️ 金礦工勝利！' : '🧨 破壞者勝利！';
    let extra = '';
    if (end) {
      const top = Math.max(...g.seats.map((s) => s.score));
      const winners = g.seats.filter((s) => s.score === top).map((s) => esc(nameOf(s.id)));
      extra = `<h2 style="margin-top:14px">🏆 ${winners.join('、')} 贏咗成局！</h2>`;
    }
    const hostBtn = isHost()
      ? (end ? `<button class="btn primary" id="lobbyBtn">返回大廳</button><button class="btn" id="againBtn">同一班人再玩</button>`
             : `<button class="btn primary" id="nextBtn">開始第 ${g.round + 1} 回合</button>`)
      : `<p class="waiting">等房主${end ? '決定' : '開始下一回合'}…</p>`;
    showModal(`
      <img class="res-art" src="${end ? ART('dwarf-gold') : dig ? ART('dwarf-cart') : ART('tnt')}" alt="">
      <h2>${title}</h2>
      <p>第 ${g.round}/${g.totalRounds} 回合完結</p>
      ${extra}
      <table class="res-table"><tr><td style="color:var(--muted)">玩家</td><td class="r" style="color:var(--muted)">今回合</td><td class="r" style="color:var(--muted)">總金</td></tr>${rows}</table>
      ${hostBtn}
      <button class="btn ghost" id="viewBoard">睇返個礦</button>`, (el) => {
      const nb = el.querySelector('#nextBtn'); if (nb) nb.onclick = () => emit('next_round');
      const lb = el.querySelector('#lobbyBtn'); if (lb) lb.onclick = () => emit('to_lobby');
      const ab = el.querySelector('#againBtn'); if (ab) ab.onclick = () => emit('start');
      el.querySelector('#viewBoard').onclick = () => {
        closeModal();
      };
    });
  }

  // ---------- events ----------
  $('#nameInput').value = store.get('dg_name') || '';
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) $('#codeInput').value = urlRoom.toUpperCase().slice(0, 4);

  function saveName() {
    const n = $('#nameInput').value.trim();
    if (!n) { toast('請輸入名稱'); $('#nameInput').focus(); return null; }
    store.set('dg_name', n);
    return n;
  }
  $('#createBtn').onclick = async () => {
    const name = saveName(); if (!name) return;
    const r = await emit('create', { name, token });
    if (r.ok) store.set('dg_room', r.code);
  };
  $('#joinBtn').onclick = async () => {
    const name = saveName(); if (!name) return;
    const code = $('#codeInput').value.trim().toUpperCase();
    if (code.length !== 4) return toast('請輸入 4 位房間代碼');
    const r = await emit('join', { code, name, token });
    if (r.ok) { store.set('dg_room', r.code); try { history.replaceState(null, '', location.pathname); } catch {} }
  };
  $('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });
  $('#codeBig').onclick = async () => {
    const link = LOCAL ? state.code : `${location.origin}${location.pathname}?room=${state.code}`;
    try {
      if (!LOCAL && navigator.share) await navigator.share({ title: '矮人掘金', text: `入嚟玩矮人掘金！房間代碼：${state.code}`, url: link });
      else { await navigator.clipboard.writeText(link); toast(LOCAL ? '已複製房間代碼' : '已複製邀請連結', true); }
    } catch { toast('房間代碼：' + state.code, true); }
  };
  $('#leaveBtn').onclick = async () => {
    await emit('leave');
    store.set('dg_room', null);
    state = null; render();
  };
  $('#lobbyList').onclick = (e) => {
    const b = e.target.closest('[data-kick]');
    if (b) emit('kick', { pid: b.dataset.kick });
  };
  $('#lobbyActions').onclick = (e) => {
    if (e.target.id === 'startBtn') emit('start');
    if (e.target.id === 'botBtn') emit('add_bot');
  };

  $('#roleBtn').onclick = () => { roleVisible = !roleVisible; renderGame(); };

  $('#hand').onclick = (e) => {
    const b = e.target.closest('[data-card]'); if (!b) return;
    if (selId === b.dataset.card) { selId = null; } else { selId = b.dataset.card; flipped = false; }
    renderGame();
  };

  $('#actionBar').onclick = async (e) => {
    const card = selCard(); if (!card) return;
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'flipBtn') { flipped = !flipped; renderGame(); return; }
    if (t.id === 'cancelBtn') { selId = null; renderGame(); return; }
    if (t.id === 'discardBtn') {
      const r = await emit('play', { kind: 'discard', cardId: card.id });
      if (r.ok) selId = null;
      return;
    }
    if (t.dataset.target) {
      const r = await emit('play', { kind: 'tool', cardId: card.id, target: t.dataset.target, tool: t.dataset.tool });
      if (r.ok) selId = null;
    }
  };

  $('#boardInner').onclick = async (e) => {
    const card = selCard(); if (!card) return;
    const slot = e.target.closest('[data-slot]');
    if (slot) {
      const [x, y] = slot.dataset.slot.split(',').map(Number);
      const r = await emit('play', { kind: 'path', cardId: card.id, x, y, flipped });
      if (r.ok) { selId = null; flipped = false; }
      return;
    }
    const rock = e.target.closest('[data-rock]');
    if (rock) {
      const [x, y] = rock.dataset.rock.split(',').map(Number);
      const r = await emit('play', { kind: 'rockfall', cardId: card.id, x, y });
      if (r.ok) selId = null;
      return;
    }
    const mp = e.target.closest('[data-map]');
    if (mp) {
      const r = await emit('play', { kind: 'map', cardId: card.id, goalIdx: Number(mp.dataset.map) });
      if (r.ok && r.peek) {
        selId = null;
        const gold = r.peek.goal === 'gold';
        const face = cellSVG({ kind: 'goal', goal: gold ? 'gold' : 'coal1', flipped: false });
        showModal(`<h2>🗺️ ${R.GOAL_LABEL[r.peek.goalIdx]}方目標</h2>
          <div class="flip"><div class="flip-inner go"><div class="front">${goalBackSVG(r.peek.goalIdx)}</div><div class="back">${face}</div></div></div>
          <div class="role-name ${gold ? 'digger' : 'saboteur'}">${gold ? '金礦！' : '煤礦'}</div>
          <p>只有你知道。地圖上會幫你標記住。</p><button class="btn primary" id="okPeek">知道</button>`,
          (el) => { el.querySelector('#okPeek').onclick = closeModal; });
      }
    }
  };

  $('#status').addEventListener('click', (e) => {
    if (e.target.id === 'skipBtn') emit('skip');
    if (e.target.id === 'reopenRes') showResultModal();
  });

  document.querySelector('.zoom').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const z = Number(b.dataset.z);
    if (z === 0) { zoomMode = 'fit'; renderBoard(); return; }
    const cur = zoomMode === 'fit' ? renderBoard.fitScale || 1 : manualScale;
    manualScale = Math.max(0.4, Math.min(2.5, cur * (z > 0 ? 1.25 : 0.8)));
    zoomMode = 'manual';
    centeredRound = 0;
    renderBoard();
  };

  // ---------- socket ----------
  $('#log').addEventListener('click', () => {
    $('#log').classList.toggle('open');
    setTimeout(() => { if (state && state.game) { renderLog(); renderBoard(); } }, 220);
  });
  let resizeT;
  addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (state && state.game) { fanHand(); renderBoard(); } }, 120);
  });

  socket.on('state', (s) => {
    const prev = state, prevGeom = renderBoard.geom;
    state = s;
    if (s.phase === 'lobby') { roleShownRound = 0; resultShownKey = ''; centeredRound = 0; prevBoardKeys = new Set(); }
    render();
    if (s.game) fxEvents(prev && prev.game, s.game, prevGeom);
  });
  socket.on('kicked', (msg) => {
    toast(msg);
    store.set('dg_room', null);
    state = null; closeModal(); render();
  });
  socket.on('connect', async () => {
    const code = store.get('dg_room');
    if (!code) return;
    socket.emit('resume', { code, token }, (r) => {
      if (!r || !r.ok) { store.set('dg_room', null); state = null; render(); }
    });
  });
  socket.on('disconnect', () => toast('斷咗線，重新連接緊…'));

  render();
})();
