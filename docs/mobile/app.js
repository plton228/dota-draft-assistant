/* Draft Assistant · «Мої ігри» для телефону.
 * Лише публічні дані OpenDota: без бекенду, ключів і синхронізації з ПК-програмою.
 * Dota ID береться з фрагмента URL (#id=123) або вводиться вручну й зберігається тільки в localStorage. */
'use strict';

const API = 'https://api.opendota.com/api';
const CDN = 'https://cdn.cloudflare.steamstatic.com';
const OPENDOTA = 'https://www.opendota.com';
const LS_ID = 'da_mobile_account_id';
const LS_CONST = 'da_mobile_constants_v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const STEAM64_BASE = 76561197960265728n;
const PAGE = 50;

const RANKS = ['', 'Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'];
const MODES = {
  1: 'All Pick', 2: 'Captains Mode', 3: 'Random Draft', 4: 'Single Draft', 5: 'All Random',
  12: 'Least Played', 16: 'Captains Draft', 18: 'Ability Draft', 20: 'All Random DM', 21: '1v1 Mid',
  22: 'All Pick', 23: 'Турбо', 24: 'Mutation',
};
const PARTY_COLORS = ['#5ea3f0', '#f2c94c', '#c77dff', '#4cc38a', '#ff8fa3'];

const el = {
  app: document.getElementById('app'),
  title: document.getElementById('title'),
  back: document.getElementById('btn-back'),
  refresh: document.getElementById('btn-refresh'),
  account: document.getElementById('btn-account'),
  banner: document.getElementById('banner'),
};

const state = {
  id: null,
  consts: null,
  home: null,          // {player, wl20, wl100, matches, heroes, heroesFromHistory, done}
  matchCache: new Map(),
  staleSince: null,    // час кешу, якщо щось показано з офлайн-збереження
  renderToken: 0,
};

/* ---------------- утиліти ---------------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function lsDel(key) {
  try { localStorage.removeItem(key); } catch { /* немає сховища */ }
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const games = (n) => `${n} ${plural(n, 'гра', 'гри', 'ігор')}`;

function pct(win, total) { return total ? Math.round((win / total) * 100) : 0; }
function wrClass(p) { return p >= 52 ? 'good' : p <= 47 ? 'badc' : ''; }
function wrColor(p) { return p >= 52 ? 'var(--ok)' : p <= 47 ? 'var(--bad)' : 'var(--text2)'; }

function fmtDuration(sec) {
  sec = Math.max(0, sec | 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

const dfShort = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' });
const dfYear = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
const dfTime = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' });
const dfFull = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function fmtWhen(unix) {
  const d = new Date(unix * 1000), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} хв тому`;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startToday) return `сьогодні ${dfTime.format(d)}`;
  if (d.getTime() >= startToday - DAY_MS) return `вчора ${dfTime.format(d)}`;
  return d.getFullYear() === now.getFullYear() ? dfShort.format(d) : dfYear.format(d);
}

function fmtK(n) {
  if (n == null) return '—';
  return n >= 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}

function isRadiantSlot(slot) { return slot < 128; }

function modeLabel(gameMode, lobbyType) {
  if (gameMode === 23) return 'Турбо';
  const plainPick = gameMode === 1 || gameMode === 22;
  if (lobbyType === 7) return plainPick ? 'Рейтингова' : `Рейтингова · ${MODES[gameMode] || 'інший режим'}`;
  if (plainPick && lobbyType === 0) return 'Звичайна';
  const mode = MODES[gameMode] || 'Інший режим';
  if (lobbyType === 1) return `Практика · ${mode}`;
  return mode;
}

function medalHtml(rankTier, leaderboard, small) {
  const cls = small ? 'medal sm' : 'medal';
  if (!rankTier) return small ? '' : `<span class="${cls} r0">Без рангу</span>`;
  const tier = Math.floor(rankTier / 10), stars = rankTier % 10;
  if (tier < 1 || tier > 8) return '';
  if (tier === 8) return `<span class="${cls} r8">Immortal${leaderboard ? ` #${leaderboard}` : ''}</span>`;
  const st = stars ? ` <span class="st" aria-label="${stars} ${plural(stars, 'зірка', 'зірки', 'зірок')}">${'★'.repeat(Math.min(stars, 5))}</span>` : '';
  return `<span class="${cls} r${tier}">${RANKS[tier]}${st}</span>`;
}

/* ---------------- ID ---------------- */

/** Розбирає Friend ID, Steam ID64 чи посилання (opendota/dotabuff/stratz/steam) → 32-бітний account_id або null. */
function parseAccountId(input) {
  const digits = String(input || '').match(/\d{1,20}/g);
  if (!digits) return null;
  const raw = digits.sort((a, b) => b.length - a.length)[0];
  let n;
  try { n = BigInt(raw); } catch { return null; }
  if (n >= STEAM64_BASE) n -= STEAM64_BASE;
  if (n <= 0n || n > 4294967295n) return null;
  return Number(n);
}

function readIdFromHash() {
  const m = location.hash.match(/(?:^#|[&#])id=([^&]+)/);
  return m ? parseAccountId(decodeURIComponent(m[1])) : null;
}

/* ---------------- мережа ---------------- */

class ApiError extends Error {
  constructor(kind, status) { super(kind); this.kind = kind; this.status = status; }
}

async function api(path) {
  let res;
  try {
    res = await fetch(API + path, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(navigator.onLine === false ? 'offline' : 'network');
  }
  const cachedAt = res.headers.get('x-da-cached-at');
  if (cachedAt) noteStale(Number(cachedAt));
  if (res.status === 429) throw new ApiError('ratelimit', 429);
  if (res.status === 404) throw new ApiError('notfound', 404);
  if (!res.ok) throw new ApiError('server', res.status);
  try { return await res.json(); } catch { throw new ApiError('server', res.status); }
}

function noteStale(ts) {
  if (!ts) return;
  state.staleSince = state.staleSince ? Math.min(state.staleSince, ts) : ts;
  const d = new Date(state.staleSince);
  el.banner.textContent = `Немає зв'язку з OpenDota — показано збережені дані від ${dfShort.format(d)}, ${dfTime.format(d)}.`;
  el.banner.hidden = false;
}
function clearStale() { state.staleSince = null; el.banner.hidden = true; }

/* ---------------- довідники (кеш на добу) ---------------- */

function slimConstants(heroes, items, itemIds, abilityIds, abilities, heroAbilities) {
  const h = {};
  for (const v of Object.values(heroes)) h[v.id] = { n: v.localized_name, key: v.name, img: v.img };
  const it = {};
  for (const [id, key] of Object.entries(itemIds)) {
    const v = items[key];
    if (v) it[id] = { n: v.dname || key, img: v.img };
  }
  const ab = {};
  for (const [id, key] of Object.entries(abilityIds)) {
    const v = abilities[key];
    if (!v || !v.dname) continue;
    ab[id] = key.startsWith('special_bonus') ? { k: key, n: v.dname, t: 1 } : { k: key, n: v.dname, img: v.img || '' };
  }
  const tal = {};
  for (const [heroKey, v] of Object.entries(heroAbilities)) {
    if (v && Array.isArray(v.talents)) {
      tal[heroKey] = v.talents.map((t) => [t.name, t.level, (abilities[t.name] && abilities[t.name].dname) || t.name]);
    }
  }
  const sc = items.ultimate_scepter, sh = items.aghanims_shard;
  return { h, it, ab, tal, aghs: { scepter: sc && sc.img, shard: sh && sh.img } };
}

async function loadConstants() {
  if (state.consts) return state.consts;
  let cached = null;
  try { cached = JSON.parse(lsGet(LS_CONST) || 'null'); } catch { cached = null; }
  if (cached && cached.v === 1 && Date.now() - cached.ts < DAY_MS) {
    state.consts = cached.data;
    return state.consts;
  }
  try {
    const names = ['heroes', 'items', 'item_ids', 'ability_ids', 'abilities', 'hero_abilities'];
    const parts = await Promise.all(names.map((n) => api(`/constants/${n}`)));
    const data = slimConstants(...parts);
    state.consts = data;
    if (!lsSet(LS_CONST, JSON.stringify({ v: 1, ts: Date.now(), data }))) lsDel(LS_CONST);
    return data;
  } catch (err) {
    if (cached && cached.data) { state.consts = cached.data; return state.consts; }
    throw err;
  }
}

const img = (path) => (path ? CDN + path : '');
function hero(id) { return (state.consts && state.consts.h[id]) || { n: `Герой #${id}`, img: '' }; }
function heroImg(id) { return img(hero(id).img); }

/* ---------------- каркас і навігація ---------------- */

function setChrome({ title, back }) {
  el.title.textContent = title;
  el.back.hidden = !back;
  el.refresh.hidden = !state.id;
  el.account.hidden = !state.id || back;
}

function route() {
  const token = ++state.renderToken;
  const hashId = readIdFromHash();
  if (hashId) {
    if (hashId !== state.id) { state.home = null; state.matchCache.clear(); }
    state.id = hashId;
    lsSet(LS_ID, String(hashId));
    history.replaceState(null, '', location.pathname + location.search + '#/');
  }
  if (!state.id) return renderSetup();
  const m = location.hash.match(/^#\/m\/(\d+)/);
  if (m) return renderMatch(m[1], token);
  return renderHome(token);
}

el.back.addEventListener('click', () => {
  // Якщо картку гри відкрито зі списку — звичайне «назад» (зберігає прокрутку), інакше — на головну.
  if (state.cameFromList) history.back();
  else location.hash = '#/';
});
el.account.addEventListener('click', () => renderSetup(true));
el.refresh.addEventListener('click', () => {
  state.home = null;
  state.matchCache.clear();
  clearStale();
  route();
});
let lastHash = location.hash;
const scrollByHash = new Map();
window.addEventListener('hashchange', () => {
  scrollByHash.set(lastHash, window.scrollY);
  state.cameFromList = /^#\/?$/.test(lastHash) && /^#\/m\//.test(location.hash);
  lastHash = location.hash;
  route();
  window.scrollTo(0, scrollByHash.get(location.hash) || 0);
});

function skeleton() {
  el.app.innerHTML = `
    <div class="card"><div class="profile"><div class="avatar skel"></div><div class="who"><div class="skel line" style="width:60%"></div><div class="skel line" style="width:35%"></div></div></div>
    <div class="stats"><div class="skel block"></div><div class="skel block"></div></div></div>
    <div class="card"><div class="skel line" style="width:40%"></div><div class="skel block"></div><div class="skel block"></div></div>`;
}

function errorView(err, retry) {
  clearStale();
  const kind = err && err.kind;
  let ic = '⚠️', h = 'Щось пішло не так', p = 'Спробуйте ще раз трохи згодом.';
  if (kind === 'offline' || kind === 'network') {
    ic = '📡'; h = 'Немає мережі';
    p = 'Не вдалося з\'єднатися з OpenDota, і збережених даних для цього екрана немає. Перевірте інтернет і спробуйте ще раз.';
  } else if (kind === 'ratelimit') {
    ic = '⏳'; h = 'OpenDota просить зачекати';
    p = 'Безкоштовний доступ до OpenDota має ліміт запитів (близько 60 на хвилину). Зачекайте хвилину й натисніть «Спробувати ще».';
  } else if (kind === 'notfound') {
    ic = '🔍'; h = 'Не знайдено';
    p = 'OpenDota не має даних за цим запитом.';
  } else if (kind === 'server') {
    h = 'OpenDota зараз не відповідає';
    p = `Сервер повернув помилку${err.status ? ' ' + err.status : ''}. Спробуйте за кілька хвилин.`;
  }
  el.app.innerHTML = `<div class="card state"><div class="ic" aria-hidden="true">${ic}</div><h2>${esc(h)}</h2><p>${esc(p)}</p>
    <div class="actions"><button class="btn primary block" type="button" data-act="retry">Спробувати ще</button>
    ${/^#\/m\//.test(location.hash)
      ? '<a class="btn block" href="#/">До списку ігор</a>'
      : '<button class="btn block" type="button" data-act="setup">Змінити Dota ID</button>'}</div></div>`;
  el.app.querySelector('[data-act=retry]').onclick = retry;
  const setup = el.app.querySelector('[data-act=setup]');
  if (setup) setup.onclick = () => renderSetup(true);
}

/* ---------------- екран введення ID ---------------- */

function renderSetup(changing) {
  setChrome({ title: changing ? 'Змінити Dota ID' : 'Мої ігри', back: false });
  el.refresh.hidden = true;
  el.account.hidden = true;
  clearStale();
  el.app.innerHTML = `
    <form class="card setup" novalidate>
      <h2>${changing ? 'Інший гравець' : 'Вітаю!'}</h2>
      <p>Введіть свій Dota ID — і тут з'явиться ваша історія ігор. Його досить ввести один раз: він збережеться лише на цьому пристрої.</p>
      <label for="acc">Dota ID (Friend ID) або Steam ID64</label>
      <input id="acc" name="acc" inputmode="numeric" autocomplete="off" autocapitalize="off" spellcheck="false"
             placeholder="Напр., 123456789" value="${changing && state.id ? esc(state.id) : ''}">
      <div class="err" id="acc-err" role="alert"></div>
      <button class="btn primary block" type="submit">Показати мої ігри</button>
      ${changing && state.id ? '<button class="btn block" type="button" id="cancel" style="margin-top:8px">Скасувати</button>' : ''}
      <ul>
        <li>Найпростіше — відсканувати QR-код у програмі Draft Assistant: ID підставиться сам.</li>
        <li>Friend ID видно в Dota 2 у профілі. Можна вставити й посилання на OpenDota, Dotabuff чи Steam-профіль із числовим ID.</li>
        <li>Щоб ігри були видні, у налаштуваннях Dota 2 має бути увімкнено «Показувати публічні дані матчів».</li>
      </ul>
    </form>`;
  const form = el.app.querySelector('form');
  const input = form.querySelector('#acc');
  const err = form.querySelector('#acc-err');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = parseAccountId(input.value);
    if (!id) { err.textContent = 'Не схоже на Dota ID: потрібне число, наприклад 123456789.'; input.focus(); return; }
    if (id !== state.id) { state.home = null; state.matchCache.clear(); }
    state.id = id;
    lsSet(LS_ID, String(id));
    if (location.hash === '#/' || location.hash === '') route(); else location.hash = '#/';
  });
  const cancel = form.querySelector('#cancel');
  if (cancel) cancel.onclick = () => route();
  if (!changing) setTimeout(() => input.focus(), 50);
}

/* ---------------- головний екран ---------------- */

function heroesFromMatches(list) {
  const agg = new Map();
  for (const m of list) {
    const a = agg.get(m.hero_id) || { hero_id: m.hero_id, games: 0, win: 0 };
    a.games += 1;
    if (isRadiantSlot(m.player_slot) === m.radiant_win) a.win += 1;
    agg.set(m.hero_id, a);
  }
  return [...agg.values()];
}

async function loadHome() {
  const id = state.id;
  const [consts, player, wl20, wl100, matches, heroes] = await Promise.allSettled([
    loadConstants(),
    api(`/players/${id}`),
    api(`/players/${id}/wl?limit=20`),
    api(`/players/${id}/wl?limit=100`),
    api(`/players/${id}/matches?limit=${PAGE}`),
    api(`/players/${id}/heroes`),
  ]);
  if (player.status === 'rejected') {
    // 404 — такого акаунта OpenDota не знає: покажемо зрозумілий екран «Гравця не знайдено».
    if (player.reason && player.reason.kind === 'notfound') return { player: {}, wl20: null, wl100: null, matches: [], heroes: null, done: true };
    throw player.reason;
  }
  if (consts.status === 'rejected') throw consts.reason;
  const val = (r) => (r.status === 'fulfilled' ? r.value : null);
  const firstErr = [wl20, wl100, matches, heroes].find((r) => r.status === 'rejected');
  const home = {
    player: player.value,
    wl20: val(wl20), wl100: val(wl100),
    matches: val(matches) || [],
    matchesFailed: matches.status === 'rejected',
    heroes: val(heroes),
    heroesFromHistory: false,
    partialError: firstErr ? firstErr.reason : null,
    done: false,
  };
  home.done = home.matches.length < PAGE;
  // OpenDota інколи віддає по героях games = 0; тоді рахуємо з повної історії матчів.
  const heroTotal = (home.heroes || []).reduce((s, h) => s + (h.games || 0), 0);
  if (!heroTotal && home.matches.length) {
    try {
      const all = await api(`/players/${id}/matches?project=hero_id&project=player_slot&project=radiant_win`);
      home.heroes = heroesFromMatches(all);
      home.heroesFromHistory = true;
    } catch {
      home.heroes = heroesFromMatches(home.matches);
      home.heroesFromHistory = true;
    }
  }
  return home;
}

async function renderHome(token) {
  setChrome({ title: 'Мої ігри', back: false });
  if (!state.home) {
    clearStale();
    skeleton();
    try {
      const home = await loadHome();
      if (token !== state.renderToken) return;
      state.home = home;
    } catch (err) {
      if (token !== state.renderToken) return;
      return errorView(err, () => route());
    }
  }
  drawHome();
}

function drawHome() {
  const { player, wl20, wl100, matches, heroes } = state.home;
  const prof = player && player.profile;
  if (!prof) {
    el.app.innerHTML = `<div class="card state"><div class="ic" aria-hidden="true">🔍</div><h2>Гравця не знайдено</h2>
      <p>OpenDota не знає акаунта з ID ${esc(state.id)}. Перевірте число: це має бути Dota ID (Friend ID), а не нікнейм.</p>
      <div class="actions"><button class="btn primary block" type="button" id="chg">Ввести інший ID</button></div></div>`;
    el.app.querySelector('#chg').onclick = () => renderSetup(true);
    return;
  }

  const name = prof.personaname || `Гравець ${state.id}`;
  const parts = [];

  parts.push(`<section class="card">
    <div class="profile">
      ${prof.avatarfull ? `<img class="avatar" src="${esc(prof.avatarfull)}" alt="" width="64" height="64">` : '<div class="avatar"></div>'}
      <div class="who">
        <div class="nick">${esc(name)}</div>
        <div class="meta">${medalHtml(player.rank_tier, player.leaderboard_rank)}<span class="num">ID ${esc(state.id)}</span></div>
      </div>
    </div>
    <div class="stats">${statTile('Останні 20', wl20)}${statTile('Останні 100', wl100)}</div>
  </section>`);

  const noHistory = !matches.length && !state.home.matchesFailed;
  if (noHistory) {
    parts.push(`<section class="card state"><div class="ic" aria-hidden="true">🔒</div><h2>Ігор не видно</h2>
      <p>Схоже, профіль закритий або OpenDota ще не бачив ваших ігор.
      Увімкніть у Dota 2 → Налаштування → Соціальне «Показувати публічні дані матчів» (Expose Public Match Data),
      зіграйте матч і зачекайте — OpenDota підхопить історію.</p></section>`);
  } else {
    if (matches.length) parts.push(formCard(matches.slice(0, 10)));
    if (heroes && heroes.length) parts.push(heroesCard(heroes, state.home.heroesFromHistory));
    parts.push(matchesCard(matches));
  }

  if (state.home.partialError) {
    const k = state.home.partialError.kind;
    parts.push(`<p class="note" style="text-align:center">${k === 'ratelimit'
      ? 'Частину даних не завантажено: ліміт запитів OpenDota. Оновіть за хвилину.'
      : 'Частину даних не вдалося завантажити. Спробуйте оновити.'}</p>`);
  }

  el.app.innerHTML = parts.join('');
  const more = el.app.querySelector('#more');
  if (more) more.onclick = loadMoreMatches;
}

function statTile(label, wl) {
  if (!wl) return `<div class="stat"><div class="k">${label}</div><div class="v">—</div><div class="s">немає даних</div></div>`;
  const total = (wl.win || 0) + (wl.lose || 0);
  const p = pct(wl.win, total);
  return `<div class="stat"><div class="k">${label}</div>
    <div class="v ${total ? wrClass(p) : ''}">${total ? p + '%' : '—'}</div>
    <div class="s num">${total ? `${wl.win} В · ${wl.lose} П` : 'немає ігор'}</div></div>`;
}

function formCard(last) {
  const cells = last.map((m) => {
    const w = isRadiantSlot(m.player_slot) === m.radiant_win;
    return `<span class="${w ? 'w' : 'l'}" title="${esc(hero(m.hero_id).n)}">${w ? 'В' : 'П'}</span>`;
  }).join('');
  const wins = last.filter((m) => isRadiantSlot(m.player_slot) === m.radiant_win).length;
  return `<section class="card"><h2>Форма <span class="aside">${wins} з ${last.length}</span></h2>
    <div class="form" role="img" aria-label="Останні ${last.length}: ${wins} перемог">${cells}</div>
    <div class="form-note"><span>← найновіша</span><span>старіша →</span></div></section>`;
}

function heroesCard(list, fromHistory) {
  const top = [...list].filter((h) => h.games > 0).sort((a, b) => b.games - a.games || b.win - a.win).slice(0, 5);
  if (!top.length) return '';
  const rows = top.map((h) => {
    const p = pct(h.win, h.games);
    return `<div class="hrow">
      <img src="${esc(heroImg(h.hero_id))}" alt="" loading="lazy" width="64" height="36">
      <div style="min-width:0"><div class="hn">${esc(hero(h.hero_id).n)}</div>
        <div class="hs num">${games(h.games)}</div>
        <div class="bar"><i style="width:${p}%;background:${wrColor(p)}"></i></div></div>
      <div class="wr num ${wrClass(p)}">${p}%</div></div>`;
  }).join('');
  return `<section class="card"><h2>Улюблені герої <span class="aside">${fromHistory ? 'за всю історію' : 'усі ігри'}</span></h2>
    <div class="heroes">${rows}</div></section>`;
}

function matchRow(m) {
  const w = isRadiantSlot(m.player_slot) === m.radiant_win;
  const h = hero(m.hero_id);
  const party = m.party_size > 1 ? `<span class="tag">пачка ${m.party_size}</span>` : '';
  const abandoned = m.leaver_status > 1 ? '<span class="tag">лівер</span>' : '';
  return `<li><a class="mrow ${w ? 'win' : 'loss'}" href="#/m/${esc(m.match_id)}">
    <span class="res" aria-hidden="true"></span>
    <img src="${esc(img(h.img))}" alt="" loading="lazy" width="72" height="40">
    <span class="mid"><span class="hn" style="display:block">${esc(h.n)}</span>
      <span class="sub" style="display:block">${party}${abandoned}${esc(modeLabel(m.game_mode, m.lobby_type))}</span>
      <span class="sub num" style="display:block">${fmtDuration(m.duration)} · ${esc(fmtWhen(m.start_time))}</span></span>
    <span class="right"><span class="kda" style="display:block">${m.kills}/${m.deaths}/${m.assists}</span>
      <span class="rl">${w ? 'Перемога' : 'Поразка'}</span></span>
  </a></li>`;
}

function matchesCard(matches) {
  if (state.home.matchesFailed && !matches.length) {
    return `<section class="card"><h2>Ігри</h2><p class="note">Список ігор не завантажився. Натисніть «Оновити» вгорі.</p></section>`;
  }
  const more = state.home.done ? '' : `<div class="more-wrap"><button class="btn block" type="button" id="more">Показати ще ${PAGE}</button></div>`;
  return `<section class="card"><h2>Ігри <span class="aside">${matches.length}</span></h2>
    <ul class="mlist" id="mlist">${matches.map(matchRow).join('')}</ul>${more}</section>`;
}

async function loadMoreMatches() {
  const btn = el.app.querySelector('#more');
  if (!btn || !state.home) return;
  btn.disabled = true;
  btn.textContent = 'Завантаження…';
  try {
    const next = await api(`/players/${state.id}/matches?limit=${PAGE}&offset=${state.home.matches.length}`);
    state.home.matches.push(...next);
    if (next.length < PAGE) state.home.done = true;
    const list = el.app.querySelector('#mlist');
    list.insertAdjacentHTML('beforeend', next.map(matchRow).join(''));
    list.closest('.card').querySelector('h2 .aside').textContent = state.home.matches.length;
    if (state.home.done) btn.parentElement.remove();
    else { btn.disabled = false; btn.textContent = `Показати ще ${PAGE}`; }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = err.kind === 'ratelimit' ? 'Ліміт OpenDota — спробуйте за хвилину' : 'Не вдалося — спробувати ще';
  }
}

/* ---------------- картка гри ---------------- */

async function renderMatch(matchId, token) {
  setChrome({ title: `Матч ${matchId}`, back: true });
  let match = state.matchCache.get(matchId);
  if (!match) {
    clearStale();
    el.app.innerHTML = `<div class="card"><div class="skel line" style="width:50%;margin:0 auto 12px"></div><div class="skel block"></div></div>
      ${'<div class="skel block"></div>'.repeat(5)}`;
    try {
      const [, m] = await Promise.all([loadConstants(), api(`/matches/${matchId}`)]);
      match = m;
      if (match && Array.isArray(match.players)) state.matchCache.set(matchId, match);
    } catch (err) {
      if (token !== state.renderToken) return;
      if (err.kind === 'notfound') {
        el.app.innerHTML = `<div class="card state"><div class="ic" aria-hidden="true">🔍</div><h2>Матч не знайдено</h2>
          <p>OpenDota ще не має цього матчу або він недоступний.</p>
          <div class="actions"><a class="btn block" href="#/">До списку ігор</a></div></div>`;
        return;
      }
      return errorView(err, () => route());
    }
  }
  if (token !== state.renderToken) return;
  drawMatch(match);
}

function drawMatch(m) {
  const players = Array.isArray(m.players) ? m.players : [];
  const me = players.find((p) => p.account_id === state.id);
  const myRadiant = me ? isRadiantSlot(me.player_slot) : null;
  const iWon = me ? myRadiant === m.radiant_win : null;
  const resultHtml = me
    ? `<div class="result ${iWon ? 'win' : 'loss'}">${iWon ? 'Перемога' : 'Поразка'}</div>`
    : `<div class="result">${m.radiant_win ? 'Перемога Світлих' : 'Перемога Темних'}</div>`;

  // Пачки: спільний колір для гравців з однаковим party_id, якщо party_size ≥ 2.
  const partyColor = new Map();
  for (const p of players) {
    if ((p.party_size || 0) >= 2 && p.party_id != null && !partyColor.has(p.party_id)) {
      partyColor.set(p.party_id, PARTY_COLORS[partyColor.size % PARTY_COLORS.length]);
    }
  }

  const rad = players.filter((p) => isRadiantSlot(p.player_slot));
  const dire = players.filter((p) => !isRadiantSlot(p.player_slot));
  const anyBuild = players.some((p) => Array.isArray(p.ability_upgrades_arr) && p.ability_upgrades_arr.length);

  el.app.innerHTML = `
    <section class="card mhead">
      ${resultHtml}
      <div class="score"><b class="rad">${m.radiant_score ?? '—'}</b><span>${fmtDuration(m.duration)}</span><b class="dire">${m.dire_score ?? '—'}</b></div>
      <div class="sub">${esc(modeLabel(m.game_mode, m.lobby_type))}</div>
      <div class="sub">${m.start_time ? esc(dfFull.format(new Date(m.start_time * 1000))) : ''}</div>
      <div class="links"><a class="btn" href="${OPENDOTA}/matches/${esc(m.match_id)}" target="_blank" rel="noopener">Відкрити в OpenDota ↗</a></div>
    </section>
    ${teamBlock('Сили Світла', 'rad', rad, m.radiant_win, partyColor)}
    ${teamBlock('Сили Темряви', 'dire', dire, !m.radiant_win, partyColor)}
    ${anyBuild ? '<p class="note" style="text-align:center">Торкніться гравця, щоб побачити скілбілд і таланти.</p>'
      : '<p class="note" style="text-align:center">Скілбілди з\'являться, коли OpenDota розбере запис матчу.</p>'}`;
}

function teamBlock(title, cls, list, won, partyColor) {
  const kills = list.reduce((s, p) => s + (p.kills || 0), 0);
  const nw = list.reduce((s, p) => s + (p.net_worth || 0), 0);
  return `<div class="team-h ${cls}"><h2>${title}</h2>
      <span class="tot num">${kills} вбивств · NW ${fmtK(nw)}</span>
      ${won ? '<span class="wtag">Перемога</span>' : ''}</div>
    ${list.map((p) => playerCard(p, partyColor)).join('')}`;
}

function itemImg(id) {
  if (!id || !state.consts) return '';
  const it = state.consts.it[id];
  return it ? `<img src="${esc(img(it.img))}" alt="${esc(it.n)}" title="${esc(it.n)}" loading="lazy">` : '';
}

function playerCard(p, partyColor) {
  const h = hero(p.hero_id);
  const color = partyColor.get(p.party_id);
  const isMe = p.account_id === state.id;
  const hidden = !p.personaname;
  const nick = hidden ? 'Прихований профіль' : p.personaname;
  const slots = [0, 1, 2, 3, 4, 5].map((i) => `<span class="islot">${itemImg(p[`item_${i}`])}</span>`).join('');
  const neutral = `<span class="neutral" title="Нейтральний предмет">${itemImg(p.item_neutral)}</span>`;
  const enh = p.item_neutral2 ? `<span class="neutral enh">${itemImg(p.item_neutral2)}</span>` : '';
  const aghs = state.consts && state.consts.aghs;
  const hasScepter = p.aghanims_scepter || p.permanent_buffs?.some?.((b) => b.permanent_buff === 2);
  const hasShard = p.aghanims_shard || p.permanent_buffs?.some?.((b) => b.permanent_buff === 12);
  const aghsHtml = aghs ? `<span class="aghs">
      <img class="${hasScepter ? 'on' : ''}" src="${esc(img(aghs.scepter))}" alt="${hasScepter ? 'Аганім' : ''}" title="Aghanim's Scepter${hasScepter ? '' : ' — немає'}" loading="lazy">
      <img class="${hasShard ? 'on' : ''}" src="${esc(img(aghs.shard))}" alt="${hasShard ? 'Шард' : ''}" title="Aghanim's Shard${hasShard ? '' : ' — немає'}" loading="lazy"></span>` : '';
  const party = color ? `<span class="party-chip"><i></i>пачка</span>` : '';
  const style = color ? ` style="--party:${color}"` : '';
  const kda = `${p.kills ?? 0}/${p.deaths ?? 0}/${p.assists ?? 0}`;

  return `<details class="pl${isMe ? ' me' : ''}"${style}>
    <summary>
      <div class="pl-top">
        <img class="hero" src="${esc(img(h.img))}" alt="${esc(h.n)}" loading="lazy" width="60" height="34">
        <div class="who">
          <div class="nick${hidden ? ' hidden-profile' : ''}">${esc(nick)}${isMe ? ' <span class="tag">ви</span>' : ''}</div>
          <div class="line2">${medalHtml(p.rank_tier, p.leaderboard_rank, true)}<span>${esc(h.n)}</span>${p.level ? `<span class="num">· ${p.level} рів.</span>` : ''}${party}</div>
        </div>
        <div class="kda">${kda}<small>NW ${fmtK(p.net_worth)}</small></div>
      </div>
      <div class="items">${slots}${neutral}${enh}${aghsHtml}</div>
      <div class="pl-stats"><span>GPM <b>${p.gold_per_min ?? '—'}</b></span><span>XPM <b>${p.xp_per_min ?? '—'}</b></span>
        <span>ЛХ/ДН <b>${p.last_hits ?? '—'}/${p.denies ?? '—'}</b></span><span class="chev" aria-hidden="true">▾</span></div>
    </summary>
    <div class="pl-more">${buildHtml(p, h)}</div>
  </details>`;
}

function buildHtml(p, h) {
  const consts = state.consts;
  const extra = `<div class="extra">
    <div>Шкода героям<b>${fmtK(p.hero_damage)}</b></div>
    <div>Шкода будівлям<b>${fmtK(p.tower_damage)}</b></div>
    <div>Лікування<b>${fmtK(p.hero_healing)}</b></div></div>`;
  const ups = Array.isArray(p.ability_upgrades_arr) ? p.ability_upgrades_arr : [];
  if (!ups.length || !consts) {
    return `${extra}<p class="note">Скілбілд недоступний: OpenDota ще не розібрав запис цього матчу.</p>`;
  }
  const picked = new Set();
  const cells = ups.map((id, i) => {
    const a = consts.ab[id];
    const lvl = i + 1;
    if (!a) return `<div class="sk"><div class="tal" title="Невідома здібність">?</div>${lvl}</div>`;
    if (a.t) {
      picked.add(a.k);
      return `<div class="sk"><div class="tal" title="${esc(a.n)}">T</div>${lvl}</div>`;
    }
    return `<div class="sk"><img src="${esc(img(a.img))}" alt="${esc(a.n)}" title="${esc(a.n)}" loading="lazy">${lvl}</div>`;
  }).join('');

  const talents = (h.key && consts.tal[h.key]) || [];
  let tree = '';
  if (talents.length) {
    const rows = [];
    for (let lv = 4; lv >= 1; lv--) {
      const pair = talents.filter((t) => t[1] === lv);
      if (pair.length < 2) continue;
      const [left, right] = [pair[1], pair[0]];
      rows.push(`<div class="trow">
        <div class="t l${picked.has(left[0]) ? ' on' : ''}">${esc(left[2])}</div>
        <div class="lv">${[10, 15, 20, 25][lv - 1]}</div>
        <div class="t${picked.has(right[0]) ? ' on' : ''}">${esc(right[2])}</div></div>`);
    }
    if (rows.length) tree = `<h3>Таланти</h3><div class="talents">${rows.join('')}</div>`;
  } else if (picked.size) {
    tree = `<h3>Таланти</h3>${[...picked].map((k) => {
      const a = Object.values(consts.ab).find((x) => x.k === k);
      return `<div class="note">• ${esc(a ? a.n : k)}</div>`;
    }).join('')}`;
  }
  return `${extra}<h3>Прокачування</h3><div class="skills">${cells}</div>${tree}`;
}

/* ---------------- старт ---------------- */

function init() {
  const saved = parseAccountId(lsGet(LS_ID));
  if (saved) state.id = saved;
  route();
  lastHash = location.hash;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-режим просто не ввімкнеться */ });
  }
}

init();
