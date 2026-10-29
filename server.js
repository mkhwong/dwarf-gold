// 矮人掘金 — room-code multiplayer server
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Game, GameError } = require('./game');
const R = require('./public/rules.js');

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 3;
const ROOM_TTL_MS = 30 * 60 * 1000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new Map(); // code -> room

function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const newId = () => crypto.randomBytes(6).toString('hex');
const cleanName = (s) => String(s || '').trim().slice(0, 12);

function phaseOf(room) { return room.game ? room.game.phase : 'lobby'; }

function stateFor(room, pid) {
  return {
    code: room.code,
    hostId: room.hostId,
    me: pid,
    phase: phaseOf(room),
    settings: room.settings,
    players: room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    game: room.game ? room.game.view(pid) : null,
  };
}
function broadcast(room) {
  room.lastActive = Date.now();
  for (const p of room.players)
    if (p.socketId) io.to(p.socketId).emit('state', stateFor(room, p.id));
}
function attach(socket, room, player) {
  if (player.socketId && player.socketId !== socket.id) {
    const old = io.sockets.sockets.get(player.socketId);
    if (old) { old.data = {}; old.emit('kicked', '你喺另一個裝置登入咗'); }
  }
  player.socketId = socket.id;
  player.connected = true;
  socket.data = { code: room.code, pid: player.id };
}
function ctx(socket) {
  const { code, pid } = socket.data || {};
  const room = code && rooms.get(code);
  const player = room && room.players.find((p) => p.id === pid);
  if (!room || !player) throw new GameError('你唔喺任何房間');
  return { room, player };
}
function requireHost(room, player) {
  if (room.hostId !== player.id) throw new GameError('只有房主可以咁做');
}
function removePlayer(room, player) {
  room.players = room.players.filter((p) => p !== player);
  if (!room.players.length) { rooms.delete(room.code); return; }
  if (room.hostId === player.id) room.hostId = (room.players.find((p) => p.connected) || room.players[0]).id;
}

io.on('connection', (socket) => {
  const on = (ev, fn) => socket.on(ev, (data = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try { reply({ ok: true, ...(fn(data) || {}) }); }
    catch (e) {
      if (!(e instanceof GameError)) console.error(ev, e);
      reply({ ok: false, error: e instanceof GameError ? e.message : '伺服器錯誤' });
    }
  });

  on('create', ({ name, token }) => {
    name = cleanName(name);
    if (!name) throw new GameError('請輸入名稱');
    const room = { code: genCode(), hostId: null, players: [], game: null, settings: { twoSided: false }, lastActive: Date.now() };
    const player = { id: newId(), token: String(token || newId()), name, connected: true, socketId: null };
    room.players.push(player);
    room.hostId = player.id;
    rooms.set(room.code, room);
    attach(socket, room, player);
    broadcast(room);
    return { code: room.code };
  });

  on('join', ({ code, name, token }) => {
    code = String(code || '').trim().toUpperCase();
    name = cleanName(name);
    const room = rooms.get(code);
    if (!room) throw new GameError('搵唔到呢個房間');
    let player = room.players.find((p) => p.token === String(token));
    if (!player) {
      if (!name) throw new GameError('請輸入名稱');
      if (room.game) throw new GameError('遊戲已經開始咗');
      const max = R.MAX_PLAYERS(room.settings.twoSided);
      if (room.players.length >= max) throw new GameError(`房間已滿（最多 ${max} 人）`);
      if (room.players.some((p) => p.name === name)) throw new GameError('呢個名已經有人用');
      player = { id: newId(), token: String(token || newId()), name, connected: true, socketId: null };
      room.players.push(player);
    }
    attach(socket, room, player);
    broadcast(room);
    return { code };
  });

  on('resume', ({ code, token }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const player = room && room.players.find((p) => p.token === String(token));
    if (!player) throw new GameError('房間已經唔存在');
    attach(socket, room, player);
    broadcast(room);
    return { code: room.code };
  });

  on('leave', () => {
    const { room, player } = ctx(socket);
    socket.data = {};
    if (!room.game || room.game.phase === 'gameEnd') removePlayer(room, player);
    else { player.connected = false; player.socketId = null; player.token = newId(); }
    if (rooms.has(room.code)) broadcast(room);
  });

  on('kick', ({ pid }) => {
    const { room, player } = ctx(socket);
    requireHost(room, player);
    if (room.game) throw new GameError('遊戲進行中唔可以踢人');
    const target = room.players.find((p) => p.id === pid);
    if (!target || target === player) throw new GameError('搵唔到玩家');
    if (target.socketId) {
      const s = io.sockets.sockets.get(target.socketId);
      if (s) { s.data = {}; s.emit('kicked', '你已被房主移出房間'); }
    }
    removePlayer(room, target);
    broadcast(room);
  });

  on('settings', ({ twoSided }) => {
    const { room, player } = ctx(socket);
    requireHost(room, player);
    if (room.game && room.game.phase !== 'gameEnd') throw new GameError('遊戲進行中唔可以改設定');
    if (!twoSided && room.players.length > R.MAX_PLAYERS(false)) throw new GameError('超過 10 人要用雙邊模式');
    room.settings.twoSided = !!twoSided;
    broadcast(room);
  });

  on('start', () => {
    const { room, player } = ctx(socket);
    requireHost(room, player);
    if (room.game && room.game.phase !== 'gameEnd') throw new GameError('遊戲已經開始');
    // drop anyone who left during a finished game
    room.players = room.players.filter((p) => p.connected || !room.game);
    if (room.players.length < MIN_PLAYERS) throw new GameError(`最少要 ${MIN_PLAYERS} 個玩家`);
    if (room.players.length > R.MAX_PLAYERS(room.settings.twoSided)) throw new GameError('超過 10 人要開雙邊模式');
    room.game = new Game(room.players.map((p) => ({ id: p.id, name: p.name })), { twoSided: room.settings.twoSided });
    broadcast(room);
  });

  on('next_round', () => {
    const { room, player } = ctx(socket);
    requireHost(room, player);
    if (!room.game) throw new GameError('遊戲未開始');
    room.game.nextRound();
    broadcast(room);
  });

  on('to_lobby', () => {
    const { room, player } = ctx(socket);
    requireHost(room, player);
    if (!room.game || room.game.phase !== 'gameEnd') throw new GameError('遊戲未完');
    room.game = null;
    room.players = room.players.filter((p) => p.connected);
    broadcast(room);
  });

  on('play', (a) => {
    const { room, player } = ctx(socket);
    const g = room.game;
    if (!g) throw new GameError('遊戲未開始');
    let extra;
    switch (a.kind) {
      case 'path': g.playPath(player.id, a.cardId, a.x, a.y, a.flipped); break;
      case 'tool': g.playTool(player.id, a.cardId, a.target, a.tool); break;
      case 'rockfall': g.playRockfall(player.id, a.cardId, a.x, a.y); break;
      case 'map': extra = g.playMap(player.id, a.cardId, a.goalIdx); break;
      case 'discard': g.discard(player.id, a.cardId); break;
      default: throw new GameError('未知動作');
    }
    broadcast(room);
    return extra ? { peek: extra } : {};
  });

  on('skip', () => {
    const { room, player } = ctx(socket);
    requireHost(room, player);
    if (!room.game) throw new GameError('遊戲未開始');
    const cur = room.players.find((p) => p.id === room.game.current());
    if (cur && cur.connected) throw new GameError('呢位玩家仲在線');
    room.game.forceSkip();
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const { code, pid } = socket.data || {};
    const room = code && rooms.get(code);
    const player = room && room.players.find((p) => p.id === pid);
    if (!player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    if (!room.game) {
      // in the lobby, give them a minute to come back before freeing the seat
      setTimeout(() => {
        if (!player.connected && !room.game && rooms.get(room.code) === room) {
          removePlayer(room, player);
          if (rooms.has(room.code)) broadcast(room);
        }
      }, 60 * 1000);
    }
    broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms)
    if (!room.players.some((p) => p.connected) && now - room.lastActive > ROOM_TTL_MS) rooms.delete(code);
}, 60 * 1000).unref();

if (require.main === module) server.listen(PORT, () => console.log(`矮人掘金 running on :${PORT}`));
module.exports = { server, rooms };
