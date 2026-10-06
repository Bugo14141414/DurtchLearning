(() => {
const KEY = 'dutch-learning-v1';
const BOX_DAYS = [0, 1, 2, 4, 8, 16, 32];
const NEW_PER_DAY = 10, SESSION_MAX = 25;
const DAY = 86400000;
const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / DAY);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let S = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.cards) return s; } catch (e) {}
  return { cards: STARTER.map((c, i) => ({ id: 's' + i, nl: c[0], en: c[1], type: c[2], cat: c[3], box: 0, due: 0, seen: false })),
           log: {}, streak: 0, lastDay: null, dir: 'nl-en', cat: 'All' };
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const $ = s => document.querySelector(s);
const view = $('#view');
let tab = 'learn', session = null;

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/…/g, ''));
  const v = speechSynthesis.getVoices().find(v => /^nl/i.test(v.lang));
  u.lang = v ? v.lang : 'nl-NL'; if (v) u.voice = v; u.rate = 0.9;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

function pool() { return S.cards.filter(c => S.cat === 'All' || c.cat === S.cat); }
function buildSession() {
  const t = today(), p = pool();
  const due = p.filter(c => c.seen && c.due <= t).sort((a, b) => a.due - b.due);
  const newDone = (S.log[t] && S.log[t].new) || 0;
  const fresh = p.filter(c => !c.seen).slice(0, Math.max(0, NEW_PER_DAY - newDone));
  return { queue: [...due, ...fresh].slice(0, SESSION_MAX), i: 0, shown: false, done: 0, dueCount: due.length };
}

function grade(c, g) { // 0 again, 1 good, 2 easy
  const t = today();
  const L = S.log[t] = S.log[t] || { new: 0, reviews: 0 };
  if (!c.seen) { c.seen = true; L.new++; }
  c.box = g === 0 ? 0 : Math.min(BOX_DAYS.length - 1, c.box + (g === 2 ? 2 : 1));
  c.due = t + BOX_DAYS[c.box];
  L.reviews++;
  if (S.lastDay !== t) { S.streak = S.lastDay === t - 1 ? S.streak + 1 : 1; S.lastDay = t; }
  save();
}

function renderLearn() {
  if (!session) session = buildSession();
  const s = session, c = s.queue[s.i];
  if (!c) {
    view.innerHTML = `<h1>Learn</h1><div class="card center"><div class="big">🎉</div><h2>${s.queue.length ? 'Session done!' : 'Nothing due'}</h2>
      <p class="mute">${s.queue.length ? 'Nice work — ' + s.done + ' cards reviewed.' : 'Come back later, or add your own cards.'}</p></div>
      <button class="btn" id="again">Check for more</button>`;
    $('#again').onclick = () => { session = buildSession(); render(); };
    return;
  }
  const fwd = S.dir === 'nl-en' || (S.dir === 'mix' && c.id.length % 2 === 0);
  const q = fwd ? c.nl : c.en, a = fwd ? c.en : c.nl;
  view.innerHTML = `<h1>Learn</h1>
    <div class="prog"><i style="width:${s.i / s.queue.length * 100}%"></i></div>
    <div class="card flash" id="flash"><span class="tag">${esc(c.cat)} · ${c.type}</span>
      <div>${esc(q)}</div>
      ${s.shown ? `<div class="ans">${esc(a)}</div>` : '<div class="hint">tap to reveal</div>'}
      <button class="speak" id="spk" aria-label="Listen">🔊</button></div>
    ${s.shown ? `<div class="row grade"><button class="btn again" data-g="0">Again</button><button class="btn good" data-g="1">Good</button><button class="btn easy" data-g="2">Easy</button></div>` : ''}`;
  $('#spk').onclick = e => { e.stopPropagation(); speak(c.nl); };
  $('#flash').onclick = () => { if (!s.shown) { s.shown = true; speak(c.nl); render(); } };
  view.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    const g = +b.dataset.g; grade(c, g);
    if (g === 0) s.queue.push(c); else s.done++;
    s.i++; s.shown = false; render();
  });
}

function renderCards() {
  const cats = ['All', ...new Set(S.cards.map(c => c.cat))];
  view.innerHTML = `<h1>Cards</h1>
    <h2>Study</h2>
    <div>${cats.map(k => `<span class="chip ${S.cat === k ? 'on' : ''}" data-cat="${esc(k)}">${esc(k)}</span>`).join('')}</div>
    <select id="dir"><option value="nl-en">Dutch → English</option><option value="en-nl">English → Dutch</option><option value="mix">Mixed</option></select>
    <h2>Add your own</h2>
    <input id="nl" placeholder="Dutch" autocapitalize="none"><input id="en" placeholder="English">
    <select id="type"><option value="word">Word</option><option value="phrase">Phrase</option></select>
    <input id="cat" placeholder="Category (e.g. Work)" value="Mine">
    <button class="btn" id="add">Add card</button>
    <h2>All cards (${pool().length})</h2>
    ${pool().slice().reverse().map(c => `<div class="item"><div><b>${esc(c.nl)}</b><br><small>${esc(c.en)} · ${esc(c.cat)}</small></div><button class="del" data-del="${c.id}">✕</button></div>`).join('')}
    <h2>Backup</h2><div class="row"><button class="btn alt" id="exp">Export</button><button class="btn alt" id="imp">Import</button></div>`;
  $('#dir').value = S.dir;
  $('#dir').onchange = e => { S.dir = e.target.value; save(); session = null; };
  view.querySelectorAll('[data-cat]').forEach(el => el.onclick = () => { S.cat = el.dataset.cat; save(); session = null; render(); });
  $('#add').onclick = () => {
    const nl = $('#nl').value.trim(), en = $('#en').value.trim();
    if (!nl || !en) return;
    S.cards.push({ id: 'u' + Date.now(), nl, en, type: $('#type').value, cat: $('#cat').value.trim() || 'Mine', box: 0, due: 0, seen: false });
    save(); session = null; render();
  };
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (confirm('Delete this card?')) { S.cards = S.cards.filter(c => c.id !== b.dataset.del); save(); session = null; render(); }
  });
  $('#exp').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' }));
    a.download = 'dutch-backup.json'; a.click();
  };
  $('#imp').onclick = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json';
    i.onchange = async () => { try { const d = JSON.parse(await i.files[0].text()); if (!d.cards) throw 0; S = d; save(); session = null; render(); } catch (e) { alert('Invalid backup file'); } };
    i.click();
  };
}

function renderStats() {
  const t = today(), seen = S.cards.filter(c => c.seen);
  const L = S.log[t] || { new: 0, reviews: 0 };
  const mastered = S.cards.filter(c => c.box >= 4).length;
  const dueNow = seen.filter(c => c.due <= t).length;
  const streak = S.lastDay >= t - 1 ? S.streak : 0;
  view.innerHTML = `<h1>Stats</h1>
    <div class="card center"><div class="big">🔥 ${streak}</div><div class="mute">day streak</div></div>
    <div class="card row"><div class="stat"><b>${L.reviews}</b><small>today</small></div><div class="stat"><b>${dueNow}</b><small>due</small></div></div>
    <div class="card row"><div class="stat"><b>${seen.length}</b><small>learning</small></div><div class="stat"><b>${mastered}</b><small>mastered</small></div><div class="stat"><b>${S.cards.length - seen.length}</b><small>new</small></div></div>`;
}

function render() { ({ learn: renderLearn, cards: renderCards, stats: renderStats })[tab](); view.scrollTop = 0; }
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  tab = b.dataset.tab; if (tab === 'learn') session = null;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b)); render();
});
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
