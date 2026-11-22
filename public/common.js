// Shared helpers for host and phone pages.
'use strict';

const $ = (s, el = document) => el.querySelector(s);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(action, body) {
  const r = await fetch('/api/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: 'Network error' }));
  if (!r.ok || j.error) { toast(j.error || 'Something went wrong'); throw new Error(j.error); }
  return j;
}

let toastTimer;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

// Live state stream. EventSource reconnects on its own after drops.
function connect(params, onState, onGone) {
  const es = new EventSource('/events?' + new URLSearchParams(params));
  es.onmessage = (e) => onState(JSON.parse(e.data));
  for (const ev of ['kicked', 'ended', 'left']) es.addEventListener(ev, () => { es.close(); onGone && onGone(ev); });
  es.onerror = () => {
    // 404 (room gone / not a member) closes the stream for good.
    if (es.readyState === EventSource.CLOSED) onGone && onGone('closed');
  };
  return es;
}

// Original 8-bit coin, 10x10 pixel grid.
function coin(color, size = 30, opacity = 1, shade = 'rgba(0,0,0,0.35)') {
  const r = (x, y, w, h, f, o) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"${o ? ` fill-opacity="${o}"` : ''}/>`;
  return `<svg class="coin" aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 10 10" shape-rendering="crispEdges" style="opacity:${opacity}">` +
    r(3, 1, 4, 1, color) + r(1, 2, 8, 6, color) + r(3, 8, 4, 1, color) +
    r(3, 1, 1, 1, '#fff', .75) + r(1, 2, 2, 1, '#fff', .75) + r(1, 3, 1, 4, '#fff', .75) + r(4, 4, 2, 2, '#fff', .75) +
    r(8, 2, 1, 6, shade) + r(3, 8, 4, 1, shade) + r(7, 7, 1, 1, shade) +
    r(3, 0, 4, 1, '#000') + r(1, 1, 2, 1, '#000') + r(7, 1, 2, 1, '#000') + r(0, 2, 1, 6, '#000') + r(9, 2, 1, 6, '#000') +
    r(1, 8, 2, 1, '#000') + r(7, 8, 2, 1, '#000') + r(3, 9, 4, 1, '#000') +
    '</svg>';
}

// FLIP animation: call before re-render to capture, run returned fn after.
function flipAnimate(container, selector, scale = 1) {
  const before = new Map();
  container.querySelectorAll(selector).forEach((el) => before.set(el.dataset.id, el.getBoundingClientRect().top));
  return () => {
    container.querySelectorAll(selector).forEach((el) => {
      const old = before.get(el.dataset.id);
      if (old == null) return;
      const dy = (old - el.getBoundingClientRect().top) / scale;
      if (!dy) return;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  };
}

// Pressed feel: makes :active work on iOS, and holds the pressed look briefly
// so a quick tap is still visible.
document.addEventListener('touchstart', () => {}, { passive: true });
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  b.classList.add('pressed');
  const up = () => setTimeout(() => b.classList.remove('pressed'), 90);
  b.addEventListener('pointerup', up, { once: true });
  b.addEventListener('pointerleave', up, { once: true });
});

// ---------- settings (saved per browser) ----------
const Settings = {
  data: Object.assign({ volume: 0.6, muted: false, clicks: true, debug: false }, JSON.parse(localStorage.getItem('top3-settings') || '{}')),
  set(k, v) { this.data[k] = v; localStorage.setItem('top3-settings', JSON.stringify(this.data)); }
};

// ---------- 8-bit sound effects (generated, no audio files) ----------
const Sfx = (() => {
  let ctx = null;
  const ac = () => {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  // notes: [[freqHz, durSec], ...] played in sequence on a square/triangle wave
  function seq(notes, { type = 'square', gap = 0, vol = 0.18 } = {}) {
    if (Settings.data.muted || Settings.data.volume <= 0) return;
    const a = ac(); if (!a) return;
    let t = a.currentTime + 0.01;
    for (const [f, d] of notes) {
      if (f) {
        const o = a.createOscillator(), g = a.createGain();
        o.type = type; o.frequency.setValueAtTime(f, t);
        const v = vol * Settings.data.volume;
        g.gain.setValueAtTime(v, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(a.destination);
        o.start(t); o.stop(t + d + 0.02);
      }
      t += d + gap;
    }
  }
  return {
    unlock: ac,
    click: () => seq([[660, 0.04]], { vol: 0.08 }),
    join: () => seq([[523, 0.07], [784, 0.1]]),
    leave: () => seq([[392, 0.08], [262, 0.12]]),
    flip: () => seq([[880, 0.05], [1175, 0.08]], { type: 'triangle', vol: 0.25 }),
    coin: () => seq([[988, 0.05], [1319, 0.14]], { vol: 0.12 }),
    tick: () => seq([[1568, 0.025]], { vol: 0.05 }),
    uncoin: () => seq([[659, 0.06]], { vol: 0.08 }),
    promote: () => seq([[523, 0.06], [659, 0.06], [784, 0.06], [1047, 0.16]]),
    phase: () => seq([[392, 0.08], [523, 0.08], [659, 0.12]], { type: 'triangle', vol: 0.25 }),
    merge: () => seq([[330, 0.06], [494, 0.06], [659, 0.12]], { type: 'triangle', vol: 0.25 }),
    drum: () => seq([[110, 0.06], [0, 0.06], [110, 0.06], [0, 0.06], [110, 0.06]], { type: 'triangle', vol: 0.3 }),
    fanfare: () => seq([[523, 0.12], [523, 0.12], [523, 0.12], [698, 0.4], [880, 0.2], [784, 0.12], [1047, 0.6]], { vol: 0.16, gap: 0.02 })
  };
})();
document.addEventListener('pointerdown', (e) => { Sfx.unlock(); if (e.target.closest('button') && Settings.data.clicks) Sfx.click(); }, true);

const PHASE_LABEL = { lobby: 'LOBBY', submit: 'SUBMIT', reveal: 'REVEAL', vote: 'VOTE', final: 'FINAL', results: 'RESULTS' };
