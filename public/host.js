// Host screen — the one that gets shared on the call.
'use strict';

const stage = $('#stage');
let S = null;            // latest room state
let auth = null;         // { code, hostKey }
let selected = new Set(); // selected item ids (reveal phase: merge / remove / edit)
let seenPromo = new Set();
let seenFlip = null; // ids of cards already shown face-up (only new ones animate)
let scale = 1;

function fit() {
  scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  stage.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', fit);
fit();

const host = (action, extra = {}) => api(action, { code: auth.code, hostKey: auth.hostKey, ...extra });

async function start() {
  const saved = JSON.parse(localStorage.getItem('top3-host') || 'null');
  if (saved) {
    try { await api('hostCheck', saved); auth = saved; } catch { auth = null; }
  }
  if (!auth) {
    const r = await api('create', {});
    auth = { code: r.code, hostKey: r.hostKey };
    localStorage.setItem('top3-host', JSON.stringify(auth));
  }
  connect({ code: auth.code, hostKey: auth.hostKey }, (st) => { sounds(S, st); S = st; render(); renderSettings(); }, () => {
    localStorage.removeItem('top3-host');
    location.reload();
  });
}

const joinUrl = () => `${location.origin}/play?code=${auth.code}`;
const playerById = (id) => S.players.find((p) => p.id === id);
const colorOf = (id) => (playerById(id) || {}).color || '#555';

function header(title) {
  const pills = ['submit', 'reveal', 'vote', 'final', 'results'].map((ph) =>
    `<button class="${S.phase === ph ? 'on' : ''}" data-phase="${ph}" style="all:unset"><span class="${S.phase === ph ? 'on' : ''}">${PHASE_LABEL[ph]}</span></button>`).join('');
  return `<div class="top">
    <div class="prompt-line"><span class="label">${title || 'PROMPT'}</span><span class="p">${esc(S.prompt)}</span></div>
    <div class="phases">${pills}</div>
  </div>`;
}

// ---------------- LOBBY ----------------
function lobby() {
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(joinUrl())}`;
  return `
  <div class="top">
    <div class="logo" style="font-size:22px">TOP<span>//</span>3</div>
    <div style="display:flex;align-items:center;gap:16px"><span style="color:var(--cyan)">LOBBY · ROUND ${S.round}</span><button class="btn ghost" id="endSession">END SESSION</button></div>
  </div>
  <div class="lobby">
    <div class="joinbox">
      <div class="label" style="letter-spacing:3px">INSERT PLAYERS</div>
      <a class="qrbtn" href="${esc(joinUrl())}" target="_blank" rel="noopener" title="Open the player view in a new window"><img src="${qr}" alt="QR code to join. Click to open the player view in a new window"><span>OPEN PLAYER VIEW ↗</span></a>
      <div style="font-size:28px">${esc(location.host)}/play</div>
      <div class="code">${auth.code.split('').map((c) => `<b>${c}</b>`).join('')}</div>
    </div>
    <div class="side">
      <div style="display:flex;flex-direction:column;gap:10px">
        <label class="label" for="prompt">TONIGHT'S PROMPT</label>
        <input id="prompt" class="field" maxlength="80" placeholder="Best 90s arcade game" value="${esc(S.prompt)}">
      </div>
      <div id="slots">${slotsHtml()}</div>
      <button class="btn" id="go" style="margin-top:auto;font-size:18px;padding:22px;box-shadow:6px 6px 0 var(--blue)">PRESS START ▸</button>
    </div>
  </div>`;
}

function slotsHtml() {
  const slots = [];
  for (let i = 0; i < 10; i++) {
    const p = S.players[i];
    slots.push(p
      ? `<div class="slot ${p.connected ? '' : 'off'}"><i class="sw" style="background:${p.color}"></i><span class="n">${esc(p.name)}</span><span class="muted" style="font-size:20px">${p.bot ? 'BOT' : p.connected ? 'READY' : 'AWAY'}</span><button class="x" data-kick="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button></div>`
      : '<div class="slot open"><i class="sw" style="background:#2A2550"></i><span class="n">OPEN</span></div>');
  }
  return `<div style="display:flex;justify-content:space-between;margin-bottom:10px" class="px"><span class="label">PLAYERS</span><span style="font-size:12px;color:var(--yellow)">${S.players.length} / 10</span></div>
    <div class="slots">${slots.join('')}</div>`;
}

// ---------------- WALL (submit + reveal) ----------------
function wall() {
  const cols = S.players.map((p) => {
    const mine = S.items.filter((i) => i.submitter === p.id);
    const main = mine.filter((i) => !i.hm);
    const hm = mine.filter((i) => i.hm);
    const card = (it, extra = '') => {
      if (!it) return `<div class="card down" style="border-color:${p.color};color:${p.color};opacity:.35${extra}">·</div>`;
      if (it.merged) return `<div class="card empty ${it.hm ? 'hm' : ''}" style="border-color:${p.color}"><span>MERGED</span></div>`;
      if (!it.revealed) return `<div class="card down ${it.hm ? 'hm' : ''}" style="border-color:${p.color};color:${p.color}">?</div>`;
      const own = it.owners.length > 1 ? `<span class="own">${it.owners.map((o) => `<i style="background:${colorOf(o)}"></i>`).join('')}</span>` : '';
      const isNew = seenFlip && !seenFlip.has(it.id);
      return `<div class="card up ${isNew ? 'flipnew' : ''} ${it.hm ? 'hm' : ''} ${selected.has(it.id) ? 'sel' : ''}" data-sel="${it.id}" data-drag="${it.id}" draggable="${S.phase === 'reveal'}" style="border-color:${p.color};box-shadow:3px 3px 0 ${p.color}">${esc(it.text)}${own}</div>`;
    };
    const slots = [0, 1, 2].map((n) => card(main[n])).join('');
    const hmCards = hm.slice(0, 1).map((it) => card(it)).join('');
    const extra = hm.length > 1 ? ` · +${hm.length - 1} HM` : '';
    return `<div class="pcol">
      <div class="phead" style="border-color:${p.color}"><i class="sw" style="background:${p.color}"></i><span class="n">${esc(p.name)}</span>${p.done ? '<span class="donechk" title="Done submitting">✓</span>' : ''}<span class="c">${p.revealedCount}/${p.itemCount}${extra}</span></div>
      ${slots}${hmCards}
    </div>`;
  }).join('');

  const total = S.items.filter((i) => !i.merged).length;
  const live = S.items.filter((i) => !i.merged);
  const up = live.filter((i) => i.revealed).length;
  const sel = selected.size;
  const bar = S.phase === 'submit'
    ? `<span class="grow">${total} cards in · players type on their phones</span>
       <button class="btn cyan" data-to="reveal">OPEN REVEAL ▸</button>`
    : `<span class="grow">${up} of ${total} revealed${sel ? ` · ${sel} selected` : ' · tap to select · drag a card onto another to merge'}</span>
       ${sel ? `<button class="btn ghost" id="edit" ${sel === 1 ? '' : 'disabled'}>EDIT</button>
       <button class="btn ghost" id="remove">REMOVE</button>
       <button class="btn ghost" id="merge" ${sel >= 2 ? '' : 'disabled'}>MERGE</button>
       <button class="btn ghost" id="clear">CLEAR</button>` : ''}
       <button class="btn ghost" id="flipall">FLIP ALL</button>
       <button class="btn cyan" data-to="vote">${S.standings.main.length && hasVotes() ? 'RESUME VOTING ▸' : 'OPEN VOTING ▸'}</button>`;
  return `${header()}<div class="wall">${cols}</div><div class="bar">${bar}</div>`;
}

const hasVotes = () => S.players.some((p) => p.used > 0);

// ---------------- LEADERBOARD ----------------
function coinsFor(item, max = 12) {
  const order = S.players.filter((p) => item.backers[p.id]);
  const list = order.flatMap((p) => Array(item.backers[p.id]).fill(p.color));
  const shown = list.slice(0, max).map((c) => coin(c, 30)).join('');
  return shown + (list.length > max ? `<span class="more">+${list.length - max}</span>` : '');
}

function board() {
  const main = S.standings.main;
  const top = main.slice(0, 8);
  const rest = main.slice(8);
  const rankColors = ['#FFD23F', '#C9D1E6', '#FF8A3D'];
  const rows = top.map((it, i) => {
    const isTop = it.place <= 3;
    const promo = it.promoted && !seenPromo.has(it.id);
    const cut = i > 0 && top[i - 1].place <= 3 && !isTop ? '<div class="cutline">PODIUM LINE</div>' : '';
    return `${cut}<div class="row ${isTop ? 'top' : ''} ${promo ? 'promo' : ''}" data-id="${it.id}">
      <span class="rk" style="color:${isTop ? rankColors[it.place - 1] : 'var(--muted)'}">#${it.place}</span>
      <span class="ow">${it.owners.map((o) => `<i style="background:${colorOf(o)}"></i>`).join('')}</span>
      <span class="t">${esc(it.text)}</span>
      <span class="coins">${coinsFor(it)}</span>
      <span class="tot">${it.total}</span>
    </div>`;
  }).join('');
  main.filter((i) => i.promoted).forEach((i) => seenPromo.add(i.id));

  const tickerText = rest.length
    ? rest.map((it) => `#${it.place} ${esc(it.text)} ${it.total}`).join('   ·   ')
    : '';
  const ticker = rest.length ? `<div class="ticker"><span class="tag">REST OF FIELD</span><div class="win"><div class="run">${tickerText}   ·   ${tickerText}   ·   </div></div></div>` : '';

  const hm = S.standings.hm.map((it) => `<div class="hmrow" data-id="${it.id}"><i style="background:${colorOf(it.owners[0])}"></i><span class="t">${esc(it.text)}</span><span class="px" style="font-size:14px">${it.total}</span></div>`).join('')
    || '<div class="muted" style="font-size:22px">None yet</div>';
  const spend = S.players.map((p) => `<div style="${p.connected ? '' : 'opacity:.45'}"><i style="background:${p.color}"></i><span>${esc(p.name)}</span><span style="color:${p.used === S.tokens ? 'var(--green)' : 'var(--text)'}">${p.used}/${S.tokens}</span></div>`).join('');

  return `
  <div class="top">
    <div style="display:flex;align-items:center;gap:16px;min-width:0">
      <span class="px" style="background:var(--blue);font-size:14px;padding:10px 14px;letter-spacing:4px;flex:none">HIGH SCORES</span>
      <span style="font-size:34px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(S.prompt)}</span>
    </div>
    <div class="phases">${['submit', 'reveal', 'vote', 'final', 'results'].map((ph) => `<button data-phase="${ph}" style="all:unset"><span class="${S.phase === ph ? 'on' : ''}">${PHASE_LABEL[ph]}</span></button>`).join('')}</div>
  </div>
  <div class="board">
    <div class="rows" id="rows">${rows || '<div class="muted">Waiting for the first tokens…</div>'}${ticker}</div>
    <div class="hmcol">
      <span class="label" style="line-height:1.6">HONORABLE MENTIONS</span>
      <div id="hm" style="display:flex;flex-direction:column;gap:10px">${hm}</div>
      <div class="muted" style="font-size:22px">Outscore the lowest main entry to break into the main board.</div>
      <div class="spend"><span class="label" style="color:var(--muted);font-size:10px">TOKENS SPENT</span><div class="g">${spend}</div></div>
    </div>
  </div>
  <div class="bar">
    <button class="btn ghost" data-to="reveal">PAUSE · ADD PLAYER</button>
    <button class="btn" data-to="final">CLOSE VOTING ▸</button>
  </div>`;
}

// ---------------- PODIUM ----------------
const POD = { start: 0.6, step: 1.7, rise: 0.8, count: 0.8 };
let podiumAnimate = false;
let podTimers = [];

// Count each bar's token total up from 0 once its bar has risen, then confetti on 1st.
function runPodium() {
  podTimers.forEach(clearTimeout); podTimers = [];
  const counts = [...stage.querySelectorAll('.count')];
  counts.forEach((el) => {
    const total = Number(el.dataset.total);
    const startAt = Number(el.dataset.delay) * 1000;
    podTimers.push(setTimeout(() => {
      const t0 = performance.now();
      const dur = POD.count * 1000;
      let shown = 0;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const v = Math.round(total * (1 - Math.pow(1 - k, 3)));
        if (v !== shown) { shown = v; el.textContent = v; Sfx.tick(); }
        if (k < 1) requestAnimationFrame(step);
        else el.closest('.pod').classList.add('landed');
      };
      if (total === 0) el.closest('.pod').classList.add('landed'); else requestAnimationFrame(step);
    }, startAt));
  });
  const last = Math.max(0, ...counts.map((el) => Number(el.dataset.delay)));
  podTimers.push(setTimeout(() => { confetti(); Sfx.fanfare(); }, (last + POD.count) * 1000));
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const colors = ['#FF2E88', '#29E6FF', '#FFD23F', '#3DFF8A', '#FF8A3D', '#A78BFF', '#F4F1FF'];
  for (let i = 0; i < 140; i++) {
    const p = document.createElement('i');
    const size = [8, 8, 12, 16][Math.floor(Math.random() * 4)];
    p.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size}px;background:${colors[i % colors.length]};` +
      `--x:${(Math.random() - 0.5) * 240}px;--dur:${2.2 + Math.random() * 2}s;--delay:${Math.random() * 0.9}s;--spin:${Math.random() < 0.5 ? -1 : 1}`;
    layer.appendChild(p);
  }
  stage.appendChild(layer);
  podTimers.push(setTimeout(() => layer.remove(), 5500));
}

// ---------------- FINAL SELECTIONS (host locks the order) ----------------
function finals() {
  const main = S.standings.main;
  const top = main.slice(0, 8);
  const rankColors = ['#FFD23F', '#C9D1E6', '#FF8A3D'];
  const rows = top.map((it, i) => {
    const isTop = it.place <= 3;
    const cut = i > 0 && top[i - 1].place <= 3 && !isTop ? '<div class="cutline">PODIUM LINE</div>' : '';
    return `${cut}<div class="row frow ${isTop ? 'top' : ''}" data-id="${it.id}" data-row="${it.id}" draggable="true">
      <span class="grip" aria-hidden="true">⋮⋮</span>
      <span class="rk" style="color:${isTop ? rankColors[it.place - 1] : 'var(--muted)'}">#${it.place}</span>
      <span class="ow">${it.owners.map((o) => `<i style="background:${colorOf(o)}"></i>`).join('')}</span>
      <span class="t">${esc(it.text)}</span>
      ${it.tied ? '<span class="tie">TIE</span>' : ''}
      <span class="tot">${it.total}</span>
      <span class="ctl">
        ${i > 0 ? `<button class="share ${it.shared ? 'on' : ''}" data-share="${it.id}" aria-pressed="${!!it.shared}" title="Share a place with the entry above">=${it.shared ? ' SHARED' : ''}</button>` : '<span style="width:44px"></span>'}
        <button data-move="${it.id}" data-dir="-1" ${i ? '' : 'disabled'} aria-label="Move up">▲</button>
        <button data-move="${it.id}" data-dir="1" ${i < top.length - 1 ? '' : 'disabled'} aria-label="Move down">▼</button>
      </span>
    </div>`;
  }).join('');
  const ties = top.filter((i) => i.tied).length;
  return `
  <div class="top">
    <div style="display:flex;align-items:center;gap:16px;min-width:0">
      <span class="px" style="background:var(--pink);color:var(--bg);font-size:14px;padding:10px 14px;letter-spacing:4px;flex:none">FINAL SELECTIONS</span>
      <span style="font-size:34px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(S.prompt)}</span>
    </div>
    <div class="phases">${['submit', 'reveal', 'vote', 'final', 'results'].map((ph) => `<button data-phase="${ph}" style="all:unset"><span class="${S.phase === ph ? 'on' : ''}">${PHASE_LABEL[ph]}</span></button>`).join('')}</div>
  </div>
  <div class="rows" id="rows" style="flex:1;min-height:0">${rows || '<div class="muted">No entries.</div>'}</div>
  <div class="bar">
    <span class="grow">${ties ? `${ties} tied entries · drag or use ▲▼ to break ties · = shares a place` : 'Drag or use ▲▼ to set the final order'}</span>
    <button class="btn ghost" data-to="vote">BACK TO VOTING</button>
    <button class="btn yellow" data-to="results">REVEAL PODIUM ▸</button>
  </div>`;
}

function podium() {
  const main = S.standings.main;
  const top3 = main.slice(0, 3);
  const heights = { 1: 300, 2: 220, 3: 160 };
  const colors = { 1: '#FFD23F', 2: '#C9D1E6', 3: '#FF8A3D' };
  const slotOrder = [1, 0, 2].filter((i) => top3[i]); // 2nd, 1st, 3rd
  // reveal order: 3rd, then 2nd, then 1st (index in top3 -> start time in seconds)
  const delay = { 2: POD.start, 1: POD.start + POD.step, 0: POD.start + POD.step * 2 };
  const anim = podiumAnimate;
  const pods = slotOrder.map((i) => {
    const it = top3[i];
    const place = Math.min(it.place, 3);
    const d = delay[i];
    return `<div class="pod ${anim ? 'anim' : ''}" style="--d:${d}s;--rise:${POD.rise}s">
      <span class="t">${esc(it.text)}</span>
      <span class="own">${it.owners.map((o) => `<i style="background:${colorOf(o)}"></i>`).join('')}</span>
      <div class="blk" style="height:${heights[place]}px;background:${colors[place]}"><b>${it.place}</b><span><em class="count" data-total="${it.total}" data-delay="${d + POD.rise}">${anim ? 0 : it.total}</em> TOKENS</span></div>
    </div>`;
  }).join('');
  const rest = main.slice(3, 8).map((it) => `${it.place} ${esc(it.text)}`).join(' · ');
  return `<div class="results" style="position:absolute;inset:0;padding:32px 56px;display:flex;flex-direction:column;align-items:center;gap:14px">
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
      <span class="px" style="background:var(--blue);font-size:16px;padding:10px 16px;letter-spacing:6px">FINAL SCORES</span>
      <span class="muted" style="font-size:32px">${esc(S.prompt)}</span>
    </div>
    <div class="podium">${pods || '<div class="muted">No entries this round.</div>'}</div>
    <div class="final" style="width:100%">
      <span class="muted" style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rest}</span>
      <div style="display:flex;gap:14px;align-items:center;flex:none">
        <button class="btn ghost" id="endSession">END SESSION</button>
        <button class="btn ghost" data-to="final">BACK</button>
        <input id="nextPrompt" class="field" style="width:280px;font-size:26px;padding:8px 12px" maxlength="80" placeholder="Next prompt">
        <button class="btn yellow" id="again">PLAY AGAIN ▸</button>
      </div>
    </div>
  </div>`;
}

// ---------------- render + events ----------------
let lastPhase = null;
function render() {
  if (!S || modalOpen) return;
  // keep focus / typing in prompt inputs across live updates
  const active = document.activeElement;
  if (active && active.id === 'prompt' && S.phase === 'lobby' && lastPhase === 'lobby') {
    $('#slots').innerHTML = slotsHtml();
    return;
  }
  if (active && active.id === 'nextPrompt' && S.phase === 'results' && lastPhase === 'results') return;

  // drop selections that no longer exist
  selected = new Set([...selected].filter((id) => S.items.some((i) => i.id === id && i.revealed && !i.merged)));

  const play = ['vote', 'final'].includes(S.phase) && lastPhase === S.phase ? flipAnimate(stage, '[data-id]', scale) : null;
  stage.classList.toggle('results', false);
  podiumAnimate = S.phase === 'results' && lastPhase !== 'results';
  if (S.phase !== 'results') { podTimers.forEach(clearTimeout); podTimers = []; }
  const keepConfetti = S.phase === 'results' && stage.querySelector('.confetti');
  stage.innerHTML = { lobby, submit: wall, reveal: wall, vote: board, final: finals, results: podium }[S.phase]();
  if (keepConfetti) stage.appendChild(keepConfetti);
  if (podiumAnimate) runPodium();
  if (play) play();
  if (!seenFlip) seenFlip = new Set();
  S.items.forEach((i) => { if (i.revealed) seenFlip.add(i.id); });
  lastPhase = S.phase;
}

let promptTimer;
stage.addEventListener('input', (e) => {
  if (e.target.id === 'prompt') {
    clearTimeout(promptTimer);
    promptTimer = setTimeout(() => host('setPrompt', { prompt: e.target.value }).catch(() => {}), 350);
  }
});

stage.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-sel]');
  if (!t) return;
  try {
    if (t.id === 'go') {
      const v = $('#prompt').value.trim();
      if (!v) return toast('Type a prompt first');
      clearTimeout(promptTimer);
      await host('setPrompt', { prompt: v });
      return host('phase', { phase: 'submit' });
    }
    if (t.dataset.kick) { if (confirm('Remove this player?')) return host('kick', { pid: t.dataset.kick }); return; }
    if (t.dataset.phase) return host('phase', { phase: t.dataset.phase });
    if (t.dataset.to) return host('phase', { phase: t.dataset.to });
    if (t.dataset.sel) { selected.has(t.dataset.sel) ? selected.delete(t.dataset.sel) : selected.add(t.dataset.sel); return render(); }
    if (t.id === 'clear') { selected.clear(); return render(); }
    if (t.id === 'flipall') return host('flipAll');
    if (t.id === 'merge') { const items = [...selected]; selected.clear(); return host('merge', { items }); }
    if (t.id === 'remove') {
      if (!confirm(`Remove ${selected.size} item(s)?`)) return;
      for (const item of [...selected]) await host('removeItem', { item });
      selected.clear(); return render();
    }
    if (t.id === 'edit') {
      const item = [...selected][0];
      const cur = S.items.find((i) => i.id === item);
      const text = prompt('Edit item', cur ? cur.text : '');
      if (text && text.trim()) { selected.clear(); return host('editItem', { item, text }); }
      return;
    }
    if (t.dataset.bump) return host('bump', { item: t.dataset.bump });
    if (t.dataset.move) {
      const ids = S.standings.main.map((i) => i.id);
      const i = ids.indexOf(t.dataset.move), j = i + Number(t.dataset.dir);
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return host('setOrder', { order: ids });
    }
    if (t.dataset.share) return host('toggleShare', { item: t.dataset.share });
    if (t.id === 'endSession') {
      if (!confirm('End this session? Everyone is sent out and a fresh room with a new code opens.')) return;
      await host('endRoom');
      localStorage.removeItem('top3-host');
      return location.reload();
    }
    if (t.id === 'again') return host('playAgain', { prompt: $('#nextPrompt').value });
  } catch { /* toast already shown */ }
});

// ---------------- drag a card onto another to merge ----------------
let dragId = null;
stage.addEventListener('dragstart', (e) => {
  const c = e.target.closest('[data-drag]');
  if (!c) return;
  dragId = c.dataset.drag;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  requestAnimationFrame(() => c.classList.add('dragging'));
});
stage.addEventListener('dragend', () => {
  dragId = null;
  stage.querySelectorAll('.dragging, .droptarget').forEach((el) => el.classList.remove('dragging', 'droptarget'));
});
stage.addEventListener('dragover', (e) => {
  const c = e.target.closest('[data-drag]');
  if (!c || !dragId || c.dataset.drag === dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  stage.querySelectorAll('.droptarget').forEach((el) => el !== c && el.classList.remove('droptarget'));
  c.classList.add('droptarget');
});
stage.addEventListener('dragleave', (e) => {
  const c = e.target.closest('[data-drag]');
  if (c && !c.contains(e.relatedTarget)) c.classList.remove('droptarget');
});
stage.addEventListener('drop', (e) => {
  const c = e.target.closest('[data-drag]');
  if (!c || !dragId) return;
  e.preventDefault();
  const from = dragId, onto = c.dataset.drag;
  dragId = null;
  stage.querySelectorAll('.dragging, .droptarget').forEach((el) => el.classList.remove('dragging', 'droptarget'));
  if (from !== onto) askMerge(onto, from);
});

// Final selections: drag rows to reorder.
let rowDrag = null;
stage.addEventListener('dragstart', (e) => {
  const r = e.target.closest('[data-row]');
  if (!r) return;
  rowDrag = r.dataset.row;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', rowDrag);
  requestAnimationFrame(() => r.classList.add('dragging'));
});
stage.addEventListener('dragover', (e) => {
  const r = e.target.closest('[data-row]');
  if (!r || !rowDrag || r.dataset.row === rowDrag) return;
  e.preventDefault();
  stage.querySelectorAll('.dropabove, .dropbelow').forEach((el) => el.classList.remove('dropabove', 'dropbelow'));
  const box = r.getBoundingClientRect();
  r.classList.add(e.clientY < box.top + box.height / 2 ? 'dropabove' : 'dropbelow');
});
stage.addEventListener('drop', (e) => {
  const r = e.target.closest('[data-row]');
  if (!r || !rowDrag) return;
  e.preventDefault();
  const below = r.classList.contains('dropbelow');
  const ids = S.standings.main.map((i) => i.id).filter((x) => x !== rowDrag);
  let at = ids.indexOf(r.dataset.row) + (below ? 1 : 0);
  ids.splice(at, 0, rowDrag);
  rowDrag = null;
  host('setOrder', { order: ids }).catch(() => {});
});
stage.addEventListener('dragend', () => {
  rowDrag = null;
  stage.querySelectorAll('.dragging, .dropabove, .dropbelow').forEach((el) => el.classList.remove('dragging', 'dropabove', 'dropbelow'));
});

// Two-step dialog: confirm the merge, then pick which label to keep.
let modalOpen = false;
function askMerge(onto, from) {
  const a = S.items.find((i) => i.id === onto);
  const b = S.items.find((i) => i.id === from);
  if (!a || !b) return;
  modalOpen = true;
  const box = document.createElement('div');
  box.className = 'modal';
  const close = () => { box.remove(); modalOpen = false; render(); };
  const step1 = () => {
    box.innerHTML = `<div class="dialog">
      <span class="label">MERGE CARDS?</span>
      <div class="pair"><div class="mini">${esc(b.text)}</div><span class="px" style="color:var(--yellow)">▸</span><div class="mini">${esc(a.text)}</div></div>
      <p class="muted">They become one entry. Both players share it and any tokens combine.</p>
      <div class="acts"><button class="btn ghost" data-m="cancel">CANCEL</button><button class="btn cyan" data-m="yes">YES, MERGE ▸</button></div>
    </div>`;
  };
  const step2 = () => {
    box.innerHTML = `<div class="dialog">
      <span class="label">WHICH LABEL?</span>
      <div class="choices">
        <button class="btn ghost choice" data-m="pick" data-t="${esc(a.text)}">${esc(a.text)}</button>
        <button class="btn ghost choice" data-m="pick" data-t="${esc(b.text)}">${esc(b.text)}</button>
      </div>
      <div class="acts"><button class="btn ghost" data-m="cancel">CANCEL</button></div>
    </div>`;
  };
  box.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-m]');
    if (!t) { if (ev.target === box) close(); return; }
    if (t.dataset.m === 'cancel') return close();
    if (t.dataset.m === 'yes') return step2();
    if (t.dataset.m === 'pick') {
      selected.delete(onto); selected.delete(from);
      try { await host('merge', { items: [onto, from], text: t.dataset.t }); } catch {}
      close();
    }
  });
  step1();
  stage.appendChild(box);
}

// ---------------- sounds from state changes ----------------
function sounds(prev, next) {
  if (!prev) return;
  const ids = (st) => new Set(st.players.map((p) => p.id));
  const a = ids(prev), b = ids(next);
  if ([...b].some((x) => !a.has(x))) Sfx.join();
  else if ([...a].some((x) => !b.has(x))) Sfx.leave();
  if (prev.phase !== next.phase) {
    if (next.phase === 'results') Sfx.drum(); else Sfx.phase();
    return;
  }
  const merged = (st) => st.items.filter((i) => i.merged).length;
  if (merged(next) > merged(prev)) return Sfx.merge();
  const up = (st) => st.items.filter((i) => i.revealed).length;
  if (up(next) > up(prev)) Sfx.flip();
  const promo = (st) => st.standings.main.filter((i) => i.promoted).map((i) => i.id).join();
  if (next.phase === 'vote' && promo(next) && promo(next) !== promo(prev)) return Sfx.promote();
  const spent = (st) => st.players.reduce((n, p) => n + p.used, 0);
  if (spent(next) > spent(prev)) Sfx.coin();
  else if (spent(next) < spent(prev)) Sfx.uncoin();
}

// ---------------- settings menu ----------------
const gear = document.createElement('button');
gear.className = 'gear';
gear.setAttribute('aria-label', 'Settings');
gear.innerHTML = '<svg width="22" height="22" viewBox="0 0 11 11" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M4 0h3v2h-3zM4 9h3v2h-3zM0 4h2v3h-2zM9 4h2v3h-2zM1 1h2v2h-2zM8 1h2v2h-2zM1 8h2v2h-2zM8 8h2v2h-2zM3 2h5v1h1v5h-1v1h-5v-1h-1v-5h1zM4 4v3h3v-3z"/></svg>';
document.body.appendChild(gear);
const panel = document.createElement('div');
panel.className = 'settings hidden';
document.body.appendChild(panel);
gear.addEventListener('click', () => { panel.classList.toggle('hidden'); renderSettings(); });

function renderSettings() {
  if (panel.classList.contains('hidden')) return;
  if (panel.contains(document.activeElement) && document.activeElement.type === 'range') return;
  const d = Settings.data;
  const fs = !!document.fullscreenElement;
  const bots = S ? S.players.filter((p) => p.bot).length : 0;
  const room = S ? 10 - S.players.length : 0;
  const tog = (key, on, label) => `<button class="tog ${on ? 'on' : ''}" data-set="${key}" aria-pressed="${on}"><span>${label}</span><b>${on ? 'ON' : 'OFF'}</b></button>`;
  panel.innerHTML = `
    <div class="shead"><span class="px" style="font-size:12px;letter-spacing:2px">SETTINGS <span style="color:var(--muted);font-size:9px">v${esc(window.APP_VERSION)}</span></span><button class="x" data-set="close" aria-label="Close settings">✕</button></div>
    ${auth ? `<span class="label">ROOM</span>
    <div class="sroom">
      <div class="code small">${auth.code.split('').map((c) => `<b>${c}</b>`).join('')}</div>
      <span style="font-size:22px;overflow-wrap:anywhere">${esc(location.host)}/play</span>
      <div class="row2"><button class="btn ghost" data-set="copy">COPY LINK</button><a class="btn ghost" href="${esc(joinUrl())}" target="_blank" rel="noopener">OPEN ↗</a></div>
    </div>` : ''}
    <span class="label">SOUND</span>
    ${tog('muted', !d.muted, 'Sound')}
    <label class="slider"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value="${d.volume}" data-set="volume" ${d.muted ? 'disabled' : ''}><b>${Math.round(d.volume * 100)}</b></label>
    ${tog('clicks', d.clicks, 'Button clicks')}
    <button class="btn ghost" data-set="test" style="align-self:flex-start">TEST SOUND</button>
    <span class="label">DISPLAY</span>
    ${tog('fullscreen', fs, 'Fullscreen')}
    <span class="label">DEBUG</span>
    ${tog('debug', d.debug, 'Debug mode')}
    ${d.debug ? `<div class="dbg">
      <span class="muted" style="font-size:20px">${bots} bot${bots === 1 ? '' : 's'} in room · ${room} open slot${room === 1 ? '' : 's'}. Bots submit, flip and spend tokens on their own each phase.</span>
      <div class="row2">
        <button class="btn cyan" data-set="bot1" ${room ? '' : 'disabled'}>+1 BOT</button>
        <button class="btn cyan" data-set="bot5" ${room ? '' : 'disabled'}>+5 BOTS</button>
        <button class="btn cyan" data-set="botfill" ${room ? '' : 'disabled'}>FILL TO 10</button>
      </div>
      <button class="btn ghost" data-set="botclear" ${bots ? '' : 'disabled'}>REMOVE ALL BOTS</button>
    </div>` : ''}`;
}

panel.addEventListener('input', (e) => {
  if (e.target.dataset.set === 'volume') {
    Settings.set('volume', Number(e.target.value));
    e.target.nextElementSibling.textContent = Math.round(Settings.data.volume * 100);
  }
});
panel.addEventListener('change', (e) => { if (e.target.dataset.set === 'volume') { Sfx.coin(); renderSettings(); } });
panel.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-set]');
  if (!b) return;
  const k = b.dataset.set;
  try {
    if (k === 'close') panel.classList.add('hidden');
    else if (k === 'muted') { Settings.set('muted', !Settings.data.muted); if (!Settings.data.muted) Sfx.coin(); }
    else if (k === 'clicks' || k === 'debug') Settings.set(k, !Settings.data[k]);
    else if (k === 'test') Sfx.fanfare();
    else if (k === 'copy') { await navigator.clipboard.writeText(joinUrl()).then(() => toast('Join link copied'), () => toast(joinUrl())); }
    else if (k === 'fullscreen') {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    }
    else if (k === 'bot1') await host('addBots', { count: 1 });
    else if (k === 'bot5') await host('addBots', { count: 5 });
    else if (k === 'botfill') await host('addBots', { count: 10 });
    else if (k === 'botclear') await host('removeBots');
  } catch { /* toast shown */ }
  renderSettings();
});
document.addEventListener('fullscreenchange', () => { fit(); renderSettings(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.add('hidden'); });

start();
