// Ranking App server — zero dependencies (Node 18+).
// Host screen and phones talk to it over plain HTTP:
//   POST /api/:action   → change state
//   GET  /events        → Server-Sent Events stream of the room state
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_PLAYERS = 10;
const TOKENS = 6;
const MAIN_PER_PLAYER = 3;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const COLORS = ['#FF2E88', '#29E6FF', '#FFD23F', '#3DFF8A', '#FF8A3D', '#A78BFF', '#F4F1FF', '#4D7BFF', '#FF5C5C', '#7DF9C4'];
const PHASES = ['lobby', 'submit', 'reveal', 'vote', 'final', 'results'];

const rooms = new Map();
const id = (n = 8) => crypto.randomBytes(n).toString('hex');

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function makeRoom() {
  const room = {
    code: newCode(), hostKey: id(12), phase: 'lobby', prompt: '', round: 1,
    players: {}, items: {}, order: 0, finalOrder: null, shared: [], touched: Date.now(), clients: new Set()
  };
  rooms.set(room.code, room);
  return room;
}

// ---------- scoring ----------
function itemTotals(room) {
  const t = {};
  for (const iid of Object.keys(room.items)) t[iid] = { total: 0, backers: {} };
  for (const [pid, p] of Object.entries(room.players)) {
    for (const [iid, n] of Object.entries(p.tokens)) {
      if (!t[iid] || n <= 0) continue;
      t[iid].total += n;
      t[iid].backers[pid] = n;
    }
  }
  return t;
}

function cmp(a, b) {
  return b.total - a.total || b.backerCount - a.backerCount || (b.bump || 0) - (a.bump || 0) || a.order - b.order;
}

// Returns { main: [...], hm: [...] } sorted, with honorable-mention promotion applied.
function standings(room) {
  const t = itemTotals(room);
  const list = Object.values(room.items).filter((i) => !i.merged && (i.revealed || room.phase === 'results')).map((i) => ({
    id: i.id, text: i.text, owners: i.owners, hm: i.hm, order: i.order, bump: i.bump || 0,
    total: t[i.id].total, backers: t[i.id].backers, backerCount: Object.keys(t[i.id].backers).length
  }));
  let main = list.filter((i) => !i.hm).sort(cmp);
  let hm = list.filter((i) => i.hm).sort(cmp);
  // Promotion: an HM that outscores the lowest main entry swaps with it.
  let guard = 100;
  while (hm.length && main.length && guard--) {
    const lowMain = main[main.length - 1];
    const topHm = hm[0];
    if (topHm.total > lowMain.total) {
      main = main.slice(0, -1).concat({ ...topHm, promoted: true }).sort(cmp);
      hm = hm.slice(1).concat({ ...lowMain, demoted: true }).sort(cmp);
    } else break;
  }
  // Natural ties: same total and same number of backers as a neighbour.
  const same = (a, b) => a && b && a.total === b.total && a.backerCount === b.backerCount;
  main.forEach((it, i) => { it.tied = same(it, main[i - 1]) || same(it, main[i + 1]); });

  if (room.finalOrder && ['final', 'results'].includes(room.phase)) {
    // Host has locked the order on the Final Selections screen.
    const idx = new Map(room.finalOrder.map((x, i) => [x, i]));
    main.sort((a, b) => (idx.has(a.id) ? idx.get(a.id) : 1e6) - (idx.has(b.id) ? idx.get(b.id) : 1e6) || cmp(a, b));
    main.forEach((it, i) => { it.shared = i > 0 && room.shared.includes(it.id); it.place = it.shared ? main[i - 1].place : i + 1; });
  } else {
    main.forEach((it, i) => {
      const prev = main[i - 1];
      it.place = prev && same(prev, it) && (prev.bump || 0) === (it.bump || 0) ? prev.place : i + 1;
    });
  }
  return { main, hm };
}

// ---------- public views ----------
function publicPlayers(room) {
  return Object.values(room.players).sort((a, b) => a.joined - b.joined).map((p) => ({
    id: p.id, name: p.name, color: p.color, connected: p.connected, bot: !!p.bot, done: !!p.done,
    used: Object.values(p.tokens).reduce((s, n) => s + n, 0),
    itemCount: Object.values(room.items).filter((i) => i.submitter === p.id).length,
    revealedCount: Object.values(room.items).filter((i) => i.submitter === p.id && i.revealed).length
  }));
}

function hostView(room) {
  const items = Object.values(room.items).sort((a, b) => a.order - b.order).map((i) => ({
    id: i.id, owners: i.owners, submitter: i.submitter, hm: i.hm, revealed: i.revealed, merged: !!i.merged,
    text: i.revealed ? i.text : null
  }));
  return {
    role: 'host', code: room.code, phase: room.phase, prompt: room.prompt, round: room.round,
    players: publicPlayers(room), items, standings: standings(room), colors: COLORS, tokens: TOKENS
  };
}

function playerView(room, pid) {
  const me = room.players[pid];
  const items = Object.values(room.items).sort((a, b) => a.order - b.order).map((i) => ({
    id: i.id, owners: i.owners, hm: i.hm, revealed: i.revealed, merged: !!i.merged, mine: i.submitter === pid || i.owners.includes(pid),
    text: i.revealed || i.submitter === pid ? i.text : null
  }));
  return {
    role: 'player', code: room.code, phase: room.phase, prompt: room.prompt, round: room.round,
    me: me ? { id: me.id, name: me.name, color: me.color, tokens: me.tokens, done: !!me.done } : null,
    players: publicPlayers(room), items, standings: standings(room), colors: COLORS, tokens: TOKENS
  };
}

function broadcast(room) {
  room.touched = Date.now();
  for (const c of room.clients) {
    const view = c.role === 'host' ? hostView(room) : playerView(room, c.pid);
    c.res.write(`data: ${JSON.stringify(view)}\n\n`);
  }
}

// ---------- actions ----------
class Fail extends Error {}
const need = (cond, msg) => { if (!cond) throw new Fail(msg); };
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function getRoom(code) {
  const room = rooms.get(String(code || '').toUpperCase());
  need(room, 'Room not found');
  return room;
}
function asHost(b) { const r = getRoom(b.code); need(b.hostKey === r.hostKey, 'Not the host'); return r; }
function asPlayer(b) { const r = getRoom(b.code); const p = r.players[b.pid]; need(p, 'Not in this room'); return [r, p]; }

function addItem(room, p, text) {
  const mine = Object.values(room.items).filter((i) => i.submitter === p.id).length;
  const iid = id(6);
  room.items[iid] = { id: iid, text, submitter: p.id, owners: [p.id], hm: mine >= MAIN_PER_PLAYER, revealed: false, order: room.order++ };
}

const actions = {
  create() {
    const room = makeRoom();
    return { code: room.code, hostKey: room.hostKey };
  },

  hostCheck(b) { asHost(b); return {}; },

  peek(b) {
    const r = getRoom(b.code);
    return { colors: COLORS, taken: Object.values(r.players).map((p) => p.color), count: Object.keys(r.players).length, max: MAX_PLAYERS };
  },

  join(b) {
    const room = getRoom(b.code);
    const name = clean(b.name, 12).toUpperCase();
    need(name, 'Enter a name');
    // Rejoin: same device id, or same name (restores everything).
    let p = b.pid && room.players[b.pid];
    if (!p) p = Object.values(room.players).find((x) => x.name === name);
    if (p) { p.name = name; if (b.color && b.color !== p.color && !Object.values(room.players).some((x) => x.color === b.color)) p.color = b.color; broadcast(room); return { pid: p.id }; }
    need(Object.keys(room.players).length < MAX_PLAYERS, 'Room is full (10 players)');
    const taken = Object.values(room.players).map((x) => x.color);
    need(COLORS.includes(b.color), 'Pick a color');
    need(!taken.includes(b.color), 'That color is taken');
    const pid = id(8);
    room.players[pid] = { id: pid, name, color: b.color, tokens: {}, connected: false, joined: Date.now() };
    broadcast(room);
    return { pid };
  },

  setPrompt(b) { const r = asHost(b); r.prompt = clean(b.prompt, 80); broadcast(r); return {}; },

  phase(b) {
    const r = asHost(b);
    need(PHASES.includes(b.phase), 'Bad phase');
    if (b.phase === 'submit') need(r.prompt, 'Set a prompt first');
    if (b.phase === 'final' && r.phase !== 'results') {
      r.phase = 'vote';
      r.finalOrder = standings(r).main.map((i) => i.id);
      // ties start as shared places; the host splits them on the Final Selections screen
      r.shared = standings(r).main.filter((it, i, a) => i > 0 && a[i - 1].total === it.total && a[i - 1].backerCount === it.backerCount).map((i) => i.id);
    }
    r.phase = b.phase;
    broadcast(r);
    return {};
  },

  submit(b) {
    const [r, p] = asPlayer(b);
    need(['lobby', 'submit', 'reveal'].includes(r.phase), 'Submissions are closed');
    need(!p.done, 'You marked yourself done — tap DONE to reopen');
    const text = clean(b.text, 48);
    need(text, 'Type something');
    need(Object.values(r.items).filter((i) => i.submitter === p.id).length < 12, 'That is plenty of entries');
    addItem(r, p, text);
    broadcast(r);
    return {};
  },

  editMine(b) {
    const [r, p] = asPlayer(b);
    const it = r.items[b.item];
    need(it && it.submitter === p.id && !it.revealed, 'Cannot edit that');
    need(!p.done, 'You marked yourself done — tap DONE to reopen');
    if (b.remove) { delete r.items[it.id]; renumberHm(r, p.id); }
    else { const t = clean(b.text, 48); need(t, 'Type something'); it.text = t; }
    broadcast(r);
    return {};
  },

  setDone(b) {
    const [r, p] = asPlayer(b);
    p.done = !!b.done;
    broadcast(r);
    return {};
  },

  flip(b) {
    const [r, p] = asPlayer(b);
    need(r.phase === 'reveal', 'The host has not opened the reveal yet');
    const it = r.items[b.item];
    need(it && it.submitter === p.id, 'Not your card');
    it.revealed = true;
    broadcast(r);
    return {};
  },

  token(b) {
    const [r, p] = asPlayer(b);
    need(r.phase === 'vote', 'Voting is not open');
    const it = r.items[b.item];
    need(it && it.revealed && !it.merged, 'Unknown item');
    const d = b.delta > 0 ? 1 : -1;
    const used = Object.values(p.tokens).reduce((s, n) => s + n, 0);
    const cur = p.tokens[it.id] || 0;
    if (d > 0) need(used < TOKENS, 'No tokens left');
    else need(cur > 0, 'No token there');
    p.tokens[it.id] = cur + d;
    if (!p.tokens[it.id]) delete p.tokens[it.id];
    broadcast(r);
    return {};
  },

  // ----- host controls -----
  flipAll(b) { const r = asHost(b); Object.values(r.items).forEach((i) => { i.revealed = true; }); broadcast(r); return {}; },

  merge(b) {
    // items[0] = the card dropped onto (kept); the rest fold into it and leave an empty slot behind.
    const r = asHost(b);
    const ids = (b.items || []).filter((x) => r.items[x] && !r.items[x].merged);
    need(ids.length >= 2, 'Pick two or more items');
    const keep = r.items[ids[0]];
    const label = clean(b.text, 48);
    if (label) keep.text = label;
    for (const other of ids.slice(1).map((x) => r.items[x])) {
      for (const o of other.owners) if (!keep.owners.includes(o)) keep.owners.push(o);
      keep.revealed = keep.revealed || other.revealed;
      keep.hm = keep.hm && other.hm;
      for (const p of Object.values(r.players)) {
        if (p.tokens[other.id]) { p.tokens[keep.id] = (p.tokens[keep.id] || 0) + p.tokens[other.id]; delete p.tokens[other.id]; }
      }
      // mark earlier merges into `other` as now pointing at keep
      for (const m of Object.values(r.items)) if (m.merged === other.id) m.merged = keep.id;
      other.merged = keep.id;
      other.revealed = true;
    }
    broadcast(r);
    return {};
  },

  removeItem(b) {
    const r = asHost(b);
    const it = r.items[b.item];
    need(it, 'Unknown item');
    for (const p of Object.values(r.players)) delete p.tokens[it.id];
    delete r.items[it.id];
    renumberHm(r, it.submitter);
    broadcast(r);
    return {};
  },

  editItem(b) {
    const r = asHost(b);
    const it = r.items[b.item];
    need(it, 'Unknown item');
    const t = clean(b.text, 48); need(t, 'Type something');
    it.text = t;
    broadcast(r);
    return {};
  },

  kick(b) {
    const r = asHost(b);
    need(r.players[b.pid], 'Unknown player');
    removePlayer(r, b.pid, 'kicked');
    broadcast(r);
    return {};
  },

  leave(b) {
    const [r, p] = asPlayer(b);
    removePlayer(r, p.id, 'left');
    broadcast(r);
    return {};
  },

  endRoom(b) {
    const r = asHost(b);
    for (const c of r.clients) { c.res.write('event: ended\ndata: {}\n\n'); c.res.end(); }
    r.clients.clear();
    rooms.delete(r.code);
    return {};
  },

  // ----- debug: bots -----
  addBots(b) {
    const r = asHost(b);
    const n = Math.max(1, Math.min(Number(b.count) || 1, MAX_PLAYERS));
    let added = 0;
    for (let i = 0; i < n && Object.keys(r.players).length < MAX_PLAYERS; i++) {
      const taken = Object.values(r.players).map((x) => x.color);
      const color = COLORS.find((c) => !taken.includes(c));
      const names = Object.values(r.players).map((x) => x.name);
      const name = BOT_NAMES.find((x) => !names.includes(x)) || 'BOT' + crypto.randomInt(100);
      const pid = id(8);
      r.players[pid] = { id: pid, name, color, tokens: {}, connected: true, bot: true, joined: Date.now(), target: 3 + (Math.random() < 0.35 ? 1 : 0) };
      added++;
    }
    need(added, 'Room is full (10 players)');
    broadcast(r);
    return { added };
  },

  removeBots(b) {
    const r = asHost(b);
    for (const p of Object.values(r.players)) if (p.bot) removePlayer(r, p.id, 'kicked');
    broadcast(r);
    return {};
  },

  setOrder(b) {
    const r = asHost(b);
    need(r.phase === 'final', 'Only on the final selections screen');
    const ids = (b.order || []).filter((x) => r.items[x] && !r.items[x].merged);
    const rest = (r.finalOrder || []).filter((x) => !ids.includes(x));
    r.finalOrder = ids.concat(rest);
    broadcast(r);
    return {};
  },

  toggleShare(b) {
    const r = asHost(b);
    need(r.phase === 'final', 'Only on the final selections screen');
    r.shared = r.shared || [];
    r.shared = r.shared.includes(b.item) ? r.shared.filter((x) => x !== b.item) : r.shared.concat(b.item);
    broadcast(r);
    return {};
  },

  bump(b) {
    // Host tie-break: lift an item above the items it is tied with.
    const r = asHost(b);
    const it = r.items[b.item];
    need(it, 'Unknown item');
    it.bump = (it.bump || 0) + 1;
    broadcast(r);
    return {};
  },

  playAgain(b) {
    const r = asHost(b);
    r.items = {};
    r.order = 0;
    r.round += 1;
    r.finalOrder = null;
    r.shared = [];
    r.prompt = clean(b.prompt, 80);
    for (const p of Object.values(r.players)) { p.tokens = {}; p.done = false; }
    r.phase = r.prompt ? 'submit' : 'lobby';
    broadcast(r);
    return {};
  }
};

function removePlayer(r, pid, why) {
  for (const it of Object.values(r.items)) {
    it.owners = it.owners.filter((o) => o !== pid);
    if (!it.owners.length) { for (const q of Object.values(r.players)) delete q.tokens[it.id]; delete r.items[it.id]; }
    else if (it.submitter === pid) it.submitter = it.owners[0];
  }
  delete r.players[pid];
  for (const c of [...r.clients]) if (c.pid === pid) { c.res.write(`event: ${why}\ndata: {}\n\n`); c.res.end(); r.clients.delete(c); }
}

function renumberHm(room, pid) {
  Object.values(room.items).filter((i) => i.submitter === pid).sort((a, b) => a.order - b.order)
    .forEach((i, n) => { i.hm = n >= MAIN_PER_PLAYER; });
}

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/host.html';
  if (pathname === '/play' || pathname === '/join') pathname = '/play.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/events') {
    let room;
    try { room = getRoom(url.searchParams.get('code')); } catch { res.writeHead(404); return res.end(); }
    const hostKey = url.searchParams.get('hostKey');
    const pid = url.searchParams.get('pid');
    const role = hostKey && hostKey === room.hostKey ? 'host' : 'player';
    if (role === 'player' && !room.players[pid]) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const client = { res, role, pid };
    room.clients.add(client);
    if (role === 'player') room.players[pid].connected = true;
    broadcast(room);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      room.clients.delete(client);
      if (role === 'player' && room.players[pid]) {
        room.players[pid].connected = [...room.clients].some((c) => c.pid === pid);
        broadcast(room);
      }
    });
    return;
  }

  if (url.pathname.startsWith('/api/') && req.method === 'POST') {
    const name = url.pathname.slice(5);
    const fn = Object.prototype.hasOwnProperty.call(actions, name) && actions[name];
    const body = await readBody(req);
    res.setHeader('Content-Type', 'application/json');
    if (!fn) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Unknown action' })); }
    try { res.end(JSON.stringify({ ok: true, ...fn(body) })); }
    catch (e) {
      res.writeHead(e instanceof Fail ? 400 : 500);
      res.end(JSON.stringify({ error: e instanceof Fail ? e.message : 'Server error' }));
      if (!(e instanceof Fail)) console.error(e);
    }
    return;
  }

  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  res.writeHead(405); res.end();
});

// ---------- bots (debug mode) ----------
const BOT_NAMES = ['BIT', 'BYTE', 'PIXEL', 'CHIP', 'ZAP', 'BLIP', 'GLITCH', 'SPRITE', 'TURBO', 'COMBO'];
const BOT_IDEAS = ['Pac-Man', 'Galaga', 'Street Fighter II', 'Mortal Kombat', 'NBA Jam', 'Metal Slug', 'Time Crisis', 'Daytona USA',
  'Tekken 3', 'Crazy Taxi', 'Killer Instinct', 'Area 51', 'X-Men', 'TMNT', 'Marvel vs Capcom', 'Puzzle Bobble', 'Rampage', 'Gauntlet',
  'Dance Dance Revolution', 'Cruising USA', 'Simpsons Arcade', 'Final Fight', 'Golden Axe', 'Raiden', 'Bubble Bobble', 'Frogger'];
const pick = (a) => a[crypto.randomInt(a.length)];
const chance = (p) => Math.random() < p;

function botTick(r) {
  const bots = Object.values(r.players).filter((p) => p.bot);
  if (!bots.length) return;
  let changed = false;
  for (const p of bots) {
    const mine = Object.values(r.items).filter((i) => i.submitter === p.id);
    if (['submit', 'reveal'].includes(r.phase) && mine.length < p.target && chance(0.35)) {
      addItem(r, p, pick(BOT_IDEAS)); changed = true;
      if (mine.length + 1 >= p.target) p.done = true;
    } else if (r.phase === 'reveal' && chance(0.3)) {
      const down = mine.find((i) => !i.revealed);
      if (down) { down.revealed = true; changed = true; }
    } else if (r.phase === 'vote') {
      const pool = Object.values(r.items).filter((i) => i.revealed && !i.merged);
      if (!pool.length) continue;
      const used = Object.values(p.tokens).reduce((s, n) => s + n, 0);
      if (used < TOKENS && chance(0.3)) {
        const it = pick(pool); p.tokens[it.id] = (p.tokens[it.id] || 0) + 1; changed = true;
      } else if (used && chance(0.06)) {
        const from = pick(Object.keys(p.tokens)); const to = pick(pool);
        if (from !== to.id) { if (!--p.tokens[from]) delete p.tokens[from]; p.tokens[to.id] = (p.tokens[to.id] || 0) + 1; changed = true; }
      }
    }
  }
  if (changed) broadcast(r);
}
setInterval(() => { for (const r of rooms.values()) botTick(r); }, 900);

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (!r.clients.size && now - r.touched > ROOM_TTL_MS) rooms.delete(code);
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`Ranking app on http://localhost:${PORT}  (host screen)  ·  phones: /play`));
