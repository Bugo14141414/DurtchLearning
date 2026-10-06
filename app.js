(() => {
const KEY = 'dutch-learning-v1';
const BOX_DAYS = [0, 1, 2, 4, 8, 16, 32];
const NEW_PER_DAY = 10, SESSION_MAX = 25; // flashcards: new cards per category per day
const PASS = 0.9, QUESTIONS = 10, MASTER_QUESTIONS = 15, DAILY_GOAL = 50;
const DAY = 86400000;
const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / DAY);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const EMOJI = Object.fromEntries(CATEGORIES.map(c => [c.name, c.emoji]));
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const LEVELS = [
  { icon: '👀', name: 'Recognise', desc: 'See Dutch, pick the English', type: 'mc-nl-en' },
  { icon: '🧠', name: 'Recall', desc: 'See English, pick the Dutch', type: 'mc-en-nl' },
  { icon: '🎧', name: 'Listen', desc: 'Hear Dutch, pick the meaning', type: 'mc-audio' },
  { icon: '🧩', name: 'Build', desc: 'Put the words in the right order', type: 'build' },
  { icon: '✍️', name: 'Write', desc: 'Type the Dutch yourself', type: 'write' },
  { icon: '📝', name: 'Dictation', desc: 'Type what you hear', type: 'dictation' },
  { icon: '🎤', name: 'Speak', desc: 'Say it out loud', type: 'speak' },
  { icon: '👑', name: 'Master', desc: `Final test — ${MASTER_QUESTIONS} mixed hard questions`, type: 'mix' },
];
const MIX_TYPES = ['mc-audio', 'build', 'write', 'dictation', 'speak'];

// ---------- state ----------
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
  s.lv = s.lv || {}; s.xp = s.xp || 0; s.xpLog = s.xpLog || {}; if (s.sound === undefined) s.sound = true;
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
let tab = 'learn', session = null, openCat = null, quiz = null;

const cats = () => [...new Set(S.cards.map(c => c.cat))];
const inCat = cat => S.cards.filter(c => cat === 'All' || c.cat === cat);
const dueIn = cat => inCat(cat).filter(c => c.seen && c.due <= today()).length;
const best = (cat, i) => (S.lv[cat] || {})[i] || 0;
const unlocked = (cat, i) => i === 0 || best(cat, i - 1) >= PASS;
const currentLevel = cat => { let i = 0; while (i < LEVELS.length && best(cat, i) >= PASS) i++; return i; };
const stars = p => p >= 1 ? '⭐⭐⭐' : p >= 0.95 ? '⭐⭐' : p >= PASS ? '⭐' : '';
const todayXP = () => S.xpLog[today()] || 0;

function markActive() {
  const t = today();
  if (S.lastDay !== t) { S.streak = S.lastDay === t - 1 ? S.streak + 1 : 1; S.lastDay = t; }
}
function addXP(n) { S.xp += n; S.xpLog[today()] = todayXP() + n; }

// ---------- audio ----------
function speak(text, slow) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[…()]/g, ''));
  const voices = speechSynthesis.getVoices();
  const v = voices.find(v => /^nl[-_]BE/i.test(v.lang)) || voices.find(v => /^nl/i.test(v.lang));
  u.lang = v ? v.lang : 'nl-BE'; if (v) u.voice = v; u.rate = slow ? 0.55 : 0.9;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
if ('speechSynthesis' in window) speechSynthesis.getVoices();

let actx;
function fx(ok) {
  if (navigator.vibrate) navigator.vibrate(ok ? 30 : [60, 40, 60]);
  if (!S.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    (ok ? [660, 880] : [220, 175]).forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), s = t + i * 0.12;
      o.type = ok ? 'sine' : 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(ok ? 0.2 : 0.06, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.15);
      o.connect(g).connect(actx.destination); o.start(s); o.stop(s + 0.16);
    });
  } catch (e) {}
}

// ---------- answer checking ----------
const UNITS = ['nul','een','twee','drie','vier','vijf','zes','zeven','acht','negen','tien','elf','twaalf','dertien','veertien','vijftien','zestien','zeventien','achttien','negentien'];
const TENS = ['', '', 'twintig','dertig','veertig','vijftig','zestig','zeventig','tachtig','negentig'];
const numNl = n => n < 20 ? UNITS[n] : n === 100 ? 'honderd' : (n % 10 ? UNITS[n % 10] + 'en' : '') + TENS[n / 10 | 0];
// Lowercase, drop accents and punctuation, and spell out digits (speech recognition returns "12", not "twaalf").
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\d+/g, d => +d <= 100 ? ' ' + numNl(+d) + ' ' : d)
  .replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Text in brackets is optional: "Hoe gaat het (met je)?" accepts both forms.
const variants = t => [...new Set([t.replace(/\([^)]*\)/g, ' '), t.replace(/[()]/g, ' ')].map(norm))];
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// Every Dutch card with the same English meaning is a valid answer ("Anything else?" has two).
const answersFor = card => [...new Set(S.cards.filter(c => norm(c.en) === norm(card.en)).flatMap(c => variants(c.nl)))];
function checkText(input, card) {
  const n = norm(input);
  if (!n) return 'wrong';
  let d = Infinity, len = 1;
  for (const v of answersFor(card)) { const x = lev(n, v); if (x < d) { d = x; len = v.length; } }
  return d === 0 ? 'right' : d <= Math.max(1, Math.floor(len / 8)) ? 'typo' : 'wrong';
}
function speechScore(alts, card) {
  let top = 0;
  for (const a of alts) for (const v of answersFor(card)) {
    const x = norm(a); top = Math.max(top, 1 - lev(x, v) / Math.max(x.length, v.length, 1));
  }
  return top;
}
const tokens = nl => nl.replace(/[()]/g, '').split(/\s+/).filter(t => t && norm(t));

// ---------- quiz building ----------
function distract(card, field) {
  // Skip cards sharing either side with this one, so there's never a second correct option.
  const seen = new Set([norm(card.nl), norm(card.en)]);
  let pool = shuffle(inCat(card.cat).filter(c => c !== card));
  if (pool.length < 6) pool = pool.concat(shuffle(S.cards.filter(c => c.cat !== card.cat)));
  pool.sort((a, b) => (a.type !== card.type) - (b.type !== card.type)); // prefer same kind (word vs phrase)
  const out = [];
  for (const c of pool) {
    const k = norm(c[field]), other = norm(c[field === 'nl' ? 'en' : 'nl']);
    if (!seen.has(k) && !seen.has(other)) { seen.add(k); out.push(c[field]); }
    if (out.length === 3) break;
  }
  return out;
}
function makeQ(card, type) {
  if (type === 'speak' && !SR) type = 'write';
  const toks = tokens(card.nl);
  if (type === 'build' && toks.length < 3) type = 'mc-en-nl';
  const q = { card, type };
  if (type.startsWith('mc')) {
    const field = type === 'mc-en-nl' ? 'nl' : 'en';
    q.answer = card[field]; q.options = shuffle([card[field], ...distract(card, field)]);
  }
  if (type === 'build') {
    const have = new Set(toks.map(norm)), extra = [];
    for (const c of shuffle(inCat(card.cat))) for (const t of tokens(c.nl)) {
      if (extra.length < (toks.length > 5 ? 3 : 2) && !have.has(norm(t))) { have.add(norm(t)); extra.push(t); }
    }
    q.tiles = shuffle([...toks, ...extra]); q.chosen = [];
  }
  return q;
}
function startQuiz(cat, li, jump) {
  const L = LEVELS[li], n = L.type === 'mix' ? MASTER_QUESTIONS : QUESTIONS, cards = inCat(cat);
  if (!cards.length) return;
  // Favour cards you're weakest on, cycling through the deck if it's smaller than the quiz.
  let picked = [];
  while (picked.length < n) picked = picked.concat(cards.map(c => ({ c, k: (c.box || 0) + Math.random() * 3 })).sort((a, b) => a.k - b.k).map(x => x.c));
  const qs = picked.slice(0, n).map((c, i) => makeQ(c, L.type === 'mix' ? MIX_TYPES[i % MIX_TYPES.length] : L.type));
  quiz = { cat, li, jump, qs: L.type === 'mix' ? shuffle(qs) : qs, total: n, i: 0, score: 0, combo: 0, xp: 0, mistakes: [], fb: null, tries: 0, heard: '' };
  render();
}

function answer(result) {
  const z = quiz, q = z.qs[z.i], ok = result !== 'wrong', c = q.card, t = today();
  z.fb = { ok, typo: result === 'typo' };
  if (!q.retry) {
    if (ok) { z.score++; z.combo++; z.xp += z.combo >= 5 ? 15 : 10; }
    else { z.combo = 0; z.mistakes.push(c); }
  }
  if (!ok && !q.retry) z.qs.push({ ...makeQ(c, q.type), retry: true }); // "fix your mistakes" round at the end
  // Feed results into flashcard scheduling: misses come back up for review today.
  if (ok) { if (!c.seen) { c.seen = true; c.box = 1; c.due = t + 1; } }
  else { c.seen = true; c.box = 0; c.due = t; }
  markActive(); save(); fx(ok);
  if (q.type !== 'dictation') setTimeout(() => speak(c.nl), 250);
  render();
}
function nextQ() {
  const z = quiz; z.fb = null; z.tries = 0; z.heard = ''; z.err = ''; z.listening = false; z.i++;
  if (z.i >= z.qs.length) {
    const pct = z.score / z.total, passed = pct >= PASS, prev = best(z.cat, z.li);
    const lv = S.lv[z.cat] = S.lv[z.cat] || {};
    lv[z.li] = Math.max(prev, pct);
    if (passed && z.jump) for (let j = 0; j < z.li; j++) lv[j] = Math.max(lv[j] || 0, PASS);
    const bonus = passed ? 20 + (pct === 1 ? 10 : 0) : 0;
    addXP(z.xp + bonus); save();
    z.done = { pct, passed, bonus, unlockedNext: passed && prev < PASS && z.li + 1 < LEVELS.length };
  }
  render();
}

// ---------- quiz screens ----------
const PRAISE = ['Correct!', 'Nice!', 'Great!', 'Goed zo!', 'Super!', 'Perfect!'];
function renderQuiz() {
  const z = quiz;
  if (z.done) return renderResult();
  const q = z.qs[z.i], c = q.card, fb = z.fb;
  const audio = `<div class="audio"><button class="speak big-spk" data-say="0">🔊</button><button class="speak" data-say="1" aria-label="Slow">🐢</button></div>`;
  const opts = () => `<div class="opts">${q.options.map((o, i) => {
    const cls = fb ? (o === q.answer ? 'right' : i === q.picked ? 'wrong' : 'dim') : '';
    return `<button class="opt ${cls}" data-opt="${i}" ${fb ? 'disabled' : ''}>${esc(o)}</button>`; }).join('')}</div>`;
  const input = `<input id="inp" class="answer-in" placeholder="Type in Dutch…" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" value="${esc(z.typed || '')}" ${fb ? 'disabled' : ''}>`;
  let body = '', check = false;
  switch (q.type) {
    case 'mc-nl-en': body = `<h3>What does this mean?</h3><div class="prompt">${esc(c.nl)} <button class="speak sm" data-say="0">🔊</button></div>${opts()}`; break;
    case 'mc-en-nl': body = `<h3>How do you say this in Dutch?</h3><div class="prompt">${esc(c.en)}</div>${opts()}`; break;
    case 'mc-audio': body = `<h3>What did you hear?</h3>${audio}${opts()}`; break;
    case 'build':
      body = `<h3>Build it in Dutch</h3><div class="prompt">${esc(c.en)}</div>
        <div class="line">${q.chosen.map((ti, k) => `<button class="wt" data-un="${k}" ${fb ? 'disabled' : ''}>${esc(q.tiles[ti])}</button>`).join('')}</div>
        <div class="bank">${q.tiles.map((t, i) => `<button class="wt ${q.chosen.includes(i) ? 'used' : ''}" data-tk="${i}" ${fb ? 'disabled' : ''}>${esc(t)}</button>`).join('')}</div>`;
      check = q.chosen.length > 0; break;
    case 'write': body = `<h3>Write this in Dutch</h3><div class="prompt">${esc(c.en)}</div>${input}`; check = true; break;
    case 'dictation': body = `<h3>Type what you hear</h3>${audio}${input}`; check = true; break;
    case 'speak':
      body = `<h3>Say this in Dutch</h3><div class="prompt">${esc(c.en)}</div>
        <button class="mic ${z.listening ? 'on' : ''}" id="mic" ${fb ? 'disabled' : ''}>🎤</button>
        <p class="center mute">${z.listening ? 'Listening… speak now' : z.err ? esc(z.err) : z.heard ? `Heard: “${esc(z.heard)}” — try again (${3 - z.tries} left)` : 'Tap the mic and say it'}</p>
        ${fb ? '' : '<button class="link" id="nomic">Can\'t speak now — type instead</button>'}`; break;
  }
  view.innerHTML = `<div class="qtop"><button class="x" id="quit" aria-label="Quit">✕</button>
      <div class="prog"><i style="width:${z.i / z.qs.length * 100}%"></i></div>${z.combo >= 3 ? `<span class="combo">🔥${z.combo}</span>` : ''}</div>
    ${q.retry ? '<div class="redo">↻ Fix your mistake</div>' : ''}
    <div class="qbody">${body}</div>
    ${fb ? `<div class="sheet ${fb.ok ? 'ok' : 'bad'}"><b>${fb.ok ? (fb.typo ? 'Almost — watch the spelling!' : PRAISE[Math.random() * PRAISE.length | 0]) : 'Not quite'}</b>
        <div class="pair"><b>${esc(c.nl)}</b> <button class="speak sm" data-say="0">🔊</button><br>${esc(c.en)}</div>
        ${c.note ? `<small>💡 ${esc(c.note.replace(/^👂\s*/, ''))}</small>` : ''}
        <button class="btn" id="next">Continue</button></div>`
      : check ? `<div class="bar-bottom"><button class="btn" id="check" ${q.type === 'build' && !q.chosen.length ? 'disabled' : ''}>Check</button></div>` : ''}`;

  $('#quit').onclick = () => { if (confirm('Quit this level? Your progress in this round will be lost.')) { quiz = null; render(); } };
  view.querySelectorAll('[data-say]').forEach(b => b.onclick = () => speak(c.nl, b.dataset.say === '1'));
  view.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => { q.picked = +b.dataset.opt; answer(q.options[q.picked] === q.answer ? 'right' : 'wrong'); });
  view.querySelectorAll('[data-tk]').forEach(b => b.onclick = () => { const i = +b.dataset.tk; if (!q.chosen.includes(i)) { q.chosen.push(i); render(); } });
  view.querySelectorAll('[data-un]').forEach(b => b.onclick = () => { q.chosen.splice(+b.dataset.un, 1); render(); });
  const inp = $('#inp');
  if (inp) {
    inp.oninput = () => { z.typed = inp.value; };
    inp.onkeydown = e => { if (e.key === 'Enter' && !fb) $('#check').click(); };
    if (!fb) inp.focus();
  }
  if ($('#check')) $('#check').onclick = () => {
    if (q.type === 'build') answer(variants(c.nl).includes(norm(q.chosen.map(i => q.tiles[i]).join(' '))) ? 'right' : 'wrong');
    else { z.typed = inp.value; if (inp.value.trim()) answer(checkText(inp.value, c)); }
  };
  if ($('#next')) $('#next').onclick = () => { z.typed = ''; nextQ(); };
  if ($('#nomic')) $('#nomic').onclick = () => { q.type = 'write'; render(); };
  if ($('#mic')) $('#mic').onclick = () => listen(z, q);
  if (!q.played && ['mc-nl-en', 'mc-audio', 'dictation'].includes(q.type)) { q.played = true; speak(c.nl); }
}

function listen(z, q) {
  if (z.listening) return;
  const r = new SR();
  r.lang = 'nl-NL'; r.interimResults = false; r.maxAlternatives = 5;
  const live = () => quiz === z && z.qs[z.i] === q && !z.fb;
  r.onresult = e => {
    if (!live()) return;
    const alts = [...e.results[0]].map(a => a.transcript);
    z.listening = false; z.err = ''; z.heard = alts[0];
    if (speechScore(alts, q.card) >= 0.8) return answer('right');
    if (++z.tries >= 3) return answer('wrong');
    fx(false); render();
  };
  r.onerror = e => {
    if (!live()) return;
    z.listening = false;
    z.err = e.error === 'no-speech' ? "Didn't catch that — tap the mic and try again"
      : e.error === 'network' ? 'Speech recognition needs internet — try again or type instead'
      : `Speech recognition error (${e.error}) — try again or type instead`;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { alert('Microphone access is blocked — switching to typing.'); q.type = 'write'; }
    render();
  };
  r.onend = () => { if (live() && z.listening) { z.listening = false; render(); } };
  z.listening = true; z.err = ''; render();
  try { r.start(); } catch (e) { z.listening = false; render(); }
}

function renderResult() {
  const z = quiz, d = z.done, L = LEVELS[z.li], pct = Math.round(d.pct * 100);
  const need = Math.ceil(PASS * z.total) - z.score;
  const uniq = [...new Set(z.mistakes)];
  view.innerHTML = `<div class="result center">
      <div class="big">${d.passed ? (d.pct === 1 ? '🏆' : '🎉') : '💪'}</div>
      <h1>${pct}%</h1><p class="mute">${z.score} / ${z.total} correct · ${L.icon} ${L.name}</p>
      ${d.passed ? `<div class="stars">${stars(d.pct)}</div><p><b>Level passed!</b>${d.unlockedNext ? `<br>Unlocked: ${LEVELS[z.li + 1].icon} ${LEVELS[z.li + 1].name}` : ''}</p>`
                 : `<p>You need <b>90%</b> to pass — ${need} more correct answer${need > 1 ? 's' : ''} next time. You've got this!</p>`}
      <span class="pill">+${z.xp + d.bonus} XP</span></div>
    ${uniq.length ? `<h2>Practise these</h2>${uniq.map(c => `<div class="item"><div><b>${esc(c.nl)}</b><br><small>${esc(c.en)}</small></div><button class="del" data-say="${esc(c.nl)}">🔊</button></div>`).join('')}` : ''}
    <div class="stack">
      ${d.passed && z.li + 1 < LEVELS.length ? '<button class="btn" id="go">Next level →</button>' : ''}
      <button class="btn ${d.passed ? 'alt' : ''}" id="retry">${d.passed ? 'Play again' : 'Try again'}</button>
      <button class="btn alt" id="done">Back to levels</button></div>`;
  view.querySelectorAll('[data-say]').forEach(b => b.onclick = () => speak(b.dataset.say));
  if ($('#go')) $('#go').onclick = () => startQuiz(z.cat, z.li + 1);
  $('#retry').onclick = () => startQuiz(z.cat, z.li);
  $('#done').onclick = () => { quiz = null; render(); };
}

// ---------- learn: home + category ----------
function renderHome() {
  const totalDue = dueIn('All'), xp = todayXP();
  const streak = S.lastDay >= today() - 1 ? S.streak : 0;
  view.innerHTML = `<div class="hero"><div><h1>Learn</h1><small class="mute">🔥 ${streak} day streak · ${S.xp} XP</small></div></div>
    <div class="card goal"><div class="row-sb"><b>Daily goal</b><small>${Math.min(xp, DAILY_GOAL)} / ${DAILY_GOAL} XP ${xp >= DAILY_GOAL ? '✅' : ''}</small></div>
      <div class="prog"><i style="width:${Math.min(1, xp / DAILY_GOAL) * 100}%"></i></div></div>
    ${totalDue ? `<button class="btn alt" id="all">🃏 Review ${totalDue} due flashcard${totalDue > 1 ? 's' : ''}</button>` : ''}
    <h2>Pick a situation</h2>
    <div class="grid">${cats().map(k => {
      const cur = currentLevel(k), p = inCat(k);
      return `<button class="tile" data-cat="${esc(k)}">
        <span class="lvbadge ${cur >= LEVELS.length ? 'max' : ''}">${cur >= LEVELS.length ? '👑 Done' : 'Lv ' + (cur + 1)}</span>
        <span class="emo">${EMOJI[k] || '📝'}</span><b>${esc(k)}</b>
        <small>${p.length} cards${dueIn(k) ? ` · <em>${dueIn(k)} due</em>` : ''}</small>
        <span class="bar"><i style="width:${cur / LEVELS.length * 100}%"></i></span></button>`;
    }).join('')}</div>`;
  if (totalDue) $('#all').onclick = () => { session = buildSession('All'); render(); };
  view.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { openCat = b.dataset.cat; render(); });
}

function renderCat() {
  const cat = openCat, cur = currentLevel(cat), due = dueIn(cat);
  view.innerHTML = `<div class="top"><button class="x" id="back" aria-label="Back">‹</button><h1>${EMOJI[cat] || '📝'} ${esc(cat)}</h1></div>
    <p class="mute">${cur >= LEVELS.length ? 'All levels mastered! 👑 Replay any level to keep sharp.' : `Level ${cur + 1} of ${LEVELS.length} · score 90% to unlock the next`}</p>
    <div class="path">${LEVELS.map((L, i) => {
      const b = best(cat, i), open = unlocked(cat, i);
      return `<button class="lvl ${open ? '' : 'locked'} ${i === cur ? 'cur' : ''} ${b >= PASS ? 'passed' : ''}" data-lv="${i}">
        <span class="ic">${open ? L.icon : '🔒'}</span>
        <span class="lt"><b>${i + 1}. ${L.name}</b><small>${L.desc}</small></span>
        <span class="st">${b >= PASS ? stars(b) : b ? `<small>best ${Math.round(b * 100)}%</small>` : i === cur ? '<small class="go">START</small>' : ''}</span></button>`;
    }).join('')}</div>
    ${SR ? '' : '<p class="mute small">🎤 Speech recognition isn\'t available in this browser — speaking questions will ask you to type instead.</p>'}
    <h2>Free practice</h2>
    <button class="btn alt" id="flash">🃏 Flashcards${due ? ` · ${due} due` : ''}</button>`;
  $('#back').onclick = () => { openCat = null; render(); };
  $('#flash').onclick = () => { session = buildSession(cat); render(); };
  view.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => {
    const i = +b.dataset.lv;
    if (unlocked(cat, i)) return startQuiz(cat, i);
    if (confirm(`Jump ahead to ${LEVELS[i].name}?\n\nScore 90% on this test and every level before it is unlocked too.`)) startQuiz(cat, i, true);
  });
}

// ---------- flashcards (spaced repetition) ----------
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
  if (g > 0) addXP(2);
  markActive(); save();
}
function renderFlash() {
  const s = session, c = s.queue[s.i];
  const title = `${EMOJI[s.cat] || '🔁'} ${esc(s.cat === 'All' ? 'Review' : s.cat)}`;
  const back = () => { session = null; render(); };
  if (!c) {
    view.innerHTML = `<h1>${title}</h1><div class="card center"><div class="big">🎉</div>
      <h2>${s.queue.length ? 'Done!' : 'All caught up'}</h2>
      <p class="mute">${s.queue.length ? `${s.done} cards practised. You're getting there!` : 'No new or due cards here today. Try a level instead!'}</p></div>
      <button class="btn" id="back">Back</button>`;
    $('#back').onclick = back;
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
  $('#back').onclick = back;
  $('#spk').onclick = e => { e.stopPropagation(); speak(c.nl); };
  $('#flash').onclick = () => { if (!s.shown) { s.shown = true; speak(c.nl); render(); } };
  view.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    const g = +b.dataset.g; grade(c, g, s.cat);
    if (g === 0) s.queue.push(c); else s.done++;
    s.i++; s.shown = false; render();
  });
}

// ---------- cards tab ----------
function renderCards() {
  const list = inCat(S.cat);
  view.innerHTML = `<h1>Cards</h1>
    <h2>Settings</h2>
    <select id="dir"><option value="nl-en">Flashcards: Dutch → English</option><option value="en-nl">Flashcards: English → Dutch</option><option value="mix">Flashcards: Mixed</option></select>
    <label class="toggle"><input type="checkbox" id="snd" ${S.sound ? 'checked' : ''}> Sound effects</label>
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
  $('#snd').onchange = e => { S.sound = e.target.checked; save(); };
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

// ---------- stats tab ----------
function renderStats() {
  const seen = S.cards.filter(c => c.seen);
  const mastered = S.cards.filter(c => c.box >= 4).length;
  const streak = S.lastDay >= today() - 1 ? S.streak : 0;
  const passed = cats().reduce((n, k) => n + LEVELS.filter((_, i) => best(k, i) >= PASS).length, 0);
  view.innerHTML = `<h1>Stats</h1>
    <div class="card row"><div class="stat"><b>🔥 ${streak}</b><small>day streak</small></div><div class="stat"><b>${S.xp}</b><small>total XP</small></div><div class="stat"><b>${todayXP()}</b><small>XP today</small></div></div>
    <div class="card row"><div class="stat"><b>${passed}</b><small>levels passed</small></div><div class="stat"><b>${seen.length}</b><small>cards seen</small></div><div class="stat"><b>${mastered}</b><small>mastered</small></div></div>
    <h2>By situation</h2>
    ${cats().map(k => { const cur = currentLevel(k);
      return `<div class="item"><div>${EMOJI[k] || '📝'} ${esc(k)}</div><small>${cur >= LEVELS.length ? '👑 Mastered' : `Level ${cur + 1} · ${LEVELS[cur].name}`}</small></div>`; }).join('')}`;
}

// ---------- router ----------
function render() {
  const focus = tab === 'learn' && (quiz || session);
  document.body.classList.toggle('focus', !!focus);
  if (tab === 'learn') (quiz ? renderQuiz : session ? renderFlash : openCat ? renderCat : renderHome)();
  else ({ cards: renderCards, stats: renderStats })[tab]();
  if (!(quiz && quiz.fb)) view.scrollTop = 0;
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b)); render();
});
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
