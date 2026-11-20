// Draft Assistant · віджет «Мої ігри» для iPhone (програма Scriptable).
// Дані — лише публічні з OpenDota. Dota ID: поле «Parameter» у налаштуваннях віджета
// або число в рядку DEFAULT_ID нижче (його підставляє кнопка «Скопіювати скрипт» на сторінці).
// Встановлення: Scriptable → «+» → вставити цей текст → назвати «Dota» → на головному екрані
// додати віджет Scriptable (малий або середній) → утримати → «Редагувати віджет» → Script: Dota.

const DEFAULT_ID = "";
const PAGE = "https://plton228.github.io/dota-draft-assistant/mobile/";
const API = "https://api.opendota.com/api";
const CDN = "https://cdn.cloudflare.steamstatic.com";
const RANKS = ["", "Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];
const C = {
  bg: new Color("#0b0c0f"), panel: new Color("#111317"), text: new Color("#ececf0"), muted: new Color("#858a96"),
  ok: new Color("#4cc38a"), okText: new Color("#6fdca0"), bad: new Color("#f2555a"), badText: new Color("#ff8a8a"),
  empty: new Color("#2b2e34"),
};

const fm = FileManager.local();
const dir = fm.joinPath(fm.cacheDirectory(), "draft-assistant-widget");
if (!fm.fileExists(dir)) fm.createDirectory(dir);
const cachePath = (name) => fm.joinPath(dir, name);
function readCache(name) {
  try { return JSON.parse(fm.readString(cachePath(name))); } catch (e) { return null; }
}
function writeCache(name, value) {
  try { fm.writeString(cachePath(name), JSON.stringify(value)); } catch (e) { /* без кешу */ }
}

function accountId() {
  const raw = String((args.widgetParameter || DEFAULT_ID || "")).replace(/\D/g, "");
  if (!raw) return null;
  let n = Number(raw);
  if (raw.length >= 17) n = Number(BigInt(raw) - 76561197960265728n);
  return n > 0 && n <= 4294967295 ? n : null;
}

async function getJSON(path) {
  const req = new Request(API + path);
  req.timeoutInterval = 25;
  const data = await req.loadJSON();
  if (req.response && req.response.statusCode >= 400) throw new Error("HTTP " + req.response.statusCode);
  return data;
}

async function heroes() {
  const cached = readCache("heroes.json");
  if (cached && Date.now() - cached.ts < 7 * 86400000) return cached.h;
  const all = await getJSON("/constants/heroes");
  const h = {};
  for (const v of Object.values(all)) h[v.id] = [v.localized_name, v.img];
  writeCache("heroes.json", { ts: Date.now(), h });
  return h;
}

const won = (m) => (m.player_slot < 128) === m.radiant_win;
function ago(unix) {
  const s = Date.now() / 1000 - unix;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + " хв тому";
  if (s < 86400) return Math.round(s / 3600) + " год тому";
  const d = Math.round(s / 86400);
  return d === 1 ? "вчора" : d + " дн. тому";
}

async function load(id) {
  const key = "player-" + id + ".json";
  try {
    const [player, wl, matches, hs] = await Promise.all([
      getJSON("/players/" + id), getJSON("/players/" + id + "/wl?limit=20"),
      getJSON("/players/" + id + "/matches?limit=10"), heroes()]);
    if (!player.profile) return { error: "Гравця не знайдено", hint: "OpenDota не знає ID " + id };
    const d = { id, ts: Date.now(), name: player.profile.personaname || "Гравець " + id,
                rank: player.rank_tier, wl, matches };
    writeCache(key, d);
    return { ...d, heroes: hs, stale: false };
  } catch (e) {
    const cached = readCache(key);
    const hs = readCache("heroes.json");
    if (cached) return { ...cached, heroes: (hs && hs.h) || {}, stale: true };
    return { error: "OpenDota не відповідає", hint: "Віджет оновиться сам пізніше" };
  }
}

function text(stack, value, size, color, bold) {
  const t = stack.addText(value);
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  return t;
}

async function build() {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(12, 12, 12, 12);
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  const id = accountId();
  if (!id) {
    text(w, "Немає Dota ID", 14, C.text, true);
    w.addSpacer(4);
    const hint = w.addText("Утримайте віджет → «Редагувати віджет» → Parameter: ваш Dota ID");
    hint.font = Font.systemFont(11); hint.textColor = C.muted;
    return w;
  }
  w.url = PAGE + "#id=" + id;
  const d = await load(id);
  if (d.error) {
    text(w, d.error, 14, C.text, true);
    w.addSpacer(4);
    text(w, d.hint, 11, C.muted, false);
    return w;
  }
  const small = config.widgetFamily === "small";

  const top = w.addStack();
  top.centerAlignContent();
  text(top, d.name, 13, C.text, true);
  top.addSpacer();
  const tier = Math.floor((d.rank || 0) / 10), stars = (d.rank || 0) % 10;
  if (d.rank && !small) text(top, tier === 8 ? "Immortal" : RANKS[tier] + " " + "★".repeat(Math.min(stars, 5)), 10, C.muted, true);
  w.addSpacer(6);

  const total = d.wl.win + d.wl.lose, p = total ? Math.round(d.wl.win / total * 100) : 0;
  const row = w.addStack();
  row.bottomAlignContent();
  text(row, total ? p + "%" : "—", small ? 28 : 32, p >= 52 ? C.okText : p <= 47 ? C.badText : C.text, true);
  row.addSpacer(6);
  text(row, total ? d.wl.win + "В · " + d.wl.lose + "П за " + total : "немає ігор", 11, C.muted, false);
  w.addSpacer(6);

  const form = w.addStack();
  form.spacing = 3;
  const last10 = d.matches.slice(0, 10);
  const cell = small ? 10 : 18;
  for (const m of last10) {
    const s = form.addStack();
    s.size = new Size(cell, 8);
    s.cornerRadius = 2;
    s.backgroundColor = won(m) ? C.ok : C.bad;
  }
  w.addSpacer();

  const last = d.matches[0];
  if (last) {
    const h = d.heroes[last.hero_id] || ["Герой", ""];
    const line = w.addStack();
    line.centerAlignContent();
    if (!small && h[1]) {
      try {
        const img = await new Request(CDN + h[1]).loadImage();
        const pic = line.addImage(img);
        pic.imageSize = new Size(44, 25);
        pic.cornerRadius = 4;
        line.addSpacer(8);
      } catch (e) { /* без картинки */ }
    }
    const col = line.addStack();
    col.layoutVertically();
    text(col, (won(last) ? "Перемога" : "Поразка") + (small ? "" : " · " + h[0]), 12, won(last) ? C.okText : C.badText, true);
    text(col, last.kills + "/" + last.deaths + "/" + last.assists + " · " + ago(last.start_time), 10, C.muted, false);
  }
  if (d.stale) {
    w.addSpacer(2);
    text(w, "збережені дані", 9, C.muted, false);
  }
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
