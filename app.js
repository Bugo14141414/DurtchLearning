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
  { icon: '👀', name: 'Recognise', desc: 'See Dutch, pick the meaning', type: 'mc-nl-en' },
  { icon: '🧠', name: 'Recall', desc: 'Spot the one correct Dutch sentence', type: 'mc-en-nl' },
  { icon: '🕳️', name: 'Fill the gap', desc: 'Pick the missing word', type: 'cloze' },
  { icon: '🎧', name: 'Listen', desc: 'Hear Dutch, pick what was said', type: 'mc-audio' },
  { icon: '🧩', name: 'Build', desc: 'Put the words in the right order', type: 'build' },
  { icon: '✍️', name: 'Write', desc: 'Type the Dutch yourself', type: 'write' },
  { icon: '📝', name: 'Dictation', desc: 'Type what you hear', type: 'dictation' },
  { icon: '🎤', name: 'Speak', desc: 'Say it out loud', type: 'speak' },
  { icon: '👑', name: 'Master', desc: `Final test — ${MASTER_QUESTIONS} mixed hard questions`, type: 'mix' },
];
const MIX_TYPES = ['cloze', 'mc-audio', 'build', 'write', 'dictation', 'speak'];
const LV_VERSION = 2, LV_MAP_V1 = [0, 1, 3, 4, 5, 6, 7, 8]; // v1 had no "Fill the gap" level

// ---------- state ----------
function starterCards() {
  return CATEGORIES.flatMap(cat => cat.cards.map(([nl, en, note]) => ({
    id: 'k:' + nl, nl, en, note: note || '', cat: cat.name,
    type: /\s/.test(nl.trim().replace(/^(de|het|een) /i, '')) ? 'phrase' : 'word', box: 0, due: 0, seen: false })));
}
const RENAMED = { 'School & work': 'School' }; // keep level progress when a situation is renamed
let S = load();
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!s || !s.cards) s = { cards: [], log: {}, streak: 0, lastDay: null, dir: 'nl-en', cat: 'All' };
  s.lv = s.lv || {};
  for (const [from, to] of Object.entries(RENAMED)) if (s.lv[from] && !s.lv[to]) { s.lv[to] = s.lv[from]; delete s.lv[from]; }
  if ((s.lvVer || 1) < LV_VERSION) {
    for (const cat in s.lv) s.lv[cat] = Object.fromEntries(Object.entries(s.lv[cat]).map(([i, v]) => [LV_MAP_V1[i], v]));
    s.lvVer = LV_VERSION;
  }
  s.xp = s.xp || 0; s.xpLog = s.xpLog || {}; if (s.sound === undefined) s.sound = true;
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
const numNl = n => n < 20 ? UNITS[n] : n < 100 ? (n % 10 ? UNITS[n % 10] + 'en' : '') + TENS[n / 10 | 0]
  : (n >= 200 ? UNITS[n / 100 | 0] : '') + 'honderd' + (n % 100 ? numNl(n % 100) : '');
// Lowercase, drop accents and punctuation, and spell out digits (speech recognition returns "12", not "twaalf").
const normCache = new Map();
const norm = s => { let v = normCache.get(s); if (v === undefined) { v = normRaw(s); if (normCache.size < 20000) normCache.set(s, v); } return v; };
const normRaw = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\d+/g, d => +d < 1000 ? ' ' + numNl(+d) + ' ' : d)
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
// Swapping any word in a group for another changes the meaning, so the result is always wrong
// for the English shown. Groups never contain synonyms (e.g. mag/kan are kept apart).
const CONFUSE = [
  ['linksaf', 'rechtsaf'], ['groot', 'klein'], ['grote', 'kleine'], ['warm', 'koud'], ['wit', 'bruin'],
  ['vandaag', 'morgen', 'gisteren'], ['met', 'zonder'], ['eten', 'drinken'], ['hier', 'daar'],
  ['altijd', 'nooit'], ['goed', 'slecht'], ['vroeger', 'later'], ['wie', 'wat', 'waar', 'wanneer', 'hoe'],
  ['twee', 'drie', 'vier', 'vijf', 'acht', 'tien', 'twaalf', 'vijftien', 'zeventien', 'twintig', 'vijftig'],
  ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'],
  ['tram', 'bus', 'trein'], ['koffie', 'cola', 'water'], ['ui', 'kaas', 'saus'], ['uien', 'tomaten', 'aardappelen'],
  ['snijden', 'koken', 'bakken'], ['mijn', 'je'], ['nog', 'ook'], ['moet', 'mag', 'wil'], ['kan', 'moet', 'wil'],
];
// Wrong verb forms for the same person ("ik heb" → hebt / heeft / hebben).
const CONJ = {
  ben: ['bent', 'is', 'zijn'], bent: ['ben', 'is', 'zijn'], is: ['ben', 'bent', 'zijn'], zijn: ['ben', 'bent', 'is'],
  heb: ['hebt', 'heeft', 'hebben'], heeft: ['heb', 'hebben'], hebben: ['heb', 'heeft'],
  kan: ['kunt', 'kunnen'], kun: ['kunt', 'kunnen'], kunt: ['kun', 'kunnen'], wil: ['wilt', 'willen'], wilt: ['wil', 'willen'],
  moet: ['moeten', 'moesten'], doe: ['doet', 'doen'], doet: ['doe', 'doen'], ga: ['gaat', 'gaan'], gaat: ['ga', 'gaan'],
  kom: ['komt', 'komen'], woon: ['woont', 'wonen'], spreek: ['spreekt', 'spreken'], vind: ['vindt', 'vinden'],
  denk: ['denkt', 'denken'], begrijp: ['begrijpt', 'begrijpen'], zoek: ['zoekt', 'zoeken'], neem: ['neemt', 'nemen'],
};
const BOTH_GENDERS = new Set(['schort', 'weekend']); // "de" and "het" are both fine for these
const SWAPPABLE = {};
for (const g of CONFUSE) for (const w of g) SWAPPABLE[w] = [...new Set([...(SWAPPABLE[w] || []), ...g.filter(x => x !== w)])];

const pick = a => a[Math.random() * a.length | 0];
const coreOf = t => t.replace(/^[^\p{L}]+|[^\p{L}'’]+$/gu, '');
const withCase = (orig, w) => /^\p{Lu}/u.test(orig) ? w[0].toUpperCase() + w.slice(1) : w;
const putCore = (tok, w) => { const c = coreOf(tok); return tok.replace(c, withCase(c, w)); };
const words = nl => nl.split(/\s+/).filter(Boolean);
const contentWords = en => new Set(norm(en).split(' ').filter(w => w.length > 2 && !['the', 'you', 'and', 'for', 'please', 'this', 'that', 'can', 'could', 'would', 'have'].includes(w)));
function overlap(a, b) { const A = new Set(a), B = new Set(b); let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.max(1, Math.min(A.size, B.size)); }
// How alike two Dutch phrases look: shared words plus spelling closeness.
const lookAlike = (a, b) => { const x = norm(a), y = norm(b); return 0.6 * overlap(x.split(' '), y.split(' ')) + 0.4 * (1 - lev(x, y) / Math.max(x.length, y.length, 1)); };
// True when another card's English could pass as a translation of this one.
const sameMeaning = (a, b) => norm(a.en) === norm(b.en) || overlap(contentWords(a.en), contentWords(b.en)) >= 0.5 && contentWords(a.en).size > 0;

// Alternatives for the word at position i that make the sentence wrong.
function wrongWordsAt(ws, i, card) {
  const k = coreOf(ws[i]).toLowerCase(), next = coreOf(ws[i + 1] || '').toLowerCase(), prev = coreOf(ws[i - 1] || '').toLowerCase();
  const out = new Set(SWAPPABLE[k] || []);
  const formalHave = ['heeft', 'heb'].includes(k) && (next === 'u' || prev === 'u'); // "hebt u" is also correct
  if (CONJ[k] && !formalHave) CONJ[k].forEach(w => out.add(w));
  if ((k === 'de' || k === 'het') && !BOTH_GENDERS.has(next) && i < ws.length - 1) ['de', 'het', 'een'].forEach(w => w !== k && out.add(w));
  if (!/\b(kwijt|vergeten)\b/i.test(card.nl)) { if (k === 'ben') out.add('heb'); if (k === 'heb') out.add('ben'); if (k === 'is') out.add('heeft'); }
  out.delete(k);
  return [...out];
}

// Near-miss versions of the Dutch: one small change each, never a valid answer.
function nearMisses(card) {
  const end = (card.nl.match(/[.?!]+$/) || [''])[0], ws = words(card.nl.slice(0, card.nl.length - end.length));
  const out = [], add = (arr, kind) => out.push({ s: arr.join(' ') + end, kind });
  ws.forEach((t, i) => wrongWordsAt(ws, i, card).forEach(w => { const c = [...ws]; c[i] = putCore(t, w); add(c, 'word' + i); }));
  ws.forEach((t, i) => {
    const k = coreOf(t).toLowerCase(), prev = coreOf(ws[i - 1] || '').toLowerCase();
    let w = null;
    if (k === 'u' && /t$/.test(prev)) w = 'je';                                       // Kunt u → Kunt je
    if (k === 'je' && i > 0 && CONJ[prev] && !/t$/.test(prev)) w = 'u';               // Kun je → Kun u
    if (k === 'uw') w = 'u';                                                           // uw naam → u naam
    if (w) { const c = [...ws]; c[i] = putCore(t, w); add(c, 'formal'); }
  });
  for (let i = 1; i < ws.length - 1; i++) if (!/[,!]/.test(ws[i] + ws[i + 1]) && coreOf(ws[i]) && coreOf(ws[i + 1])) {
    const c = [...ws]; [c[i], c[i + 1]] = [c[i + 1], c[i]]; add(c, 'order');
  }
  const ni = ws.findIndex(t => coreOf(t).toLowerCase() === 'niet');
  if (ni > 0) { const c = [...ws]; c.splice(ni, 1); add(c, 'neg'); }
  else if (ws.length >= 3 && ws.length <= 4 && !ws.some(t => /^geen$/i.test(coreOf(t))) && !['u', 'je', 'ik', 'het', 'we'].includes(coreOf(ws[ws.length - 1]).toLowerCase())) { const c = [...ws]; c.splice(ws.length - 1, 0, 'niet'); add(c, 'neg'); }
  ws.forEach((t, i) => { if (i > 0 && ['te', 'er', 'om', 'aan'].includes(coreOf(t).toLowerCase())) { const c = [...ws]; c.splice(i, 1); add(c, 'drop'); } });
  const valid = new Set(answersFor(card)), seen = new Set([norm(card.nl)]);
  const ok = out.filter(o => { const k = norm(o.s); if (valid.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  // Prefer a mix of different kinds of mistakes.
  const byKind = {}; shuffle(ok).forEach(o => (byKind[o.kind.replace(/\d+$/, '')] = byKind[o.kind.replace(/\d+$/, '')] || []).push(o.s));
  const res = [], kinds = shuffle(Object.keys(byKind));
  while (res.length < 3 && kinds.some(k => byKind[k].length)) for (const k of kinds) if (byKind[k].length && res.length < 3) res.push(byKind[k].shift());
  return res;
}
// Other cards whose Dutch looks most like this one (but means something else).
function lookAlikes(card, n) {
  // Cheap pre-filter on shared words, then the full comparison on the best 40.
  const mine = norm(card.nl).split(' ');
  return S.cards.filter(c => c !== card && norm(c.nl) !== norm(card.nl))
    .map(c => ({ c, k: overlap(mine, norm(c.nl).split(' ')) + (c.cat === card.cat ? 0.3 : 0) + (c.type === card.type ? 0.3 : 0) + Math.random() * 0.2 }))
    .sort((a, b) => b.k - a.k).slice(0, 40).map(x => x.c).filter(c => !sameMeaning(c, card))
    .map(c => ({ c, k: lookAlike(card.nl, c.nl) + (c.cat === card.cat ? 0.1 : 0) + (c.type === card.type ? 0 : -0.4) + Math.random() * 0.15 }))
    .sort((a, b) => b.k - a.k).slice(0, n * 2).map(x => x.c);
}
function uniqueOptions(answer, cands) {
  const seen = new Set([norm(answer)]), out = [];
  for (const c of cands) { const k = norm(c); if (!seen.has(k)) { seen.add(k); out.push(c); } if (out.length === 3) break; }
  return shuffle([answer, ...out]);
}
const englishOptions = card => uniqueOptions(card.en, shuffle(lookAlikes(card, 3)).map(c => c.en));
const dutchOptions = card => uniqueOptions(card.nl, [...nearMisses(card), ...lookAlikes(card, 3).map(c => c.nl)]);

function clozeOf(card) {
  const ws = words(card.nl), spots = ws.map((t, i) => ({ i, alts: wrongWordsAt(ws, i, card) })).filter(x => x.alts.length >= 2);
  if (ws.length < 2 || !spots.length) return null; // a gap needs a sentence around it
  const { i, alts } = pick(spots), core = coreOf(ws[i]), valid = new Set(answersFor(card));
  const wrong = shuffle(alts).map(w => withCase(core, w)).filter(w => { const c = [...ws]; c[i] = putCore(ws[i], w); return !valid.has(norm(c.join(' '))); });
  return { before: ws.slice(0, i).join(' ') + ' ' + ws[i].slice(0, ws[i].indexOf(core)), after: ws[i].slice(ws[i].indexOf(core) + core.length) + ' ' + ws.slice(i + 1).join(' '),
           answer: core, options: uniqueOptions(core, wrong) };
}

function makeQ(card, type, n = 0) {
  if (type === 'speak' && !SR) type = 'write';
  const toks = tokens(card.nl);
  if (type === 'build' && toks.length < 3) type = 'mc-en-nl';
  const q = { card, type };
  if (type === 'cloze') { const z = clozeOf(card); if (z) Object.assign(q, z); else q.type = type = 'mc-en-nl'; }
  if (type === 'mc-audio') q.exact = n % 2 === 1; // every other listening question: pick the exact sentence you heard
  if (type === 'mc-nl-en' || (type === 'mc-audio' && !q.exact)) { q.answer = card.en; q.options = englishOptions(card); }
  if (type === 'mc-en-nl' || (type === 'mc-audio' && q.exact)) { q.answer = card.nl; q.options = dutchOptions(card); }
  if (type === 'build') {
    // Decoys: look-alike words (het for de, kunt for kun…) plus one word from elsewhere.
    const have = new Set(toks.map(norm)), extra = [];
    const ws = words(card.nl);
    for (const i of shuffle(ws.map((_, i) => i))) {
      const w = pick(wrongWordsAt(ws, i, card) || []);
      if (w && extra.length < 2 && !have.has(norm(w))) { have.add(norm(w)); extra.push(w); }
    }
    for (const c of shuffle(inCat(card.cat))) for (const t of tokens(c.nl))
      if (extra.length < (toks.length > 5 ? 3 : 2) + 1 && !have.has(norm(t))) { have.add(norm(t)); extra.push(t); }
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
  const qs = picked.slice(0, n).map((c, i) => L.type === 'mix' ? makeQ(c, MIX_TYPES[i % MIX_TYPES.length], Math.random() * 2 | 0) : makeQ(c, L.type, i));
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
  if (!ok && !q.retry) z.qs.push({ ...makeQ(c, q.type, z.i), retry: true }); // "fix your mistakes" round at the end
  // Feed results into flashcard scheduling: misses come back up for review today.
  if (ok) { if (!c.seen) { c.seen = true; c.box = 1; c.due = t + 1; } }
  else { c.seen = true; c.box = 0; c.due = t; }
  markActive(); save(); fx(ok);
  if (q.type !== 'dictation') z.sayTimer = setTimeout(() => speak(c.nl), 250);
  render();
}
function nextQ() {
  const z = quiz; clearTimeout(z.sayTimer); z.fb = null; z.tries = 0; z.heard = ''; z.err = ''; z.listening = false; z.i++;
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
    case 'mc-en-nl': body = `<h3>Which one is correct Dutch?</h3><div class="prompt">${esc(c.en)}</div>${opts()}`; break;
    case 'cloze': body = `<h3>Fill the gap</h3><div class="prompt cloze">${esc(q.before.trim())} <span class="gap ${fb ? (fb.ok ? 'ok' : 'bad') : ''}">${fb ? esc(q.answer) : '&nbsp;'}</span> ${esc(q.after.trim())}</div>
      <p class="mute hint-en">“${esc(c.en)}”</p>${opts()}`; break;
    case 'mc-audio': body = `<h3>${q.exact ? 'Which sentence did you hear exactly?' : 'What does it mean?'}</h3>${audio}${opts()}`; break;
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
        ${LITERAL[c.nl] ? `<small class="lit">Literally: “${esc(LITERAL[c.nl])}”</small>` : ''}
        ${c.note ? `<small>💡 ${esc(c.note.replace(/^👂\s*/, ''))}</small>` : ''}
        <div class="row"><button class="btn alt" id="why">📖 Explain</button><button class="btn" id="next">Continue</button></div></div>`
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
  if ($('#why')) $('#why').onclick = () => openExplain(c);
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
    ${uniq.length ? `<h2>Practise these <small class="mute">· tap for explanation</small></h2>${uniq.map((c, i) => `<div class="item tap" data-ex="${i}"><div><b>${esc(c.nl)}</b><br><small>${esc(c.en)}</small></div><button class="del" data-say="${esc(c.nl)}">🔊</button></div>`).join('')}` : ''}
    <div class="stack">
      ${d.passed && z.li + 1 < LEVELS.length ? '<button class="btn" id="go">Next level →</button>' : ''}
      <button class="btn ${d.passed ? 'alt' : ''}" id="retry">${d.passed ? 'Play again' : 'Try again'}</button>
      <button class="btn alt" id="done">Back to levels</button></div>`;
  view.querySelectorAll('[data-say]').forEach(b => b.onclick = e => { e.stopPropagation(); speak(b.dataset.say); });
  view.querySelectorAll('[data-ex]').forEach(el => el.onclick = () => openExplain(uniq[+el.dataset.ex]));
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
      ${s.shown ? `<div class="ans">${esc(a)}</div>${LITERAL[c.nl] ? `<div class="hint">Literally: “${esc(LITERAL[c.nl])}”</div>` : ''}${c.note ? `<div class="hint">${esc(c.note.replace(/^👂\s*/, ''))}</div>` : ''}
        <button class="link" id="why">📖 Explain</button>`
                : '<div class="hint">tap to reveal</div>'}
      <button class="speak" id="spk" aria-label="Listen">🔊</button></div>
    ${s.shown ? `<div class="row grade"><button class="btn again" data-g="0">Again</button><button class="btn good" data-g="1">Good</button><button class="btn easy" data-g="2">Easy</button></div>` : ''}`;
  $('#back').onclick = back;
  $('#spk').onclick = e => { e.stopPropagation(); speak(c.nl); };
  if ($('#why')) $('#why').onclick = e => { e.stopPropagation(); openExplain(c); };
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
    <h2>Browse <small class="mute">· tap a card for its explanation</small></h2>
    <div>${['All', ...cats()].map(k => `<span class="chip ${S.cat === k ? 'on' : ''}" data-cat="${esc(k)}">${EMOJI[k] || ''} ${esc(k)}</span>`).join('')}</div>
    ${list.map((c, i) => `<div class="item tap" data-ex="${i}"><div><b>${esc(c.nl)}</b><br><small>${esc(c.en)}${S.cat === 'All' ? ' · ' + esc(c.cat) : ''}</small></div>
      <div class="acts"><button class="del" data-say="${esc(c.nl)}">🔊</button>${c.id.startsWith('u') ? `<button class="del" data-del="${c.id}">✕</button>` : ''}</div></div>`).join('')}
    <h2>Backup</h2><div class="row"><button class="btn alt" id="exp">Export</button><button class="btn alt" id="imp">Import</button></div>`;
  $('#dir').value = S.dir;
  $('#dir').onchange = e => { S.dir = e.target.value; save(); };
  $('#snd').onchange = e => { S.sound = e.target.checked; save(); };
  $('#cat').onchange = e => { $('#newcat').hidden = e.target.value !== '__new'; };
  view.querySelectorAll('[data-cat]').forEach(el => el.onclick = () => { S.cat = el.dataset.cat; save(); render(); });
  view.querySelectorAll('[data-say]').forEach(b => b.onclick = e => { e.stopPropagation(); speak(b.dataset.say); });
  view.querySelectorAll('[data-ex]').forEach(el => el.onclick = () => openExplain(list[+el.dataset.ex]));
  $('#add').onclick = () => {
    const nl = $('#nl').value.trim(), en = $('#en').value.trim();
    const cat = $('#cat').value === '__new' ? $('#newcat').value.trim() || 'Mine' : $('#cat').value;
    if (!nl || !en) return;
    S.cards.push({ id: 'u' + Date.now(), nl, en, note: '', type: /\s/.test(nl) ? 'phrase' : 'word', cat, box: 0, due: 0, seen: false });
    save(); render();
  };
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = e => { e.stopPropagation();
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

// ---------- explanations ----------
function openExplain(c) {
  const x = explainFor(c), m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="panel" role="dialog" aria-label="Explanation">
    <button class="x close" aria-label="Close">✕</button>
    <div class="ex-nl">${esc(c.nl)} <button class="speak sm" data-say="0">🔊</button></div>
    <div class="ex-en">${esc(c.en)}</div>
    ${x.literal ? `<div class="ex-lit"><small>Literally</small>“${esc(x.literal)}”</div>` : ''}
    ${x.words.length > 1 || x.words.some(w => w.g) ? `<h2>Word by word</h2><div class="wchips">${x.words.map(w => `<span class="wchip"><b>${esc(w.w)}</b><small>${esc(w.g || '—')}</small></span>`).join('')}</div>` : ''}
    ${x.tips.length ? `<h2>How it works</h2>${x.tips.map(t => `<div class="tip">${t}</div>`).join('')}` : ''}
    ${c.note ? `<div class="tip">💡 ${esc(c.note.replace(/^👂\s*/, ''))}</div>` : ''}
  </div>`;
  m.onclick = e => { if (e.target === m || e.target.closest('.close')) m.remove(); };
  m.querySelector('[data-say]').onclick = () => speak(c.nl);
  document.body.appendChild(m);
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
