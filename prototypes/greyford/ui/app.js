// 회색여울 — 화면 (19 표현). 이야기 칸 · 장면 곁칸 · 선택지 · 수첩 · 지도.
// 서버(server.mjs)의 /api/*를 부른다. 서술은 SSE로 흘러 들어온다.
import { worldSVG, townSVG, routePath, panZoom, fitToScreen, TYPE_KO } from "./map.js";
import { initCodex, codexSync, linkify, relink, openCard, closeCard, cardOpen, encyclopediaHTML, bindEncyclopedia, linksOn, setLinks } from "./codex.js";
import { initCreate, openCreate, closeCreate, createOpen } from "./create.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DEBUG = new URLSearchParams(location.search).has("debug");
const store = {
  get(k, d) { try { const v = localStorage.getItem("gf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("gf:" + k, JSON.stringify(v)); } catch { /* 저장이 막혀도 화면은 돈다 */ } },
};
const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then((r) => r.json());

// ── 읽기 설정 (이 기기에만) ──
const SET = { size: store.get("size", "m"), theme: store.get("theme", "night"), dim: store.get("dim", true), motion: store.get("motion", true) };
const SIZES = { s: "15px", m: "17px", l: "19px", xl: "21px" };
const mq = window.matchMedia?.("(prefers-color-scheme: light)");
function applySettings() {
  const theme = SET.theme === "system" ? (mq?.matches ? "parchment" : "night") : SET.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--fs", SIZES[SET.size] || SIZES.m);
  document.body.classList.toggle("dim-past", !!SET.dim);
  document.body.classList.toggle("no-motion", !SET.motion);
}
mq?.addEventListener?.("change", applySettings);
applySettings();

// ── 상태 ──
let busy = false, last = null, currentTurn = null, lastPlace = null, fresh = false, deathRunning = false, lastTurn = null;
let mapData = null, mapKey = "";

// ── 서버 부르기 (서술은 오는 대로) ──
async function call(path, body) {
  busy = true; render(last, true);
  const turn = currentTurn || newTurn();
  const live = document.createElement("p"); live.className = "live"; turn.appendChild(live);
  let scrolled = false;
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error(await r.text());
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "", out = null;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /event: (\w+)/.exec(chunk)?.[1], data = JSON.parse(/data: ([\s\S]*)/.exec(chunk)?.[1] || "null");
        if (ev === "text") { live.textContent = data; if (!scrolled) { scrolled = true; turn.scrollIntoView({ behavior: SET.motion ? "smooth" : "auto", block: "start" }); } }
        if (ev === "done") out = data;
      }
    }
    live.remove();
    return out;
  } catch (e) { live.remove(); return { broken: "서버에 닿지 않는다 — " + e.message, retry: body }; }
  finally { busy = false; }
}

// ── 이야기: 한 턴 = 한 덩어리 (내가 고른 것 + 판정 → 서술). 지난 턴은 흐려지고, 오래된 것은 한 줄로 접힌다 ──
const KEEP_OPEN = 3;   // 펼쳐 둘 덩어리 — 그 앞은 '내가 한 일 — 결과' 한 줄로 접힌다 (누르면 펼친다)
function newTurn() {
  const story = $("story");
  for (const t of story.querySelectorAll(".turn:not(.past)")) t.classList.add("past");
  const t = document.createElement("section"); t.className = "turn"; story.appendChild(t);
  while (story.children.length > 40) story.removeChild(story.firstChild);
  const all = story.querySelectorAll(".turn");
  for (let i = 0; i < all.length - KEEP_OPEN; i++) foldTurn(all[i]);
  return (currentTurn = t);
}
function foldTurn(t) {
  if (t.classList.contains("fold") || t.dataset.open) return;
  if (!t.querySelector(":scope > .foldline")) {
    const pl = t.querySelector(":scope > .player"), tier = pl?.querySelector(".tier");
    const first = [...t.querySelectorAll(":scope > p")].find((p) => !p.classList.contains("player") && !p.classList.contains("recap") && p.textContent.trim());
    const txt = pl ? (pl.querySelector("span:not(.tier)")?.textContent || pl.textContent) : (first?.textContent || "").trim().split(/(?<=[.!?…])\s/)[0];
    if (!txt) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "foldline"; b.setAttribute("aria-label", `접힌 대목 펼치기 — ${txt}`);
    b.innerHTML = `<span class="ft">${esc(txt)}</span>${tier ? `<span class="fr ${tier.classList.contains("good") ? "good" : tier.classList.contains("bad") ? "bad" : ""}">${esc(tier.textContent)}</span>` : ""}`;
    b.onclick = () => { t.classList.remove("fold"); t.dataset.open = "1"; };
    t.prepend(b);
  }
  t.classList.add("fold");
}
const TIER_CLS = { "대성공": "good", "성공": "good", "실패": "bad", "대실패": "bad" };
function addBeats(d) {
  const t = currentTurn || newTurn();
  const pl = t.querySelector(".player");
  if (pl && d.result && d.result.skill) { const tg = document.createElement("span"); tg.className = `tier ${TIER_CLS[d.result.tier] || ""}`; tg.textContent = `${d.result.skill} · ${d.result.tier}`; pl.appendChild(tg); }
  // 장면이 바뀌면 가는 줄: 어디, 몇 시
  const v = d.view;
  if (v && lastPlace && v.place.id !== lastPlace) { const m = document.createElement("div"); m.className = "scene-mark"; m.innerHTML = `<span><b>${esc(v.place.name)}</b> · ${esc(v.hm)}</span>`; t.appendChild(m); }
  if (v) lastPlace = v.place.id;
  for (const b of d.beats || []) {
    const p = document.createElement("p");
    if (b.startsWith("┊")) p.className = "ink";
    else if (/^\*[^*]+\*$/.test(b)) { p.className = "inner"; p.textContent = b.slice(1, -1); t.appendChild(p); continue; }
    else if (d.engineOnly && !d.view?.story) p.className = "eng";
    p.textContent = b; t.appendChild(p);
  }
  for (const k of d.ink || []) {
    const p = document.createElement("p");
    if (k.kind === "voice") { p.className = "voice"; p.innerHTML = `<span class="who">${esc(k.who)}</span>${esc(k.text)}`; t.appendChild(p); continue; }
    if (k.kind === "dayend") { p.className = "dayend"; p.innerHTML = `${esc(k.text)}${k.card ? `<span class="card2">${esc(k.card)}</span>` : ""}`; t.appendChild(p); continue; }
    if (k.kind === "echo" || k.kind === "recap") { p.className = k.kind; p.textContent = k.text; if (k.kind === "recap") t.insertBefore(p, t.firstChild); else t.appendChild(p); continue; }
    p.className = k.kind === "grow" ? "grow" : "ink" + (k.kind === "drift" ? " drift" : ""); p.textContent = k.text; t.appendChild(p); if (k.buzz) buzz(HAPTIC[k.buzz]);
  }
  linkify(t);   // 이야기 속 이름 → 카드 (아는 만큼만)
  lastTurn = t;
  // 죽음: 마지막 문장이 문장 중간에서 끊긴다 (14 §4.1 ①)
  if (d.view?.ended?.kind === "dead" && d.beats?.length) { const ps = t.querySelectorAll("p:not(.player)"); const lp = ps[ps.length - 1]; if (lp) { const w = lp.textContent; const cut = w.lastIndexOf(" ", Math.floor(w.length * 0.6)); lp.textContent = w.slice(0, cut > 10 ? cut : Math.floor(w.length * 0.6)).replace(/[.,!?…"']+$/, ""); } }
  currentTurn = null;
}
function say(text) { const t = newTurn(); const p = document.createElement("p"); p.className = "player"; const sp = document.createElement("span"); sp.textContent = text; p.appendChild(sp); t.appendChild(p); }

// ── 작은 그림 조각들 ──
const BAND_N = { "식은 죽 먹기": 5, "확실해 보인다": 4, "해볼 만하다": 3, "반반이다": 2, "운이 따라야 한다": 1, "무모하다": 0 };
const bandHTML = (b) => (b ? `<span class="band" data-b="${BAND_N[b] ?? 2}">${esc(b)}</span>` : "");   // 확률은 말로만 — 낮으면 주묵
const moodCls = (m) => (/열었|나쁘지 않/.test(m) ? "open" : /화가/.test(m) ? "angry" : /겁/.test(m) ? "afraid" : /믿지 않/.test(m) ? "cold" : "");
const PHASE = (h, night) => (night ? "밤" : h < 6 ? "새벽" : h < 11 ? "아침" : h < 14 ? "한낮" : h < 18 ? "오후" : "저녁");
const KIND_KO = { keep: "성채", work: "일터", barracks: "막사", home: "집", square: "광장", office: "관청", canteen: "배급소", chapel: "예배당", store: "곳간", lodging: "헛간 숙소", graveyard: "묘지", checkpoint: "검문소", kennel: "개 우리", outdoor: "물가·들",
  // 회색여울 밖의 고장들
  quay: "부두", dock: "나루", pens: "우리", pen: "우리", shed: "헛간", path: "길", track: "길", street: "거리", wall: "성벽", ruin: "폐허", well: "우물", tower: "탑", edge: "변두리", hut: "오두막", dunes: "모래언덕",
  palace: "궁", perch: "횃대", district: "구역", tavern: "선술집", inn: "여관", market: "장터", guildhall: "길드 회관", guild: "길드", slum: "빈민가", sewer: "하수도", arena: "투기장", hall: "회당", yard: "마당", ground: "마당",
  camp: "야영지", tent: "천막", shrine: "사당", pit: "구덩이", culvert: "배수로", tomb: "무덤", grave: "무덤", graves: "묘역", crypt: "지하 묘실", gate: "문", post: "초소", watch: "망루", guardhouse: "위병소",
  ladder: "사다리", lift: "승강기", stair: "계단", cave: "동굴", clinic: "치료소", infirmary: "진료소", loft: "다락", prison: "감옥", archive: "서고", library: "서고", stacks: "서가", scriptorium: "필사실", court: "법정",
  gallery: "회랑", landmark: "표지", mailbox: "우편함", smelter: "제련소", depot: "집하장", lair: "소굴", residence: "거처", quarters: "처소", secret: "숨은 곳", shaft: "갱도", drift: "갱도", sealed: "봉인된 곳",
  vent: "환기구", abandoned: "버려진 곳", open_pit: "노천 구덩이", sacred_tree: "신목", lake: "호수", pool: "못", spring: "샘", council: "회의장", orchard: "과수원", village: "마을", wood: "숲", spot: "자리",
  cellar: "지하실", vault: "금고", rock: "바위", stone: "돌", field: "들", flat: "너른 땅", ring: "원", pole: "장대", hill: "언덕", lantern: "등불", shop: "가게", cistern: "저수조", house: "집", homes: "집들",
  manor: "저택", cathedral: "대성당", temple: "신전", school: "학당", workshop: "공방", forge: "대장간", altar: "제단", box: "상자", garden: "정원", stable: "마구간", fence: "울타리", lodge: "산막",
  bank: "은행", registry: "등기소", canal: "운하", shipyard: "조선소", tenement: "셋집", seabed: "바다 밑", lighthouse: "등대", customs: "세관", burrow: "굴", throne: "옥좌", ballroom: "무도회장",
  chamber: "방", maze: "미로", kitchen: "부엌", hollow: "움푹한 곳", border: "경계", nest: "둥지", peak: "봉우리", cliff: "벼랑", ledge: "바위턱", bridge: "다리", slope: "비탈" };
const ACCESS_KO = { public: "누구나 드나든다", serf: "농노의 자리", staff: "일꾼만 드나든다", owner: "주인의 자리 — 허락 없이는", locked: "잠겨 있다", secret: "숨은 곳" };
const ABOUT = { suspect: "너를 의심한다", saw_item: "네가 지닌 것을 보았다", trespass: "네가 들어가는 것을 보았다", claim: "네 말을 믿는다", kill: "네가 한 일을 안다", assault: "네가 한 일을 안다", echo_sign: "네가 이상하다고 생각한다" };
// 돈: 속은 동화 단위 — 금화 1 = 은화 20 = 동화 240 (엔진의 coinText와 같은 셈)
const coinParts = (n) => ({ 금화: Math.floor(n / 240), 은화: Math.floor((n % 240) / 12), 동화: n % 12 });
const coinText = (n) => Object.entries(coinParts(n)).filter(([, v]) => v).map(([k, v]) => `${k} ${v}닢`).join(" ") || "동화 0닢";
const coinHTML = (n) => `<span class="coins" title="가진 돈">${esc(coinText(n))}</span>`;   // 돈은 글자로 — 금화·은화·동화 몇 닢
function meter(label, val, max, { seg = false, warn = 0.5, crit = 0.75, show } = {}) {
  const raw = max ? val / max : 0, f = Math.max(0, Math.min(1, raw)), cls = raw >= crit ? "crit" : raw >= warn ? "warn" : "";
  const bar = seg ? `<span class="bar seg">${Array.from({ length: max }, (_, i) => `<i class="${i < val ? "on" : ""}"></i>`).join("")}</span>` : `<span class="bar"><i style="width:${Math.round(f * 100)}%"></i></span>`;
  return `<span class="meter ${cls}" title="${esc(label)} — ${esc(show ?? val)}"><span class="lab">${esc(label)}<b>${esc(show ?? val)}</b></span>${bar}</span>`;
}

// ── 지닌 것 (02 인벤토리 · 19 §8): 몸의 자리마다 · 질과 닳음 · 누르면 물건 카드 ──
const SLOT_INFO = [["손", "손에 든 것", true], ["허리", "허리에 찬 것", true], ["품", "품속", false], ["소매", "소매 속 — 하나만", false], ["부츠", "부츠 속 — 하나만", false]];
const Q_CLS = { 조악: "q0", 보통: "q1", 좋음: "q2", 명품: "q3", 걸작: "q4" };
const ICON = {
  blade: `<path d="M3.5 20.5l5-5M8.5 15.5l2 2"/><path d="M9.6 14.4 19 5c1.2 2.6.4 5.6-2.4 7.6l-4.8 4.1z"/>`,
  light: `<path d="M9 10h6v9.5H9zM7 19.5h10M12 10V7.8"/><path d="M12 3.4c1.4 1.5 1.7 2.7.9 3.5-.5.5-1.3.5-1.8 0-.8-.8-.5-2 .9-3.5z"/>`,
  rope: `<ellipse cx="12" cy="11" rx="7.5" ry="5"/><ellipse cx="12" cy="11" rx="4" ry="2.4"/><path d="M19.4 11.6c-.3 3-2.4 5.5-5 7.9"/>`,
  hook: `<circle cx="12" cy="4" r="1.4"/><path d="M12 5.4V15"/><path d="M12 15c0 4-7 4-7-.5V12M12 15c0 4 7 4 7-.5V12"/>`,
  food: `<path d="M3.8 15c0-4.4 3.7-7.6 8.2-7.6s8.2 3.2 8.2 7.6v1.8H3.8z"/><path d="M8.6 10.4l1 3.2M12.4 9.6l1 3.6M16 10.6l.8 2.6"/>`,
  drink: `<path d="M6 7h9v12.5H6zM6 10h9"/><path d="M15 10.5h2.4c.9 0 1.6.7 1.6 1.6v2.8c0 .9-.7 1.6-1.6 1.6H15"/>`,
  herb: `<path d="M5 19.5C5 11 10 6 19 4.5c-.8 9-6 14.5-14 15z"/><path d="M5 19.5l8.5-8.5"/>`,
  doc: `<path d="M7 4h10v13.5a2.5 2.5 0 0 1-2.5 2.5H6.5"/><path d="M7 4a2 2 0 0 0-2 2v11.6c0 1.3 1 2.4 2.4 2.4"/><path d="M10 8.5h4.5M10 11.5h4.5M10 14.5h3"/>`,
  pass: `<path d="M5 5h14v11H5z"/><path d="M8 8.5h5M8 11h4"/><circle cx="15.5" cy="15.5" r="2.6"/><path d="M14.5 17.8 14 21l1.5-1 1.5 1-.5-3.2"/>`,
  coin: `<path d="M8.6 6h6.8l-1.3 2.4c3 1.3 5.2 4.2 5.2 7.4 0 3-3.5 4.2-7.3 4.2s-7.3-1.2-7.3-4.2c0-3.2 2.2-6.1 5.2-7.4z"/><path d="M9.8 8.4h4.4"/>`,
  sack: `<path d="M9 4h6l-1 3c3.2 1.4 5 4.4 5 7.6 0 3.6-3 5.4-7 5.4s-7-1.8-7-5.4C5 11.4 6.8 8.4 10 7z"/>`,
};
const iconKey = (tags = []) => (tags.includes("무기") ? "blade" : tags.includes("광원") ? "light" : tags.includes("갈고리") ? "hook" : tags.includes("밧줄") ? "rope" : tags.includes("통행증") ? "pass" : tags.includes("문서") ? "doc" : tags.includes("화폐") ? "coin" : tags.includes("술") ? "drink" : tags.includes("치료") ? "herb" : tags.includes("음식") ? "food" : "sack");
const itemIcon = (tags, px = 18) => `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[iconKey(tags)]}</svg>`;
function itemChip(i, { mini = false } = {}) {
  return `<button type="button" class="itm ${Q_CLS[i.effQuality] || ""}${i.illegal ? " ill" : ""}${i.seen ? " seen" : ""}${mini ? " mini" : ""}" data-item="${esc(i.id)}" aria-label="${esc(i.name)}${i.conditionWord ? ` — ${esc(i.conditionWord)}` : ""} · 물건 카드">
    <span class="ic">${itemIcon(i.tags)}</span><span class="nm">${esc(i.name)}</span>${i.quality && i.quality !== "보통" && !mini ? `<span class="qb">${esc(i.quality)}</span>` : ""}${i.illegal && !mini ? `<span class="ib" title="인간이 지니면 죄다">금지</span>` : ""}${i.condition != null ? `<span class="cb${i.condition <= 20 ? " low" : i.condition <= 50 ? " mid" : ""}" title="${esc(i.conditionWord)}"><i style="width:${i.condition}%"></i></span>` : ""}</button>`;
}
const BULK_WORD = (b) => (b <= 0 ? "자리를 차지하지 않는다" : b === 1 ? "한 줌 — 거의 짐이 안 된다" : b === 2 ? "제법 자리를 차지한다" : "무겁다 — 짐이 된다");
const USE_LINES = {
  무기: ["싸움에서 맨손보다 훨씬 낫다 — 날이 좋을수록 더", "쓸 때마다 무뎌진다. 부서지면 맨손이다"],
  광원: ["어두운 곳을 뒤질 때, 캄캄한 아래로 숨어들 때", "한 번 쓸 때마다 탄다 — 다 타면 없어진다"],
  갈고리: ["밧줄과 함께 있으면 담을 넘는 길이 열린다"], 밧줄: ["갈고리와 함께 있으면 담을 넘는 길이 열린다", "쓸수록 해진다"],
  음식: ["먹으면 허기가 가신다", "누군가에게 나눌 수도 있다 — 굶는 곳에서 빵은 말보다 크다"], 술: ["마시면 아픔이 조금 가신다"], 치료: ["아픔을 덜어 준다"],
  문서: ["펼쳐 읽을 수 있다 — 글을 모르면 읽어 줄 사람이 필요하다"], 통행증: ["관문의 검문을 지날 때 보여 준다"], 화폐: ["숨겨 둔 돈 — 챙기면 다시 쓸 수 있다"],
};
function itemEntry(cid) {
  const v = last?.view; if (!v) return null;
  const id = cid.slice(5), it = v.player.items.find((x) => x.id === id) || (v.stash || []).find((x) => x.id === id);
  if (!it) return null;
  const sections = [], L = (text, o = {}) => ({ text, ...o });
  const what = [it.desc ? L(it.desc) : null,
    L(`질 — ${it.quality}${it.effQuality !== it.quality ? ` · 닳아서 ${it.effQuality}만큼밖에 못 한다` : ""}`, { mark: "◆" }),
    it.condition != null ? L(`상태 — ${it.conditionWord}`, { mark: "◇", meter: it.condition / 100 }) : null,
    L(`부피 — ${BULK_WORD(it.bulk)}`, { mark: "▢" }),
    it.value ? L(`값 — ${it.value}쯤`, { mark: "¤" }) : null].filter(Boolean);
  sections.push({ title: "어떤 것", lines: what });
  const where = it.where ? [L(`숨겨 둔 곳 — ${it.where}`), L("몸에 지니지 않았다 — 몸수색에는 안 걸린다", { faint: true })]
    : [L(`${it.slot} — ${it.seen ? "남들 눈에 보인다" : "감춰져 있다 (몸을 뒤지면 나온다)"}`)];
  sections.push({ title: "어디에", lines: where });
  const warn = [it.illegal ? L("인간이 지니면 죄다 — 들키면 채찍이나 그보다 나쁜 것", { bad: true, mark: "!" }) : null,
    it.seen && it.tags.includes("무기") ? L("칼을 드러내고 다닌다 — 보는 사람마다 기억한다", { bad: true, mark: "!" }) : null,
    it.stolen ? L(`원래 주인 — ${it.from || "누군가"}. 알아보는 눈이 있다`, { mark: "!" }) : it.from ? L(`${it.from}에게서 왔다`, { faint: true }) : null].filter(Boolean);
  if (warn.length) sections.push({ title: "조심", lines: warn });
  const use = [...new Set(it.tags.flatMap((t) => USE_LINES[t] || []))].map((t) => L(t));
  if (use.length) sections.push({ title: "쓰임", lines: use });
  const verbs = ["use", "read", "stash", "give", "sell", "take"].map((x) => `${x}:${id}`);
  const actions = (last?.choices || []).filter((c) => verbs.includes(c.id) || c.id.startsWith(`wear:${id}:`)).map((c) => ({ id: c.id, text: c.text }));
  const badges = [{ text: it.quality, cls: it.quality === "조악" ? "lv1" : ["명품", "걸작"].includes(it.quality) ? "lv3" : "" }, it.illegal ? { text: "금지된 물건", cls: "bad" } : null].filter(Boolean);
  return { id: cid, kind: "item", kindLabel: it.where ? "숨겨 둔 것" : "지닌 것", level: 2, name: it.name, sub: it.where ? `${it.where}에 숨겨 두었다` : `${it.slot}에 · ${it.seen ? "남들 눈에 보인다" : "감춰져 있다"}`, artHTML: itemIcon(it.tags, 54), badges, sections, actions };
}
const bindItems = (root) => root.querySelectorAll(".itm[data-item]").forEach((b) => (b.onclick = () => openCard(`item:${b.dataset.item}`)));
const HUNGER_W = ["배부르다", "괜찮다", "출출하다", "배고프다", "굶주렸다"];
// 이/가 (받침이 있으면 '이') — 엔진의 josa와 같은 셈
const iga = (w) => { const c = String(w).charCodeAt(String(w).length - 1) - 0xac00; return `${w}${c >= 0 && c < 11172 && c % 28 ? "이" : "가"}`; };
const eul = (w) => { const c = String(w).charCodeAt(String(w).length - 1) - 0xac00; return `${w}${c >= 0 && c < 11172 && c % 28 ? "을" : "를"}`; };
const painWord = (x) => (x >= 75 ? "몸을 가누기 힘들다" : x >= 50 ? "욱신거린다" : x >= 25 ? "쑤신다" : "견딜 만하다");
const tiredWord = (x) => (x >= 85 ? "쓰러지기 직전" : x >= 60 ? "지쳤다" : x >= 30 ? "조금 피곤하다" : "멀쩡하다");
const fearWord = (x) => (x >= 4 ? "공포에 질렸다" : x >= 2 ? "떨린다" : x >= 1 ? "불안하다" : "담담하다");
const stressWord = (x) => (x >= 70 ? "무너지기 직전" : x >= 45 ? "무겁다" : x >= 20 ? "짊어졌다" : "가볍다");
function skillRow(k) {
  const pct = Math.round((k.progress || 0) * 100);
  return `<div class="sk${k.lagging ? " lag" : ""}">
    <div class="sk-top"><b>${esc(k.name)}</b>${k.body ? `<span class="sk-tag" title="몸의 기술 — 몸이 받쳐 주는 만큼만 쓴다">몸</span>` : ""}<span class="w">${esc(k.word)}</span>${k.next ? `<span class="nx">다음 — ${esc(k.next)}</span>` : `<span class="nx top">끝에 닿았다</span>`}</div>
    <div class="sk-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(k.name)}: 다음 단계까지 ${pct}%"><i style="width:${pct}%"></i></div>
    ${(k.notes || []).map((n) => `<div class="sk-note ${n.sign === "▲" ? "up" : n.sign === "▼" ? "down" : ""}">${esc(n.sign)} ${esc(n.text)}</div>`).join("")}
    ${(k.mentors || []).length ? `<div class="sk-m">가르칠 사람 — ${k.mentors.map((m) => `<span class="ent k-npc lv2" data-ent="npc:${esc(m.npc)}" tabindex="0" role="button">${esc(m.name)}</span> <span class="faint">${m.ready ? (m.fee ? `(값: ${esc(m.fee)})` : "(받아 줄 것이다)") : "(아직 너를 그만큼 믿지 않는다)"}</span>`).join(" · ")}</div>` : ""}
  </div>`;
}
const GROWTH_HELP = [
  "기술은 쓰는 만큼 는다 — 어려운 판정, 목숨이 걸린 판정일수록 많이. 너무 쉬운 일은 아무것도 가르치지 않는다.",
  "잡담과 혼자 하는 연습은 '제법이다'에서 멈춘다. 그 위는 실전과 스승의 몫이다. 스승은 믿음을 얻어야 받아 준다.",
  "몸의 기술(싸움·은신·손재주)은 몸이 받쳐 주는 만큼만 쓴다. 돌아오면 몸은 처음으로 돌아가지만, 손은 기억한다 — 다시 단련하면 세 배로 빨리 붙는다.",
  "머리의 기술(화술·기만·위압·통찰)과 글·말은 돌아와도 그대로다.",
  "한 달 넘게 쓰지 않으면 무뎌진다 — 그래도 가장 좋았던 때의 여덟 할 아래로는 떨어지지 않는다.",
  "물건에는 질(조악·보통·좋음·명품·걸작)과 닳음이 있다. 판정에 쓸 때마다 닳고, 망가지기 직전이면 한 단계 낮게 친다.",
  "손과 허리에 찬 것은 남들이 본다. 품·소매·부츠 속은 감춰지지만 몸을 뒤지면 나온다. 많이 지니면 몸놀림이 둔해진다.",
];

// ── 그리기 ──
function render(d, loading = false) {
  $("busy").textContent = loading ? "잿빛 실이 이어지는 중" : "";
  if (!d) return;
  const v = d.view;
  if (v) {
    renderTop(v);
    renderAside(v, d);
    if (!$("sheet").hidden) renderSheet(v);
  }
  if (DEBUG) $("debugOut") && ($("debugOut").textContent = JSON.stringify({ debug: d.debug, usage: d.usage, provider: d.provider }, null, 1));
  renderDock(d, loading);
}

function renderTop(v) {
  const h = Number(v.hm.slice(0, 2));
  $("clockT").innerHTML = `${esc(v.hm)}<span class="ph">${PHASE(h, v.night)}</span>`;
  $("clockD").textContent = `${v.month} ${v.time.split(" ")[3]}${v.rain ? " · 비" : ""}`;
  // 이름이 길면 별명('절름발이 수탉')은 옆의 작은 글자로
  const nm = /^(.*?)\s*'(.+)'$/.exec(v.place.name);
  $("placeN").textContent = nm ? nm[1] : v.place.name;
  $("placeS").textContent = [nm ? `'${nm[2]}'` : null, v.place.settlement, KIND_KO[v.place.kind]].filter(Boolean).join(" · ");
  $("status").innerHTML = statusWords(v).map(([t, c]) => `<span${c ? ` class="${c}"` : ""}>${esc(t)}</span>`).join("");
  renderStrip(v);
}
// 머리의 아랫줄: 몸과 판의 형편 — 멀쩡할 때는 말하지 않는다. 위험은 주묵, 회차는 황토, 돈은 늘 끝에
function statusWords(v) {
  const p = v.player, U = new Set(v.unlocked || []), out = [], f = p.fatigue || 0, fe = p.fear || 0, st = p.stress || 0;
  if (v.fight) out.push([`싸움 — ${v.fight.name} · ${v.fight.round}합`, "hot"]);
  else if (v.convo) out.push([`대화 — ${v.convo.name}`]);
  if (p.hunger >= 2) out.push([HUNGER_W[p.hunger], p.hunger >= 3 ? "hot" : ""]);
  if (p.pain >= 25) out.push([painWord(p.pain), p.pain >= 50 ? "hot" : ""]);
  if (f >= 30) out.push([tiredWord(f), f >= 60 ? "hot" : ""]);
  if (fe >= 1) out.push([fearWord(fe), fe >= 2 ? "hot" : ""]);
  if (st >= 45) out.push([`마음이 ${stressWord(st)}`, st >= 70 ? "hot" : ""]);
  if (p.bloody) out.push(["옷에 핏자국", "hot"]);
  if (v.load && v.load.total > v.load.cap) out.push(["짐이 무겁다", "hot"]);
  if (p.wantedWord) out.push([`수배 — ${p.wantedWord}`, "hot"]);
  if (v.ladder) out.push([v.ladder.name, "hot"]);
  if (v.echo) out.push([`앎의 흔적 — ${v.echo}`, "hot"]);
  if (U.has("loop")) out.push([`${v.loop}회차`, "mem"]);
  if (v.mode === "story") out.push(["이야기 모드"]);
  out.push([coinText(p.coin), "coin"]);
  return out;
}
// 가장 급한 것 하나: 곧 닥칠 약속, 아니면 날이 가장 적게 남은 일
function topGoal(v) {
  const pr = (v.promises || []).find((p) => p.soon);
  if (pr) return { who: `${pr.who}와의 약속`, what: `${pr.where} · ${pr.what}`, dd: pr.when.split(" ").pop(), soon: true };
  const g = [...(v.goals || [])].sort((a, b) => (a.days ?? 999) - (b.days ?? 999))[0];
  return g ? { who: g.who, what: g.what, dd: g.days != null ? `D-${g.days}` : "", soon: g.days != null && g.days <= 7 } : null;
}
// 폰: 곁칸 대신 이야기 위의 두 줄 — 이 자리의 사람들 · 가장 급한 것
let stripAll = false;
function renderStrip(v) {
  const ppl = v.people || [], MAX = stripAll ? 99 : 4, g = topGoal(v);
  const names = ppl.slice(0, MAX).map((x) => `<button class="pchip${moodCls(x.mood) === "angry" ? " angry" : ""}${x.asleep ? " asleep" : ""}" data-npc="${esc(x.id)}">${esc(x.name)}</button>`).join("")
    + (ppl.length > MAX ? `<button class="pchip more" data-all="1">외 ${ppl.length - MAX}명</button>` : "");
  $("strip").innerHTML = (ppl.length ? `<div class="sline"><span class="lab">이 자리</span>${names}</div>` : "")
    + (g ? `<div class="gline"><b>${esc(g.who)}</b> ${esc(g.what)}${g.dd ? `<span class="dd${g.soon ? " soon" : ""}">${esc(g.dd)}</span>` : ""}</div>` : "");
  $("strip").querySelectorAll(".pchip").forEach((b) => (b.onclick = () => (b.dataset.all ? ((stripAll = true), renderStrip(v)) : personMenu(b.dataset.npc, b))));
}

let asideAll = false;
function renderAside(v, d) {
  // 이 자리: 이름 · 하는 일 · 기분 (화가 났으면 주묵) · 나에 대해 아는 것
  const ppl = v.people || [], MAX = 6, shown = asideAll ? ppl : ppl.slice(0, MAX);
  const row = (x) => {
    const ab = [...new Set((x.aboutPlayer || []).map((b) => ABOUT[b.kind]).filter(Boolean))], mc = moodCls(x.mood);
    return `<button class="person${x.asleep ? " asleep" : ""}" data-npc="${esc(x.id)}" aria-label="${esc(x.name)}에게 할 수 있는 일"><span class="pname"><b>${esc(x.name)}</b>${x.who && x.who !== x.name ? `<span class="who">${esc(x.who)}</span>` : ""}</span>
      <span class="pdo">${esc(x.doing || "")}${x.asleep ? " — 잠들었다" : ""}${x.mood ? ` · <span class="mood ${mc}">${esc(x.mood)}</span>` : ""}</span>${ab.length ? `<span class="pwarn">${esc(ab.join(", "))}</span>` : ""}</button>`;
  };
  $("asideScene").innerHTML = `<h3><span>이 자리</span>${ppl.length > 1 ? `<span>${ppl.length}명</span>` : ""}</h3>${shown.map(row).join("") || `<div class="empty">아무도 없다.</div>`}
    ${ppl.length > MAX ? `<button class="people-more">${asideAll ? "줄여 본다" : `그 밖에 ${ppl.length - MAX}명`}</button>` : ""}${v.bodies.length ? `<div class="bodies">시체 — ${esc(v.bodies.join(", "))}</div>` : ""}`;
  $("asideScene").querySelectorAll(".person").forEach((b) => (b.onclick = () => personMenu(b.dataset.npc, b)));
  $("asideScene").querySelector(".people-more")?.addEventListener("click", () => { asideAll = !asideAll; renderAside(v, d); });
  // 지켜야 할 것 · 약속
  const goals = (v.goals || []).map((g) => `<div class="goal"><span class="w"><b>${esc(g.who)}</b><span>${esc(g.what)}</span></span>${g.days != null ? `<span class="dday${g.days <= 7 ? " soon" : ""}">D-${g.days}</span>` : ""}</div>`);
  const proms = (v.promises || []).map((p) => `<div class="goal"><span class="w"><b>${esc(p.who)}와의 약속</b><span>${esc(p.where)} · ${esc(p.what)}</span></span><span class="dday${p.soon ? " soon" : ""}">${esc(p.when.split(" ").pop())}</span></div>`);
  $("asideGoals").hidden = !goals.length && !proms.length;
  $("asideGoals").innerHTML = `<h3><span>지켜야 할 것</span></h3>${proms.join("")}${goals.join("")}`;
  // 뒤를 밟는 자
  const hu = (v.hunters || []).filter((h) => h.now && h.track >= 1);
  $("asideHunt").hidden = !hu.length;
  $("asideHunt").innerHTML = `<h3><span>뒤를 밟는 자</span></h3>${hu.map((h) => `<div class="goal"><span class="w"><b>${esc(h.name)}</b><span>${esc(h.disposition)}</span></span><span class="track" title="얼마나 가까이 왔나">${"●".repeat(h.track)}${"○".repeat(Math.max(0, 4 - h.track))}</span></div>`).join("")}`;
  refreshMini(v);
}

// 곁칸의 작은 고장 지도 (장소나 시각이 바뀌면 다시 받는다)
async function refreshMini(v) {
  const key = `${v.place.id}|${v.t}`;
  if (key === mapKey && mapData) return drawMini();
  mapKey = key;
  if (getComputedStyle($("aside")).display === "none" && $("mapview").hidden) return;
  try { mapData = await post("/api/map"); } catch { return; }
  drawMini();
  if (!$("mapview").hidden) drawMap();
}
function drawMini() {
  const S = mapData?.settlement; if (!S?.grid) { $("asideMap").hidden = true; return; }
  $("asideMap").hidden = false;
  const t = townSVG(S, { mini: true });
  const here = S.locations.find((l) => l.here);
  // 내 자리를 가운데로, 고장의 절반쯤 보이게
  const w = t.base.w * 0.62, h = w * 0.75, cx = here ? here.xy[0] : t.base.x + t.base.w / 2, cy = here ? here.xy[1] : t.base.y + t.base.h / 2;
  $("miniMap").innerHTML = `<svg viewBox="${cx - w / 2} ${cy - h / 2} ${w} ${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(S.name)} 약도">${t.svg}</svg>`;
  fitToScreen($("miniMap").querySelector("svg"), { ...t, icon: { ...t.icon, px: 24 } }, { pawnPx: 42 });
  $("miniCap").innerHTML = `<span>${esc(S.name)}</span><span>지도 <span class="kbd">M</span></span>`;
}

// 사람을 누르면: 그 사람에게 할 수 있는 일
function personMenu(npc, anchor) {
  closeMenu();
  const ch = (last?.choices || []).filter((c) => c.id.split(":").includes(npc) || c.id.endsWith(":" + npc));
  const p = last?.view?.people.find((x) => x.id === npc);
  const m = document.createElement("div"); m.className = "menu-pop"; m.id = "menuPop"; m.setAttribute("role", "menu");
  m.innerHTML = `<div class="mh"><b>${esc(p?.name || "")}</b>${p?.who ? esc(p.who) : ""}</div>${ch.length ? ch.map((c) => `<button role="menuitem" data-id="${esc(c.id)}">${esc(c.text)}</button>`).join("") : `<div class="none">지금은 할 수 있는 게 없다</div>`}<button role="menuitem" data-card="npc:${esc(npc)}" class="card-item">이 사람의 카드</button>`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(12, Math.min(innerWidth - mw - 12, r.left)) + "px";
  m.style.top = (r.bottom + mh + 8 < innerHeight ? r.bottom + 6 : Math.max(12, r.top - mh - 6)) + "px";
  m.querySelectorAll("button").forEach((b) => (b.onclick = () => { closeMenu(); if (b.dataset.card) return openCard(b.dataset.card); const c = ch.find((x) => x.id === b.dataset.id); act({ id: c.id, text: c.text }); }));
  m.querySelector("button")?.focus();
  setTimeout(() => document.addEventListener("pointerdown", outside, { once: true }), 0);
  function outside(e) { if (!m.contains(e.target)) closeMenu(); else document.addEventListener("pointerdown", outside, { once: true }); }
}
function closeMenu() { $("menuPop")?.remove(); }

// ── 선택지: 번호 붙은 목록 하나 + 시간 한 줄 + 접어 둔 묶음 (이곳에서 더 · 다른 곳으로 · 아직 못 하는 것) ──
let openGroup = null, groupPlace = null;
function renderDock(d, loading) {
  const panel = $("dock"), v = d.view;
  if (loading) { panel.querySelectorAll("button, input").forEach((b) => (b.disabled = true)); return; }
  if (d.broken) {
    panel.innerHTML = `<div class="broken"><p>${esc(d.broken)}</p><div class="sub">판정도, 시간도 흐르지 않았다. 다시 시도하면 같은 주사위로 이어진다.</div><button class="btn primary" id="retry">다시 시도</button></div>`;
    $("retry").onclick = () => (d.retry ? act(d.retry, true) : start());
    return;
  }
  if (v?.ended) {
    panel.innerHTML = `<div class="ended"><button class="btn" id="reg" aria-label="계속">…</button></div>`;
    $("reg").onclick = () => deathSequence(v.ended);
    if (!deathRunning && fresh) setTimeout(() => deathSequence(v.ended), 1800);
    return;
  }
  const ch = d.choices || [];
  const nameC = ch.find((c) => c.input === "true_name");
  if (nameC) {
    panel.innerHTML = `<form class="namebox" id="nameForm"><label for="tn">${esc(nameC.text)} — 이 이름은 회귀해도 남는다</label>
      <input type="text" id="tn" maxlength="8" placeholder="이름" autocomplete="off" required>
      ${nameC.sibling ? `<div class="sib"><span>${esc(nameC.sibling)}</span><label><input type="radio" name="sib" value="형" checked> 형</label><label><input type="radio" name="sib" value="누나"> 누나</label></div>` : ""}
      <button class="btn primary">${esc(nameC.button || "그 이름으로 대답한다")}</button></form>`;
    $("nameForm").onsubmit = (e) => { e.preventDefault(); const n = $("tn").value.trim(); if (!n) return; const sib = panel.querySelector("input[name=sib]:checked")?.value; act({ id: nameC.id, text: sib ? `${n}|${sib}` : n }, false, `"${n}." — ${nameC.say || "그 이름에 대답한다"}`); };
    setTimeout(() => $("tn")?.focus(), 50);
    return;
  }
  const NAMED = ["npc_name", "child_name", "house"];
  const nameNpc = ch.filter((c) => NAMED.includes(c.input));
  const journeys = ch.filter((c) => c.kind === "journey");
  const more = ch.filter((c) => c.more && c.kind !== "journey" && !NAMED.includes(c.input));
  const main = ch.filter((c) => !c.more && c.kind !== "move" && c.kind !== "time" && c.kind !== "journey" && !NAMED.includes(c.input));
  const moves = ch.filter((c) => !c.more && c.kind === "move"), time = ch.filter((c) => !c.more && c.kind === "time");
  const locked = d.locked || [];
  const cls = { "▲": "up", "▼": "down", "?": "unk" };
  let n = 0;
  const btn = (c, numbered = true) => {
    const k = numbered && n < 9 ? ++n : null;
    const meta = [c.skill ? `<span>${esc(c.skill)}</span>` : "", bandHTML(c.band), DEBUG && c.p != null ? `<span>${c.p}%</span>` : "", c.risk ? `<span class="risk">${esc(c.risk)}</span>` : ""].filter(Boolean).join("");
    const b = `<button class="choice${numbered ? "" : " plain"}" data-id="${esc(c.id)}"${k ? ` data-key="${k}"` : ""}>${numbered ? `<span class="num">${k || "·"}</span>` : ""}<span class="ct">${c.memory ? `<span class="mem" title="지난 회차의 기억">◈</span>` : ""}${esc(c.text)}</span>${meta ? `<span class="meta">${meta}</span>` : ""}</button>`;
    const why = c.why?.length ? `<button class="q" aria-expanded="false" aria-label="판정 근거" data-q="${esc(c.id)}">근거</button><div class="why" hidden>${c.why.map((w) => `<div class="${cls[w.sign] || ""}">${esc(w.sign)} ${esc(w.text)}</div>`).join("")}<div class="res">→ ${esc(c.band)}</div></div>` : "";
    return `<div class="crow">${b}${why}</div>`;
  };
  // 묶음: 처음엔 접혀 있다. 고장 안에서 다른 곳으로 옮기면 다시 접는다. 할 일이 이동뿐이면 '다른 곳으로'를 펼쳐 둔다
  const groups = [more.length ? ["more", "이곳에서 더", more.length] : null, moves.length || journeys.length ? ["moves", "다른 곳으로", moves.length + (journeys.length ? 1 : 0)] : null, locked.length ? ["locked", "아직 못 하는 것", locked.length] : null].filter(Boolean);
  if (v?.place?.id !== groupPlace) { groupPlace = v?.place?.id; openGroup = null; }
  if (openGroup && !groups.some(([k]) => k === openGroup)) openGroup = null;
  if (!main.length && !openGroup && groups.some(([k]) => k === "moves")) openGroup = "moves";
  const groupHTML = (k) => k === "more" ? `<div class="choices">${more.map((c) => btn(c, false)).join("")}</div>`
    : k === "moves" ? `<div class="choices">${moves.map((c) => btn(c, false)).join("")}${journeys.length ? `<div class="crow"><button class="choice plain" id="toWorld"><span class="ct">먼 길은 지도에서 고른다</span><span class="meta"><span>빠른 길과 돌아가는 길</span><span>대륙 지도 · M</span></span></button></div>` : ""}</div>`
    : k === "locked" ? `<div class="locked-list">${locked.map((l) => `<div><b>${esc(l.label)}</b> — ${esc(l.why)}</div>`).join("")}</div>` : "";
  panel.innerHTML = `${main.length ? `<div class="choices">${main.map((c) => btn(c)).join("")}</div>` : ""}
    ${time.length ? `<div class="timeline"><span class="lab">시간</span>${time.map((c) => `<button class="tbtn choice-lite" data-id="${esc(c.id)}">${esc(c.text)}</button>`).join("")}</div>` : ""}
    ${nameNpc.map((c) => c.input === "house" ? `<form class="free nameNpc house" data-id="${esc(c.id)}"><input placeholder="가문 이름" maxlength="10" autocomplete="off"><input placeholder="가훈 한 문장" maxlength="40" autocomplete="off"><button class="btn">세운다</button></form>` : `<form class="free nameNpc" data-id="${esc(c.id)}"><input placeholder="${esc(c.text)}" maxlength="10" autocomplete="off"><button class="btn">이름</button></form>`).join("")}
    ${groups.length ? `<div class="dock-more">${groups.map(([k, l, c]) => `<button type="button" class="gbtn" data-g="${k}" aria-expanded="${openGroup === k}" aria-controls="gpanel"><span class="gt">${l}</span><span class="c">${c}</span></button>`).join("")}</div><div class="gpanel" id="gpanel"${openGroup ? "" : " hidden"}>${openGroup ? groupHTML(openGroup) : ""}</div>` : ""}
    ${v?.convo || main.length ? `<form class="free" id="free"><input id="freeText" placeholder="직접 말하거나 행동한다  ( / )" autocomplete="off" aria-label="직접 말하거나 행동한다"><button class="btn">하기</button></form>` : ""}`;
  const byId = new Map(ch.map((c) => [c.id, c]));
  panel.querySelectorAll(".choice[data-id], .choice-lite").forEach((b) => (b.onclick = () => { const c = byId.get(b.dataset.id); act({ id: c.id, text: c.text }); }));
  panel.querySelectorAll(".q").forEach((q) => (q.onclick = () => { const w = q.nextElementSibling; w.hidden = !w.hidden; q.setAttribute("aria-expanded", !w.hidden); }));
  panel.querySelectorAll(".gbtn").forEach((g) => (g.onclick = () => { openGroup = openGroup === g.dataset.g ? null : g.dataset.g; renderDock(d, false); panel.querySelector(`.gbtn[data-g="${g.dataset.g}"]`)?.focus(); }));
  panel.querySelectorAll(".nameNpc").forEach((fm) => (fm.onsubmit = (e) => { e.preventDefault(); const ins = fm.querySelectorAll("input"); const val = ins[0].value.trim(); if (!val) return; const text = fm.classList.contains("house") ? `${val}|${ins[1].value.trim()}` : val; act({ id: fm.dataset.id, text }, false, `"${val}."`); }));
  const f = $("free"); if (f) f.onsubmit = (e) => { e.preventDefault(); const t = $("freeText").value.trim(); if (t) act({ free: t }); };
  const tw = $("toWorld"); if (tw) tw.onclick = () => openMap("world");
}

let offeredCreate = false;
function show(d, isFresh = false) {
  last = d; fresh = isFresh;
  // 처음 여는 판 (자동 저장이 비어 있다): 생성 화면부터 — 닫으면 정본의 셋째로 그대로 시작한다
  if (d.fresh && !offeredCreate && !d.broken) { offeredCreate = true; setTimeout(() => openCreate({ canClose: true, reason: "누구로 시작할까 — 잔향이 깃들 사람" }), 60); }
  if (!d.broken) addBeats(d); else currentTurn = null;
  render(d);
  // 새로 알게 된 것이 있으면 백과 목록을 다시 받고, 방금 그린 덩어리의 이름을 다시 잇는다
  if (d.codexSig) codexSync(d.codexSig).then((changed) => { if (changed) { $("story").querySelectorAll(".turn").forEach((t) => relink(t)); if (!$("sheet").hidden && sheetTab === "codex") renderSheet(last?.view); } });
}
async function act(input, retry = false, label) {
  if (busy) return;
  closeMenu();
  if (!retry) say(label || input.free || input.text || input.id);
  show(await call("/api/act", input), true);
}
async function start() { show(await call("/api/state")); }

// ── 수첩 ──
let sheetTab = "memory";
function openSheet(tab) {
  if (tab) sheetTab = tab;
  $("sheet").hidden = false;
  renderSheet(last?.view);
  if (sheetTab === "settings") loadSaves();
  $("sheet").querySelector(`.tab[data-tab="${sheetTab}"]`)?.focus();
}
function closeSheet() { $("sheet").hidden = true; }
function renderSheet(v) {
  document.querySelectorAll("#sheet .tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === sheetTab));
  const body = $("sheetBody");
  if (sheetTab === "settings") { body.innerHTML = settingsHTML(v); bindSettings(); return; }
  if (sheetTab === "codex") { body.innerHTML = encyclopediaHTML(); bindEncyclopedia(body, () => renderSheet(last?.view)); return; }
  if (!v) { body.innerHTML = `<div class="sec empty">아직 아무것도 없다.</div>`; return; }
  const U = new Set(v.unlocked || []);
  const sec = (title, html, show = true) => (show && html ? `<div class="sec"><h4>${title}</h4>${html}</div>` : "");
  let h = "";
  if (sheetTab === "memory") {
    h += sec(v.echoNamed ? "잔향 — 회귀해도 남는다" : "기억 — 회귀해도 남는다", `<ul>${v.trueName ? `<li class="mem">네 이름 — ${esc(v.trueName)}.${v.origin?.family !== false ? " 어머니만 부른다" : ""}</li>` : ""}${v.lastHook ? `<li class="past">마지막 줄 — ${esc(v.lastHook)}</li>` : ""}${v.notebook.map((x) => `<li class="${x.startsWith("◇") ? "past" : ""}">${esc(x)}</li>`).join("") || "<li class='faint'>아직 없다</li>"}</ul>`, U.has("notebook"));
    const OA = [...(v.oaths || []).map((o) => `<li>"${esc(o.line)}" — ${o.state === "held" ? "품고 있다" : o.state === "kept" ? "지켜졌다" : "깨졌다"}${o.witnesses.length ? ` <span class="faint">(증인: ${esc(o.witnesses.join(", "))})</span>` : ""}</li>`), ...(v.pastOaths || []).map((l) => `<li class="past">┊ "${esc(l)}" — 증인은 잊었다. 너는 기억한다</li>`)];
    h += sec("맹세", OA.length ? `<ul>${OA.join("")}</ul>` : "");
    const T2 = v.twoDays;
    if (T2?.then) h += sec("두 겹의 날", `<div class="book">${(T2.marks || []).map((m) => `<div>${esc(m)}</div>`).join("")}<div class="faint">┊ 지난 회차의 이 날 (${esc(T2.then.date)}) — ${esc(T2.then.at)}${T2.then.notes.map((x) => `<br>┊ ${esc(x)}`).join("")}</div>${T2.now ? `<div style="margin-top:6px">이번 — ${esc(T2.now.at)}${T2.now.notes.map((x) => `<br>· ${esc(x)}`).join("")}</div>` : `<div style="margin-top:6px">이번 — 아직 하루가 끝나지 않았다</div>`}</div>`);
    const TL = v.talents || [], AC = v.achievements || [];
    h += sec("재능과 새긴 것", TL.length || AC.length ? `<div class="book">${TL.map((t) => `<b>${esc(t.name)}</b> <span class="faint">${t.mother ? "어머니가 기억하는 너" : esc(t.tierName)}${t.grows.length ? ` — ${esc(iga(t.grows.join("·")))} 빨리 는다` : t.effect ? ` — ${esc(t.effect)}` : ""}</span>`).join("<br>")}${AC.length ? `<div class="faint" style="margin-top:6px">잔향에 새긴 것 — ${esc(AC.join(" · "))}</div>` : ""}</div>` : "");
    const WL = v.memoryWall || [];
    h += sec("기억의 벽", WL.length ? `<div class="book">${WL.map((w) => `<div class="past">┊ ${esc(w)}</div>`).join("")}${v.soulYears ? `<div class="faint" style="margin-top:6px">영혼의 햇수 — ${v.soulYears}년</div>` : ""}</div>` : "");
  }
  if (sheetTab === "people") {
    h += sec("약속", (v.promises || []).length ? `<ul>${v.promises.map((p) => `<li><b>${esc(p.who)}</b> — ${esc(p.when)} ${esc(p.where)}: ${esc(p.what)}</li>`).join("")}</ul>` : "");
    h += sec("아는 사람들 — 지금 어디쯤", (v.people_known || []).map((x) => `<div class="pk"><div class="top"><b class="ent k-npc lv2" data-ent="npc:${esc(x.id)}" tabindex="0" role="button">${esc(x.name)}</b>${x.knots ? ` <span class="knots" title="매듭">${"⟡".repeat(x.knots)}</span>` : ""}${x.heldKnots && !x.thisLoop ? ` <span class="faint" title="지난 회차의 매듭">${"◇".repeat(x.heldKnots)}</span>` : ""}${x.who ? ` <span class="faint">${esc(x.who)}</span>` : ""}</div>
      <div class="guess">${esc(x.guess || "모른다")}${x.lastSeen ? ` · 마지막으로 본 곳: ${esc(x.lastSeen)}` : ""} · ${esc(x.mood)}${x.id === "npc_sara" && v.romance?.words?.npc_sara && v.romance.npc_sara > 0 ? ` · <span class="mem">${esc(v.romance.words.npc_sara)}</span>` : ""}</div>
      ${(x.talks || []).length ? `<div class="book talks">${x.talks.map((t) => `<div><span class="faint">${esc(t.when)}</span> — ${t.asked.length ? `꺼낸 말 ‘${esc(t.asked[t.asked.length - 1])}’` : "짧은 인사"}${t.said ? ` · 끝에 들은 말 “${esc(t.said)}”` : ""}</div>`).join("")}</div>` : ""}
      ${(x.facts || []).length ? `<div class="book">${x.facts.map((f) => `<div>${esc(f.sure)} ${esc(f.text)}</div>`).join("")}</div>` : ""}${(x.links || []).length ? `<div class="book lk">${x.links.map((l) => `— ${esc(l.other)}: ${esc(l.text)}`).join("<br>")}</div>` : ""}
      ${(x.past || []).map((l) => `<div class="book past">┊ ${esc(l)}</div>`).join("")}<input class="memo" data-npc="${esc(x.id)}" placeholder="메모 — 회귀해도 남는다" value="${esc(x.memo || "")}"></div>`).join("") || `<div class="empty">아직 말을 섞은 사람이 없다</div>`, U.has("people"));
    const HU = v.hunters || [];
    h += sec("사냥꾼 판", HU.length ? HU.map((x) => `<div class="pk"><div class="top"><b>${esc(x.name)}</b> <span class="faint">${esc(x.disposition)}</span>${x.past ? ` <span class="faint">${esc(x.past)}</span>` : ""}${x.now && x.track ? ` <span class="bad">${"●".repeat(x.track)}${"○".repeat(Math.max(0, 4 - x.track))}</span>` : ""}</div>${(x.lessons || []).map((l) => `<div class="guess">교훈 — ${esc(l)}</div>`).join("")}</div>`).join("") : "");
  }
  if (sheetTab === "body") {
    const p = v.player, LD = v.load || { total: 0, cap: 6, word: "" };
    h += sec("몸", `<div class="bvit">${[
      meter("배고픔", p.hunger, 4, { seg: true, show: HUNGER_W[p.hunger] }),
      meter("아픔", p.pain, 100, { warn: 0.3, crit: 0.6, show: painWord(p.pain) }),
      meter("지침", p.fatigue || 0, 100, { warn: 0.6, crit: 0.85, show: tiredWord(p.fatigue || 0) }),
      meter("두려움", p.fear || 0, 5, { seg: true, warn: 0.4, crit: 0.8, show: fearWord(p.fear || 0) }),
      meter("마음의 짐", p.stress || 0, 100, { warn: 0.45, crit: 0.7, show: stressWord(p.stress || 0) }),
    ].join("")}</div>
      <div class="bline">${[
        v.origin ? `<span class="chip gold" title="${esc(v.origin.title)} · 잠자리 — ${esc(v.origin.home)}">${esc(v.origin.name)}</span>` : "",
        v.body?.train ? `<span class="chip">${esc(v.body.train)}</span>` : "",
        v.body?.weak ? `<span class="chip hot">굶주려 팔에 힘이 없다</span>` : "",
        v.debt ? `<span class="chip hot" title="열흘마다 빚쟁이가 온다 — 두 번 못 내면 쫓긴다">빚 — ${esc(v.debt.left)} · 빚쟁이까지 ${v.debt.days}일${v.debt.miss ? ` · 못 낸 번 ${v.debt.miss}` : ""}</span>` : "",
        v.smell ? `<span class="chip" title="개 코 — 제 몸의 젖은 재 냄새를 맡는다">젖은 재 냄새 — ${esc(v.smell)}</span>` : "",
        ...(v.traits || []).map((t) => `<span class="chip">기질 — ${esc(t)}</span>`),
      ].filter(Boolean).join("")}</div>`);
    const bySlot = (s) => p.items.filter((i) => i.slot === s);
    h += sec(`지닌 것 <span class="h4r">짐 — ${esc(LD.word)}</span>`, `<div class="doll">${SLOT_INFO.map(([s, lab, seen]) => `<div class="slot${seen ? " seen" : ""}"><div class="sl"><b>${s}</b><span>${seen ? "남들 눈에 보인다" : lab}</span></div><div class="its">${bySlot(s).map((i) => itemChip(i)).join("") || `<span class="none">비었다</span>`}</div></div>`).join("")}</div>
      <div class="loadrow">${meter("짐", LD.total, LD.cap, { warn: 0.84, crit: 1.01, show: LD.total > LD.cap ? "몸놀림이 둔하다" : LD.word })}${coinHTML(p.coin)}</div>
      ${p.bloody ? `<div class="warnline">옷에 핏자국 — 물가에서 빨아야 한다</div>` : ""}<p class="faint-note">물건을 누르면 카드가 열린다 — 질과 닳음, 누가 볼 수 있는지, 지금 할 수 있는 일.</p>`, U.has("items") || p.items.length > 0);
    const ST = v.stash || [];
    h += sec("숨겨 둔 것", ST.length ? `<div class="stash">${ST.map((i) => `<div class="st-row">${itemChip(i)}<span class="where">${esc(i.where)}</span></div>`).join("")}</div>` : "");
    h += sec("손에 익은 것 — 쓸수록 는다", `<div class="skills">${(v.skills || []).map(skillRow).join("")}</div>`);
    // 비기 (06 §3.1): 열린 것은 뜻까지, 닫힌 것은 한 줄 — 무엇을 얼마나 익히면 열리나
    const AR = v.arts || [], MS = v.mastery || [];
    if (AR.length || MS.length) h += sec("비기 — 손이 기억하는 것", `<div class="arts">${[...AR.filter((a) => a.on), ...AR.filter((a) => !a.on)].map((a) => `<div class="art${a.on ? "" : " off"}"><span><b>${esc(a.name)}</b><span class="tl">${esc(a.talent || "")}${a.tier === 5 ? " · 오의" : ""}</span></span><span class="st${a.on ? " on" : ""}">${a.on ? (a.used ? "오늘은 썼다" : "열렸다") : `${esc(a.skill)} ${a.req}에 열린다`}</span>${a.on ? `<span class="ds">${esc(a.desc)}</span>` : ""}</div>`).join("")}
      ${MS.map((m) => `<div class="art"><span><b>경지 — ${esc(m.skill)}</b><span class="tl">${m.level}단계</span></span><span class="st on">영혼에 남는다</span><span class="ds">${esc(m.skill)}의 모든 판정이 사람의 끝을 넘는다</span></div>`).join("")}</div>`);
    const B = v.build, TLs = (v.talents || []).filter((t) => !t.mother), GR = v.grafts || [];
    if (B || TLs.length || GR.length) h += sec("타고난 것 — 재능·특질·결점", `<div class="born">${B?.line ? `<p class="birth">${esc(B.line)}</p>` : ""}
      ${TLs.map((t) => `<div class="tal"><b>${esc(t.name)}</b><span class="tier t${t.tier}">${esc(t.tierName)}</span>${t.revealed ? `<span class="rev">숨어 있던 것</span>` : ""}<div class="faint">${esc(t.effect || "")}${t.grows.length ? ` · ${esc(iga(t.grows.join("·")))} 빨리 는다` : ""}</div></div>`).join("")}
      ${(B?.traits || []).map((t) => `<div class="tal"><b>${esc(t.name)}</b><span class="tier">혈통</span><div class="faint">${esc(t.desc)}</div></div>`).join("")}
      ${GR.map((t) => `<div class="tal"><b>${esc(t.name)}</b><span class="tier t4">이식</span><div class="faint">${t.held ? "붙었다 — 이 몸은 회귀하면 잃지만, 견뎌 낸 것은 영혼이 기억한다" : "몸이 아직 밀어낸다 — 이레를 견뎌야 붙는다"}</div></div>`).join("")}
      ${(B?.legacy || []).map((t) => `<div class="tal"><b>${esc(t.name)}</b><span class="tier t4">유산</span><div class="faint">${esc(t.desc)}</div></div>`).join("")}
      ${(B?.flaws || []).map((f) => `<div class="tal bad"><b>${esc(f.name)}</b><span class="tier">결점</span><div class="faint">${esc(f.desc)}</div></div>`).join("")}
      <div class="faint born-foot">${B?.hiddenLeft ? `숨은 재능 ${B.hiddenLeft}개가 아직 잠들어 있다. ` : ""}${v.tp?.free > 0 ? `잔향에 남은 점수 ${v.tp.free} — 회귀할 때 어둠 속에서 재능을 깨운다.` : ""}</div>
      ${v.forecast ? `<div class="forecast">${v.forecast.map((f) => `<span class="${f.rain ? "rain" : ""}">${f.day === 1 ? "내일" : `${f.day}일 뒤`} ${f.rain ? "비" : "맑음"}</span>`).join("")}</div>` : ""}</div>`);
    h += `<details class="sec help"><summary>몸이 기억하는 법 — 성장과 장비</summary><ul>${GROWTH_HELP.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>`;
    h += sec("낱말", (v.lexicon || []).length ? `<ul>${v.lexicon.map((w) => `<li>${esc(w.word)} <span class="faint">(${esc(w.lang)})</span> — ${w.meaning ? esc(w.meaning) : "<span class='faint'>뜻을 모른다. 쇳소리 같은 말</span>"}</li>`).join("")}</ul>` : "");
  }
  if (sheetTab === "world") {
    const R = v.reputation || {};
    const rep = (R.news || []).map((x) => `<li>${esc(x.scopeName)}: ${esc(x.label)}${x.place ? ` (${esc(x.place)})` : ""}${x.distortion ? ` — 소문이 ${esc(x.distortion)}` : ""}${x.identified ? "" : " — 누가 했는지는 모른다"}</li>`).join("")
      + ([...(R.titles || []), ...(R.extraTitles || [])].length ? `<li>사람들이 부르는 이름: ${esc([...new Set([...(R.titles || []), ...(R.extraTitles || [])])].join(", "))}</li>` : "")
      + (v.echo ? `<li class="bad">앎의 흔적 — ${esc(v.echo)}</li>` : "")
      + (Object.keys(R.bands || {}).length ? `<li>${Object.entries(R.bands).map(([k, b]) => `${esc(k)}: ${esc(b)}`).join(" · ")}</li>` : "");
    h += sec("평판 — 사람들이 나를 어떻게 말하나", `<ul>${rep || "<li>아무도 당신을 모른다</li>"}</ul>`, U.has("reputation"));
    const FM = v.family;
    if (FM) h += sec("가족", `<div class="book">${FM.name ? `<b>'${esc(FM.name)}'</b> — "${esc(FM.motto)}"<br>` : ""}${FM.members.length ? `식구: ${esc(FM.members.join(", "))}` : ""}${FM.children.length ? `<br>아이: ${FM.children.map((c) => `${esc(c.name)} (${esc(c.sex)}, ${esc(c.age)}${c.traits.length ? " · " + esc(c.traits.join(", ")) : ""}${Object.keys(c.skills).length ? " · " + esc(Object.entries(c.skills).map(([k, x]) => `${k} ${x}`).join(", ")) : ""})`).join(", ")} <span class="faint">— 이 회차에만 있다</span>` : ""}${FM.pregnant ? "<br>사라가 아이를 가졌다" : ""}</div>`);
    const TN = v.trueNames || [];
    h += sec("진명", TN.length ? `<div class="book">${TN.map((w) => `'${esc(w.word)}' — ${esc(w.source)}`).join("<br>")}</div>` : "");
    const DM = v.domain;
    if (DM) h += sec("영역", `<div class="book"><b>${esc(DM.at)}</b> — ${esc(DM.stage)}${DM.lost ? " (잃었다)" : ""}<br>머릿수 ${DM.pop} · 먹을 것 ${DM.foodDays}일치 · 방어 ${DM.defense} · 은폐 ${DM.conceal} · 사기 ${DM.morale}<br>드러남 <span class="${DM.exposure >= DM.threshold - 10 ? "bad" : ""}">${DM.exposure}/${DM.threshold}</span> · 관리자 ${esc(DM.steward)} (충성 ${DM.loyalty}, ${DM.delegation === "full" ? "전권" : "직접 지시"}) · 방침 ${DM.policy === "open" ? "받는다" : "닫는다"}${DM.built.length ? `<br>시설: ${esc(DM.built.join(", "))}` : ""}${DM.building ? `<br>짓는 중: ${esc(DM.building.name)} (${DM.building.days}일 남음)` : ""}</div>`);
    const HD = v.hide;
    if (HD) h += sec("숨긴 곳", `<div class="book">${esc(HD.at)} — ${esc(HD.people.join(", "))}<br>먹을 것: ${HD.food}일치 · ${esc(HD.exposure)}</div>`);
    const OP = v.ops || [];
    h += sec("작전", OP.length ? OP.map((o) => `<div class="pk"><div class="top"><b>${esc(o.target)}</b> <span class="faint">보안 ${o.security}</span>${o.done ? " — 끝났다" : ""}</div><div class="guess">${esc(o.when)}</div><div class="book">${o.ready.map((r) => `${r.ok ? "✓" : "✗"} ${esc(r.label)}`).join("<br>")}</div>${o.missing.length ? `<div class="guess bad">아직 열리지 않는다 — ${esc(o.missing.join("·"))}이(가) 없다</div>` : ""}</div>`).join("") : "");
    const RS = v.rising;
    if (RS) h += sec("여울강이 붉어지는 날", `<div class="book">${RS.free ? "회색여울은 사슬을 끊었다 — 해방구" : RS.failed ? "<span style='color:var(--bad)'>두 번째 붉은 길</span>" : RS.ready.map((r) => `${r.ok ? "✓" : "·"} ${esc(r.label)}`).join("<br>") + `<br><span class="faint">넷이 갖춰지면 밤의 채찍 기둥 광장에서 사람들을 부를 수 있다</span>`}</div>`);
    const SC = v.succession;
    if (SC) h += sec("용좌의 그림자", `<div class="book">${[SC.dead ? "용황이 죽었다 — 계승이 시작되었다" : "용황은 아직 숨을 쉰다", SC.throne ? "카스파르 반비늘이 즉위했다" : `카스파르의 세력: ${SC.kaspar >= 50 ? "즉위할 만하다" : SC.kaspar >= 30 ? "모이고 있다" : "아직 작다"}`, SC.charter ? "인간 자치령 칙허 — 그가 지는 날 휴지가 된다" : ""].filter(Boolean).map(esc).join("<br>")}</div>`);
  }
  body.innerHTML = h || `<div class="sec empty">아직 적힌 것이 없다. 살아남으면 이 장부가 찬다.</div>`;
  body.querySelectorAll(".memo").forEach((m) => (m.onchange = () => post("/api/memo", { npc: m.dataset.npc, text: m.value })));
  bindItems(body);
}
const NARR = [["silent_god", "침묵하는 신 — 세계는 제 무게대로"], ["old_teller", "늙은 이야기꾼 — 쉬어 가며 하마"], ["ash_teller", "재의 화자 — 가장 나쁜 때에 불탄다"], ["dice", "주사위 — 뼈가 던져진 대로"]];
function settingsHTML(v) {
  const segBtns = (key, opts) => `<span class="seg" data-set="${key}">${opts.map(([val, lab]) => `<button type="button" data-v="${val}" aria-pressed="${String(SET[key]) === String(val)}">${lab}</button>`).join("")}</span>`;
  return `<div class="sec"><h4>읽기</h4>
      <div class="set-row"><span>글자 크기</span>${segBtns("size", [["s", "작게"], ["m", "보통"], ["l", "크게"], ["xl", "아주 크게"]])}</div>
      <div class="set-row"><span>바탕</span>${segBtns("theme", [["night", "밤"], ["parchment", "양피지"], ["system", "기기 따라"]])}</div>
      <div class="set-row"><span>지난 글</span>${segBtns("dim", [[true, "흐리게"], [false, "또렷하게"]])}</div>
      <div class="set-row"><span>움직임</span>${segBtns("motion", [[true, "켬"], [false, "줄임"]])}</div>
      <div class="set-row"><span>이름 잇기</span><span class="seg" data-set="links">${[[true, "켬 — 이름을 누르면 카드"], [false, "끔"]].map(([val, lab]) => `<button type="button" data-v="${val}" aria-pressed="${linksOn() === val}">${lab}</button>`).join("")}</span></div></div>
    <div class="sec"><h4>누가 이 이야기를 기억하는가</h4><div class="row"><select id="narr">${NARR.map(([id, lab]) => `<option value="${id}"${v?.narrator?.id === id ? " selected" : ""}>${lab}</option>`).join("")}</select><button class="btn" id="narrBtn">이 화자로</button></div></div>
    <div class="sec"><h4>저장</h4><div class="row"><input id="slotName" placeholder="칸 이름" value="칸1" aria-label="저장 칸 이름"><button class="btn" id="saveBtn">저장</button></div><div class="slots" id="slots"></div></div>
    <div class="sec"><h4>잔향의 장부 — 시대를 건너 남는 것</h4><div id="ledgerBox"><p class="empty">펼치는 중…</p></div></div>
    <div class="sec"><h4>새 판 — 출신·능력치·재능·혈통을 고른다</h4><div class="row"><button class="btn" id="newBtn">새 판 — 그림다크</button><button class="btn text" id="newStoryBtn">새 판 — 이야기 (아침으로 되돌리기 3번)</button></div>
      ${v?.mode === "story" ? `<div class="row" style="margin-top:8px"><button class="btn" id="rewindBtn">마지막 아침으로 되돌린다</button></div>` : ""}</div>
    <div class="sec"><h4>단축키</h4><div class="keys"><span class="kbd">1</span><span>~ <span class="kbd">9</span> 선택지 고르기</span><span class="kbd">/</span><span>직접 쓰기</span><span class="kbd">M</span><span>지도</span><span class="kbd">N</span><span>수첩</span><span class="kbd">B</span><span>백과</span><span class="kbd">Esc</span><span>닫기</span></div></div>
    ${DEBUG ? `<div class="sec"><h4>엔진 기록 (판정·검증)</h4><pre id="debugOut">${esc(JSON.stringify({ debug: last?.debug, usage: last?.usage, provider: last?.provider }, null, 1))}</pre></div>` : ""}`;
}
function bindSettings() {
  document.querySelectorAll("#sheetBody .seg[data-set]").forEach((sg) => sg.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    const key = sg.dataset.set, raw = b.dataset.v, val = raw === "true" ? true : raw === "false" ? false : raw;
    if (key === "links") { setLinks(val); $("story").querySelectorAll(".turn").forEach((t) => relink(t)); sg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); return; }
    SET[key] = val; store.set(key, val); applySettings();
    sg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  })));
  $("narrBtn").onclick = async () => { const r = await post("/api/narrator", { id: $("narr").value }); if (r.view && last) { last.view = r.view; render(last); } };
  $("saveBtn").onclick = async () => { await post("/api/save", { name: $("slotName").value }); loadSaves(); };
  $("newBtn").onclick = () => { closeSheet(); openCreate({ canClose: true, narrator: $("narr").value, mode: "grim" }); };
  $("newStoryBtn").onclick = () => { closeSheet(); openCreate({ canClose: true, narrator: $("narr").value, mode: "story" }); };
  const rw = $("rewindBtn"); if (rw) rw.onclick = async () => { closeSheet(); const d = await call("/api/rewind"); if (d.error) { $("busy").textContent = d.error; return; } resetStory(); show(d); };
  loadSaves(); loadLedger();
}
// 잔향의 장부: 끝난 시대 · 새긴 업적(재능 포인트) · 열린 신재 · 견뎌 낸 이식 — 그리고 정본 해금
async function loadLedger() {
  const el = $("ledgerBox"); if (!el) return;
  let L; try { L = await post("/api/ledger"); } catch { el.innerHTML = `<p class="empty">장부를 못 불렀다</p>`; return; }
  if (!$("ledgerBox")) return;
  const ended = (L.eras || []).filter((e) => e.ended).length, A = L.achievements || [];
  el.innerHTML = `<p class="ledger-line">끝난 시대 <b>${ended}</b> · 새긴 업적 <b>${A.length}</b> · 다음 시대의 재능 포인트 <b>${L.tp}</b></p>
    ${(L.divine || []).length ? `<p class="ledger-line">신재가 열린 재능 — ${esc(L.divine.join(", "))}</p>` : ""}
    ${(L.grafted || []).length ? `<p class="ledger-line">이식해 견딘 피 — ${esc(L.grafted.join(", "))}</p>` : ""}
    ${A.length ? `<div>${A.map((a) => `<div class="lrow"><span>${esc(a.text)}</span><em>${a.tp ? `<span class="tp">+${a.tp}</span>` : ""}</em></div>`).join("")}</div>` : `<p class="empty">아직 새긴 것이 없다 — 업적은 회귀할 때와 시대가 끝날 때 장부로 옮겨진다.</p>`}
    <div class="set-row" style="margin-top:16px"><span>정본 해금</span><span class="seg" id="canonSeg">${[[false, "끔 — 모두 열림"], [true, "켬 — 업적으로 연다"]].map(([val, lab]) => `<button type="button" data-v="${val}" aria-pressed="${!!L.canon === val}">${lab}</button>`).join("")}</span></div>
    <p class="faint-note">켜면 몇몇 출신과 혈통이 장부의 업적이 있어야 열린다 — 다음에 새 판을 만들 때부터.</p>`;
  el.querySelectorAll("#canonSeg button").forEach((b) => (b.onclick = async () => { await post("/api/ledger/canon", { on: b.dataset.v === "true" }); loadLedger(); }));
}
async function loadSaves() {
  const el = $("slots"); if (!el) return;
  try { const r = await post("/api/saves"); el.innerHTML = r.saves.length ? `<span class="faint">불러오기 —</span>${r.saves.map((s) => `<button data-s="${esc(s)}">${esc(s)}</button>`).join("")}` : `<span class="faint">저장한 칸이 없다</span>`; } catch { el.textContent = "저장 목록을 못 불렀다"; return; }
  el.querySelectorAll("button").forEach((b) => (b.onclick = async () => { closeSheet(); resetStory(); show(await call("/api/load", { name: b.dataset.s })); }));
}
function resetStory() { $("story").innerHTML = ""; currentTurn = null; lastPlace = null; }
async function newGame(body) {
  closeSheet(); resetStory();
  const d = await call("/api/new", body);
  if (d?.error) { show(await call("/api/state")); return d; }
  offeredCreate = true; show(d); return d;
}

// ── 지도 ──
let mapTab = "town", pz = null, selNode = null;
async function openMap(tab) {
  closeMenu();
  $("mapview").hidden = false;
  if (tab) mapTab = tab;
  if (!mapData || mapKey !== `${last?.view?.place.id}|${last?.view?.t}`) {
    $("mapStage").innerHTML = `<div class="empty" style="padding:20px">펼치는 중…</div>`;
    try { mapData = await post("/api/map"); mapKey = `${last?.view?.place.id}|${last?.view?.t}`; } catch (e) { $("mapStage").textContent = "지도를 못 불렀다: " + e.message; return; }
  }
  if (!mapData.settlement?.grid && mapTab === "town") mapTab = "world";
  drawMap();
}
function closeMap() { $("mapview").hidden = true; closePop(); }
function drawMap() {
  $("tabTown").setAttribute("aria-pressed", mapTab === "town"); $("tabWorld").setAttribute("aria-pressed", mapTab === "world");
  $("tabTown").disabled = !mapData?.settlement?.grid;
  closePop();
  const m = mapData; if (!m || m.error) { $("mapStage").textContent = m?.error || "—"; return; }
  const built = mapTab === "town" ? townSVG(m.settlement) : worldSVG(m.world);
  $("mapTitle").textContent = mapTab === "town" ? m.settlement.name || "고장" : "대륙 에오르";
  const B = built.base;
  $("mapStage").innerHTML = `<svg viewBox="${B.x} ${B.y} ${B.w} ${B.h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${mapTab === "town" ? "고장 지도" : "대륙 지도"}">${built.svg}</svg>`;
  const svg = $("mapStage").querySelector("svg");
  pz = panZoom(svg, B, { min: 0.8, max: mapTab === "town" ? 4 : 8, onZoom: () => fitToScreen(svg, built) });
  // 처음 보이는 범위: 폰은 내 자리 둘레를 크게, 넓은 화면은 고장 전체 · 대륙은 내 둘레
  const narrow = $("mapStage").clientWidth < 700;
  if (built.here) pz.center(built.here[0], built.here[1], mapTab === "town" ? (narrow ? 1.9 : 1) : (narrow ? 2.6 : 2.2));
  fitToScreen(svg, built);
  window.onresize = () => { if (!$("mapview").hidden) fitToScreen(svg, built); };
  // 누르기: 이름표는 확대할 때마다 다시 그려지므로 위임으로
  svg.addEventListener("click", (e) => {
    const el = e.target.closest(mapTab === "town" ? ".t-bld, .t-exit" : ".m-node");
    if (!el) return closePop();
    e.stopPropagation(); mapTab === "town" ? townPop(el.dataset.loc, el) : worldPop(el.dataset.node, el);
  });
  svg.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest?.(".t-bld, .t-exit, .m-node")) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); } });
  $("legend").innerHTML = legendHTML(mapTab);
  $("legend").querySelector(".x")?.addEventListener("click", () => $("legend").classList.remove("show"));
}
const choiceById = (id) => (last?.choices || []).find((c) => c.id === id);
function placePop(pop, anchor) {
  const st = $("mapStage").getBoundingClientRect(), r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = r.left - st.left + r.width / 2 + 16, y = r.top - st.top - ph / 2;
  if (x + pw > st.width - 12) x = r.left - st.left - pw - 16;
  pop.style.left = Math.max(12, x) + "px"; pop.style.top = Math.max(12, Math.min(st.height - ph - 12, y)) + "px";
}
function closePop() { $("mapPop")?.remove(); const rt = $("mapStage").querySelector(".route-layer"); if (rt) rt.innerHTML = ""; document.querySelectorAll(".m-node.sel").forEach((x) => x.classList.remove("sel")); selNode = null; }
function townPop(id, anchor) {
  closePop();
  const S = mapData.settlement, l = S.locations.find((x) => x.id === id), o = S.outer.find((x) => x.id === id);
  const it = l || o; if (!it) return;
  const goId = `go:${id}`, can = (S.goable || []).includes(id), c = choiceById(goId);
  const ppl = l ? (S.people || []).filter((p) => p.at && (p.at === id)) : [];
  const pop = document.createElement("div"); pop.className = "pop"; pop.id = "mapPop";
  pop.innerHTML = `<button class="close" aria-label="닫기">닫기</button><h4>${esc(it.name)}</h4>
    <div class="sub">${l ? `${esc(KIND_KO[l.kind] || "장소")} · ${esc(ACCESS_KO[l.access] || "")}` : `고장 밖 · 걸어서 ${o.hours}시간`}</div>
    ${ppl.length ? `<div class="ppl">${ppl.map((p) => `<div><span>${esc(p.name)} — ${esc(p.text)}</span><span class="c" title="짐작의 확신">${p.conf >= 0.85 ? "●●●" : p.conf >= 0.65 ? "●●○" : "●○○"}</span></div>`).join("")}<div class="note">짐작이다 — 틀릴 수 있다</div></div>` : l ? `<div class="note">아는 사람이 있을 것 같지 않다</div>` : ""}
    <div class="acts">${(l?.here || o?.here) ? `<div class="sub">지금 여기 있다</div>` : can ? `<button class="act" data-id="${esc(goId)}"><b>${esc(c?.text || "그리로 간다")}</b><span class="h">가기</span>${c?.risk ? `<span class="s risk">${esc(c.risk)}</span>` : ""}</button>` : `<div class="sub">${busy ? "잠깐 — 이야기가 이어지는 중" : "지금은 그리로 갈 수 없다"}</div>`}</div>`;
  $("mapStage").appendChild(pop); placePop(pop, anchor);
  pop.querySelector(".close").onclick = closePop;
  pop.querySelectorAll(".act").forEach((b) => (b.onclick = () => { closeMap(); const cc = choiceById(b.dataset.id); act({ id: b.dataset.id, text: cc?.text || it.name }); }));
  pop.querySelector(".act")?.focus();
}
function worldPop(id, anchor) {
  closePop();
  const W = mapData.world, n = W.nodes.find((x) => x.id === id); if (!n) return;
  anchor.classList.add("sel"); selNode = id;
  const region = (W.regions || []).find((r) => r.id === n.region)?.name;
  const J = (W.journeys || []).find((j) => j.node === id);
  const status = n.here ? "지금 여기" : n.visited ? "가 본 곳" : n.remembered ? "지난 회차에 가 본 곳 — 이번엔 아직" : n.heard ? "들어서 아는 곳" : "아는 곳";
  const risk = (r) => `<span title="길의 위험">${"▮".repeat(Math.round(Math.min(5, r)))}${"▯".repeat(Math.max(0, 5 - Math.round(Math.min(5, r))))}</span>`;
  const days = (h) => (h >= 36 ? `약 ${Math.round(h / 12) / 2}일` : `${Math.round(h)}시간`);
  const act1 = (lab, plan, id2, sub) => `<button class="act" data-id="${esc(id2 || "")}" data-path="${esc((plan?.path || []).join(","))}"${id2 ? "" : " disabled"}><b>${lab}</b><span class="h">${plan ? days(plan.total || plan.hours) : ""}</span><span class="s">${plan ? `걸어서 ${plan.hours}시간${plan.camps ? ` · 노숙 ${plan.camps}밤` : ""} · 위험 ${risk(plan.risk)} · ${plan.path.length - 1}구간${plan.passNeeded ? " · 통행증 없이 검문" : ""}${plan.unknownLegs ? ` · 모르는 길 ${plan.unknownLegs}` : ""}` : ""}${sub ? ` ${sub}` : ""}</span></button>`;
  let acts = "";
  if (J) {
    if (J.travel) acts += act1("곧장 간다", J.fast, J.travel);
    else acts += act1("빠른 길", J.fast, J.fast.id);
    if (J.safe) acts += act1("돌아가는 길 — 덜 위험하다", J.safe, J.safe.id);
  }
  const pop = document.createElement("div"); pop.className = "pop"; pop.id = "mapPop";
  pop.innerHTML = `<button class="close" aria-label="닫기">닫기</button><h4>${esc(n.name)}</h4>
    <div class="sub">${esc(TYPE_KO[n.type] || "")}${region ? ` · ${esc(region)}` : ""} · ${status}</div>
    ${n.desc ? `<div class="desc">${esc(n.desc)}</div>` : ""}
    ${J ? `<div class="acts">${acts}</div>${J.fast.id || J.travel ? "" : `<div class="warn">지금은 떠날 수 없다 — 대화나 장면이 끝난 뒤에</div>`}${W.deserter ? `<div class="warn">${esc(eul(W.home || "매인 고장"))} 떠나면 — 점호에 두 번 빠지면 달아난 자로 쫓긴다</div>` : ""}` : n.here ? "" : `<div class="sub">${n.settlement ? "아직 가는 길을 모른다" : "머물 곳이 없는 땅 — 지나가는 길목이다"}</div>`}`;
  $("mapStage").appendChild(pop); placePop(pop, anchor);
  pop.querySelector(".close").onclick = closePop;
  const showRoute = (path) => { const rt = $("mapStage").querySelector(".route-layer"); if (rt) rt.innerHTML = path ? routePath(W, path.split(",")) : ""; };
  pop.querySelectorAll(".act").forEach((b) => {
    b.addEventListener("mouseenter", () => showRoute(b.dataset.path)); b.addEventListener("focus", () => showRoute(b.dataset.path));
    b.onclick = () => { if (!b.dataset.id) return; closeMap(); const cc = choiceById(b.dataset.id); act({ id: b.dataset.id, text: cc?.text || `${n.name}(으)로 떠난다` }); };
  });
  if (J) showRoute((J.fast.path || []).join(","));
}
function legendHTML(tab) {
  const sw = (svg) => `<svg width="30" height="14" viewBox="0 0 30 14">${svg}</svg>`;
  if (tab === "town") return `<button class="x" aria-label="범례 닫기">닫기</button><div class="lg">
    ${sw(`<rect x="3" y="2" width="24" height="10" fill="#efe4c8" stroke="#3a2d20"/>`)}<span>드나들 수 있는 곳 · 누르면 그리로</span>
    ${sw(`<rect x="3" y="2" width="24" height="10" fill="#ddd0b0" stroke="#3a2d20"/><path d="M22 5h4v4h-4Z" fill="none" stroke="#3a2d20"/>`)}<span>주인·일꾼의 곳 — 함부로 들면 걸린다</span>
    ${sw(`<text x="2" y="11" font-size="10" fill="#2f5868">●●○</text>`)}<span>아는 사람이 '아마 거기' (짐작의 확신)</span>
    ${sw(`<path d="M4 7h18M18 3l6 4-6 4" fill="none" stroke="#3a2d20" stroke-width="1.6"/>`)}<span>고장 밖으로 — 걸리는 시간</span></div>`;
  return `<button class="x" aria-label="범례 닫기">닫기</button><div class="lg">
    ${sw(`<path d="M2 7h26" stroke="#8d3223" stroke-width="2.6"/><path d="M2 7h26" stroke="#e3d2a9" stroke-width=".8" stroke-dasharray="4 3"/>`)}<span>제국 가도</span>
    ${sw(`<path d="M2 7h26" stroke="#7a5634" stroke-width="1.5"/>`)}<span>큰길</span>
    ${sw(`<path d="M2 7h26" stroke="#7a5634" stroke-width="1.1" stroke-dasharray="3 2.4"/>`)}<span>오솔길</span>
    ${sw(`<path d="M2 7h26" stroke="#3b5d6c" stroke-width="1.2" stroke-dasharray="6 4"/>`)}<span>뱃길 · <span style="color:#a0281c">✕</span> 위험한 길목</span>
    ${sw(`<circle cx="15" cy="7" r="6" fill="#d8c9a8"/>`)}<span>안개 — 아직 모르는 땅</span>
    ${sw(`<path d="M2 7h26" stroke="#a0281c" stroke-width="2" stroke-dasharray="6 4"/>`)}<span>고른 길 (먼 길 계획)</span></div>`;
}

// ── 진동 (14 §4.2) ──
const HAPTIC = { H1: [450], H1water: [180, 120, 140, 160, 100], H1teeth: [90, 60, 90], H1blade: [260], H1rope: [450], H2: [25], H3: [60, 140, 80], H4: [70], H5: [40] };
function buzz(p) { try { if (p && navigator.vibrate) navigator.vibrate(p); } catch { /* 기기가 못 하면 아무 일 없다 */ } }
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const tapOr = (veil, ms) => new Promise((r) => { const done = () => { veil.onclick = null; clearTimeout(t); r(); }; const t = ms ? setTimeout(done, ms) : null; veil.onclick = done; });
// 죽음 → 재 → 회차 기록 → 시간이 접힌다 → 정적 → (시대의 첫 죽음에만) 말 → 빵 냄새. '사망'·'회귀'라는 말은 쓰지 않는다
async function deathSequence(E) {
  if (deathRunning) return; deathRunning = true;
  closeMap(); closeSheet(); closeMenu();
  const veil = $("veil");
  buzz(HAPTIC["H1" + (E.trace?.id || "")] || HAPTIC.H1);
  document.body.classList.add("ashing");
  await nap(2500);
  veil.innerHTML = ""; veil.hidden = false;
  const rec = document.createElement("div"); rec.className = "rec";
  const lines = E.loop === 1 ? E.record.short : E.record.full;
  rec.innerHTML = lines.map((x) => `<p>${esc(x)}</p>`).join(""); veil.appendChild(rec);
  if (E.loop === 1) await tapOr(veil, 4500);
  else {
    await nap(2000);
    // 회귀를 놓는다 (03 §4.6): 두 번 눌러야 한다 — 다음 회차의 죽음은 돌아오지 않는다
    if (E.canRelease) {
      const b = document.createElement("button"); b.className = "btn"; b.textContent = "회귀를 놓는다";
      b.onclick = async (ev) => { ev.stopPropagation(); if (b.dataset.armed) { await fetch("/api/release", { method: "POST" }); b.textContent = "놓았다. 다음 저녁이 마지막이다."; b.disabled = true; } else { b.dataset.armed = "1"; b.textContent = "정말로? 다음 죽음은 돌아오지 않는다 — 한 번 더 누르면"; } };
      rec.appendChild(b);
    }
    const h = document.createElement("div"); h.className = "hint"; h.textContent = "닫는다"; veil.appendChild(h); await tapOr(veil); h.remove();
  }
  const next = fetch("/api/regress", { method: "POST" }).then((r) => r.json()).catch((e) => ({ broken: "서버에 닿지 않는다 — " + e.message }));
  rec.classList.add("ash"); await nap(650); rec.remove();
  // 삽화 (19 §9): 접힘 뒤에 '시간의 접힘' 목판화가 희미하게, 빵 냄새에는 배급 줄
  const plate = (name) => { const im = document.createElement("img"); im.className = "plate"; im.alt = ""; im.onerror = () => im.remove(); im.src = `/art/${name}.svg`; veil.appendChild(im); requestAnimationFrame(() => im.classList.add("on")); return im; };
  const foldArt = plate("03_time_fold");
  const fold = document.createElement("div"); fold.className = "fold"; veil.appendChild(fold);
  let gap = E.loop === 1 ? 220 : 120;
  // 진짜 죽음: 접힘이 시작했다가 멈춘다. 날짜가 두세 줄 오르다 재가 된다. 빵 냄새는 오지 않는다
  if (E.final) {
    for (const dt of E.record.rewind.slice(0, 3)) { const x = document.createElement("div"); x.textContent = dt; fold.appendChild(x); buzz(HAPTIC.H2); await nap(260); }
    await nap(700); fold.classList.add("ash"); foldArt.classList.remove("on"); await nap(900); fold.remove(); foldArt.remove(); await nap(1500);
    const d = await next;
    const ep = document.createElement("div"); ep.className = "rec"; ep.innerHTML = (d.epilogue || E.epilogue || []).map((x) => `<p>${esc(x)}</p>`).join("") + `<p style="margin-top:22px;color:#5e574c">시대가 끝났다.</p>`;
    const nb = document.createElement("button"); nb.className = "btn"; nb.textContent = "새 시대 — 새 판"; nb.onclick = () => { veil.hidden = true; document.body.classList.remove("ashing"); deathRunning = false; openCreate({ canClose: false, reason: "새 시대 — 잔향이 고를 사람" }); };
    veil.appendChild(ep); veil.appendChild(nb); veil.onclick = null;
    return;
  }
  for (const dt of E.record.rewind) { const x = document.createElement("div"); x.textContent = dt; fold.appendChild(x); while (fold.children.length > 9) fold.firstChild.remove(); buzz(HAPTIC.H2); await nap(gap); gap = Math.max(40, gap * 0.86); }
  await nap(500); fold.classList.add("ash"); foldArt.classList.remove("on"); await nap(400); fold.remove(); setTimeout(() => foldArt.remove(), 1700);
  await nap(1500);   // 정적 — 그림도 소리도 없다
  let god = null;
  if (E.firstDeath) { god = document.createElement("div"); god.className = "god"; god.textContent = "너희는 끝나지 않을 것이다."; veil.appendChild(god); await nap(2500); }
  const n = E.loop + 1;
  const sm = document.createElement("div"); sm.className = "smell";
  const sense = last?.view?.origin?.sense || "빵 냄새";   // 갈래의 회귀점 냄새 (농노: 배급 줄의 빵, 하인: 남작의 식탁 …)
  sm.innerHTML = `<p>${n >= 12 ? `젖은 재. 그 위에, ${sense}.` : n >= 4 ? `${sense}. 그 밑에, 젖은 재.` : `${sense}.`}</p>`; veil.appendChild(sm); buzz(HAPTIC.H3); const pl = last?.view?.origin?.plate ?? ((last?.view?.origin?.id || "serf") === "serf" ? "01_ration_line" : null); if (pl) plate(pl);
  await nap(800); sm.insertAdjacentHTML("beforeend", `<p class="inner">나는 — 이 냄새를 안다.</p>`);
  if (god) setTimeout(() => god.remove(), 1000);
  const d = await next; await tapOr(veil);
  veil.hidden = true; document.body.classList.remove("ashing"); deathRunning = false;
  resetStory(); show(d);
}

// ── 단추와 단축키 ──
initCodex({ post, esc, store, local: itemEntry, onAction: (a) => { closeSheet(); act({ id: a.id, text: a.text }); } });
initCreate({ post, esc, start: (body) => newGame(body) });
document.body.classList.toggle("no-links", !linksOn());
$("mapBtn").onclick = () => openMap();
$("bookBtn").onclick = () => openSheet();
$("setBtn").onclick = () => openSheet("settings");
$("closeSheet").onclick = closeSheet;
$("sheet").onclick = (e) => { if (e.target.id === "sheet") closeSheet(); };
document.querySelectorAll("#sheet .tab").forEach((t) => (t.onclick = () => { sheetTab = t.dataset.tab; renderSheet(last?.view); }));
$("closeMap").onclick = closeMap;
$("tabTown").onclick = () => { mapTab = "town"; drawMap(); };
$("tabWorld").onclick = () => { mapTab = "world"; drawMap(); };
$("zIn").onclick = () => pz?.zoomBy(1.4);
$("zOut").onclick = () => pz?.zoomBy(1 / 1.4);
$("zMe").onclick = () => { const svg = $("mapStage").querySelector("svg"); const b = svg?.querySelector(".pawn-layer .pawn-mark")?.getAttribute("transform"); const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(b || ""); if (m) pz?.center(+m[1], +m[2], Math.max(pz.zoom, mapTab === "town" ? 1.6 : 3)); };
$("zLegend").onclick = () => $("legend").classList.toggle("show");
$("miniMap").onclick = () => openMap("town");
document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
  if (createOpen()) { if (e.key === "Escape") closeCreate(); return; }   // 생성 화면이 열려 있으면 단축키는 쉰다
  if (e.key === "Escape") { if ($("menuPop")) return closeMenu(); if (cardOpen()) return closeCard(); if ($("mapPop")) return closePop(); if (!$("mapview").hidden) return closeMap(); if (!$("sheet").hidden) return closeSheet(); if (typing) document.activeElement.blur(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || deathRunning) return;
  if (e.key === "m" || e.key === "M" || e.key === "ㅡ") { e.preventDefault(); $("mapview").hidden ? openMap() : closeMap(); return; }
  if (e.key === "n" || e.key === "N" || e.key === "ㅜ") { e.preventDefault(); $("sheet").hidden ? openSheet() : closeSheet(); return; }
  if (e.key === "b" || e.key === "B" || e.key === "ㅠ") { e.preventDefault(); $("sheet").hidden || sheetTab !== "codex" ? openSheet("codex") : closeSheet(); return; }
  if (!$("mapview").hidden || !$("sheet").hidden || cardOpen()) return;
  if (e.key === "/") { const f = $("freeText"); if (f) { e.preventDefault(); f.focus(); } return; }
  if (/^[1-9]$/.test(e.key)) { const b = $("dock").querySelector(`.choice[data-key="${e.key}"]`); if (b && !b.disabled) { e.preventDefault(); b.click(); } }
});
start();
