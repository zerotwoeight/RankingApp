// Phone client.
'use strict';

const app = $('#app');
const KEY = 'top3-player';
let S = null;
let me = JSON.parse(localStorage.getItem(KEY) || 'null'); // { code, pid, name, color }
let es = null;
let pickColor = me ? me.color : null;
let joinCode = (new URLSearchParams(location.search).get('code') || (me && me.code) || '').toUpperCase();

const save = () => localStorage.setItem(KEY, JSON.stringify(me));
const act = (action, extra = {}) => api(action, { code: me.code, pid: me.pid, ...extra });

// ---------------- JOIN ----------------
async function showJoin(msg) {
  if (es) { es.close(); es = null; }
  let peek = null;
  if (joinCode.length === 4) peek = await api('peek', { code: joinCode }).catch(() => null);
  const colors = (peek && peek.colors) || ['#FF2E88', '#29E6FF', '#FFD23F', '#3DFF8A', '#FF8A3D', '#A78BFF', '#F4F1FF', '#4D7BFF', '#FF5C5C', '#7DF9C4'];
  const taken = (peek && peek.taken) || [];
  if (pickColor && taken.includes(pickColor)) pickColor = null;
  app.innerHTML = `
    <div class="logo" style="font-size:22px;text-align:center;margin-top:20px">TOP<span>//</span>3</div>
    ${msg ? `<div class="big" style="color:var(--yellow);font-size:11px">${esc(msg)}</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:10px">
      <label class="label" for="code">ROOM CODE</label>
      <input id="code" class="field px" maxlength="4" autocomplete="off" autocapitalize="characters" value="${esc(joinCode)}"
        style="color:var(--pink);border-color:var(--pink);font-size:26px;letter-spacing:18px;text-align:center;padding:16px 8px">
      ${peek ? `<span class="muted" style="font-size:22px">${peek.count}/${peek.max} players in this room</span>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <label class="label" for="name">NAME OR INITIALS</label>
      <input id="name" class="field" maxlength="12" autocomplete="off" value="${esc(me ? me.name : '')}">
    </div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <span class="label">PICK YOUR COLOR</span>
      <div class="colors">${colors.map((c) => {
        const tk = taken.includes(c);
        return `<button data-color="${c}" class="${tk ? 'taken' : ''} ${pickColor === c ? 'pick' : ''}" style="background:${c};color:${c}" ${tk ? 'disabled' : ''} aria-label="color ${c}${tk ? ' (taken)' : ''}"><span style="color:#0B0820">${pickColor === c ? '✓' : ''}</span></button>`;
      }).join('')}</div>
      <span class="muted" style="font-size:22px">Greyed colors are taken.</span>
    </div>
    <button class="btn" id="join" style="margin-top:auto;font-size:16px;padding:22px;box-shadow:6px 6px 0 var(--blue)">JOIN GAME ▸</button>`;
}

app.addEventListener('change', (e) => {
  if (e.target.id === 'code') {
    joinCode = e.target.value.trim().toUpperCase();
    if (joinCode.length === 4) { const n = $('#name') && $('#name').value; showJoin().then(() => { if (n) $('#name').value = n; }); }
  }
});

async function doJoin() {
  const code = $('#code').value.trim().toUpperCase();
  const name = $('#name').value.trim();
  if (code.length !== 4) return toast('Enter the 4-letter room code');
  if (!name) return toast('Enter a name');
  if (!pickColor) return toast('Pick a color');
  const prevPid = me && me.code === code ? me.pid : null;
  const r = await api('join', { code, name, color: pickColor, pid: prevPid }).catch(() => null);
  if (!r) return;
  me = { code, pid: r.pid, name: name.toUpperCase(), color: pickColor };
  save();
  history.replaceState(null, '', `/play?code=${code}`);
  live();
}

// ---------------- LIVE ----------------
function live() {
  if (es) es.close();
  es = connect({ code: me.code, pid: me.pid }, (st) => { S = st; if (S.me) { me.color = S.me.color; me.name = S.me.name; save(); } render(); },
    (why) => {
      S = null;
      if (why === 'left') return;
      if (why === 'kicked' || why === 'ended') forget();
      showJoin({ kicked: 'The host removed you from the room.', ended: 'The host ended this session. Enter a new room code to play again.' }[why]
        || 'Could not reconnect — rejoin with the same name to restore your cards.');
    });
}

// Leave the room for good on this phone (name + color are kept for next time).
function forget() {
  if (es) { es.close(); es = null; }
  me = me ? { name: me.name, color: me.color } : null;
  save();
  joinCode = '';
  history.replaceState(null, '', '/play');
}

async function leave() {
  if (!confirm('Leave this room? Your entries and tokens will be removed.')) return;
  await act('leave').catch(() => {});
  forget();
  showJoin('You left the room.');
}

function headerHtml() {
  return `<div class="me"><i class="sw" style="background:${S.me.color}"></i><span class="n">${esc(S.me.name)}</span>${S.phase === 'submit'
    ? `<button class="phbtn ${S.me.done ? 'done' : ''}" id="done" aria-pressed="${S.me.done}">${S.me.done ? 'DONE ✓' : 'SUBMIT ▸'}</button>`
    : `<span class="ph">${PHASE_LABEL[S.phase]}</span>`}<button class="x" id="leave" style="border:2px solid var(--line);padding:8px 10px">LEAVE</button></div>`;
}
const promptHtml = () => S.prompt ? `<div class="promptbox"><span class="label" style="font-size:9px">PROMPT</span><span class="p">${esc(S.prompt)}</span></div>` : '';

function myItems() { return S.items.filter((i) => i.mine); }

function entriesHtml(canFlip, canEdit) {
  const mine = myItems();
  const main = mine.filter((i) => !i.hm);
  const hm = mine.filter((i) => i.hm);
  const row = (it, n) => it.merged
    ? `<div class="entry" style="border-color:var(--line);opacity:.6"><span class="t">${esc(it.text)}<span class="s">merged with a matching card</span></span></div>`
    : it.revealed
    ? `<div class="entry up" style="border-color:${S.me.color};box-shadow:4px 4px 0 ${S.me.color}"><span class="t">${esc(it.text)}<span class="s">✓ ON SCREEN</span></span></div>`
    : `<div class="entry" style="border-color:${S.me.color}">
        ${n ? `<span class="px" style="font-size:12px">${n}</span>` : ''}
        <span class="t">${esc(it.text)}<span class="s">only you can see this</span></span>
        ${canEdit ? `<button class="x" data-del="${it.id}" aria-label="Delete">✕</button>` : ''}
        ${canFlip ? `<button class="btn yellow" data-flip="${it.id}" style="box-shadow:4px 4px 0 var(--pink)">FLIP</button>` : ''}
      </div>`;
  const left = 3 - main.length;
  return `
    <span class="label">YOUR 3 ENTRIES</span>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${main.map((it, i) => row(it, i + 1)).join('')}
      ${left > 0 ? `<div class="muted" style="font-size:22px">${left} more to go</div>` : ''}
    </div>
    ${hm.length ? `<span class="sect">HONORABLE MENTIONS</span><div style="display:flex;flex-direction:column;gap:8px">${hm.map((it) => row(it)).join('')}</div>` : ''}
    ${canEdit ? `<form class="addrow" id="add">
      <label for="newItem" class="hidden">New entry</label>
      <input id="newItem" class="field" maxlength="48" autocomplete="off" placeholder="${left > 0 ? `${4 - left} · type an entry` : '+ honorable mention'}">
      <button class="btn yellow" type="submit">ADD</button>
    </form>` : ''}`;
}

function voteHtml() {
  const used = Object.values(S.me.tokens).reduce((s, n) => s + n, 0);
  const left = S.tokens - used;
  const coins = Array.from({ length: S.tokens }, (_, i) => coin('#FFD23F', 40, i < left ? 1 : 0.18, '#C98A00')).join('');
  const revealed = S.items.filter((i) => i.revealed && !i.merged);
  const ownerColor = (it) => (S.players.find((p) => p.id === it.owners[0]) || {}).color || '#555';
  const row = (it) => {
    const n = S.me.tokens[it.id] || 0;
    return `<div class="vote ${n ? 'on' : ''}">
      <i style="background:${ownerColor(it)}"></i>
      <span class="t">${esc(it.text)}</span>
      <button class="minus" data-tok="${it.id}" data-d="-1" ${n ? '' : 'disabled'} aria-label="Remove a token from ${esc(it.text)}">−</button>
      <span class="n" style="color:${n ? 'var(--yellow)' : 'var(--muted)'}">${n}</span>
      <button class="plus" data-tok="${it.id}" data-d="1" ${left ? '' : 'disabled'} aria-label="Add a token to ${esc(it.text)}">+</button>
    </div>`;
  };
  const main = revealed.filter((i) => !i.hm);
  const hm = revealed.filter((i) => i.hm);
  return `
    <div class="coinbar">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="label" style="font-size:10px">YOUR TOKENS</span><span class="px" style="font-size:12px;color:var(--yellow)">${left} LEFT</span></div>
      <div class="coins">${coins}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${main.map(row).join('')}
      ${hm.length ? `<span class="sect">HONORABLE MENTIONS</span>${hm.map(row).join('')}` : ''}
    </div>
    <div class="wait" style="font-size:22px">Move tokens anytime until the host closes voting.</div>`;
}

function r2Html() {
  const r = S.r2;
  const mine = r.mine || {};
  const used = Object.values(mine).reduce((a, n) => a + n, 0);
  const left = r.tokens - used;
  const coins = Array.from({ length: r.tokens }, (_, i) => coin('#FFD23F', 48, i < left ? 1 : 0.18, '#C98A00')).join('');
  const rows = S.items.filter((it) => r.ids.includes(it.id)).map((it) => {
    const n = mine[it.id] || 0;
    const owner = (S.players.find((p) => p.id === it.owners[0]) || {}).color || '#555';
    return `<div class="vote ${n ? 'on' : ''}">
      <i style="background:${owner}"></i>
      <span class="t">${esc(it.text)}</span>
      <button class="minus" data-r2="${it.id}" data-d="-1" ${n ? '' : 'disabled'} aria-label="Remove a round 2 token from ${esc(it.text)}">−</button>
      <span class="n" style="color:${n ? 'var(--yellow)' : 'var(--muted)'}">${n}</span>
      <button class="plus" data-r2="${it.id}" data-d="1" ${left ? '' : 'disabled'} aria-label="Add a round 2 token to ${esc(it.text)}">+</button>
    </div>`;
  }).join('');
  return `
    <div style="text-align:center;display:flex;flex-direction:column;gap:8px">
      <span class="px" style="font-size:14px;color:var(--cyan);line-height:1.5">ROUND 2 · TOP 8</span>
      <span class="muted" style="font-size:24px">Fresh ${r.tokens} tokens. Only this round counts!</span>
    </div>
    <div class="coinbar" style="border-color:var(--cyan)">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="label" style="font-size:10px">ROUND 2 TOKENS</span><span class="px" style="font-size:12px;color:var(--yellow)">${left} LEFT</span></div>
      <div class="coins">${coins}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">${rows}</div>
    <div class="wait" style="font-size:22px">Move tokens anytime until the host closes voting.</div>`;
}

function tieHtml() {
  const t = S.tie;
  if (!t) return '<div class="wait">…</div>';
  const mine = t.mine || {};
  const used = Object.values(mine).reduce((a, n) => a + n, 0);
  const max = t.allowance[S.me.id] || 3;
  const left = max - used;
  const myBonus = t.bonus && t.bonus.pid === S.me.id && !t.bonus.used;
  const locked = t.closed && !myBonus;
  const ord = (n) => n + (['th', 'st', 'nd', 'rd'][n % 10] && !(n % 100 > 10 && n % 100 < 14) ? ['th', 'st', 'nd', 'rd'][n % 10] : 'th');
  const coins = Array.from({ length: max }, (_, i) => coin('#FFD23F', 48, i < left ? 1 : 0.18, '#C98A00')).join('');
  const rows = t.items.map((it) => {
    const n = mine[it.id] || 0;
    const owner = (S.players.find((p) => p.id === it.owners[0]) || {}).color || '#555';
    return `<div class="vote big ${n ? 'on' : ''}">
      <i style="background:${owner}"></i>
      <span class="t">${esc(it.text)}</span>
      <button class="minus" data-tie="${it.id}" data-d="-1" ${n && !locked && !myBonus ? '' : 'disabled'} aria-label="Remove a tie-break token from ${esc(it.text)}">−</button>
      <span class="n" style="color:${n ? 'var(--yellow)' : 'var(--muted)'}">${n}</span>
      <button class="plus" data-tie="${it.id}" data-d="1" ${left > 0 && !locked ? '' : 'disabled'} aria-label="Add a tie-break token to ${esc(it.text)}">+</button>
    </div>`;
  }).join('');
  return `
    <div style="text-align:center;display:flex;flex-direction:column;gap:8px">
      <span class="px" style="font-size:14px;color:var(--yellow);line-height:1.5">${myBonus ? 'BONUS TOKEN!' : `TIE FOR ${ord(t.place).toUpperCase()}!`}</span>
      <span class="muted" style="font-size:24px">${myBonus ? 'You were picked to break the tie. Cast your extra token!' : t.closed ? 'Tie-break closed — eyes on the shared screen.' : `Spend ${max} tokens to break it · round ${t.round}`}</span>
    </div>
    <div class="coinbar" style="border-color:var(--yellow)">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="label" style="font-size:10px">TIE TOKENS</span><span class="px" style="font-size:12px;color:var(--yellow)">${left} LEFT</span></div>
      <div class="coins">${coins}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px">${rows}</div>
    <div class="wait" style="font-size:22px">${locked ? 'Waiting for the host…' : 'Debate it out — move tokens until the host closes the tie-break.'}</div>`;
}

function resultsHtml() {
  const top = S.standings.main.slice(0, 3);
  const medal = ['#FFD23F', '#C9D1E6', '#FF8A3D'];
  return `<div class="big" style="margin-top:20px">FINAL SCORES</div>
    ${top.map((it) => `<div class="entry up" style="border-color:${medal[Math.min(it.place, 3) - 1]};box-shadow:4px 4px 0 ${medal[Math.min(it.place, 3) - 1]}">
      <span class="px" style="font-size:18px">${it.place}</span><span class="t">${esc(it.text)}<span class="s">${it.total} TOKENS</span></span></div>`).join('')}
    <div class="wait">Look at the shared screen! Waiting for the host…</div>`;
}

let lastPhase = null;
function render() {
  if (!S || !S.me) return;
  // don't wipe what the player is typing
  const typing = document.activeElement && document.activeElement.id === 'newItem';
  const draft = typing ? document.activeElement.value : '';
  const scrollY = window.scrollY;
  let body = '';
  if (S.phase === 'lobby') body = `<div class="big" style="margin-top:30px">YOU'RE IN!</div><div class="wait">Waiting for the host to start…</div>`;
  else if (S.phase === 'submit') body = `${promptHtml()}${entriesHtml(false, !S.me.done)}<div class="wait" style="font-size:22px">${S.me.done ? 'Locked in! Tap DONE ✓ up top if you need to change something.' : 'Tap SUBMIT up top when you are done. Cards stay face-down until you flip them.'}</div>`;
  else if (S.phase === 'reveal') body = `${promptHtml()}<div class="big">FLIP WHEN<br>YOU'RE READY</div>${entriesHtml(true, !S.me.done)}<div class="wait">Waiting for host to open voting…</div>`;
  else if (S.phase === 'vote') body = voteHtml();
  else if (S.phase === 'round2') body = r2Html();
  else if (S.phase === 'tiebreak') body = tieHtml();
  else if (S.phase === 'final') body = `${promptHtml()}<div class="big" style="margin-top:30px">VOTING CLOSED</div><div class="wait">The host is locking in the final order… eyes on the shared screen!</div>`;
  else body = resultsHtml();
  app.innerHTML = headerHtml() + body;
  if (typing && $('#newItem')) { $('#newItem').value = draft; $('#newItem').focus(); }
  if (lastPhase === S.phase) window.scrollTo(0, scrollY);
  lastPhase = S.phase;
}

app.addEventListener('submit', async (e) => {
  if (e.target.id !== 'add') return;
  e.preventDefault();
  const inp = $('#newItem');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  await act('submit', { text }).catch(() => { inp.value = text; });
});

app.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.dataset.color) { pickColor = b.dataset.color; const c = $('#code').value, n = $('#name').value; await showJoin(); $('#code').value = c; $('#name').value = n; return; }
    if (b.id === 'join') return doJoin();
    if (b.id === 'leave') return leave();
    if (b.id === 'done') return act('setDone', { done: !S.me.done });
    if (b.dataset.flip) return act('flip', { item: b.dataset.flip });
    if (b.dataset.del) return act('editMine', { item: b.dataset.del, remove: true });
    if (b.dataset.tok) return act('token', { item: b.dataset.tok, delta: Number(b.dataset.d) });
    if (b.dataset.r2) return act('r2Token', { item: b.dataset.r2, delta: Number(b.dataset.d) });
    if (b.dataset.tie) return act('tieToken', { item: b.dataset.tie, delta: Number(b.dataset.d) });
  } catch { /* toast shown */ }
});

if (me && me.pid && me.code && (!joinCode || joinCode === me.code)) live();
else showJoin();
