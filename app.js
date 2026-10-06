(() => {
const KEY = 'dutch-learning-v1';
const BOX_DAYS = [0, 1, 2, 4, 8, 16, 32];
const NEW_PER_DAY = 10, SESSION_MAX = 25; // new cards per category per day
const DAY = 86400000;
const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / DAY);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const EMOJI = Object.fromEntries(CATEGORIES.map(c => [c.name, c.emoji]));

function starterCards() {
  return CATEGORIES.flatMap(cat => cat.cards.map(([nl, en, note]) => ({
    id: 'k:' + nl, nl, en, note: note || '', cat: cat.name,
    type: /\s/.test(nl.trim()) ? 'phrase' : 'word', box: 0, due: 0, seen: false })));
}

let S = load();
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!s || !s.cards) s = { cards: [], log: {}, streak: 0, lastDay: null, dir: 'nl-en', cat: 'All' };
  // Merge the built-in deck: keep progress for cards that still exist (matched by Dutch text),
  // keep the user's own cards, drop built-in cards that were removed from the deck.
  const old = Object.fromEntries(s.cards.map(c => [c.nl, c]));
  const fresh = starterCards().map(c => {
    const o = old[c.nl];
    return o ? { ...c, box: o.box, due: o.due, seen: o.seen } : c;
  });
  s.cards = [...fresh, ...s.cards.filter(c => c.id.startsWith('u'))];
  return s;
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
save();
const $ = s => document.querySelector(s);
const view = $('#view');
let tab = 'learn', session = null;

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[…()]/g, ''));
  const voices = speechSynthesis.getVoices();
  const v = voices.find(v => /^nl[-_]BE/i.test(v.lang)) || voices.find(v => /^nl/i.test(v.lang));
  u.lang = v ? v.lang : 'nl-BE'; if (v) u.voice = v; u.rate = 0.9;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

const cats = () => [...new Set(S.cards.map(c => c.cat))];
const inCat = cat => S.cards.filter(c => cat === 'All' || c.cat === cat);
const dueIn = cat => inCat(cat).filter(c => c.seen && c.due <= today()).length;

function buildSession(cat) {
  const t = today(), p = inCat(cat);
  const due = p.filter(c => c.seen && c.due <= t).sort((a, b) => a.due - b.due);
  const L = S.log[t] || {};
  const used = (L.newByCat && L.newByCat[cat]) || 0;
  const fresh = cat === 'All' ? [] : p.filter(c => !c.seen).slice(0, Math.max(0, NEW_PER_DAY - used));
  return { cat, queue: [...due, ...fresh].slice(0, SESSION_MAX), i: 0, shown: false, done: 0 };
}

function grade(c, g, cat) { // 0 again, 1 good, 2 easy
  const t = today();
  const L = S.log[t] = S.log[t] || { new: 0, reviews: 0 };
  L.newByCat = L.newByCat || {};
  if (!c.seen) { c.seen = true; L.new++; L.newByCat[cat] = (L.newByCat[cat] || 0) + 1; }
  c.box = g === 0 ? 0 : Math.min(BOX_DAYS.length - 1, c.box + (g === 2 ? 2 : 1));
  c.due = t + BOX_DAYS[c.box];
  L.reviews++;
  if (S.lastDay !== t) { S.streak = S.lastDay === t - 1 ? S.streak + 1 : 1; S.lastDay = t; }
  save();
}

function renderHome() {
  const totalDue = dueIn('All');
  view.innerHTML = `<h1>Learn</h1>
    ${totalDue ? `<button class="btn" id="all">Review ${totalDue} due card${totalDue > 1 ? 's' : ''}</button>` : ''}
    <h2>Pick a situation</h2>
    <div class="grid">${cats().map(k => {
      const p = inCat(k), seen = p.filter(c => c.seen).length, d = dueIn(k);
      return `<button class="tile" data-cat="${esc(k)}">
        <span class="emo">${EMOJI[k] || '📝'}</span><b>${esc(k)}</b>
        <small>${seen}/${p.length} learned${d ? ` · <em>${d} due</em>` : ''}</small>
        <span class="bar"><i style="width:${seen / p.length * 100}%"></i></span></button>`;
    }).join('')}</div>`;
  if (totalDue) $('#all').onclick = () => { session = buildSession('All'); render(); };
  view.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { session = buildSession(b.dataset.cat); render(); });
}

function renderLearn() {
  if (!session) return renderHome();
  const s = session, c = s.queue[s.i];
  const title = `${EMOJI[s.cat] || '🔁'} ${esc(s.cat === 'All' ? 'Review' : s.cat)}`;
  if (!c) {
    view.innerHTML = `<h1>${title}</h1><div class="card center"><div class="big">🎉</div>
      <h2>${s.queue.length ? 'Done!' : 'All caught up'}</h2>
      <p class="mute">${s.queue.length ? `${s.done} cards practised. You're getting there!` : 'No new or due cards here today. Try another situation.'}</p></div>
      <button class="btn" id="back">Back to situations</button>`;
    $('#back').onclick = () => { session = null; render(); };
    return;
  }
  const fwd = S.dir === 'nl-en' || (S.dir === 'mix' && (c.nl.length + s.i) % 2 === 0);
  const q = fwd ? c.nl : c.en, a = fwd ? c.en : c.nl;
  const hear = c.note.startsWith('👂');
  view.innerHTML = `<div class="top"><button class="x" id="back" aria-label="Back">‹</button><h1>${title}</h1></div>
    <div class="prog"><i style="width:${s.i / s.queue.length * 100}%"></i></div>
    <div class="card flash" id="flash"><span class="tag">${hear ? '👂 you\'ll hear' : '🗣️ you say'}${c.seen ? '' : ' · new'}</span>
      <div>${esc(q)}</div>
      ${s.shown ? `<div class="ans">${esc(a)}</div>${c.note ? `<div class="hint">${esc(c.note.replace(/^👂\s*/, ''))}</div>` : ''}`
                : '<div class="hint">tap to reveal</div>'}
      <button class="speak" id="spk" aria-label="Listen">🔊</button></div>
    ${s.shown ? `<div class="row grade"><button class="btn again" data-g="0">Again</button><button class="btn good" data-g="1">Good</button><button class="btn easy" data-g="2">Easy</button></div>` : ''}`;
  $('#back').onclick = () => { session = null; render(); };
  $('#spk').onclick = e => { e.stopPropagation(); speak(c.nl); };
  $('#flash').onclick = () => { if (!s.shown) { s.shown = true; speak(c.nl); render(); } };
  view.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    const g = +b.dataset.g; grade(c, g, s.cat);
    if (g === 0) s.queue.push(c); else s.done++;
    s.i++; s.shown = false; render();
  });
}

function renderCards() {
  const list = inCat(S.cat);
  view.innerHTML = `<h1>Cards</h1>
    <h2>Direction</h2>
    <select id="dir"><option value="nl-en">Dutch → English</option><option value="en-nl">English → Dutch</option><option value="mix">Mixed</option></select>
    <h2>Add your own</h2>
    <input id="nl" placeholder="Dutch" autocapitalize="none"><input id="en" placeholder="English">
    <select id="cat">${cats().map(k => `<option>${esc(k)}</option>`).join('')}<option value="__new">+ New category…</option></select>
    <input id="newcat" placeholder="New category name" hidden>
    <button class="btn" id="add">Add card</button>
    <h2>Browse</h2>
    <div>${['All', ...cats()].map(k => `<span class="chip ${S.cat === k ? 'on' : ''}" data-cat="${esc(k)}">${EMOJI[k] || ''} ${esc(k)}</span>`).join('')}</div>
    ${list.map(c => `<div class="item"><div><b>${esc(c.nl)}</b><br><small>${esc(c.en)}${S.cat === 'All' ? ' · ' + esc(c.cat) : ''}</small></div>
      <div class="acts"><button class="del" data-say="${esc(c.nl)}">🔊</button>${c.id.startsWith('u') ? `<button class="del" data-del="${c.id}">✕</button>` : ''}</div></div>`).join('')}
    <h2>Backup</h2><div class="row"><button class="btn alt" id="exp">Export</button><button class="btn alt" id="imp">Import</button></div>`;
  $('#dir').value = S.dir;
  $('#dir').onchange = e => { S.dir = e.target.value; save(); };
  $('#cat').onchange = e => { $('#newcat').hidden = e.target.value !== '__new'; };
  view.querySelectorAll('[data-cat]').forEach(el => el.onclick = () => { S.cat = el.dataset.cat; save(); render(); });
  view.querySelectorAll('[data-say]').forEach(b => b.onclick = () => speak(b.dataset.say));
  $('#add').onclick = () => {
    const nl = $('#nl').value.trim(), en = $('#en').value.trim();
    const cat = $('#cat').value === '__new' ? $('#newcat').value.trim() || 'Mine' : $('#cat').value;
    if (!nl || !en) return;
    S.cards.push({ id: 'u' + Date.now(), nl, en, note: '', type: /\s/.test(nl) ? 'phrase' : 'word', cat, box: 0, due: 0, seen: false });
    save(); render();
  };
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (confirm('Delete this card?')) { S.cards = S.cards.filter(c => c.id !== b.dataset.del); save(); render(); }
  });
  $('#exp').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' }));
    a.download = 'dutch-backup.json'; a.click();
  };
  $('#imp').onclick = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json';
    i.onchange = async () => {
      try { const d = JSON.parse(await i.files[0].text()); if (!d.cards) throw 0;
        localStorage.setItem(KEY, JSON.stringify(d)); S = load(); save(); render();
      } catch (e) { alert('Invalid backup file'); }
    };
    i.click();
  };
}

function renderStats() {
  const t = today(), seen = S.cards.filter(c => c.seen);
  const L = S.log[t] || { new: 0, reviews: 0 };
  const mastered = S.cards.filter(c => c.box >= 4).length;
  const streak = S.lastDay >= t - 1 ? S.streak : 0;
  view.innerHTML = `<h1>Stats</h1>
    <div class="card center"><div class="big">🔥 ${streak}</div><div class="mute">day streak</div></div>
    <div class="card row"><div class="stat"><b>${L.reviews}</b><small>today</small></div><div class="stat"><b>${dueIn('All')}</b><small>due</small></div></div>
    <div class="card row"><div class="stat"><b>${seen.length}</b><small>learning</small></div><div class="stat"><b>${mastered}</b><small>mastered</small></div><div class="stat"><b>${S.cards.length - seen.length}</b><small>new</small></div></div>
    <h2>By situation</h2>
    ${cats().map(k => { const p = inCat(k), m = p.filter(c => c.box >= 4).length, sn = p.filter(c => c.seen).length;
      return `<div class="item"><div>${EMOJI[k] || '📝'} ${esc(k)}</div><small>${sn}/${p.length} learned · ${m} mastered</small></div>`; }).join('')}`;
}

function render() { ({ learn: renderLearn, cards: renderCards, stats: renderStats })[tab](); view.scrollTop = 0; }
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  tab = b.dataset.tab; if (tab === 'learn') session = null;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b)); render();
});
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
