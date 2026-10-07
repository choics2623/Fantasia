// 회색여울 — 화면 (19 표현). 이야기 칸 · 장면 곁칸 · 선택지 · 수첩 · 지도.
// 서버(server.mjs)의 /api/*를 부른다. 서술은 SSE로 흘러 들어온다.
import { worldSVG, townSVG, routePath, panZoom, fitToScreen, TYPE_KO } from "./map.js";
import { pawnIconHTML } from "./piece.js";

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
let busy = false, last = null, currentTurn = null, lastPlace = null, fresh = false, deathRunning = false;
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

// ── 이야기: 한 턴 = 한 덩어리 (내가 고른 것 + 판정 → 서술). 지난 턴은 흐려진다 ──
function newTurn() {
  for (const t of $("story").querySelectorAll(".turn:not(.past)")) t.classList.add("past");
  const t = document.createElement("section"); t.className = "turn"; $("story").appendChild(t);
  while ($("story").children.length > 40) $("story").removeChild($("story").firstChild);
  return (currentTurn = t);
}
const TIER_CLS = { "대성공": "good", "성공": "good", "실패": "bad", "대실패": "bad" };
function addBeats(d) {
  const t = currentTurn || newTurn();
  const pl = t.querySelector(".player");
  if (pl && d.result && d.result.skill) { const tg = document.createElement("span"); tg.className = `tier ${TIER_CLS[d.result.tier] || ""}`; tg.textContent = `${d.result.skill} — ${d.result.tier}`; pl.appendChild(tg); }
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
    if (k.kind === "voice") { p.className = "voice"; p.innerHTML = `<span class="who">⟨${esc(k.who)}⟩</span>${esc(k.text)}`; t.appendChild(p); continue; }
    if (k.kind === "dayend") { p.className = "dayend"; p.innerHTML = `${esc(k.text)}${k.card ? `<span class="card2">${esc(k.card)}</span>` : ""}`; t.appendChild(p); continue; }
    if (k.kind === "echo" || k.kind === "recap") { p.className = k.kind; p.textContent = k.text; if (k.kind === "recap") t.insertBefore(p, t.firstChild); else t.appendChild(p); continue; }
    p.className = k.kind === "grow" ? "grow" : "ink" + (k.kind === "drift" ? " drift" : ""); p.textContent = k.text; t.appendChild(p); if (k.buzz) buzz(HAPTIC[k.buzz]);
  }
  // 죽음: 마지막 문장이 문장 중간에서 끊긴다 (14 §4.1 ①)
  if (d.view?.ended?.kind === "dead" && d.beats?.length) { const ps = t.querySelectorAll("p:not(.player)"); const lp = ps[ps.length - 1]; if (lp) { const w = lp.textContent; const cut = w.lastIndexOf(" ", Math.floor(w.length * 0.6)); lp.textContent = w.slice(0, cut > 10 ? cut : Math.floor(w.length * 0.6)).replace(/[.,!?…"']+$/, ""); } }
  currentTurn = null;
}
function say(text) { const t = newTurn(); const p = document.createElement("p"); p.className = "player"; const sp = document.createElement("span"); sp.textContent = text; p.appendChild(sp); t.appendChild(p); }

// ── 작은 그림 조각들 ──
const BAND_N = { "식은 죽 먹기": 5, "확실해 보인다": 4, "해볼 만하다": 3, "반반이다": 2, "운이 따라야 한다": 1, "무모하다": 0 };
const bandHTML = (b) => { if (!b) return ""; const n = BAND_N[b] ?? 2; return `<span class="band" data-b="${n}"><span class="pips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>${esc(b)}</span>`; };
const moodCls = (m) => (/열었|나쁘지 않/.test(m) ? "open" : /화가/.test(m) ? "angry" : /겁/.test(m) ? "afraid" : /믿지 않/.test(m) ? "cold" : "");
const initial = (name) => (String(name || "?").replace(/^[^가-힣A-Za-z]+/, "")[0] || "?");
const PHASE = (h, night) => (night ? "밤" : h < 6 ? "새벽" : h < 11 ? "아침" : h < 14 ? "한낮" : h < 18 ? "오후" : "저녁");
const KIND_KO = { keep: "성채", work: "일터", barracks: "막사", home: "집", square: "광장", office: "관청", canteen: "배급소", chapel: "예배당", store: "곳간", lodging: "헛간 숙소", graveyard: "묘지", checkpoint: "검문소", kennel: "개 우리", outdoor: "물가·들" };
const ACCESS_KO = { public: "누구나 드나든다", serf: "농노의 자리", staff: "일꾼만 드나든다", owner: "주인의 자리 — 허락 없이는", locked: "잠겨 있다", secret: "숨은 곳" };
const ABOUT = { suspect: "너를 의심한다", saw_item: "네가 지닌 것을 보았다", trespass: "네가 들어가는 것을 보았다", claim: "네 말을 믿는다", kill: "네가 한 일을 안다", assault: "네가 한 일을 안다", echo_sign: "네가 이상하다고 생각한다" };
function meter(label, val, max, { seg = false, warn = 0.5, crit = 0.75, show } = {}) {
  const f = Math.max(0, Math.min(1, val / max)), cls = f >= crit ? "crit" : f >= warn ? "warn" : "";
  const bar = seg ? `<span class="bar seg">${Array.from({ length: max }, (_, i) => `<i class="${i < val ? "on" : ""}"></i>`).join("")}</span>` : `<span class="bar"><i style="width:${Math.round(f * 100)}%"></i></span>`;
  return `<span class="meter ${cls}" title="${esc(label)} ${val}/${max}"><span class="lab">${esc(label)}<b>${esc(show ?? val)}</b></span>${bar}</span>`;
}

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
  const p = v.player, U = new Set(v.unlocked || []), h = Number(v.hm.slice(0, 2));
  $("clockD").textContent = `${v.month} ${v.time.split(" ")[3]}${v.rain ? " · 비" : ""}`;
  $("clockT").innerHTML = `${esc(v.hm)}<span class="ph">${PHASE(h, v.night)}</span>`;
  // 이름이 길면 별명('절름발이 수탉')은 아랫줄로
  const nm = /^(.*?)\s*'(.+)'$/.exec(v.place.name);
  $("placeN").textContent = nm ? nm[1] : v.place.name;
  $("placeS").textContent = [nm ? `'${nm[2]}'` : null, v.place.settlement, KIND_KO[v.place.kind]].filter(Boolean).join(" · ");
  $("vitals").innerHTML = [
    meter("배고픔", p.hunger, 4, { seg: true, warn: 0.5, crit: 0.75 }),
    meter("아픔", p.pain, 100, { warn: 0.3, crit: 0.6 }),
    meter("지침", p.fatigue || 0, 100, { warn: 0.6, crit: 0.85 }),
    `<span class="coin" title="가진 돈">${p.coin}못</span>`,
  ].join("");
  $("status").innerHTML = [
    U.has("loop") ? `<span class="chip gold">${v.loop}회차</span>` : "",
    p.fear >= 2 ? `<span class="chip hot">떨림</span>` : "",
    v.fight ? `<span class="chip hot">싸움 — ${esc(v.fight.name)} · ${v.fight.round}합</span>` : "",
    v.convo ? `<span class="chip">대화 — ${esc(v.convo.name)}</span>` : "",
    p.wantedWord ? `<span class="chip hot">수배 — ${esc(p.wantedWord)}</span>` : "",
    v.ladder ? `<span class="chip hot">${esc(v.ladder.name)}</span>` : "",
    v.echo ? `<span class="chip hot">앎의 흔적 — ${esc(v.echo)}</span>` : "",
    v.mode === "story" ? `<span class="chip">이야기 모드</span>` : "",
  ].filter(Boolean).join("");
  // 폰: 장면 띠
  $("strip").innerHTML = v.people.map((x) => `<button class="pchip" data-npc="${esc(x.id)}"><span class="av ${moodCls(x.mood)}${x.asleep ? " asleep" : ""}">${esc(initial(x.name))}</span>${esc(x.name)}</button>`).join("")
    + (v.goals || []).map((g) => `<span class="gchip"><b>${esc(g.who)}</b> ${esc(g.what)}${g.days != null ? `<span class="dd">D-${g.days}</span>` : ""}</span>`).join("");
  $("strip").querySelectorAll(".pchip").forEach((b) => (b.onclick = () => personMenu(b.dataset.npc, b)));
}

function renderAside(v, d) {
  // 이 자리
  const ppl = v.people.map((x) => {
    const ab = [...new Set((x.aboutPlayer || []).map((b) => ABOUT[b.kind]).filter(Boolean))];
    return `<button class="person" data-npc="${esc(x.id)}" aria-label="${esc(x.name)}에게 할 수 있는 일"><span class="av ${moodCls(x.mood)}${x.asleep ? " asleep" : ""}">${esc(initial(x.name))}</span>
      <span class="pname">${esc(x.name)}${x.who && x.who !== x.name ? `<span class="who">${esc(x.who)}</span>` : ""}</span>
      <span class="pdo">${esc(x.doing || "")}${x.asleep ? " (잠)" : ""} <span class="mood">· ${esc(x.mood)}</span>${ab.length ? `<span class="pwarn">${esc(ab.join(", "))}</span>` : ""}</span></button>`;
  }).join("");
  $("asideScene").innerHTML = `<h3><span>이 자리 — ${esc(v.place.name)}</span></h3>${ppl || `<div class="empty">아무도 없다.</div>`}${v.bodies.length ? `<div class="bodies">시체 — ${esc(v.bodies.join(", "))}</div>` : ""}`;
  $("asideScene").querySelectorAll(".person").forEach((b) => (b.onclick = () => personMenu(b.dataset.npc, b)));
  // 지킬 것 · 약속
  const goals = (v.goals || []).map((g) => `<div class="goal"><span class="w"><b>${esc(g.who)}</b><span>${esc(g.what)}</span></span>${g.days != null ? `<span class="dday${g.days <= 7 ? " soon" : ""}">D-${g.days}</span>` : ""}</div>`);
  const proms = (v.promises || []).map((p) => `<div class="goal"><span class="w"><b>${esc(p.who)}와의 약속</b><span>${esc(p.where)} · ${esc(p.what)}</span></span><span class="dday${p.soon ? " soon" : ""}">${esc(p.when.split(" ").pop())}</span></div>`);
  $("asideGoals").hidden = !goals.length && !proms.length;
  $("asideGoals").innerHTML = `<h3><span>지켜야 할 것</span></h3>${goals.join("")}${proms.join("")}`;
  // 몸
  const p = v.player, seen = p.items.filter((i) => i.seen);
  $("asideBody").innerHTML = `<h3><span>몸</span><button class="more" data-tab="body">수첩 ›</button></h3>
    <div class="kv"><span>배고픔</span><b>${["배부르다", "괜찮다", "출출하다", "배고프다", "굶주렸다"][p.hunger] || p.hunger}</b><span>아픔</span><b>${p.pain >= 75 ? "몸을 가누기 힘들다" : p.pain >= 50 ? "욱신거린다" : p.pain >= 25 ? "쑤신다" : "견딜 만하다"}</b>${(v.traits || []).length ? `<span>기질</span><b>${esc(v.traits.join(", "))}</b>` : ""}</div>
    <div class="tags">${seen.map((i) => `<span class="tag seen" title="남들 눈에 보인다">${esc(i.name)}</span>`).join("")}${p.items.filter((i) => !i.seen).slice(0, 4).map((i) => `<span class="tag">${esc(i.name)}</span>`).join("")}${p.bloody ? `<span class="tag bad">옷에 핏자국</span>` : ""}</div>`;
  $("asideBody").querySelector(".more").onclick = () => openSheet("body");
  // 쫓는 자
  const hu = (v.hunters || []).filter((h) => h.now && h.track >= 1);
  $("asideHunt").hidden = !hu.length;
  $("asideHunt").innerHTML = `<h3><span>뒤를 밟는 자</span></h3>${hu.map((h) => `<div class="goal"><span class="w"><b>${esc(h.name)}</b><span>${esc(h.disposition)}</span></span><span class="dday soon">${"●".repeat(h.track)}${"○".repeat(Math.max(0, 4 - h.track))}</span></div>`).join("")}`;
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
  m.innerHTML = `<div class="mh">${esc(p?.name || "")}${p?.who ? ` — ${esc(p.who)}` : ""}</div>${ch.length ? ch.map((c) => `<button role="menuitem" data-id="${esc(c.id)}">${esc(c.text)}</button>`).join("") : `<div class="mh">지금은 할 수 있는 게 없다</div>`}`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(12, Math.min(innerWidth - mw - 12, r.left)) + "px";
  m.style.top = (r.bottom + mh + 8 < innerHeight ? r.bottom + 6 : Math.max(12, r.top - mh - 6)) + "px";
  m.querySelectorAll("button").forEach((b) => (b.onclick = () => { closeMenu(); const c = ch.find((x) => x.id === b.dataset.id); act({ id: c.id, text: c.text }); }));
  m.querySelector("button")?.focus();
  setTimeout(() => document.addEventListener("pointerdown", outside, { once: true }), 0);
  function outside(e) { if (!m.contains(e.target)) closeMenu(); else document.addEventListener("pointerdown", outside, { once: true }); }
}
function closeMenu() { $("menuPop")?.remove(); }

// ── 선택지 ──
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
      <div class="sib"><span>키트에게 너는</span><label><input type="radio" name="sib" value="형" checked> 형</label><label><input type="radio" name="sib" value="누나"> 누나</label></div>
      <button class="btn primary">그 이름으로 대답한다</button></form>`;
    $("nameForm").onsubmit = (e) => { e.preventDefault(); const n = $("tn").value.trim(); if (!n) return; const sib = panel.querySelector("input[name=sib]:checked").value; act({ id: nameC.id, text: `${n}|${sib}` }, false, `"${n}." — 어머니가 부르는 이름에 대답한다`); };
    setTimeout(() => $("tn")?.focus(), 50);
    return;
  }
  const NAMED = ["npc_name", "child_name", "house"];
  const nameNpc = ch.filter((c) => NAMED.includes(c.input));
  const journeys = ch.filter((c) => c.kind === "journey");
  const more = ch.filter((c) => c.more && c.kind !== "journey" && !NAMED.includes(c.input));
  const main = ch.filter((c) => !c.more && c.kind !== "move" && c.kind !== "time" && c.kind !== "journey" && !NAMED.includes(c.input));
  const moves = ch.filter((c) => !c.more && c.kind === "move"), time = ch.filter((c) => !c.more && c.kind === "time");
  const cls = { "▲": "up", "▼": "down", "?": "unk" };
  const kindOf = (c) => (c.id.startsWith("attack:") || c.id.startsWith("fight_") ? "fight" : c.kind === "talk" || c.id.startsWith("talk:") ? "talk" : "");
  let n = 0;
  const btn = (c, numbered = true) => {
    const k = numbered && n < 9 ? ++n : null;
    const meta = [c.skill ? esc(c.skill) : "", bandHTML(c.band), DEBUG && c.p != null ? `(${c.p}%)` : "", c.risk ? `<span class="risk">${esc(c.risk)}</span>` : ""].filter(Boolean).join(" ");
    const b = `<button class="choice" data-id="${esc(c.id)}"${k ? ` data-key="${k}"` : ""}>${numbered ? `<span class="num k-${kindOf(c)}">${k || "·"}</span>` : ""}<span class="ct">${c.memory ? `<span class="mem" title="지난 회차의 기억">◈</span>` : ""}${esc(c.text)}</span>${meta ? `<span class="meta">${meta}</span>` : ""}</button>`;
    if (!c.why?.length) return b;
    return `<div class="crow">${b}<button class="q" aria-expanded="false" aria-label="판정 근거" data-q="${esc(c.id)}">?</button><div class="why" hidden>${c.why.map((w) => `<div class="${cls[w.sign] || ""}">${esc(w.sign)} ${esc(w.text)}</div>`).join("")}<div>→ "${esc(c.band)}"</div></div></div>`;
  };
  const mainHTML = main.map((c) => btn(c)).join("");
  panel.innerHTML = `${main.length ? `<div class="dock-h"><span>무엇을 할까</span><span class="hint">숫자 키로 고른다</span></div><div class="choices">${mainHTML}</div>` : ""}
    ${time.length ? `<div class="dock-h" style="margin-top:14px"><span>시간을 보낸다</span></div><div class="timerow">${time.map((c) => `<button class="tbtn choice-lite" data-id="${esc(c.id)}">${esc(c.text)}</button>`).join("")}</div>` : ""}
    ${nameNpc.map((c) => c.input === "house" ? `<form class="free nameNpc house" data-id="${esc(c.id)}"><input placeholder="가문 이름" maxlength="10" autocomplete="off"><input placeholder="가훈 한 문장" maxlength="40" autocomplete="off"><button class="btn">세운다</button></form>` : `<form class="free nameNpc" data-id="${esc(c.id)}"><input placeholder="${esc(c.text)}" maxlength="10" autocomplete="off"><button class="btn">이름</button></form>`).join("")}
    ${more.length ? `<details class="fold"><summary><span>이곳에서 더</span><span class="c">${more.length}</span></summary><div class="choices">${more.map((c) => btn(c, false)).join("")}</div></details>` : ""}
    ${moves.length || journeys.length ? `<details class="fold"${moves.length <= 3 ? " open" : ""}><summary><span>다른 곳으로</span><span class="c">${moves.length}${journeys.length ? ` · 먼 길 ${journeys.length}` : ""}</span></summary><div class="choices">${moves.map((c) => btn(c, false)).join("")}${journeys.length ? `<button class="choice" id="toWorld"><span class="ct">먼 길은 지도에서 고른다 — 빠른 길과 돌아가는 길</span><span class="meta">대륙 지도 열기 · M</span></button>` : ""}</div></details>` : ""}
    ${(d.locked || []).length ? `<details class="fold"><summary><span>아직 할 수 없는 것</span><span class="c">${d.locked.length}</span></summary><div class="locked-list">${d.locked.map((l) => `<div><b>${esc(l.label)}</b> — ${esc(l.why)}</div>`).join("")}</div></details>` : ""}
    ${v?.convo || main.length ? `<form class="free" id="free"><input id="freeText" placeholder="직접 말하거나 행동한다  ( / )" autocomplete="off" aria-label="직접 말하거나 행동한다"><button class="btn primary">하기</button></form>` : ""}`;
  const byId = new Map(ch.map((c) => [c.id, c]));
  panel.querySelectorAll(".choice[data-id], .choice-lite").forEach((b) => (b.onclick = () => { const c = byId.get(b.dataset.id); act({ id: c.id, text: c.text }); }));
  panel.querySelectorAll(".q").forEach((q) => (q.onclick = () => { const w = q.nextElementSibling; w.hidden = !w.hidden; q.setAttribute("aria-expanded", !w.hidden); }));
  panel.querySelectorAll(".nameNpc").forEach((fm) => (fm.onsubmit = (e) => { e.preventDefault(); const ins = fm.querySelectorAll("input"); const val = ins[0].value.trim(); if (!val) return; const text = fm.classList.contains("house") ? `${val}|${ins[1].value.trim()}` : val; act({ id: fm.dataset.id, text }, false, `"${val}."`); }));
  const f = $("free"); if (f) f.onsubmit = (e) => { e.preventDefault(); const t = $("freeText").value.trim(); if (t) act({ free: t }); };
  const tw = $("toWorld"); if (tw) tw.onclick = () => openMap("world");
}

function show(d, isFresh = false) {
  last = d; fresh = isFresh;
  if (!d.broken) addBeats(d); else currentTurn = null;
  render(d);
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
  if (!v) { body.innerHTML = `<div class="sec empty">아직 아무것도 없다.</div>`; return; }
  const U = new Set(v.unlocked || []);
  const sec = (title, html, show = true) => (show && html ? `<div class="sec"><h4>${title}</h4>${html}</div>` : "");
  let h = "";
  if (sheetTab === "memory") {
    h += sec(v.echoNamed ? "잔향 — 회귀해도 남는다" : "기억 — 회귀해도 남는다", `<ul>${v.trueName ? `<li style="color:var(--gold)">네 이름 — ${esc(v.trueName)}. 어머니만 부른다</li>` : ""}${v.lastHook ? `<li class="past">마지막 줄 — ${esc(v.lastHook)}</li>` : ""}${v.notebook.map((x) => `<li class="${x.startsWith("◇") ? "past" : ""}">${esc(x)}</li>`).join("") || "<li class='faint'>아직 없다</li>"}</ul>`, U.has("notebook"));
    const OA = [...(v.oaths || []).map((o) => `<li>"${esc(o.line)}" — ${o.state === "held" ? "품고 있다" : o.state === "kept" ? "지켜졌다" : "깨졌다"}${o.witnesses.length ? ` <span class="faint">(증인: ${esc(o.witnesses.join(", "))})</span>` : ""}</li>`), ...(v.pastOaths || []).map((l) => `<li class="past">┊ "${esc(l)}" — 증인은 잊었다. 너는 기억한다</li>`)];
    h += sec("맹세", OA.length ? `<ul>${OA.join("")}</ul>` : "");
    const T2 = v.twoDays;
    if (T2?.then) h += sec("두 겹의 날", `<div class="book">${(T2.marks || []).map((m) => `<div>${esc(m)}</div>`).join("")}<div class="faint">┊ 지난 회차의 이 날 (${esc(T2.then.date)}) — ${esc(T2.then.at)}${T2.then.notes.map((x) => `<br>┊ ${esc(x)}`).join("")}</div>${T2.now ? `<div style="margin-top:6px">이번 — ${esc(T2.now.at)}${T2.now.notes.map((x) => `<br>· ${esc(x)}`).join("")}</div>` : `<div style="margin-top:6px">이번 — 아직 하루가 끝나지 않았다</div>`}</div>`);
    const TL = v.talents || [], AC = v.achievements || [];
    h += sec("재능과 새긴 것", TL.length || AC.length ? `<div class="book">${TL.map((t) => `<b>${esc(t.name)}</b> <span class="faint">— ${esc(t.grows.join("·"))}이(가) 빨리 는다</span>`).join("<br>")}${AC.length ? `<div class="faint" style="margin-top:6px">잔향에 새긴 것 — ${esc(AC.join(" · "))}</div>` : ""}</div>` : "");
    const WL = v.memoryWall || [];
    h += sec("기억의 벽", WL.length ? `<div class="book">${WL.map((w) => `<div class="past">┊ ${esc(w)}</div>`).join("")}${v.soulYears ? `<div class="faint" style="margin-top:6px">영혼의 햇수 — ${v.soulYears}년</div>` : ""}</div>` : "");
  }
  if (sheetTab === "people") {
    h += sec("약속", (v.promises || []).length ? `<ul>${v.promises.map((p) => `<li><b>${esc(p.who)}</b> — ${esc(p.when)} ${esc(p.where)}: ${esc(p.what)}</li>`).join("")}</ul>` : "");
    h += sec("아는 사람들 — 지금 어디쯤", (v.people_known || []).map((x) => `<div class="pk"><div class="top"><b>${esc(x.name)}</b>${x.knots ? ` <span style="color:var(--gold)" title="매듭">${"⟡".repeat(x.knots)}</span>` : ""}${x.heldKnots && !x.thisLoop ? ` <span class="faint" title="지난 회차의 매듭">${"◇".repeat(x.heldKnots)}</span>` : ""}${x.who ? ` <span class="faint">${esc(x.who)}</span>` : ""}</div>
      <div class="guess">${esc(x.guess || "모른다")}${x.lastSeen ? ` · 마지막으로 본 곳: ${esc(x.lastSeen)}` : ""} · ${esc(x.mood)}${x.id === "npc_sara" && v.romance?.words?.npc_sara && v.romance.npc_sara > 0 ? ` · <span style="color:var(--gold)">${esc(v.romance.words.npc_sara)}</span>` : ""}</div>
      ${(x.facts || []).length ? `<div class="book">${x.facts.map((f) => `<div>${esc(f.sure)} ${esc(f.text)}</div>`).join("")}</div>` : ""}${(x.links || []).length ? `<div class="book lk">${x.links.map((l) => `— ${esc(l.other)}: ${esc(l.text)}`).join("<br>")}</div>` : ""}
      ${(x.past || []).map((l) => `<div class="book past">┊ ${esc(l)}</div>`).join("")}<input class="memo" data-npc="${esc(x.id)}" placeholder="메모 — 회귀해도 남는다" value="${esc(x.memo || "")}"></div>`).join("") || `<div class="empty">아직 말을 섞은 사람이 없다</div>`, U.has("people"));
    const HU = v.hunters || [];
    h += sec("사냥꾼 판", HU.length ? HU.map((x) => `<div class="pk"><div class="top"><b>${esc(x.name)}</b> <span class="faint">${esc(x.disposition)}</span>${x.past ? ` <span class="faint">${esc(x.past)}</span>` : ""}${x.now && x.track ? ` <span style="color:var(--bad)">${"●".repeat(x.track)}${"○".repeat(Math.max(0, 4 - x.track))}</span>` : ""}</div>${(x.lessons || []).map((l) => `<div class="guess">교훈 — ${esc(l)}</div>`).join("")}</div>`).join("") : "");
  }
  if (sheetTab === "body") {
    h += sec("몸과 손", `<ul>${(v.traits || []).length ? `<li style="color:var(--gold)">기질 — ${esc(v.traits.join(", "))}</li>` : ""}${(v.skills || []).map((k) => `<li>${esc(k.name)} — ${esc(k.word)}${k.lagging ? ` <span class="faint">(손은 기억하는데 몸이 아직)</span>` : ""}</li>`).join("")}</ul>`);
    const p = v.player;
    h += sec("소지품 — 몸의 어디에", `<ul>${p.items.map((i) => `<li>${esc(i.name)} <span class="faint">— ${esc(i.slot)}${i.seen ? " (남들 눈에 보인다)" : ""}</span></li>`).join("") + (p.bloody ? `<li style="color:var(--bad)">옷에 핏자국 — 물가에서 빨아야 한다</li>` : "") || "<li>부츠 속 동전뿐</li>"}</ul>`, U.has("items"));
    h += sec("낱말", (v.lexicon || []).length ? `<ul>${v.lexicon.map((w) => `<li>${esc(w.word)} <span class="faint">(${esc(w.lang)})</span> — ${w.meaning ? esc(w.meaning) : "<span class='faint'>뜻을 모른다. 쇳소리 같은 말</span>"}</li>`).join("")}</ul>` : "");
  }
  if (sheetTab === "world") {
    const R = v.reputation || {};
    const rep = (R.news || []).map((x) => `<li>${esc(x.scopeName)}: ${esc(x.label)}${x.place ? ` (${esc(x.place)})` : ""}${x.distortion ? ` — 소문이 ${esc(x.distortion)}` : ""}${x.identified ? "" : " — 누가 했는지는 모른다"}</li>`).join("")
      + ([...(R.titles || []), ...(R.extraTitles || [])].length ? `<li>사람들이 부르는 이름: ${esc([...new Set([...(R.titles || []), ...(R.extraTitles || [])])].join(", "))}</li>` : "")
      + (v.echo ? `<li style="color:var(--bad)">앎의 흔적 — ${esc(v.echo)}</li>` : "")
      + (Object.keys(R.bands || {}).length ? `<li>${Object.entries(R.bands).map(([k, b]) => `${esc(k)}: ${esc(b)}`).join(" · ")}</li>` : "");
    h += sec("평판 — 사람들이 나를 어떻게 말하나", `<ul>${rep || "<li>아무도 당신을 모른다</li>"}</ul>`, U.has("reputation"));
    const FM = v.family;
    if (FM) h += sec("가족", `<div class="book">${FM.name ? `<b>'${esc(FM.name)}'</b> — "${esc(FM.motto)}"<br>` : ""}${FM.members.length ? `식구: ${esc(FM.members.join(", "))}` : ""}${FM.children.length ? `<br>아이: ${FM.children.map((c) => `${esc(c.name)} (${esc(c.sex)}, ${esc(c.age)}${c.traits.length ? " · " + esc(c.traits.join(", ")) : ""}${Object.keys(c.skills).length ? " · " + esc(Object.entries(c.skills).map(([k, x]) => `${k} ${x}`).join(", ")) : ""})`).join(", ")} <span class="faint">— 이 회차에만 있다</span>` : ""}${FM.pregnant ? "<br>사라가 아이를 가졌다" : ""}</div>`);
    const TN = v.trueNames || [];
    h += sec("진명", TN.length ? `<div class="book">${TN.map((w) => `'${esc(w.word)}' — ${esc(w.source)}`).join("<br>")}</div>` : "");
    const DM = v.domain;
    if (DM) h += sec("영역", `<div class="book"><b>${esc(DM.at)}</b> — ${esc(DM.stage)}${DM.lost ? " (잃었다)" : ""}<br>머릿수 ${DM.pop} · 먹을 것 ${DM.foodDays}일치 · 방어 ${DM.defense} · 은폐 ${DM.conceal} · 사기 ${DM.morale}<br>드러남 <span style="color:${DM.exposure >= DM.threshold - 10 ? "var(--bad)" : "inherit"}">${DM.exposure}/${DM.threshold}</span> · 관리자 ${esc(DM.steward)} (충성 ${DM.loyalty}, ${DM.delegation === "full" ? "전권" : "직접 지시"}) · 방침 ${DM.policy === "open" ? "받는다" : "닫는다"}${DM.built.length ? `<br>시설: ${esc(DM.built.join(", "))}` : ""}${DM.building ? `<br>짓는 중: ${esc(DM.building.name)} (${DM.building.days}일 남음)` : ""}</div>`);
    const HD = v.hide;
    if (HD) h += sec("숨긴 곳", `<div class="book">${esc(HD.at)} — ${esc(HD.people.join(", "))}<br>먹을 것: ${HD.food}일치 · ${esc(HD.exposure)}</div>`);
    const OP = v.ops || [];
    h += sec("작전", OP.length ? OP.map((o) => `<div class="pk"><div class="top"><b>${esc(o.target)}</b> <span class="faint">보안 ${o.security}</span>${o.done ? " — 끝났다" : ""}</div><div class="guess">${esc(o.when)}</div><div class="book">${o.ready.map((r) => `${r.ok ? "✓" : "✗"} ${esc(r.label)}`).join("<br>")}</div>${o.missing.length ? `<div class="guess" style="color:var(--bad)">아직 열리지 않는다 — ${esc(o.missing.join("·"))}이(가) 없다</div>` : ""}</div>`).join("") : "");
    const RS = v.rising;
    if (RS) h += sec("여울강이 붉어지는 날", `<div class="book">${RS.free ? "회색여울은 사슬을 끊었다 — 해방구" : RS.failed ? "<span style='color:var(--bad)'>두 번째 붉은 길</span>" : RS.ready.map((r) => `${r.ok ? "✓" : "·"} ${esc(r.label)}`).join("<br>") + `<br><span class="faint">넷이 갖춰지면 밤의 채찍 기둥 광장에서 사람들을 부를 수 있다</span>`}</div>`);
    const SC = v.succession;
    if (SC) h += sec("용좌의 그림자", `<div class="book">${[SC.dead ? "용황이 죽었다 — 계승이 시작되었다" : "용황은 아직 숨을 쉰다", SC.throne ? "카스파르 반비늘이 즉위했다" : `카스파르의 세력: ${SC.kaspar >= 50 ? "즉위할 만하다" : SC.kaspar >= 30 ? "모이고 있다" : "아직 작다"}`, SC.charter ? "인간 자치령 칙허 — 그가 지는 날 휴지가 된다" : ""].filter(Boolean).map(esc).join("<br>")}</div>`);
  }
  body.innerHTML = h || `<div class="sec empty">아직 적힌 것이 없다. 살아남으면 이 장부가 찬다.</div>`;
  body.querySelectorAll(".memo").forEach((m) => (m.onchange = () => post("/api/memo", { npc: m.dataset.npc, text: m.value })));
}
const NARR = [["silent_god", "침묵하는 신 — 세계는 제 무게대로"], ["old_teller", "늙은 이야기꾼 — 쉬어 가며 하마"], ["ash_teller", "재의 화자 — 가장 나쁜 때에 불탄다"], ["dice", "주사위 — 뼈가 던져진 대로"]];
function settingsHTML(v) {
  const segBtns = (key, opts) => `<span class="seg" data-set="${key}">${opts.map(([val, lab]) => `<button type="button" data-v="${val}" aria-pressed="${String(SET[key]) === String(val)}">${lab}</button>`).join("")}</span>`;
  return `<div class="sec"><h4>읽기</h4>
      <div class="set-row"><span>글자 크기</span>${segBtns("size", [["s", "작게"], ["m", "보통"], ["l", "크게"], ["xl", "아주 크게"]])}</div>
      <div class="set-row"><span>바탕</span>${segBtns("theme", [["night", "밤"], ["parchment", "양피지"], ["system", "기기 따라"]])}</div>
      <div class="set-row"><span>지난 글</span>${segBtns("dim", [[true, "흐리게"], [false, "또렷하게"]])}</div>
      <div class="set-row"><span>움직임</span>${segBtns("motion", [[true, "켬"], [false, "줄임"]])}</div></div>
    <div class="sec"><h4>누가 이 이야기를 기억하는가</h4><div class="row"><select id="narr">${NARR.map(([id, lab]) => `<option value="${id}"${v?.narrator?.id === id ? " selected" : ""}>${lab}</option>`).join("")}</select><button class="btn" id="narrBtn">이 화자로</button></div></div>
    <div class="sec"><h4>저장</h4><div class="row"><input id="slotName" placeholder="칸 이름" value="칸1"><button class="btn" id="saveBtn">저장</button></div><div class="row" id="slots" style="margin-top:8px"></div></div>
    <div class="sec"><h4>새 판</h4><div class="row"><button class="btn" id="newBtn">새 판 — 그림다크</button><button class="btn" id="newStoryBtn">새 판 — 이야기 (아침으로 되돌리기 3번)</button></div>
      ${v?.mode === "story" ? `<div class="row" style="margin-top:8px"><button class="btn" id="rewindBtn">마지막 아침으로 되돌린다</button></div>` : ""}</div>
    <div class="sec"><h4>단축키</h4><div class="keys"><span class="kbd">1</span><span>~ <span class="kbd">9</span> 선택지 고르기</span><span class="kbd">/</span><span>직접 쓰기</span><span class="kbd">M</span><span>지도</span><span class="kbd">N</span><span>수첩</span><span class="kbd">Esc</span><span>닫기</span></div></div>
    ${DEBUG ? `<div class="sec"><h4>엔진 기록 (판정·검증)</h4><pre id="debugOut">${esc(JSON.stringify({ debug: last?.debug, usage: last?.usage, provider: last?.provider }, null, 1))}</pre></div>` : ""}`;
}
function bindSettings() {
  document.querySelectorAll("#sheetBody .seg").forEach((sg) => sg.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    const key = sg.dataset.set, raw = b.dataset.v, val = raw === "true" ? true : raw === "false" ? false : raw;
    SET[key] = val; store.set(key, val); applySettings();
    sg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  })));
  $("narrBtn").onclick = async () => { const r = await post("/api/narrator", { id: $("narr").value }); if (r.view && last) { last.view = r.view; render(last); } };
  $("saveBtn").onclick = async () => { await post("/api/save", { name: $("slotName").value }); loadSaves(); };
  $("newBtn").onclick = () => newGame({ narrator: $("narr").value });
  $("newStoryBtn").onclick = () => newGame({ mode: "story", narrator: $("narr").value });
  const rw = $("rewindBtn"); if (rw) rw.onclick = async () => { closeSheet(); const d = await call("/api/rewind"); if (d.error) { $("busy").textContent = d.error; return; } resetStory(); show(d); };
  loadSaves();
}
async function loadSaves() {
  const el = $("slots"); if (!el) return;
  try { const r = await post("/api/saves"); el.innerHTML = r.saves.map((s) => `<button class="btn" data-s="${esc(s)}">불러오기: ${esc(s)}</button>`).join(""); } catch { el.textContent = "저장 목록을 못 불렀다"; return; }
  el.querySelectorAll("button").forEach((b) => (b.onclick = async () => { closeSheet(); resetStory(); show(await call("/api/load", { name: b.dataset.s })); }));
}
function resetStory() { $("story").innerHTML = ""; currentTurn = null; lastPlace = null; }
async function newGame(body) { closeSheet(); resetStory(); show(await call("/api/new", body)); }

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
  pop.innerHTML = `<button class="close" aria-label="닫기">✕</button><h4>${esc(it.name)}</h4>
    <div class="sub">${l ? `${esc(KIND_KO[l.kind] || "장소")} · ${esc(ACCESS_KO[l.access] || "")}` : `고장 밖 · 걸어서 ${o.hours}시간`}</div>
    ${ppl.length ? `<div class="ppl">${ppl.map((p) => `<div><span>${esc(p.name)} — ${esc(p.text)}</span><span class="c" title="짐작의 확신">${p.conf >= 0.85 ? "●●●" : p.conf >= 0.65 ? "●●○" : "●○○"}</span></div>`).join("")}<div class="faint" style="font-size:.7rem;color:var(--ink-faint)">짐작이다 — 틀릴 수 있다</div></div>` : l ? `<div class="faint" style="color:var(--ink-faint)">아는 사람이 있을 것 같지 않다</div>` : ""}
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
  pop.innerHTML = `<button class="close" aria-label="닫기">✕</button><h4>${esc(n.name)}</h4>
    <div class="sub">${esc(TYPE_KO[n.type] || "")}${region ? ` · ${esc(region)}` : ""} · ${status}</div>
    ${n.desc ? `<div class="desc">${esc(n.desc)}</div>` : ""}
    ${J ? `<div class="acts">${acts}</div>${J.fast.id || J.travel ? "" : `<div class="warn">지금은 떠날 수 없다 — 대화나 장면이 끝난 뒤에</div>`}${W.deserter ? `<div class="warn">회색여울을 떠나면 — 점호에 두 번 빠지면 탈주 노예다</div>` : ""}` : n.here ? "" : `<div class="sub">${n.settlement ? "아직 가는 길을 모른다" : "머물 곳이 없는 땅 — 지나가는 길목이다"}</div>`}`;
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
  if (tab === "town") return `<button class="x" aria-label="범례 닫기">✕</button><div class="lg">
    ${sw(`<rect x="3" y="2" width="24" height="10" fill="#efe4c8" stroke="#3a2d20"/>`)}<span>드나들 수 있는 곳 · 누르면 그리로</span>
    ${sw(`<rect x="3" y="2" width="24" height="10" fill="#ddd0b0" stroke="#3a2d20"/><path d="M22 5h4v4h-4Z" fill="none" stroke="#3a2d20"/>`)}<span>주인·일꾼의 곳 — 함부로 들면 걸린다</span>
    ${sw(`<text x="2" y="11" font-size="10" fill="#2f5868">●●○</text>`)}<span>아는 사람이 '아마 거기' (짐작의 확신)</span>
    ${sw(`<path d="M4 7h18M18 3l6 4-6 4" fill="none" stroke="#3a2d20" stroke-width="1.6"/>`)}<span>고장 밖으로 — 걸리는 시간</span></div>`;
  return `<button class="x" aria-label="범례 닫기">✕</button><div class="lg">
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
  const plate = (name) => { const im = document.createElement("img"); im.className = "plate"; im.alt = ""; im.src = `/art/${name}.svg`; veil.appendChild(im); requestAnimationFrame(() => im.classList.add("on")); return im; };
  const foldArt = plate("03_time_fold");
  const fold = document.createElement("div"); fold.className = "fold"; veil.appendChild(fold);
  let gap = E.loop === 1 ? 220 : 120;
  // 진짜 죽음: 접힘이 시작했다가 멈춘다. 날짜가 두세 줄 오르다 재가 된다. 빵 냄새는 오지 않는다
  if (E.final) {
    for (const dt of E.record.rewind.slice(0, 3)) { const x = document.createElement("div"); x.textContent = dt; fold.appendChild(x); buzz(HAPTIC.H2); await nap(260); }
    await nap(700); fold.classList.add("ash"); foldArt.classList.remove("on"); await nap(900); fold.remove(); foldArt.remove(); await nap(1500);
    const d = await next;
    const ep = document.createElement("div"); ep.className = "rec"; ep.innerHTML = (d.epilogue || E.epilogue || []).map((x) => `<p>${esc(x)}</p>`).join("") + `<p style="margin-top:22px;color:#5e574c">시대가 끝났다.</p>`;
    const nb = document.createElement("button"); nb.className = "btn"; nb.textContent = "새 시대 — 새 판"; nb.onclick = async () => { veil.hidden = true; document.body.classList.remove("ashing"); deathRunning = false; resetStory(); show(await call("/api/new", {})); };
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
  sm.innerHTML = `<p>${n >= 12 ? "젖은 재. 그 위에, 빵 냄새." : n >= 4 ? "빵 냄새. 그 밑에, 젖은 재." : "빵 냄새."}</p>`; veil.appendChild(sm); buzz(HAPTIC.H3); plate("01_ration_line");
  await nap(800); sm.insertAdjacentHTML("beforeend", `<p class="inner">나는 — 이 냄새를 안다.</p>`);
  if (god) setTimeout(() => god.remove(), 1000);
  const d = await next; await tapOr(veil);
  veil.hidden = true; document.body.classList.remove("ashing"); deathRunning = false;
  resetStory(); show(d);
}

// ── 단추와 단축키 ──
$("placePawn").innerHTML = pawnIconHTML(26);
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
  if (e.key === "Escape") { if ($("menuPop")) return closeMenu(); if ($("mapPop")) return closePop(); if (!$("mapview").hidden) return closeMap(); if (!$("sheet").hidden) return closeSheet(); if (typing) document.activeElement.blur(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || deathRunning) return;
  if (e.key === "m" || e.key === "M" || e.key === "ㅡ") { e.preventDefault(); $("mapview").hidden ? openMap() : closeMap(); return; }
  if (e.key === "n" || e.key === "N" || e.key === "ㅜ") { e.preventDefault(); $("sheet").hidden ? openSheet() : closeSheet(); return; }
  if (!$("mapview").hidden || !$("sheet").hidden) return;
  if (e.key === "/") { const f = $("freeText"); if (f) { e.preventDefault(); f.focus(); } return; }
  if (/^[1-9]$/.test(e.key)) { const b = $("dock").querySelector(`.choice[data-key="${e.key}"]`); if (b && !b.disabled) { e.preventDefault(); b.click(); } }
});
start();
