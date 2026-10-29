/* 矮人掘金 — transition animations
 * Each cinematic can be swapped for a video clip (e.g. generated in Higgsfield):
 * set CINEMATICS.<name> to an mp4 URL and it plays instead of the code animation. */
(function () {
  const CINEMATICS = { roundIntro: null, goldStrike: null, sabWin: null };

  const $ = (s) => document.querySelector(s);
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cv, ctx, stage, dpr = 1, parts = [], raf = null;
  let chain = Promise.resolve(), pending = 0;

  function init() {
    if (cv) return;
    const root = document.createElement('div');
    root.id = 'fx';
    root.innerHTML = '<canvas id="fxCanvas"></canvas><div id="fxStage"></div>';
    document.body.appendChild(root);
    cv = $('#fxCanvas'); stage = $('#fxStage'); ctx = cv.getContext('2d');
    resize(); addEventListener('resize', resize);
  }
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? Math.min(ms, 350) : ms));
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- particles ----------
  function loop() {
    if (cv.width !== Math.round(cv.clientWidth * dpr) || cv.height !== Math.round(cv.clientHeight * dpr)) resize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    parts = parts.filter((p) => (p.life -= 1 / 60) > 0);
    for (const p of parts) {
      p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      const a = Math.min(1, p.life / p.fade);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.kind === 'nugget') {
        ctx.fillStyle = p.c; ctx.beginPath();
        ctx.moveTo(-p.s, p.s * .4); ctx.lineTo(-p.s * .3, -p.s * .8); ctx.lineTo(p.s * .7, -p.s * .5); ctx.lineTo(p.s, p.s * .5); ctx.lineTo(0, p.s * .8);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,248,200,.85)'; ctx.fillRect(-p.s * .2, -p.s * .45, p.s * .35, p.s * .2);
      } else if (p.kind === 'rock') {
        ctx.fillStyle = p.c; ctx.beginPath();
        ctx.moveTo(-p.s, 0); ctx.lineTo(-p.s * .4, -p.s); ctx.lineTo(p.s * .8, -p.s * .6); ctx.lineTo(p.s, p.s * .4); ctx.lineTo(-p.s * .2, p.s);
        ctx.closePath(); ctx.fill();
      } else if (p.kind === 'smoke') {
        p.s += .5; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(0, 0, p.s, 0, 7); ctx.fill();
      } else { // dust / spark
        ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(0, 0, p.s, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(loop) : (ctx.setTransform(1, 0, 0, 1, 0, 0), ctx.clearRect(0, 0, cv.width, cv.height), null);
  }
  function emit(n, mk) {
    if (reduce) return;
    for (let i = 0; i < n; i++) parts.push(Object.assign({ vx: 0, vy: 0, g: 0, drag: 1, rot: 0, vr: 0, life: 1, fade: .4, s: 2, c: '#fff', kind: 'dust' }, mk(i)));
    if (!raf) raf = requestAnimationFrame(loop);
  }

  // ---------- helpers ----------
  function queue(fn) {
    init(); pending++;
    chain = chain.then(fn).catch((e) => console.warn(e)).then(() => { pending--; });
    return chain;
  }
  function scene(cls, html) {
    stage.className = 'on ' + cls;
    stage.innerHTML = html;
    return stage;
  }
  async function clear(outMs = 450) {
    stage.classList.add('out');
    await wait(outMs);
    stage.className = ''; stage.innerHTML = '';
  }
  async function playClip(url) {
    scene('clip', `<video src="${url}" autoplay muted playsinline></video>`);
    const v = stage.querySelector('video');
    await new Promise((r) => { v.onended = r; v.onerror = r; setTimeout(r, 8000); });
    await clear(300);
  }
  function shake(el, cls = 'fx-shake') {
    if (!el || reduce) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 700);
  }

  // ---------- cinematics ----------
  function roundIntro(round, total) {
    return queue(async () => {
      if (CINEMATICS.roundIntro) return playClip(CINEMATICS.roundIntro);
      const chars = '落礦'.split('').map((c, i) => `<i style="animation-delay:${.35 + i * .18}s">${c}</i>`).join('');
      scene('intro', `
        <div class="fx-shaft"></div>
        <div class="fx-lamp"></div>
        <div class="fx-intro-text">
          <img class="fx-dwarf" src="art/dwarf-pick.webp" alt="">
          <span class="fx-eyebrow">第 ${round} / ${total} 回合</span>
          <b class="fx-big">${chars}</b>
          <span class="fx-sub">${round === total ? '最後一回合' : '金礦藏喺三張目標牌其中一張'}</span>
        </div>`);
      emit(70, () => ({ x: rnd(0, innerWidth), y: rnd(-innerHeight, 0), vy: rnd(1.5, 4), vx: rnd(-.3, .3), s: rnd(.6, 1.8), c: 'rgba(240,200,140,.6)', life: rnd(1.6, 2.4), fade: .5 }));
      await wait(2100);
      stage.classList.add('iris');
      await wait(650);
      stage.className = ''; stage.innerHTML = '';
    });
  }

  function goldStrike(name) {
    return queue(async () => {
      if (CINEMATICS.goldStrike) return playClip(CINEMATICS.goldStrike);
      scene('gold', `
        <div class="fx-rays"></div>
        <img class="fx-nugget" src="art/dwarf-gold.webp" alt="">
        <div class="fx-stamp">金礦！</div>
        <div class="fx-who">${name} 挖通咗</div>`);
      const cx = innerWidth / 2, cy = innerHeight * .34;
      await wait(380);
      emit(90, () => {
        const a = rnd(0, Math.PI * 2), sp = rnd(4, 12);
        return { kind: 'nugget', x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4, g: .32, drag: .985, s: rnd(4, 9), vr: rnd(-.2, .2), c: ['#f6c93f', '#e9a92a', '#ffd966'][Math.floor(rnd(0, 3))], life: rnd(1.6, 2.4), fade: .5 };
      });
      await wait(2300);
      await clear();
    });
  }

  function sabWin(game) {
    return queue(async () => {
      if (CINEMATICS.sabWin) return playClip(CINEMATICS.sabWin);
      scene('boom', `
        <div class="fx-fuse"><span class="fx-spark"></span></div>
        <img class="fx-tnt" src="art/tnt.webp" alt="">
        <div class="fx-flash"></div>
        <div class="fx-stamp red">坍塌！</div>
        <div class="fx-who">破壞者得逞，冇人挖到金</div>`);
      const sx = innerWidth / 2, sy = innerHeight * .42;
      await wait(1050);
      shake(game, 'fx-quake');
      emit(80, () => {
        const a = rnd(0, Math.PI * 2), sp = rnd(3, 11);
        return { kind: 'rock', x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3, g: .35, drag: .99, s: rnd(3, 9), vr: rnd(-.25, .25), c: ['#5b4636', '#3a2c22', '#7a6450'][Math.floor(rnd(0, 3))], life: rnd(1.4, 2.2), fade: .5 };
      });
      emit(40, () => ({ kind: 'smoke', x: sx + rnd(-60, 60), y: sy + rnd(-30, 30), vx: rnd(-1, 1), vy: rnd(-1.2, -.2), s: rnd(8, 20), c: 'rgba(40,30,25,.16)', life: rnd(1.4, 2), fade: 1 }));
      await wait(1700);
      await clear();
    });
  }

  function coal(px, py) {
    return queue(async () => {
      emit(26, () => ({ kind: 'smoke', x: px + rnd(-14, 14), y: py + rnd(-14, 14), vx: rnd(-.8, .8), vy: rnd(-1.6, -.4), s: rnd(4, 10), c: 'rgba(30,30,32,.55)', life: rnd(.9, 1.4), fade: .8 }));
      floatLabel(px, py, '煤礦', 'coal');
      await wait(900);
    });
  }

  function rockfall(px, py, wrap) {
    return queue(async () => {
      shake(wrap);
      emit(30, () => ({ kind: 'rock', x: px + rnd(-20, 20), y: py - rnd(30, 80), vx: rnd(-1.5, 1.5), vy: rnd(0, 2), g: .45, s: rnd(3, 7), vr: rnd(-.3, .3), c: ['#5b4636', '#3a2c22', '#7a6450'][Math.floor(rnd(0, 3))], life: rnd(.8, 1.2), fade: .3 }));
      emit(14, () => ({ kind: 'smoke', x: px + rnd(-16, 16), y: py + rnd(-10, 10), vx: rnd(-1, 1), vy: rnd(-.6, 0), s: rnd(5, 10), c: 'rgba(160,130,100,.35)', life: rnd(.7, 1), fade: .7 }));
      floatLabel(px, py, '坍方', 'rock');
      await wait(800);
    });
  }

  function floatLabel(px, py, text, cls) {
    init();
    const el = document.createElement('div');
    el.className = 'fx-float ' + cls;
    el.textContent = text;
    el.style.left = px + 'px'; el.style.top = py + 'px';
    document.getElementById('fx').appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  function toolHit(el, good) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    shake(el, good ? 'fx-heal' : 'fx-hit');
    if (good) emit(16, () => ({ x: r.left + r.width / 2 + rnd(-20, 20), y: r.top + r.height / 2, vy: rnd(-2.2, -.8), s: rnd(1.2, 2.4), c: 'rgba(120,230,160,.9)', life: rnd(.6, 1), fade: .4 }));
    else emit(16, () => ({ kind: 'spark', x: r.left + r.width / 2, y: r.top + r.height / 2, vx: rnd(-4, 4), vy: rnd(-4, 2), g: .2, s: rnd(1, 2), c: '#ff7a5c', life: rnd(.4, .7), fade: .3 }));
  }

  function yourTurn() {
    return queue(async () => {
      init();
      const el = document.createElement('div');
      el.className = 'fx-turn';
      el.innerHTML = '<img src="art/pickaxe.webp" alt=""> 輪到你';
      document.getElementById('fx').appendChild(el);
      await wait(1100);
      el.remove();
    });
  }

  window.FX = {
    CINEMATICS, roundIntro, goldStrike, sabWin, coal, rockfall, toolHit, yourTurn,
    get busy() { return pending > 0; },
    after(fn) { init(); chain = chain.then(fn); return chain; },
  };
})();
