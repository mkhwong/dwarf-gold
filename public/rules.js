// 矮人掘金 — shared rules (runs on server and in the browser)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SabRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIRS = ['N', 'E', 'S', 'W'];
  const DELTA = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const key = (x, y) => x + ',' + y;

  // Each shape = list of groups; edges inside one group are connected through the card.
  // A group with a single edge is a dead-end stub.
  const SHAPES = {
    start: [['N', 'E', 'S', 'W']],
    gold: [['N', 'E', 'S', 'W']],
    coal1: [['N', 'W']],
    coal2: [['N', 'E']],
    cross: [['N', 'E', 'S', 'W']],
    tV: [['N', 'E', 'S']],
    tH: [['E', 'S', 'W']],
    ns: [['N', 'S']],
    ew: [['E', 'W']],
    se: [['S', 'E']],
    sw: [['S', 'W']],
    xNS: [['N'], ['S']],
    xEW: [['E'], ['W']],
    xCross: [['N'], ['E'], ['S'], ['W']],
    xTV: [['N'], ['E'], ['S']],
    xTH: [['E'], ['S'], ['W']],
    xSE: [['S'], ['E']],
    xSW: [['S'], ['W']],
    xN: [['N']],
    xE: [['E']],
  };

  // 40 path cards (31 connected + 9 dead ends)
  const PATH_COUNTS = {
    cross: 5, tV: 5, tH: 5, ns: 4, ew: 3, se: 4, sw: 5,
    xNS: 1, xEW: 1, xCross: 1, xTV: 1, xTH: 1, xSE: 1, xSW: 1, xN: 1, xE: 1,
  };

  const TOOLS = ['pick', 'lamp', 'cart'];
  const TOOL_NAME = { pick: '礦鎬', lamp: '礦燈', cart: '礦車' };
  const TOOL_ICON = { pick: '⛏️', lamp: '🔦', cart: '🛒' };
  const GOAL_POS = [[8, -2], [8, 0], [8, 2]];
  const GOAL_LABEL = ['上', '中', '下'];

  // players -> [saboteurs, gold diggers] in the role pool (one card left unused)
  const ROLE_TABLE = {
    3: [1, 3], 4: [1, 4], 5: [2, 4], 6: [2, 5], 7: [3, 5], 8: [3, 6], 9: [3, 7], 10: [4, 7],
  };
  const handSize = (n) => (n <= 5 ? 6 : n <= 7 ? 5 : 4);

  function groupsFor(shape, flipped) {
    const g = SHAPES[shape] || [];
    return flipped ? g.map((gr) => gr.map((d) => OPP[d])) : g;
  }
  function cellGroups(cell) {
    if (!cell || cell.hidden) return null;
    return groupsFor(cell.kind === 'goal' ? cell.goal : cell.shape, cell.flipped);
  }
  function openEdges(groups) {
    const s = new Set();
    groups.forEach((g) => g.forEach((d) => s.add(d)));
    return s;
  }

  // Flood fill from the start card through connected tunnel groups.
  function computeReach(board) {
    const reached = new Set();
    const touchedGoals = {};
    const start = Object.values(board).find((c) => c.kind === 'start');
    if (!start) return { reached, touchedGoals };
    const queue = [[start.x, start.y, 0]];
    reached.add(key(start.x, start.y) + '#0');
    while (queue.length) {
      const [x, y, gi] = queue.shift();
      const groups = cellGroups(board[key(x, y)]);
      for (const d of groups[gi]) {
        const nx = x + DELTA[d][0], ny = y + DELTA[d][1];
        const nk = key(nx, ny);
        const n = board[nk];
        if (!n) continue;
        if (n.hidden) {
          (touchedGoals[nk] = touchedGoals[nk] || new Set()).add(OPP[d]);
          continue;
        }
        const ngi = cellGroups(n).findIndex((gr) => gr.includes(OPP[d]));
        if (ngi < 0) continue;
        const rk = nk + '#' + ngi;
        if (!reached.has(rk)) { reached.add(rk); queue.push([nx, ny, ngi]); }
      }
    }
    return { reached, touchedGoals };
  }

  // Goal cards (hidden or revealed) never block placement; other neighbours must match edges.
  function canPlacePath(board, shape, flipped, x, y, reach) {
    if (board[key(x, y)]) return false;
    reach = reach || computeReach(board);
    const open = openEdges(groupsFor(shape, flipped));
    let hasNeighbor = false, connects = false;
    for (const d of DIRS) {
      const nk = key(x + DELTA[d][0], y + DELTA[d][1]);
      const n = board[nk];
      if (!n) continue;
      hasNeighbor = true;
      if (n.hidden) continue;
      const ng = cellGroups(n);
      const nOpen = openEdges(ng).has(OPP[d]);
      if (n.kind !== 'goal' && open.has(d) !== nOpen) return false;
      if (open.has(d) && nOpen) {
        const ngi = ng.findIndex((gr) => gr.includes(OPP[d]));
        if (reach.reached.has(nk + '#' + ngi)) connects = true;
      }
    }
    return hasNeighbor && connects;
  }

  function bounds(board) {
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    Object.values(board).forEach((c) => {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    });
    return { minX, maxX, minY, maxY };
  }

  function validPlacements(board, shape, flipped) {
    const reach = computeReach(board);
    const b = bounds(board);
    const out = [];
    for (let y = b.minY - 1; y <= b.maxY + 1; y++)
      for (let x = b.minX - 1; x <= b.maxX + 1; x++)
        if (canPlacePath(board, shape, flipped, x, y, reach)) out.push([x, y]);
    return out;
  }

  return {
    DIRS, DELTA, OPP, key, SHAPES, PATH_COUNTS, TOOLS, TOOL_NAME, TOOL_ICON,
    GOAL_POS, GOAL_LABEL, ROLE_TABLE, handSize,
    groupsFor, cellGroups, openEdges, computeReach, canPlacePath, validPlacements, bounds,
  };
});
