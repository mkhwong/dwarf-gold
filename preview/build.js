// Builds a single-file, server-less preview (AI players) for reviewing inside Claude.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('public/index.html');
const body = html.split('<body>')[1].split('<script')[0];
let game = read('game.js')
  .replace("const R = require('./public/rules.js');", 'const R = window.SabRules;')
  .replace(/module\.exports = \{([^}]*)\};/, 'window.DGGame = {$1};');
game = `(function(){\n${game}\n})();`;

const overrides = `
:root { color-scheme: dark; }
html, body { height: 100%; }
body { background: var(--bg); }
.screen { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.game { height: 100%; padding-block: 0; }
.topbar { padding: 10px 0 6px; }
.seats { padding: 2px 0 6px; margin: 0 -2px; }
.board-wrap { margin: 0; }
.log { margin: 6px 0 0; }
.action-bar { padding: 6px 0 0; }
.hand { padding: 10px 0 12px; }
.preview-note { text-align: center; color: var(--muted); font-size: 12px; margin-top: 18px; line-height: 1.6; }
`;
const note = `<p class="preview-note">預覽版：喺 Claude 入面試玩，AI 玩家代替朋友。<br>真人多人連線用 Render 伺服器版本。</p>`;
const bodyOut = body.replace('<details class="rules">', note + '\n  <details class="rules">');

const out = `<title>矮人掘金</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700;900&family=Noto+Serif+TC:wght@900&display=swap" rel="stylesheet">
<style>
${read('public/style.css')}
${overrides}
</style>
${bodyOut}
<script>
${read('public/rules.js')}
</script>
<script>
${game}
</script>
<script>
${read('preview/local-server.js')}
</script>
<script>
${read('public/fx.js')}
</script>
<script>
${read('public/app.js')}
</script>
`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'dwarf-gold.html'), out);
console.log('built', (out.length / 1024).toFixed(1) + ' KB');
