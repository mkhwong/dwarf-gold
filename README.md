# 矮人掘金 · Dwarf Gold

Online version of the board game Saboteur (矮人掘金) for 3–10 players, Traditional Chinese UI, phone-first.
Rooms work like the werewolf platform: the host opens a room, shares the 4-letter code (or invite link `?room=CODE`), everyone joins with a name — no accounts.

## Run locally
```bash
npm install
npm start          # http://localhost:3000
npm test           # rule tests + 5-player socket simulation (3 full rounds)
```

## Deploy on Render
Push to GitHub, then on Render: **New → Blueprint** and pick the repo (uses `render.yaml`), or create a Web Service with build `npm install`, start `npm start`.
Free instances sleep when idle; rooms live in memory, so a restart clears open rooms.

## Structure
| File | What it does |
|---|---|
| `server.js` | Express + Socket.io: room codes, join/resume, host controls (kick, start, next round, skip offline player) |
| `game.js` | Authoritative game state: deck, roles, turns, goal reveal, gold sharing, 3 rounds |
| `public/rules.js` | Shared rules (tile shapes, path connectivity, placement validation) — used by both server and browser |
| `public/app.js` | Client: home/lobby/game screens, board rendering (SVG tiles), hand, actions, modals |

## Rules implemented
- Roles per player count: 3p 1 saboteur/3 diggers … 10p 4/7 (one role card always unused, so the saboteur count is never certain).
- Hand size 6 / 5 / 4 for 3–5 / 6–7 / 8–10 players. Deck = 40 path + 27 action cards.
- Start card at (0,0), three face-down goals 8 columns away (1 gold, 2 coal), shuffled each round.
- Path cards must connect to the start through open tunnels and match every neighbour edge; 180° rotation allowed. Goal cards never block placement.
- Broken tool (⛏️🔦🛒) on another player blocks their path placement; repair cards (single or double) fix one tool, including your own.
- Map: privately peek at one goal (stays marked on your board). Rockfall: remove any normal path card.
- Pass = discard one card. After acting you draw while the deck lasts.
- Gold reached → diggers win: draw gold cards equal to player count, best nugget to the finder, then anticlockwise among diggers (auto-picks highest). Deck and hands run out → saboteurs win (1 sab: 4, 2–3: 3 each, 4: 2 each).
- 3 rounds, most gold wins (ties share the win).

## Reconnect
Each browser keeps a private token in localStorage; refreshing or reopening the page rejoins the same seat. If someone drops mid-game the host can skip their turn (auto-discards a random card).
