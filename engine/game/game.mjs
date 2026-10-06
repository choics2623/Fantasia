// 게임 진행 루프 (28_GAME_LOOP.md) — 위치(24)·목표 행동(26)·반응 층(27)·카드(22)를 하나의 플레이로 묶는다.
//
// 저장은 "시드 + 행동 기록(journal)"이다. 세계 상태는 언제나 기록을 처음부터 다시 재생해서 만든다.
//   - 불러오기 = 재생. 되돌리기(LLM 실패) = 마지막 기록을 빼고 재생. 클로저·Map을 직렬화할 일이 없다.
//   - 주사위는 hash(시드, 회차, 기록 번호) — 다시 시도해도 같은 주사위 (재시도로 이득을 보지 못한다).
//   - LLM이 만든 것 중 엔진이 받아들인 것(기억)도 기록에 들어간다 → 재생할 때 LLM을 다시 부르지 않는다.
// 이 파일에는 LLM 호출이 없다. LLM은 서버가 부르고, 결과 중 엔진이 검증한 것만 기록으로 돌아온다.
import { createWorld } from "../sim/whereabouts.mjs";
import { createState, createAgenda } from "../sim/agenda.mjs";
import { createLivingWorld } from "../sim/living.mjs";
import { fmt, toMinutes, fromMinutes, isSabbath, parseClock, parseDate, MONTHS } from "../sim/calendar.mjs";
import { cardReveals, revealOK } from "./reveal.mjs";
import { josa } from "../sim/text.mjs";
import { createReputation, classifyDeed } from "../sim/reputation.mjs";
import { createOffices } from "../sim/offices.mjs";

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function hash(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join("|")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const prob = (S, D) => clamp(1 / (1 + Math.exp(-(S - D) / 8)), 0.03, 0.97);
// 체감 등급 6단 (01 §4.1) — 숫자 대신 캐릭터의 판단
export function band(p) { return p >= 0.9 ? "식은 죽 먹기" : p >= 0.75 ? "확실해 보인다" : p >= 0.55 ? "해볼 만하다" : p >= 0.4 ? "반반이다" : p >= 0.2 ? "운이 따라야 한다" : "무모하다"; }
// 체감 확률 (01 §4.2): 실제 P + 과신 편향 + 오차. 서툰 사람일수록 자기를 믿고, 틀린다. 실력이 늘면 세계가 투명해진다
export function perceived(g, P, skill, key) {
  const sk = g.P.skills[skill] || 10, sense = 10 + g.P.mods.감각 * 2;
  const bias = 0.15 * Math.max(0, 1 - sk / 50);
  const sd = 0.2 * Math.max(0, 1 - (sk + sense * 2) / 140);
  const u1 = Math.max(1e-6, hash(g.seed, "feel", key, Math.floor(g.t / 1440))), u2 = hash(g.seed, "feel2", key);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return clamp(P + bias + z * sd, 0.01, 0.99);
}
export function tierOf(P, r) {
  if (r < P * 0.15) return "대성공";
  if (r < P) return "성공";
  if (r < P + (1 - P) * 0.35) return "부분 성공";
  if (r > 1 - (1 - P) * 0.15) return "대실패";
  return "실패";
}
const OK = (t) => t === "성공" || t === "대성공";

// ── 회귀점 (14 첫 시간, WORLD_BIBLE §1.3) ──
export const START = toMinutes(312, 9, 1, 18, 0);   // 회귀점: 낙엽월 1일 저녁 6시, 배급 줄의 빵 냄새 (14 §2)
const SETTLEMENT = "greyford";            // 주인공이 매인 곳 (회귀점). 지금 있는 곳은 g.P.settlement
const HOME = "gf_river_huts";                         // 강변 움막 12호 — 어머니 게르다, 동생 키트와 함께 (14 §6.2)
const ROLLCALL = "gf_whip_square";
const NEW_PLAYER = () => ({
  name: "셋째", age: 17,
  skills: { 화술: 22, 기만: 15, 위압: 8, 통찰: 18, 손재주: 12, 은신: 16, 싸움: 12 },
  mods: { 근력: -0.5, 민첩: 0.5, 지능: 0.5, 감각: 1, 의지: 0 },
  status: { hunger: 2, pain: 30 },
});

// ── 콘텐츠 ── (content/build/*.json + cards.json)
export function prepareContent({ bundle, cards, game }) {
  const names = {};
  for (const c of Object.values(cards)) {
    if (!c.name) continue;
    names[c.name] = c.id;
    for (const p of c.name.split(/\s+/)) if (p.length > 1 && !names[p]) names[p] = c.id;
  }
  const reveals = {};
  for (const c of Object.values(cards)) reveals[c.id] = cardReveals(c, names);
  return { bundle, cards, game, names, reveals, facts: game.facts };
}

// ── 한 회차 (저장되는 것) ──
export function newRun({ seed = 7, loop = 1, carry = null, opening = true } = {}) {
  return { v: 1, seed, loop, opening, journal: [], carry: carry || { notebook: [], future: [], deaths: [] } };
}
// 영혼 (03 §4.1·§8): 세계 밖의 유일한 상태 — 회귀를 건너는 것은 이것뿐이다.
// 회차 안에서는 읽기만 한다 (재생이 결정적이도록). 회귀할 때 regressRun이 이번 회차를 정산해 새로 쓴다.
//   people: {npc: {loops:[{loop, like, trust, impressions, lines}], name}} — 관계 수치는 넘어가지 않는다. 기억만.
//   knowledge: {fact: {first, last, seen}} — 몇 번 다시 확인했는가가 확신도(03 §4.4)
//   places: 들어가 본 곳 · records: 회차 기록 · unlocked: 해금(14 §8) · furthest: 가장 멀리 간 날
export const emptySoul = () => ({ people: {}, knowledge: {}, places: [], records: [], unlocked: [], furthest: START });
const EMPTY_SOUL = emptySoul();
const soul = (g) => g.run.carry.soul || EMPTY_SOUL;
const soulPerson = (g, n) => soul(g).people[n] || null;
const loopSeed = (run) => Math.floor(hash(run.seed, "loop", run.loop) * 1e9);

// ── 재생: 기록으로 세계를 만든다 ──
export function boot(content, run) {
  const g = build(content, run);
  if (run.carry.talent) storyEffect(g, `talent ${run.carry.talent}`);   // 재능은 영혼에 남는다 (06)
  if (run.opening !== false) startStory(g);   // 회귀점의 대본 장면 (검사는 opening:false로 건너뛸 수 있다)
  for (const e of run.journal) apply(g, e, { replay: true });
  return g;
}

function build(content, run) {
  const { bundle, cards, game } = content;
  const seed = loopSeed(run);
  ROUTINES = bundle.routines;
  const W = createWorld(bundle, { loopSeed: seed });
  const S = createState({ cards, vars: game.agendas.vars, inventories: game.inventories });
  const A = createAgenda(W, S, game.agendas, { loopSeed: seed });
  const L = createLivingWorld({ world: W, state: S, agenda: A, inventories: game.inventories, sim: game.sim, cards, loopSeed: seed, active: [SETTLEMENT], startAt: START });
  S.purse.player = 3;      // 부츠 속 동화 3못 (14)
  // 대본 장면의 무대: 회차 시작 장면이 세우는 사람들 (모든 회차 같다 — 회귀점의 고정 인물)
  const day0 = Math.floor(START / 1440) * 1440;
  for (const st of game.storylets || []) if (st.trigger?.start) for (const x of st.stage || []) W.override({ npc: x.npc, from: day0 + parseClock(x.from), to: day0 + parseClock(x.to), kind: "at", at: x.at, doing: x.doing });
  const g = {
    content, run, W, S, A, L, seed,
    t: START, at: "gf_rooster",
    P: { ...NEW_PLAYER(), settlement: SETTLEMENT, alive: true, captured: false, knows: new Set(), met: new Set(), seen: {}, knowsPlaces: new Set(), found: new Set(), been: new Set(["gf_rooster"]), notebook: [], heard: new Set(), lastRollcall: null },
    M: {},             // NPC의 마음 (회차 안에서만): {fear, anger, memories[], impressions{}, revealed:Set, toldPlayer:Set}
    convo: null,       // {npc, turns, patience, transcript[]}
    ended: null,       // {kind: dead|captured, why}
    feed: [],          // 이번 턴에 플레이어가 겪은 일 (서술 재료)
    story: null,       // 지금 펼쳐진 대본 장면 {id, phase: input|choice, done:Set}
    storyDone: new Set(),
    deeds: [],         // 플레이어의 행적 — 평판은 이것과 '아는 사람들'에서 계산한다 (재생으로 저절로 맞다)
    rep: createReputation(game.reputation || {}, { seed }),
    offices: createOffices(game.factions || {}),
    seenDead: new Set(),
  };
  S.heirs = {};       // 죽은 사람 → 그 일을 이은 사람 (반응 층의 '윗선' 찾기가 쓴다)
  return g;
}
const mind = (g, n) => (g.M[n] ??= { fear: 0, anger: 0, memories: [], impressions: {}, revealed: new Set(), toldPlayer: new Set() });
const relOf = (g, n) => g.S.rel.get(`${n}>player`) || { like: 0, trust: 0 };
function bumpRel(g, n, like = 0, trust = 0) {
  const r = { ...relOf(g, n) }; r.like = clamp(r.like + like, -100, 100); r.trust = clamp(r.trust + trust, -100, 100);
  g.S.rel.set(`${n}>player`, r);
}
const cardOf = (g, n) => g.content.cards[n] || { id: n, name: n };
const nameOf = (g, n) => (n === "player" ? "당신" : cardOf(g, n).name || n);
const placeName = (g, id) => g.W.loc.get(id)?.name || id;
const profOf = (g, n) => ({ perception: 50, nerve: 50, ...(g.content.game.sim.defaults_by_settlement?.[g.P.settlement] || {}), ...(g.content.game.sim.profiles[n] || {}) });
const knowsFact = (g, f) => g.P.knows.has(f) || g.run.carry.future.includes(f);
const isFuture = (g, f) => g.run.carry.future.includes(f) && !g.P.knows.has(f);
function learn(g, f, how) {
  if (g.P.knows.has(f)) return false;
  g.P.knows.add(f);
  const text = g.content.facts[f]?.text || f;
  g.P.notebook.push(`${how} — ${text}`);
  // 사실에 장소 이름이 나오면 그 장소를 안다 (숨은 장소에 들어갈 수 있게)
  for (const [id, l] of g.W.loc) if (l.settlement === g.P.settlement && l.name && text.includes(l.name.replace(/'.*'/, "").trim().split(" ")[0]) && (l.access === "secret")) g.P.knowsPlaces.add(id);
  if (f === "fact_gf_egil_family_in_cellar") g.P.knowsPlaces.add("gf_rooster_cellar");
  return true;
}

// ── 지금 장면 ──
// 이 고장에 올 수 있는 사람만 본다: 여기 사는 사람 + 일정으로 여기 오는 사람 (LOD — 다른 고장 수백 명은 계산하지 않는다)
function localNpcs(g) {
  if (g._local?.s === g.P.settlement) return g._local.list;
  const inHere = (id) => g.W.loc.get(id)?.settlement === g.P.settlement;
  const set = new Set();
  for (const [n, r] of Object.entries(g.content.bundle.routines)) if (inHere(r.home) || (r.blocks || []).some((b) => inHere(b.at))) set.add(n);
  for (const e of g.content.bundle.events) if (inHere(e.at) || inHere(e.travel_from) || inHere(e.return_to)) e.npcs.forEach((n) => set.add(n));
  g._local = { s: g.P.settlement, list: [...set] };
  return g._local.list;
}
function present(g, t = g.t) {
  return g.W.whoIsAt(g.at, t, localNpcs(g)).filter((w) => (w.kind === "at" || w.kind === "captive") && w.at === g.at && !g.S.dead.has(w.npc));
}
const isNight = (t) => { const m = ((t % 1440) + 1440) % 1440; return m >= 21 * 60 || m < 4 * 60 + 30; };
// 자고 있나: 일과 글에 잠이 있거나, 깊은 밤(23~04시)에 자기 집에 있으면
let ROUTINES = {};
function asleep(w, t) {
  if (!isNight(t)) return false;
  if (/잔다|잠|침상|자고/.test(w.doing || "")) return true;
  const m = ((t % 1440) + 1440) % 1440;
  return (m >= 23 * 60 || m < 4 * 60) && ROUTINES[w.npc]?.home === w.at;
}
function bodiesHere(g) { return g.L.bodies.filter((b) => b.at === g.at && !b.removed); }
function worn(g, n) { return [...g.L.items.values()].filter((i) => i.owner === n && i.worn); }
function mine(g) { return [...g.L.items.values()].filter((i) => i.owner === "player" && !i.stashed); }
const hasWeapon = (g) => mine(g).some((i) => i.tags?.includes("무기"));

function locAccess(g, id, t) {
  const l = g.W.loc.get(id); if (!l) return "none";
  let a = l.access || "public";
  const m = /(\d\d:\d\d)-(\d\d:\d\d)/.exec(l.hours || "");
  const mod = ((t % 1440) + 1440) % 1440;
  if (m && typeof l.hours === "string") { const [f, to] = [parseClock(m[1]), parseClock(m[2])]; const open = f < to ? mod >= f && mod < to : mod >= f || mod < to; if (!open && a === "public") a = "closed"; }
  if (l.locked && typeof l.locked === "string") { const [f, to] = l.locked.split("-").map(parseClock); const shut = f < to ? mod >= f && mod < to : mod >= f || mod < to; if (shut) a = id === HOME ? "home_locked" : "locked"; }
  return a;
}
function settlementAtNode(g, node) {
  for (const [sid, st] of Object.entries(g.content.bundle.settlements)) if (st.node === node) return sid;
  return null;
}
function travels(g) {
  const st = g.content.bundle.settlements[g.P.settlement]; if (!st) return [];
  const here = g.W.loc.get(g.at);
  // 고장의 가장자리(마을 밖 장소)나 고장 안 어디서든 떠날 수 있다 — 길은 지도의 이웃 노드
  const out = [];
  for (const [sid, s2] of Object.entries(g.content.bundle.settlements)) {
    if (sid === g.P.settlement) continue;
    const r = g.W.route(st.node, s2.node);
    if (!r || r.path.length > 3 || r.hours > 40) continue;      // 한두 걸음 거리의 이웃만
    out.push({ settlement: sid, name: s2.name, hours: Math.round(r.hours * 10) / 10 });
  }
  return out.sort((a, b) => a.hours - b.hours).slice(0, 4);
}
function entryOf(g, sid) {
  const st = g.content.bundle.settlements[sid];
  const L = st.locations || [];
  return (L.find((l) => /gate|square|checkpoint/.test(l.kind || "") && (l.access || "public") === "public") || L.find((l) => (l.access || "public") === "public" && !l.parent) || L[0])?.id || st.node;
}
function exits(g) {
  const here = g.W.loc.get(g.at);
  const out = [];
  for (const [id, l] of g.W.loc) {
    if (l.settlement !== g.P.settlement || id === g.at) continue;
    const isRoomHere = l.parent && (l.parent === g.at || l.parent === here?.parent);
    const isTop = !l.parent;
    if (!isTop && !isRoomHere) continue;
    if (l.outer && settlementAtNode(g, l.node) && settlementAtNode(g, l.node) !== g.P.settlement) continue;   // 다른 고장 = 길 떠나기 (travel)
    let a = locAccess(g, id, g.t);
    if (g.W.placeState(id, g.t)) continue;           // 닫힘·통제·불탐 (24 §3.7)
    if (a === "secret" && !g.P.knowsPlaces.has(id)) continue;
    if (a === "locked") continue;
    out.push({ id, name: l.name, access: a, minutes: g.W.travelMinutes(g.at, id) });
  }
  return out.sort((x, y) => x.minutes - y.minutes);
}

// ── 할 수 있는 것 (어포던스) — LLM은 이 목록을 문장으로만 바꾼다 ──
export function options(g) {
  // ◈는 한 화면에 셋까지 (14 §7.5) — 나머지는 접힌 줄로
  let mem = 0;
  return rawOptions(g).map((o) => ({ ...o, label: josa(o.label), ...(o.memory && ++mem > 3 ? { more: true } : {}) }));
}
// ◈ 표지: 지난 회차의 기억이 연 선택지. 세 회차 연속 고르면 표지가 빠진다 — 기억이 아니라 습관 (§7.2)
function memMark(g, id, source) {
  const used = soul(g).memUsed?.[id] || [], L = g.run.loop;
  if ([L - 1, L - 2, L - 3].every((x) => used.includes(x))) return null;
  return source;
}
function rawOptions(g) {
  if (g.story) return storyOptions(g);
  if (g.ended) return [{ id: "regress", kind: "regress", label: "눈을 감는다 — 회귀점으로" }];
  const o = [];
  if (g.convo) {
    const n = g.convo.npc, c = cardOf(g, n);
    o.push({ id: "small_talk", kind: "talk", label: `${c.name}에게 이런저런 말을 붙인다`, skill: "화술", request: -10 });
    for (const topic of topicsFor(g, n)) o.push({ id: `ask:${topic}`, kind: "talk", label: `${topic}에 대해 묻는다`, skill: "화술", request: 5, topic });
    for (const f of [...g.P.knows, ...g.run.carry.future]) {
      const hid = (g.content.reveals[n] || []).find((r) => r.fact === f);
      if (hid && !mind(g, n).revealed.has(f)) o.push({ id: `press:${f}`, kind: "talk", label: `${c.name}이 숨기는 것을 안다고 넌지시 말한다`, skill: "위압", request: 8, fact: f, memory: isFuture(g, f) ? memMark(g, `press:${f}`, { fact: f, loop: soul(g).knowledge[f]?.last || g.run.loop - 1 }) : null });
    }
    if (g.S.purse.player >= 12) o.push({ id: "give:coin", kind: "talk", label: "1 발톱(12못)을 건넨다", skill: "화술", request: -15 });
    for (const it of mine(g)) {
      if (it.eat || it.use || it.coin) continue;                 // 먹을 것·약은 보이거나 팔 물건이 아니다
      o.push({ id: `show:${it.id}`, kind: "talk", label: `${it.name}을(를) 꺼내 보인다`, risk: "물건을 알아볼 수 있다" });
      if (profOf(g, n).role === "fence" || (it.value || 0) > 0) o.push({ id: `sell:${it.id}`, kind: "talk", label: `${it.name}을(를) 팔겠다고 한다` });
    }
    const shop = g.content.game.economy?.shops?.[n];
    for (const gid of shop?.sells || []) {
      const good = g.content.game.economy.goods[gid], price = priceOf(g, n, gid);
      if (good && g.S.purse.player >= price) o.push({ id: `buy:${gid}`, kind: "talk", label: `${good.name}을(를) ${price}못에 산다${good.illegal ? " (몰래)" : ""}`, risk: good.illegal ? "인간이 지니면 죄" : null });
    }
    o.push({ id: "leave", kind: "talk", label: "이야기를 끝낸다" });
    return o;
  }
  for (const w of present(g)) {
    if (w.kind === "captive") continue;
    o.push({ id: `talk:${w.npc}`, kind: "scene", label: `${displayName(g, w.npc)}에게 말을 건다${asleep(w, g.t) ? " (자고 있다)" : ""}`, npc: w.npc });
  }
  for (const w of present(g)) if (w.kind !== "captive") o.push({ id: `attack:${w.npc}`, kind: "scene", more: true, label: `${displayName(g, w.npc)}에게 덤벼든다${hasWeapon(g) ? " (칼이 있다)" : " (맨손)"}`, skill: "싸움", npc: w.npc, risk: "죽을 수 있다" });
  for (const b of bodiesHere(g)) {
    const left = (g.S.purse[b.npc] || 0) > 0 || worn(g, b.npc).length;
    if (left) o.push({ id: `loot:${b.npc}`, kind: "scene", label: `${nameOf(g, b.npc)}의 시체를 뒤진다`, npc: b.npc });
    o.push({ id: `hide_body:${b.npc}`, kind: "scene", label: `${nameOf(g, b.npc)}의 시체를 숨긴다`, npc: b.npc });
  }
  const ra = g.content.game.economy?.ration;
  if (ra?.at === g.at && g.P.lastRation !== Math.floor(g.t / 1440)) {
    const m = ((g.t % 1440) + 1440) % 1440;
    if (m >= parseClock(ra.from) && m < parseClock(ra.to) && present(g).some((w) => w.npc === "npc_bram")) o.push({ id: "ration", kind: "scene", label: "배급 줄에 서서 죽 한 그릇을 받는다" });
  }
  for (const it of mine(g)) if (it.eat || it.use) o.push({ id: `use:${it.id}`, kind: "scene", label: `${it.name}을(를) ${it.eat ? "먹는다" : "쓴다"}` });
  o.push({ id: "search", kind: "scene", more: true, label: "이곳을 뒤져 본다", skill: "통찰" });
  for (const it of g.L.items.values()) if (it.at === g.at && !it.worn && (it.owner !== "player" || it.stashed) && g.P.found.has(it.id)) o.push({ id: `take:${it.id}`, kind: "scene", label: `${it.name}을(를) 챙긴다` });
  // 숨기기: 몸에 지니면 점호 몸수색에 걸린다 — 어딘가에 묻어 두고 다닌다
  for (const it of mine(g)) if (!it.stashed) o.push({ id: `stash:${it.id}`, kind: "scene", more: true, label: `${it.name}을(를) 이곳에 숨긴다` });
  if (g.S.purse.player >= 12) o.push({ id: "stash:coin", kind: "scene", more: true, label: `동전 ${g.S.purse.player - 3}못을 이곳에 숨긴다 (부츠 속 3못만 남기고)` });
  for (const e of exits(g)) {
    const sneak = ["owner", "staff", "closed", "secret", "home_locked"].includes(e.access) && !(e.id === HOME);
    o.push({ id: `go:${e.id}`, kind: "move", label: `${e.name}(으)로 간다${e.minutes ? ` (${e.minutes}분)` : ""}${sneak ? " — 몰래" : ""}`, minutes: e.minutes, skill: sneak ? "은신" : null, to: e.id });
  }
  // 다른 고장으로: 지도에서 이웃한 고장 (주인공은 농노다 — 허락 없이 떠나면 탈주다)
  for (const tr of travels(g)) o.push({ id: `travel:${tr.settlement}`, kind: "move", label: `${tr.name}(으)로 길을 떠난다 (${tr.hours}시간)${g.P.settlement === SETTLEMENT ? " — 탈주" : ""}`, minutes: Math.round(tr.hours * 60), risk: g.P.settlement === SETTLEMENT ? "점호에 두 번 빠지면 탈주 노예" : null });
  o.push({ id: "wait:60", kind: "time", label: "한 시간 기다린다" });
  // 18 「기억대로 보낸다」: 하루를 늘 하던 대로 — 저녁 배급, 막사, 잠, 점호. 그사이 눈앞에서 일어난 일만 남는다
  if (g.P.settlement === SETTLEMENT && !g.S.vars.player_fugitive) o.push({ id: "routine_day", kind: "time", label: "하루를 늘 하던 대로 보낸다 (배급 → 막사 → 점호)" });
  if ((g.at === HOME && g.P.settlement === SETTLEMENT) || isNight(g.t)) o.push({ id: "sleep", kind: "time", label: g.at === HOME ? "침상에 눕는다" : "이곳에서 웅크리고 잔다" });
  return o;
}

export function knownNames(g) {
  const out = new Set();
  for (const f of [...g.P.knows, ...g.run.carry.future]) for (const nm of g.content.facts[f]?.names || []) out.add(nm);
  for (const n of [...g.P.met, ...Object.keys(soul(g).people)]) { const nm = nameOf(g, n); out.add(nm); out.add(nm.split(/\s+/)[0]); }
  for (const w of present(g)) { const nm = nameOf(g, w.npc); out.add(nm); out.add(nm.split(/\s+/)[0]); }
  return out;
}
function topicsFor(g, n) {
  const c = cardOf(g, n);
  const fs = [...(c.knows || []), ...(c.hides || []).map((h) => h.fact)];
  // 플레이어가 아는 이름만 주제가 된다 — 숨긴 사람의 이름이 선택지에 새지 않게
  const known = knownNames(g);
  const topics = new Set();
  for (const f of fs) for (const nm of g.content.facts[f]?.names || []) if (nm !== c.name && known.has(nm) && topics.size < 5) topics.add(nm);
  topics.add("요즘 마을 사정");
  return [...topics];
}

// ── 판정 ──
// parts: 근거 미리보기 (01 §4.3) — 캐릭터가 아는 말로만. ▲ 유리 ▼ 불리 ? 모른다
export function odds(g, opt) {
  if (!opt.skill) return null;
  const p = g.P;
  const n = opt.npc || g.convo?.npc;
  const pr = n ? profOf(g, n) : { perception: 50, nerve: 50 };
  const m = n ? mind(g, n) : { fear: 0, anger: 0 };
  const r = n ? relOf(g, n) : { like: 0, trust: 0 };
  const knowsHim = n && (p.met.has(n) || soulPerson(g, n));
  let S = p.skills[opt.skill] || 10, D = 10;
  const parts = [];
  const why = (sign, text) => parts.push({ sign, text: josa(text) });
  const statMod = opt.skill === "싸움" ? (p.mods.근력 + p.mods.민첩) * 2 : opt.skill === "위압" ? (p.mods.의지 + p.mods.근력) * 2 : opt.skill === "은신" ? p.mods.민첩 * 2 : (p.mods.지능 + p.mods.감각) * 2;
  S += statMod;
  if (p.status.hunger >= 2) { S -= 5; why("▼", p.status.hunger >= 3 ? "며칠째 제대로 못 먹었다 — 머리가 멍하다" : "배가 고프다"); }
  if (p.status.pain >= 30) { S -= p.status.pain >= 60 ? 9 : 3; why("▼", p.status.pain >= 60 ? "몸이 많이 아프다" : "등의 채찍 자국이 욱신거린다"); }
  if (opt.skill === "화술" && n) { const grp = groupOf(g, n), v = grp ? (reputation(g).views[grp] || 0) : 0; if (v) { const b = clamp(Math.round(v * 0.3), -8, 8); S += b; why(b >= 0 ? "▲" : "▼", `${grp} 사이에서 네 이름이 ${b >= 0 ? "좋게" : "나쁘게"} 돈다`); } }
  if (opt.skill === "화술") {
    const relB = Math.round(r.like * 0.3 + r.trust * 0.2); S += relB;
    if (relB >= 4) why("▲", "그가 너를 좋게 본다"); else if (relB <= -4) why("▼", "그가 너를 믿지 않는다");
    D += 5 + Math.round(pr.nerve / 10) + (opt.request || 0) + m.anger * 5 + m.fear * 2;
    if ((opt.request || 0) >= 5) why("▼", "쉽게 내줄 것을 묻는 게 아니다");
    if ((opt.request || 0) <= -10) why("▲", "부담 없는 말이다");
    if (m.anger >= 2) why("▼", "화가 나 있다");
  }
  if (opt.skill === "위압") {
    D += Math.round(pr.nerve / 4) + (opt.request || 0) - m.fear * 4;
    if (opt.fact) { S += Math.min(15, (g.content.facts[opt.fact]?.danger || 2) * 3); why("▲", "그가 숨기는 것을 안다"); }
    if (m.fear >= 2) why("▲", "이미 겁을 먹었다");
  }
  if (n && (opt.skill === "화술" || opt.skill === "위압")) {
    if (!knowsHim) why("?", "이 사람이 어떤 사람인지 아직 모른다");
    else if (pr.nerve >= 65) why("▼", "쉽게 흔들리는 사람이 아니다");
    else if (pr.nerve <= 35) why("▲", "겁이 많은 사람이다");
  }
  if (opt.skill === "통찰") { D += 18; why("?", "무엇이 있을지 모른다"); }
  if (opt.skill === "은신") {
    const watchers = g.W.whoIsAt(opt.to, g.t + (opt.minutes || 0), g.W.npcs()).filter((w) => w.kind === "at").length;
    D += 10 + watchers * 6 + (isNight(g.t) ? -6 : 4);
    why(isNight(g.t) ? "▲" : "▼", isNight(g.t) ? "어둡다" : "아직 밝다");
    if (knowsPlace(g, opt.to)) why(watchers ? "▼" : "▲", watchers ? `이 시각엔 그곳에 사람이 있다 (${watchers})` : "이 시각엔 그곳이 빈다");
    else why("?", "그곳에 지금 누가 있는지 모른다");
  }
  if (opt.skill === "싸움") {
    const w = g.W.where(n, g.t);
    const armed = worn(g, n).some((i) => i.tags?.includes("무기"));
    D += 10 + Math.round(pr.nerve / 5) + (armed ? 8 : 0) + (profOf(g, n).role === "hunter" ? 12 : 0);
    if (armed) why("▼", "상대가 무기를 지녔다");
    if (profOf(g, n).role === "hunter" && knowsHim) why("▼", "사람을 사냥하는 자다");
    if (hasWeapon(g)) { S += 10; why("▲", "칼이 있다"); } else why("▼", "맨손이다");
    if (asleep(w, g.t)) { S += 20; why("▲", "자고 있다"); }
    if (p.mods.근력 < 0) why("▼", "굶어서 팔에 힘이 없다");
  }
  for (const tr of soul(g).traces || []) if (n && tr.npc === n) { S -= 5 * (tr.level || 1); why("▼", TRACE_TEXT[tr.id]?.why || tr.name); }
  const P = prob(S, D);
  return { P, S: Math.round(S), D: Math.round(D), parts };
}
// 그 장소를 아는가: 들어가 봤거나(seen) 일정을 아는 곳 — 은신 근거에 쓴다
const knowsPlace = (g, id) => !!id && ((g.P.been || new Set()).has(id) || (soul(g).places || []).includes(id));

// ── 한 걸음: 기록 하나를 적용한다 (결정적) ──
// entry: {i, kind:'act', id, tags?, text?} | {i, kind:'memory', npc, mems:[...]} | {i, kind:'regress'}
export function apply(g, e, { replay = false } = {}) {
  g.feed = [];
  if (e.kind === "memory") { for (const m of e.mems) applyRecord(g, e.npc, m); return { kind: "memory" }; }
  const opt = options(g).find((o) => o.id === e.id);
  if (!opt) throw new Error(`지금은 할 수 없는 행동: ${e.id}`);
  const roll = hash(g.seed, "roll", e.i);
  const od = opt.check ? storyOdds(g, opt.check) : odds(g, { ...opt, tags: e.tags });
  const bonus = Math.min(25, (e.tags || []).reduce((s, t) => s + tagBonus(g, t), 0));
  const P = od ? prob(od.S + bonus, od.D) : 1;
  const tier = od ? tierOf(P, roll) : "성공";
  const res = { id: e.id, label: opt.label, kind: opt.kind, tier, P, roll, skill: opt.skill || null, changes: [], reveal: null, notes: [], futureUsed: [] };
  const [verb, arg] = e.id.split(/:(.*)/s);
  const before = g.t;
  DO[verb](g, arg, res, opt, e);
  successions(g);
  for (const w of present(g)) g.P.seen[w.npc] = { t: g.t, at: g.at };   // 마지막으로 본 곳 (24 §3.6)
  g.P.been.add(g.at);
  if (!TRIVIAL.test(e.id)) g.P.acts = [...(g.P.acts || []), { id: e.id, label: res.label, t: g.t, at: g.at }].slice(-8);
  if (opt.memory) (g.P.memUsed ??= new Set()).add(e.id);
  memoryInk(g);
  res.notes = res.notes.map(josa); res.label = josa(res.label);
  if (g.ended) g.ended.why = josa(g.ended.why);
  if (!replay) res.feed = g.feed.map((f) => ({ ...f, text: josa(f.text) }));
  return res;
}
const TRIVIAL = /^(wait|sleep|leave|small_talk|story:next|story_name)\b/;

// ── 기억 표지 (14 §7.5): ┊ 지난 회차에 일어났던 일 · ◇ 기억과 어긋남 ──
// 엔진이 고른 줄을 그대로 화면에 (LLM이 쓰지 않는다). 회차 안에서 같은 방아쇠에 한 번, 한 박자에 둘까지.
function memoryInk(g) {
  const day = Math.floor(g.t / 1440), key = `${day}|${Math.floor((g.t % 1440) / 30)}|${g.at}`;
  const here = present(g).filter((w) => w.kind !== "captive").map((w) => w.npc);
  const obs = (g.P.obs ??= {});
  if (!obs[key] && Object.keys(obs).length < 1500) obs[key] = here;
  if (g.run.loop < 2 || g.story) return;
  const said = (g.P.inkSaid ??= new Set());
  let budget = 2;
  const ink = (id, text, extra = {}) => { if (budget <= 0 || said.has(id)) return; said.add(id); budget--; g.feed.push({ kind: extra.drift ? "drift" : "ink", text, ...extra }); };
  // 죽음의 흔적: 그 사람을 이번 회차에 처음 볼 때 손이 먼저 기억한다 (H4)
  for (const tr of soul(g).traces || []) if (tr.npc && here.includes(tr.npc)) ink(`trace:${tr.id}:${tr.npc}`, `┊ ${TRACE_TEXT[tr.id]?.ink || tr.name}`, { buzz: "H4", trace: tr.id });
  // 지난 회차에 가까웠거나 멀었던 사람을 처음 볼 때 (이 사람은 너를 모른다)
  for (const n of here) {
    const sp = soulPerson(g, n); if (!sp?.loops?.length) continue;
    const x = sp.loops[sp.loops.length - 1], sc = x.like * 0.6 + x.trust * 0.4;
    const told = (x.told || []).map((f) => shortFact(g, f)).filter(Boolean)[0];
    const line = x.died ? "┊ 이 사람은 죽었었다. 지금은 숨을 쉰다." : told ? `┊ 이 사람이 너에게 털어놓았었다 — ${told}` : sc >= 40 ? "┊ 이 사람은 너를 깊이 믿었었다." : sc >= 20 ? "┊ 이 사람은 너에게 마음을 열었었다." : sc <= -20 ? "┊ 이 사람은 너를 미워했었다." : null;
    if (line) ink(`person:${n}`, line);
  }
  // ◇ 표류: 지난 회차의 같은 날·같은 30분·같은 자리와 지금이 다르다 (회차마다 처음 3번만 진동, H5)
  const past = soul(g).obs?.[key];
  if (past) {
    const drifted = (g.P.driftCount ??= { n: 0 });
    const pick = (n, was) => { const nm = displayName(g, n); const id = `drift:${key}:${n}`; if (said.has(id) || budget <= 0) return; ink(id, `┊ 지난번엔 이 시각에 ${nm}${josaPick(nm, "이", "가")} 여기 ${was ? "있었다" : "없었다"}. ◇`, { drift: true, buzz: drifted.n++ < 3 ? "H5" : null }); };
    for (const n of past) if (!here.includes(n) && (g.P.met.has(n) || soulPerson(g, n))) pick(n, true);
    for (const n of here) if (!past.includes(n) && soulPerson(g, n)) pick(n, false);
  }
}
const josaPick = (w, a, b) => { const c = String(w).charCodeAt(String(w).length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? a : b; };
const shortFact = (g, f) => { const t = g.content.facts[f]?.text; if (!t) return null; const cut = t.replace(/\s*\([^)]*\)/g, "").split(/[.,—]/)[0].trim(); return cut.length > 38 ? cut.slice(0, 36) + "…" : cut; };
// 죽음의 흔적 (14 §4.4): 그 죽음을 다시 만났을 때 손이 떨린다. 판정 −5 × 단계. 근거 미리보기에 한 줄
const TRACE_TEXT = {
  blade: { name: "목이 뜨겁다", ink: "목이 뜨겁다. 손을 대 보면 아무것도 없다.", why: "목이 먼저 기억한다. 이 손이다." },
  rope: { name: "손목이 쓸린다", ink: "손목이 쓸린다. 밧줄 자국은 없다.", why: "손목이 기억한다. 이 사람에게 붙잡혔다." },
  hunger: { name: "빈 속", ink: "배가 꼬인다. 아니다 — 이 저녁엔 빵이 나온다.", why: "빈 속이 무엇인지 안다." },
  water: { name: "물이 차다", ink: "물이 차다. 가슴 위의 발.", why: "물이 차다. 너는 그걸 안다." },
  teeth: { name: "목덜미", ink: "목덜미가 가렵다. 긁으면 손톱 밑에 아무것도 없다.", why: "목덜미가 기억한다." },
  spear: { name: "옆구리", ink: "옆구리가 시리다. 손을 대 보면 따뜻하다.", why: "옆구리가 기억한다." },
};
const TAGS = {
  uses_fact: (g, v) => (knowsFact(g, v) ? Math.min(15, (g.content.facts[v]?.danger || 2) * 3) : 0),
  appeals_interest: () => 6, appeals_fear: () => 6,
  offers_item: (g, v) => (mine(g).some((i) => i.id === v) || (v === "coin" && g.S.purse.player > 0) ? 5 : 0),
};
function tagBonus(g, t) { const [k, v] = String(t).split(":"); return TAGS[k] ? TAGS[k](g, v) : 0; }

// 시간이 흐른다: 세계를 굴리고, 그 사이 플레이어 주변에서 일어난 일을 모은다
function pass(g, minutes, { sleeping = false } = {}) {
  if (g.story) return;                 // 대본 장면이 열려 있으면 시간은 그 장면의 선택이 흘린다
  const from = g.t, to = g.t + minutes;
  const logFrom = g.S.log.length;
  // 점호·통금은 시각에 걸리는 일이다 — 지나가는 시각마다 본다
  let t = from;
  while (t < to) {
    let next = Math.min(to, Math.floor(t / 30) * 30 + 30);
    // 대본 장면의 시각이 이 구간에 있고 플레이어가 그 자리에 있으면 — 거기서 멈추고 장면을 연다 (잠도 깬다)
    const trig = nextTrigger(g, t, next);
    if (trig) next = trig.t;
    g.L.advance(next);
    successions(g);
    const c = fromMinutes(next);
    const hm = c.hh * 60 + c.mm;
    // 점호 (04:45~05:00, 안식일 제외): 그 시각 광장에 없으면 즈닉이 안다
    if (hm === 5 * 60 && !isSabbath(c.day) && g.P.lastRollcall !== c.day && overseer(g) && !g.S.dead.has(overseer(g)) && !g.S.vars.player_fugitive) {   // 점호는 감독관 자리의 일 — 즈닉이 죽으면 이은 사람이, 공석이면 점호도 없다
      g.P.lastRollcall = c.day;
      if (g.at !== ROLLCALL) { g.S.vars.player_missed_rollcall = (g.S.vars.player_missed_rollcall || 0) + 1; g.feed.push({ kind: "rule", text: "새벽 점호에 나가지 않았다. 감독관의 명단에 빈칸이 생겼다." }); }
      else rollcallSearch(g, c.day);
      // 점호에 두 번 빠진 채 마을 밖에 있으면 — 탈주 노예. 감독관이 바르그 조합에 현상금을 건다
      if ((g.S.vars.player_missed_rollcall || 0) >= 2 && g.P.settlement !== SETTLEMENT && !g.S.vars.player_fugitive) {
        g.S.vars.player_fugitive = true;
        const w = (g.S.wanted.player ??= { heat: 0, by: new Set(), reasons: [] });
        w.heat += 3; w.since ??= next; w.by.add(overseer(g)); w.reasons.push("탈주"); w.settlement = SETTLEMENT;
        g.deeds.push({ id: `d${g.deeds.length + 1}`, kind: "flee", victim: null, at: ROLLCALL, placeName: placeName(g, ROLLCALL), t: next });
        g.L.believe(overseer(g), next, { kind: "trespass", subject: "player", at: ROLLCALL, source: "noticed", reason: "탈주" }, { react: false });
        g.S.log.push({ t: next, npc: overseer(g), agenda: "sim", vis: "public", text: "감독관이 셋째를 탈주 노예로 올렸다 — 바르그 조합에 현상금" });
      }
    }
    // 통금 순찰 (21:00·23:00·02:00): 막사 밖에 있는 인간은 걸린다 — 은신 판정
    if (!g.P.traveling && g.P.settlement !== SETTLEMENT && hm % 60 === 0 && !g.ended) checkpoint(g, null, isNight(next) ? 0.04 : 0.08);
    if (g.P.settlement === SETTLEMENT && !g.P.traveling && ["21:00", "23:00", "02:00"].some((x) => parseClock(x) === hm) && g.at !== HOME && !g.W.loc.get(g.at)?.outer && !g.ended) {
      const P = prob(g.P.skills.은신 + g.P.mods.민첩 * 2 + 6, 22);
      if (hash(g.seed, "patrol", next) >= P) {
        g.P.status.pain = clamp(g.P.status.pain + 15, 0, 100);
        g.feed.push({ kind: "rule", text: "통금 순찰에 걸렸다. 크릭 감독의 몽둥이 — 그리고 막사로 끌려간다." });
        g.at = HOME;
        g.S.vars.player_curfew = (g.S.vars.player_curfew || 0) + 1;
      }
    }
    manhunt(g, next);
    t = next;
    if (g.ended) break;
    if (trig) { openStory(g, trig.st); break; }
  }
  g.t = Math.min(g.story ? t : to, g.ended?.t ?? to);
  if (sleeping) { g.P.status.pain = clamp(g.P.status.pain - 10, 0, 100); }
  // 하루에 한 번 배가 고파진다 (배급을 받으면 준다)
  for (let d = Math.floor(from / 1440) + 1; d <= Math.floor(to / 1440); d++) {
    // 굶주림: 이미 바닥(4)이면 몸이 먹힌다 — 아픔 +15, 100이면 죽는다
    if (g.P.status.hunger >= 4) { g.P.status.pain = clamp(g.P.status.pain + 15, 0, 100); g.feed.push({ kind: "rule", text: "사흘째 빈속이다. 손이 떨리고 무릎이 꺾인다." }); }
    g.P.status.hunger = clamp(g.P.status.hunger + 1, 0, 4);
    if (g.P.status.pain >= 100 && !g.ended) { g.P.alive = false; g.ended = { kind: "dead", why: "굶주림과 상처 — 몸이 더 버티지 못했다", t: d * 1440, trace: { id: "hunger" } }; }
  }
  // 플레이어가 알 수 있는 일: 지금 이 자리에서 일어난 공개 기록, 그리고 자기에 대한 것
  for (const l of g.S.log.slice(logFrom)) {
    if (l.vis === "secret" || l.vis === "player") continue;
    const here = g.W.where(l.npc, l.t);
    if (here?.at === g.at || l.agenda === "sim" && /주인공/.test(l.text)) g.feed.push({ kind: "world", t: l.t, text: l.text });
  }
  checkDanger(g);
}

// 죽음 → 자리 승계 (23 §2.1). 잇는 사람은 다음 날 아침부터 전임자의 일과를 산다
function successions(g) {
  for (const n of g.S.dead) {
    if (g.seenDead.has(n)) continue;
    g.seenDead.add(n);
    const changes = g.offices.onDeath(n, g.t, g.S.dead);
    const heir = g.offices.heirOf(n, changes);
    if (heir) {
      g.S.heirs[n] = heir;
      const c = fromMinutes(g.t); const from = (Math.floor(g.t / 1440) + 1) * 1440 + 6 * 60;
      g.W.inherit(heir, n, from);
    }
    for (const ch of changes) g.S.log.push({ t: g.t, npc: ch.to || n, agenda: "sim", vis: "public", text: josa(ch.to ? `${nameOf(g, ch.to)}이(가) ${ch.title} 자리를 이었다` : `${ch.title} 자리가 비었다`) });
  }
}
const overseer = (g) => g.offices.holder("fac_raven_house.off_overseer");

// 낯선 고장의 인간: 길목·순찰에서 통행증을 요구받는다. 없으면 탈주 노예로 붙잡힌다. 위조 통행증은 기만 판정.
// 소문(평판)이 이 고장까지 닿았고 얼굴이 알려졌으면 더 어렵다. 자유민의 땅(윗선이 없는 고장)은 묻지 않는다.
function checkpoint(g, res, p) {
  const chain = g.content.game.sim.defaults_by_settlement?.[g.P.settlement]?.report_to || [];
  if (!chain.length || g.ended) return;
  if (g.P.clearedUntil > g.t) return;                       // 한 번 넘긴 검문은 하루 동안 다시 묻지 않는다
  const l = g.W.loc.get(g.at) || {};
  if (l.outer || ["secret", "serf"].includes(l.access)) p *= 0.25;   // 마을 밖·숨은 곳·인간 거처는 덜 묻는다
  const roll = hash(g.seed, "check", g.P.settlement, g.t);
  if (roll >= p) return;
  const pass = mine(g).find((i) => i.tags?.includes("통행증"));
  const rep = reputation(g);
  const known = rep.news.some((n) => n.identified && n.scope !== "village");
  let ok = false, text;
  if (pass) {
    const P2 = prob(g.P.skills.기만 + g.P.mods.지능 * 2 + (pass.tags.includes("위조") ? 0 : 20) - (known ? 10 : 0), 22);
    ok = hash(g.seed, "check-pass", g.t) < P2;
    text = ok ? "경비가 통행증을 오래 들여다보다가 돌려준다." : "경비가 통행증의 인장을 손톱으로 긁는다. 위조다.";
  } else text = "경비가 묻는다. 누구의 것이냐, 통행증은. 대답할 것이 없다.";
  if (ok) g.P.clearedUntil = g.t + 1440;
  if (!ok) { g.ended = { kind: "captured", why: `${text} 탈주 노예로 붙잡혔다 — ${g.content.bundle.settlements[g.P.settlement]?.name}`, t: g.t, trace: { id: "rope" } }; }
  (res?.notes || g.feed).push(res ? text : { kind: "rule", text });
}

// 수배: 쫓는 윗선이 같은 자리에 있으면 붙잡힌다. 수배 3 이상이면 낮 동안 사람을 풀어 찾는다 —
// 막사·광장처럼 뻔한 곳은 금방, 숨은 곳(비밀 장소)·마을 밖은 느리게. 숨을 곳을 찾아 달아나는 것이 길이다
function manhunt(g, next) {
  const w = g.S.wanted?.player;
  if (!w || w.heat < 3 || g.ended || next - (w.since ?? next) < 60 || next % 60 !== 0) return;
  if (g.P.traveling || (w.settlement || SETTLEMENT) !== g.P.settlement) return;   // 쫓는 사람들은 자기 고장에서만 찾는다 (소문이 닿은 곳은 검문이 맡는다)
  const hm = ((next % 1440) + 1440) % 1440;
  const day = hm >= 6 * 60 && hm < 21 * 60;
  const l = g.W.loc.get(g.at) || {};
  const hidden = l.access === "secret" || l.outer;
  const p = hidden ? 0.08 : g.at === HOME ? 0.7 : day ? 0.45 : 0.15;
  if (hash(g.seed, "hunt", next) < p) {
    const by = [...w.by].find((n) => !g.S.dead.has(n));
    g.ended = { kind: "captured", why: `${nameOf(g, by)}의 사람들이 당신을 찾아냈다 — ${w.reasons.slice(-1)[0] || ""}`, t: next, trace: { id: "rope", npc: by } };
    g.feed.push({ kind: "rule", text: g.ended.why });
  }
}
function checkDanger(g) {
  if (g.ended) return;
  const w = g.S.wanted?.player;
  if (!w || w.heat < 2) return;
  const here = present(g).map((x) => x.npc);
  const hunter = [...w.by].find((n) => here.includes(n));
  const anyGuard = here.find((n) => profOf(g, n).role === "authority" && g.L.knowsAbout(n, "suspect", "player"));
  const who = hunter || anyGuard;
  if (who && w.heat >= 3) {
    g.ended = { kind: "captured", why: `${nameOf(g, who)}이(가) 당신을 붙잡았다 — ${w.reasons.slice(-1)[0] || ""}`, t: g.t, trace: { id: "rope", npc: who } };
    g.feed.push({ kind: "rule", text: g.ended.why });
  }
}

// ── 대본 장면 (content/base/storylets — 14 §6) ──
const SL = (g, id) => (g.content.game.storylets || []).find((x) => x.id === id);
function startStory(g) { const st = (g.content.game.storylets || []).find((x) => x.trigger?.start); if (st) openStory(g, st); }
function openStory(g, st) {
  if (st.once !== false && g.storyDone.has(st.id)) return;
  const needName = st.input === "true_name" && !trueName(g);
  g.story = { id: st.id, phase: needName ? "input" : "choice" };
  g.feed.push({ kind: "story", text: storyText(g, st, needName) });
  if (!needName) for (const e of st.effects || []) storyEffect(g, e);
}
function nextTrigger(g, t, next) {
  if (g.run.opening === false) return null;   // 대본 장면 없이 (검사용)
  for (const st of g.content.game.storylets || []) {
    const tr = st.trigger || {}; if (!tr.at_time || g.storyDone.has(st.id) || g.story) continue;
    const [d, hm] = tr.at_time.split(" "); const { y, m, d: dd } = parseDate(d);
    const at = toMinutes(y, m, dd) + parseClock(hm);
    if (at > t && at <= next && (!tr.at || g.at === tr.at)) return { t: at, st };
  }
  return null;
}
// 장면 글: 두 번째 회차부터 첫 줄 아래 속마음, 죽음의 흔적이 깨운 줄, 기억 잉크가 얹힌다 (14 §6.5)
function storyText(g, st, needName = false) {
  let paras = fill(g, st.text).split(/\n\s*\n/);
  if (g.run.loop >= 2 && st.return_text) {
    const heavy = Object.entries(st.return_heavy || {}).filter(([k]) => g.run.loop >= Number(k)).pop();
    if (heavy) paras[0] = heavy[1];
    const last = g.run.carry.deaths[g.run.carry.deaths.length - 1];
    const tl = last?.trace && st.trace_lines?.[last.trace.id];
    paras = [paras[0], `*${st.return_text}*`, ...(tl ? [tl] : []), ...paras.slice(1)];
  }
  let out = paras.join("\n\n");
  if (!needName && st.after_input) out += "\n\n" + fill(g, st.after_input);
  if (g.run.loop >= 2 && st.return_ink) out += "\n\n" + fill(g, st.return_ink);
  return out;
}
// 이름: 첫 회차에 받은 이름은 이 회차의 상태(P)에, 회귀할 때 carry로 넘어간다 (재생해도 이름 입력은 기록에서 다시 온다)
const trueName = (g) => g.P.trueName || g.run.carry.trueName || null;
const sibling = (g) => g.P.sibling || g.run.carry.sibling || "형";
const fill = (g, text) => String(text || "").trim().replace(/\{name\}/g, trueName(g) || "…").replace(/\{sibling\}/g, sibling(g))
  .replace(/\{record_full\}/g, () => { const r = soul(g).records.filter((x) => x.loop === g.run.loop - 1).pop(); return r ? recordCard(r).join("\n\n") : "…셀 것이 없다."; });
function storyOptions(g) {
  const st = SL(g, g.story.id);
  if (g.story.phase === "input") return [{ id: "story_name", kind: "story", label: "어머니가 부르는 이름", input: "true_name" }];
  const out = [];
  for (const c of st.choices || []) {
    // 두 번째 회차부터 어머니의 세 카드 중 고른 것만 진하다 — 다시 고를 수 없다 (14 §6.2)
    if (st.id === "serf_mother_memory" && g.P.talent && c.id !== `talent_${g.P.talent}`) continue;
    if (c.needs) { const [, k, op, v] = /^(\w+)\s*(>=|<=|>|<|==)\s*(\S+)$/.exec(c.needs) || []; if (k === "coin" && !(g.S.purse.player >= Number(v))) continue; }
    let memory = null;
    if (c.needs_memory) { memory = memoryOK(g, c.needs_memory); if (!memory) continue; memory = memMark(g, `story:${c.id}`, memory); }
    out.push({ id: `story:${c.id}`, kind: "story", label: c.label, skill: c.check?.skill || null, check: c.check || null, minutes: c.minutes || 0, memory });
  }
  if (!out.length) out.push({ id: "story:next", kind: "story", label: "▸" });
  return out;
}
// 기억 조건: loop (두 번째 회차부터) · fact:<id> (지난 회차에 안 사실) · trace:<id> (그 죽음을 겪었다)
function memoryOK(g, need) {
  if (g.run.loop < 2) return null;
  const [k, v] = String(need).split(":");
  if (k === "loop") return { loop: g.run.loop - 1 };
  if (k === "fact") return soul(g).knowledge[v] || g.run.carry.future.includes(v) ? { fact: v, loop: soul(g).knowledge[v]?.last || g.run.loop - 1 } : null;
  if (k === "trace") return (soul(g).traces || []).some((t) => t.id === v) ? { trace: v } : null;
  return null;
}
export function optionOdds(g, o) { return o.check ? storyOdds(g, o.check) : odds(g, o); }
function storyOdds(g, ck) {
  const p = g.P, mod = ck.skill === "은신" || ck.skill === "손재주" ? p.mods.민첩 * 2 : (p.mods.지능 + p.mods.감각) * 2;
  const status = -(p.status.hunger >= 2 ? 5 : 0) - (p.status.pain >= 30 ? 3 : 0);
  const S = (p.skills[ck.skill] || 10) + mod + status;
  return { P: prob(S, ck.D), S, D: ck.D, parts: [] };
}
function storyEffect(g, e, res) {
  const parts = String(e).split(/\s+/), k = parts[0], rest = String(e).slice(k.length + 1);
  if (k === "learn") learn(g, parts[1], "그 저녁");
  else if (k === "rel") { const [, n, field, v] = parts; bumpRel(g, n, field === "like" ? Number(v) : 0, field === "trust" ? Number(v) : 0); }
  else if (k === "var") { const [, name, , v] = parts; g.S.vars[name] = v === "true" ? true : v === "false" ? false : isNaN(Number(v)) ? v : Number(v); }
  else if (k === "coin") g.S.purse.player = Math.max(0, g.S.purse.player + Number(parts[1]));
  else if (k === "hunger") g.P.status.hunger = clamp(g.P.status.hunger + Number(parts[1]), 0, 4);
  else if (k === "pain") g.P.status.pain = clamp(g.P.status.pain + Number(parts[1]), 0, 100);
  else if (k === "item") { const good = g.content.game.economy.goods[parts[1]]; if (good) g.L.give("player", { ...good, id: `it_${parts[1]}_${g.run.journal.length}_${Math.floor(g.t % 1440)}`, gid: parts[1] }); }
  else if (k === "talent") { if (g.P.talent) return; g.P.talent = parts[1]; const T = { voice: { 화술: 6, 기만: 3 }, shadow: { 은신: 8, 손재주: 3 }, gunnar: { 싸움: 8, 손재주: 2 } }[parts[1]] || {}; for (const [sk, v] of Object.entries(T)) g.P.skills[sk] = (g.P.skills[sk] || 0) + v; }
  else if (k === "note") g.P.notebook.push(fill(g, rest));
  else if (k === "memory") { const [, n, tag] = parts; addMemory(g, n, { kind: "impression", tag, delta: 0, text: parts.slice(3).join(" "), salience: 4, source: "engine" }); }
  else if (k === "goto") g.at = parts[1];
  else if (k === "ration") { g.P.lastRation = Math.floor(g.t / 1440); g.P.status.hunger = clamp(g.P.status.hunger - 1, 0, 4); }
}

const DO = {
  // 이름: 어머니가 부르는 진짜 이름 (첫 회차에만 받는다 — 회귀해도 같은 이름, 20 R6)
  story_name(g, _, res, opt, e) {
    const [name, sibling] = String(e.text || "").split("|");
    g.P.trueName = (name || "").trim().slice(0, 12) || "…";
    g.P.sibling = sibling === "누나" ? "누나" : "형";
    const st = SL(g, g.story.id);
    g.story.phase = "choice";
    res.storyText = fill(g, st.after_input);
    for (const ef of st.effects || []) storyEffect(g, ef, res);
    if (!(st.choices || []).length && st.next) { g.storyDone.add(st.id); g.story = null; const nx = SL(g, st.next); if (nx) { openStory(g, nx); res.storyText += "\n\n" + g.feed.pop().text; } }
  },
  story(g, cid, res) {
    const st = SL(g, g.story.id);
    if (cid === "next") {
      g.storyDone.add(st.id); g.story = null;
      const nx = st.next && SL(g, st.next);
      if (nx) { openStory(g, nx); res.storyText = g.feed.pop()?.text; }
      return;
    }
    const c = (st.choices || []).find((x) => x.id === cid);
    let text = "", effects = [];
    if (c.check) { const ok = res.tier === "성공" || res.tier === "대성공"; const br = ok ? c.success : c.failure; text = br?.text || ""; effects = br?.effects || []; res.storyCheck = { skill: c.check.skill, tier: res.tier }; }
    else { text = c.text || ""; effects = c.effects || []; }
    for (const ef of effects) storyEffect(g, ef, res);
    for (const ef of st.after_all || []) storyEffect(g, ef, res);
    // 줄을 떠나는 선택: 키트가 자리를 맡는다. 15분 넘게 비우면 키트가 맞는다 (⏱가 진짜라는 첫 교훈, 14 §6.1)
    let extra = "";
    if (c.leave_line && st.after_choice) {
      extra = "\n\n" + st.after_choice.leave_line_text;
      if ((c.minutes || 0) > 15) { for (const ef of st.after_choice.late_effects || []) storyEffect(g, ef, res); extra += "\n\n돌아왔을 때 키트의 손등에 붉은 줄이 셋 있다. 즈닉이 출결 막대를 짚고 지나간다. \"두 자리 맡는 쥐새끼.\""; }
    }
    if (c.miss_ration) g.P.lastRation = Math.floor(g.t / 1440);   // 배식을 놓쳤다
    g.storyDone.add(st.id); g.story = null;
    res.storyText = fill(g, text) + extra;
    pass(g, c.minutes || 0);
    if (!g.story && st.next) { const nx = SL(g, st.next); if (nx) openStory(g, nx); }
    if (st.id === "ration_line_count" && c.id !== "stay_in_line" && !c.miss_ration && g.P.lastRation !== Math.floor(g.t / 1440)) {
      // 줄로 돌아와 빵을 받는다 (키트가 자리를 맡아 두었다)
      storyEffect(g, "ration", res);
    }
  },
  // ── 장면 ──
  talk(g, n, res) {
    const w = g.W.where(n, g.t);
    g.P.met.add(n);                    // 말을 섞으면 이름을 안다 (이름 모르던 사람도 — 대화에서 이름을 듣는다)
    g.convo = { npc: n, turns: 0, patience: 6 + Math.max(0, Math.round(relOf(g, n).like / 10)), transcript: [] };
    if (asleep(w, g.t)) { mind(g, n).anger += 1; res.notes.push(`${nameOf(g, n)}은(는) 자다 깼다`); }
    pass(g, 1);
  },
  go(g, to, res, opt) {
    const sneak = opt.skill === "은신";
    pass(g, Math.max(1, opt.minutes || 1));
    if (sneak && !OK(res.tier)) {
      const seen = g.L.player.trespass(g.t, to, res.tier === "대실패" ? 1 : 0.7);
      if (seen.length) deed(g, "trespass", null, to);
      res.notes.push(seen.length ? `들어가다 ${seen.map((n) => nameOf(g, n)).join(", ")}의 눈에 띄었다` : "발소리가 났지만 아무도 보지 못한 듯하다");
    }
    g.at = to;
    checkDanger(g);
  },
  wait(g, m) { pass(g, Number(m) || 60); },
  travel(g, sid, res, opt) {
    const from = g.P.settlement;
    g.P.traveling = true;
    pass(g, opt.minutes || 60);
    g.P.traveling = false;
    if (g.ended) return;
    g.P.settlement = sid; g.at = entryOf(g, sid); g._local = null;
    (g.P.visited ??= []).includes(sid) || g.P.visited.push(sid);
    g.L.setActive([sid]);
    res.notes.push(`${g.content.bundle.settlements[sid].name}에 닿았다`);
    if (from === SETTLEMENT && !g.P.leftHomeAt) g.P.leftHomeAt = g.t;
    checkpoint(g, res, 0.35);   // 낯선 인간은 들어서는 길목에서 붙잡히기 쉽다
  },
  routine_day(g, _, res) {
    const start = g.t, feedAll = [];
    const step = (fn) => { fn(); feedAll.push(...g.feed); };
    const ra = g.content.game.economy?.ration;
    // 1) 저녁 배급까지 (이미 지났으면 바로 막사로)
    const m = ((g.t % 1440) + 1440) % 1440;
    if (ra && m < parseClock(ra.to) - 10 && g.P.lastRation !== Math.floor(g.t / 1440)) {
      step(() => { g.at = "gf_rooster"; pass(g, Math.max(1, parseClock(ra.from) - m)); });
      if (!g.ended && present(g).some((w) => w.npc === "npc_bram")) step(() => { g.P.lastRation = Math.floor(g.t / 1440); g.P.status.hunger = clamp(g.P.status.hunger - 1, 0, 4); pass(g, 15); });
    }
    // 2) 통금 전에 막사로, 자고, 점호
    if (!g.ended && !g.story) step(() => { g.at = HOME; const c = fromMinutes(g.t); let wake = toMinutes(c.y, c.m, c.d, 4, 40); if (wake <= g.t) wake += 1440; pass(g, wake - g.t, { sleeping: true }); });
    if (!g.ended && !g.story && !isSabbath(Math.floor(g.t / 1440))) step(() => { pass(g, 5); g.at = ROLLCALL; pass(g, 20); });
    g.feed = feedAll;
    res.notes.push(`${fmt(start).slice(4, 16)}부터 ${fmt(g.t).slice(4, 16)}까지, 늘 하던 대로`);
  },
  sleep(g, _, res) {
    // 두 번째 회차부터, 첫 잠자리 전에 지난 회차를 센다 (14 §6.6)
    const cnt = SL(g, "count_before_sleep");
    if (cnt && g.run.loop >= (cnt.trigger?.first_sleep_loop || 2) && !g.storyDone.has(cnt.id) && soul(g).records.length && g.run.opening !== false) { openStory(g, cnt); res.storyText = g.feed.pop()?.text; return; }
    const c = fromMinutes(g.t);
    let wake = toMinutes(c.y, c.m, c.d, 4, 40); if (wake <= g.t) wake += 1440;
    pass(g, wake - g.t, { sleeping: true });
    if (g.story) return;               // 잠이 장면에 깼다 (첫 밤, 첫 종…)
    // 점호 날이면 막사 사람들과 함께 광장으로 끌려 나간다
    if (!isSabbath(Math.floor(g.t / 1440)) && g.at === HOME) { pass(g, 5); g.at = ROLLCALL; res.notes.push("첫 종. 막사 문이 열리고 모두 광장으로 밀려 나간다 — 점호"); pass(g, 20); }
  },
  search(g, _, res) {
    pass(g, 10);
    if (!OK(res.tier) && res.tier !== "부분 성공") { res.notes.push("아무것도 찾지 못했다"); return; }
    const found = [...g.L.items.values()].filter((i) => i.at === g.at && !i.worn && i.owner !== "player");
    for (const i of found) g.P.found.add(i.id);
    res.notes.push(found.length ? `찾았다: ${found.map((i) => i.name).join(", ")}` : "특별한 것은 없다");
  },
  take(g, id, res) {
    pass(g, 2);
    const it = g.L.items.get(id);
    if (it.stashed) { it.stashed = false; it.at = null; it.owner = "player"; }
    else g.L.player.takeFrom(g.t, g.at, id);
    if (it.coin) { g.S.purse.player += it.coin; g.L.items.delete(id); }
    res.notes.push(`${it.name}을(를) 챙겼다`);
  },
  stash(g, id, res) {
    pass(g, 10);
    let it;
    if (id === "coin") { const n = g.S.purse.player - 3; g.S.purse.player = 3; it = g.L.give("player", { id: `it_coin_${g.run.journal.length}`, name: `동전 ${n}못`, coin: n, tags: ["화폐"], value: n }); }
    else it = g.L.items.get(id);
    Object.assign(it, { at: g.at, worn: false, stashed: true });
    g.P.found.add(it.id);
    res.notes.push(`${it.name}을(를) ${placeName(g, g.at)} 어딘가에 숨겼다`);
  },
  attack(g, n, res) {
    pass(g, 2);
    if (OK(res.tier)) {
      const seen = g.L.player.kill(g.t, n, { at: g.at, stealth: res.tier === "대성공" ? 60 : 20 });
      deed(g, "kill", n);
      res.notes.push(`${nameOf(g, n)}이(가) 쓰러졌다. 움직이지 않는다`);
      if (seen.length) res.notes.push(`누군가 보았다: ${seen.map((x) => nameOf(g, x)).join(", ")}`);
    } else {
      g.L.player.assault(g.t, n, { at: g.at });
      deed(g, "assault", n);
      g.P.status.pain = clamp(g.P.status.pain + (res.tier === "대실패" ? 40 : 20), 0, 100);
      res.notes.push(`${nameOf(g, n)}을(를) 쓰러뜨리지 못했다`);
      if (res.tier === "대실패" && (cardOf(g, n).age ?? 30) >= 14 && (profOf(g, n).nerve >= 60 || worn(g, n).some((i) => i.tags?.includes("무기")) || g.P.status.pain >= 100)) { g.P.alive = false; g.ended = { kind: "dead", why: `${nameOf(g, n)}의 손에 죽었다`, t: g.t, trace: { id: "blade", npc: n } }; }
    }
    checkDanger(g);
  },
  loot(g, n, res) { pass(g, 5); const got = g.L.player.loot(g.t, n); res.notes.push(got.length ? `가져왔다: ${got.join(", ")}` : "남은 것이 없다"); },
  hide_body(g, n, res) { pass(g, 20); g.L.player.hideBody(g.t, n); res.notes.push("시체를 짚더미 밑에 밀어 넣었다"); },
  // ── 대화 ──
  small_talk(g, _, res) {
    const n = g.convo.npc;
    talkTurn(g, res, { 대성공: [6, 2], 성공: [4, 0], "부분 성공": [2, 0], 실패: [0, 0], 대실패: [-3, -1] });
    // 마음이 열리면 들은 소문을 하나 흘린다 (27 반응 층의 믿음에서)
    if (OK(res.tier)) {
      const hot = g.L.beliefs(n).filter((b) => b.heat > 0.3 && b.subject !== "player" && ["dead", "suspect", "missing", "saw_item"].includes(b.kind)).sort((a, b) => b.heat - a.heat)[0];
      if (hot) { const line = describeBelief(g, hot); if (!g.P.heard.has(line)) { g.P.heard.add(line); g.P.notebook.push(`${nameOf(g, n)}에게 들은 소문 — ${line}`); res.rumor = line; } }
    }
  },
  ask(g, topic, res) {
    const n = g.convo.npc, c = cardOf(g, n), m = mind(g, n);
    talkTurn(g, res, { 대성공: [2, 3], 성공: [1, 1], "부분 성공": [0, 0], 실패: [-1, -2], 대실패: [-3, -5] });
    if (!OK(res.tier) && res.tier !== "부분 성공") return;
    const about = (f) => topic === "요즘 마을 사정" || (g.content.facts[f]?.names || []).includes(topic);
    const open = (c.knows || []).filter((f) => about(f) && !g.P.knows.has(f));
    if (OK(res.tier) && open.length) { const f = open[Math.floor(hash(g.seed, "ask", res.roll) * open.length)]; learn(g, f, `${c.name}에게서 들었다`); m.toldPlayer.add(f); res.reveal = f; return; }
    // 숨긴 것: 공개 조건(22 §1.2)을 엔진이 판정한다
    const ctx = revealCtx(g, n, res.tier);
    for (const r of g.content.reveals[n] || []) {
      if (!about(r.fact) || m.revealed.has(r.fact)) continue;
      if (revealOK(r.alts, { ...ctx, topic }, r.fact)) { m.revealed.add(r.fact); m.toldPlayer.add(r.fact); learn(g, r.fact, `${c.name}이(가) 털어놓았다`); res.reveal = r.fact; return; }
      res.cover = r.cover; res.notes.push("무언가 숨긴다");
      return;
    }
    if (res.tier === "부분 성공") res.notes.push("말끝을 흐린다");
  },
  press(g, f, res) {
    const n = g.convo.npc, m = mind(g, n);
    if (isFuture(g, f)) { res.futureUsed.push(f); addMemory(g, n, { kind: "suspicion", tag: "이상함", text: "셋째가 알 리 없는 것을 안다", salience: 5, source: "engine" }); m.fear += 1; }
    if (OK(res.tier)) { m.fear += 2; bumpRel(g, n, -8, -10); m.revealed.add(f); learn(g, f, `${nameOf(g, n)}이(가) 겁에 질려 인정했다`); res.reveal = f; addMemory(g, n, { kind: "threat", tag: "위험함", text: "셋째가 내 비밀로 나를 겁박했다", salience: 5, source: "engine" }); }
    else { m.anger += res.tier === "대실패" ? 2 : 1; bumpRel(g, n, -5, -15); addMemory(g, n, { kind: "threat", tag: "위험함", text: "셋째가 내 비밀을 들먹였다", salience: 5, source: "engine" }); }
    endIfSpent(g, res, 1);
  },
  give(g, what, res) {
    const n = g.convo.npc;
    g.S.purse.player -= 12; g.S.purse[n] = (g.S.purse[n] || 0) + 12; mind(g, n).gifts = (mind(g, n).gifts || 0) + 12;
    talkTurn(g, res, { 대성공: [10, 5], 성공: [8, 3], "부분 성공": [4, 1], 실패: [1, 0], 대실패: [-2, 0] });
    addMemory(g, n, { kind: "debt", tag: "빚", text: "셋째가 돈을 쥐여 주었다", salience: 3, source: "engine" });
  },
  show(g, id, res) {
    pass(g, 2);
    const seen = g.L.player.show(g.t, id, g.at);
    if (g.L.items.get(id)?.tags?.includes("무기") && seen.some((x) => profOf(g, x).role === "authority")) deed(g, "weapon", null);
    const n = g.convo?.npc;
    const knew = n && g.L.beliefs(n).some((b) => b.kind === "saw_item" && b.item === id);
    res.notes.push(knew ? `${nameOf(g, n)}의 눈빛이 달라진다` : `${g.L.items.get(id).name}을(를) 꺼내 보였다`);
    if (n) endIfSpent(g, res, 1);
  },
  sell(g, id, res) {
    const n = g.convo.npc;
    pass(g, 3);
    const r = g.L.player.sell(g.t, id, n, g.at);
    res.notes.push(r.sold ? `${r.price}못을 받았다` : `${nameOf(g, n)}은(는) 사지 않는다`);
    if (r.knew) res.notes.push("누구 물건인지 알아본 눈치다");
    endIfSpent(g, res, 1);
  },
  buy(g, gid, res) {
    const n = g.convo.npc, good = g.content.game.economy.goods[gid], price = priceOf(g, n, gid);
    g.S.purse.player -= price; g.S.purse[n] = (g.S.purse[n] || 0) + price;
    const it = g.L.give("player", { ...good, id: `it_${gid}_${g.run.journal.length}`, value: good.price, gid });
    res.notes.push(`${good.name}을(를) ${price}못에 샀다`);
    if (good.illegal) g.S.threats.push({ by: n, target: "player", kind: "leverage", about: gid, t: g.t });   // 장물아비는 당신이 무엇을 샀는지 안다
    endIfSpent(g, res, 0.5);
  },
  use(g, id, res) {
    const it = g.L.items.get(id), fx = it.eat || it.use || {};
    if (fx.hunger) g.P.status.hunger = clamp(g.P.status.hunger + fx.hunger, 0, 4);
    if (fx.pain) g.P.status.pain = clamp(g.P.status.pain + fx.pain, 0, 100);
    g.L.items.delete(id);
    res.notes.push(`${it.name}을(를) ${it.eat ? "먹었다" : "썼다"}`);
    pass(g, 5);
  },
  ration(g, _, res) {
    g.P.lastRation = Math.floor(g.t / 1440);
    const f = g.content.game.economy.ration.food || {};
    g.P.status.hunger = clamp(g.P.status.hunger + (f.hunger || -1), 0, 4);
    res.notes.push("귀리죽 한 국자. 묽다. 그래도 따뜻하다");
    pass(g, 15);
  },
  leave(g, _, res) { res.ending = true; res.convoEnded = g.convo; g.convo = null; pass(g, 1); },
  regress(g) { /* 서버가 newRun으로 처리한다 */ },
};
function talkTurn(g, res, table) {
  const n = g.convo.npc, [like, trust] = table[res.tier] || [0, 0];
  bumpRel(g, n, like, trust);
  if (like || trust) res.changes.push(`호감 ${like >= 0 ? "+" : ""}${like}, 신뢰 ${trust >= 0 ? "+" : ""}${trust}`);
  if (res.tier === "대실패") mind(g, n).anger += 1;
  endIfSpent(g, res, 1);
}
function endIfSpent(g, res, cost) {
  g.convo.turns++; g.convo.patience -= cost;
  pass(g, 5);
  if (g.convo && (g.convo.patience <= 0 || mind(g, g.convo.npc).anger >= 3)) { res.ending = true; res.convoEnded = g.convo; g.convo = null; res.notes.push("상대가 등을 돌린다 — 이야기는 끝났다"); }
}
function revealCtx(g, n, tier) {
  const r = relOf(g, n);
  const toldBy = new Set(Object.entries(g.M).filter(([k, m]) => k !== n && m.toldPlayer.size).map(([k]) => k));
  const m = mind(g, n);
  const flags = new Set(Object.keys(g.S.vars).filter((k) => g.S.vars[k] === true && /^(trial|story):/.test(k)));
  return { npc: n, trust: r.trust, like: r.like, tier, dead: g.S.dead, toldBy, scene: null, offer: false, flags,
    dejaVu: (g.run.loop - 1) * 10,                                                     // 시간에 민감한 존재의 기시감 (03 §7) — 회차마다 쌓인다
    echoKnown: m.memories.some((x) => x.tag === "이상함") && (g.run.loop > 1), gifts: m.gifts || 0 };
}
function describeBelief(g, b) {
  const N = (x) => nameOf(g, x);
  if (b.kind === "suspect") return `${N(b.subject)}이(가) ${N(b.object)}을(를) 해쳤다는 말이 있다`;
  if (b.kind === "dead") return `${N(b.object)}이(가) 죽었다`;
  if (b.kind === "missing") return `${N(b.object)}이(가) 며칠째 보이지 않는다`;
  if (b.kind === "saw_item") return `${N(b.subject)}이(가) ${g.L.items.get(b.item)?.name}을(를) 가지고 다닌다`;
  return b.kind;
}

// ── 기억 (21 §6) ──
const KINDS = ["fact_learned", "claim", "impression", "emotion", "promise", "debt", "threat", "suspicion", "learned"];
export const IMPRESSION_TAGS = ["영리함", "위험함", "정직함", "거짓말쟁이", "다정함", "비굴함", "용감함", "이상함", "쓸모 있음", "짐"];
// 기록 하나를 세계에 — 기억은 마음에, 약속은 일정에, 주장은 믿음(소문)에, 들은 사실은 지식에
function applyRecord(g, n, mem) {
  addMemory(g, n, mem);
  if (mem.promise && !g.S.dead.has(n)) {
    g.W.override({ npc: n, from: mem.promise.from, to: mem.promise.to, kind: "at", at: mem.promise.place, doing: `셋째와 약속한 대로 기다린다 — ${mem.promise.what}` });
    g.P.notebook.push(josa(`${nameOf(g, n)}과(와)의 약속 — ${fmt(mem.promise.from)}, ${placeName(g, mem.promise.place)}: ${mem.promise.what}`));
  }
  if (mem.claim?.believed) {
    // 믿은 주장은 그 NPC의 믿음이 된다 → 사람이 모이는 곳에서 소문으로 퍼진다 (27 §3.4)
    g.L.believe(n, g.t, { kind: "claim", subject: mem.claim.about || "unknown", content: mem.claim.content, source: "player", heat: 1.2 }, { react: false });
  }
  if (mem.fact) { if (!g.S.knows.has(mem.fact)) g.S.knows.set(mem.fact, new Set()); g.S.knows.get(mem.fact).add(n); }   // 목표 행동의 knows 조건이 열린다
}
function addMemory(g, n, mem) {
  const m = mind(g, n);
  m.memories.push(mem);
  if (mem.kind === "impression" && mem.tag) {
    m.impressions[mem.tag] = clamp((m.impressions[mem.tag] || 0) + (mem.delta || 0), -20, 20);
    // 인상은 관계 수치로 이어진다 — 반응 층(27)이 "고발할까 침묵할까"를 정할 때 이 마음을 쓴다
    const good = ["영리함", "정직함", "다정함", "용감함", "쓸모 있음"].includes(mem.tag), bad = ["위험함", "거짓말쟁이", "비굴함", "짐"].includes(mem.tag);
    if (good) bumpRel(g, n, mem.delta || 0, Math.round((mem.delta || 0) / 2));
    if (bad) bumpRel(g, n, -Math.abs(mem.delta || 0), -Math.abs(mem.delta || 0));
  }
  const slots = { S: 60, A: 30, B: 12 }[cardOf(g, n).tier] || 8;
  if (m.memories.length > slots) { m.memories.sort((a, b) => (b.salience || 0) - (a.salience || 0)); m.memories.length = slots; }
}
// "방앗간" → gf_mill (이름의 일부로 찾는다)
function resolvePlace(g, name) {
  const key = (x) => String(x || "").replace(/[\s'"]/g, "");
  const n = key(name);
  if (!n) return null;
  const cands = [...g.W.loc].filter(([, l]) => l.settlement === g.P.settlement && l.name);
  // 정확히 같은 이름 → 이름에 들어 있는 것 중 가장 짧은 것(건물이 방보다 먼저) → 이름의 앞부분이 들어 있는 것
  const exact = cands.find(([, l]) => key(l.name) === n) || cands.find(([, l]) => (l.aka || []).some((a) => key(a) === n));
  if (exact) return exact[0];
  const inName = cands.filter(([, l]) => key(l.name).includes(n)).sort((a, b) => (a[1].parent ? 1 : 0) - (b[1].parent ? 1 : 0) || key(a[1].name).length - key(b[1].name).length);
  if (inName.length) return inName[0][0];
  const part = cands.find(([, l]) => n.includes(key(l.name).split("·")[0]));
  return part ? part[0] : null;
}
// "내일 정오", "오늘 밤", "모레 새벽 다섯 시" → 절대 시각
const NUMK = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12 };
export function resolveWhen(text, t) {
  const s = String(text || "");
  const day = Math.floor(t / 1440) + (/모레/.test(s) ? 2 : /내일/.test(s) ? 1 : 0);
  let h = null;
  const m = /(\d{1,2})\s*시/.exec(s) || new RegExp(`(${Object.keys(NUMK).sort((a, b) => b.length - a.length).join("|")})\\s*시`).exec(s);
  if (m) h = Number(m[1]) || NUMK[m[1]];
  const part = /새벽/.test(s) ? 5 : /아침/.test(s) ? 7 : /정오|한낮/.test(s) ? 12 : /오후|낮/.test(s) ? 15 : /저녁|해 질/.test(s) ? 19 : /자정/.test(s) ? 24 : /밤/.test(s) ? 22 : null;
  if (h == null) h = part;
  else if (part && part >= 15 && h < 12) h += 12;          // "저녁 일곱 시"
  if (h == null) return null;
  let at = day * 1440 + h * 60;
  if (at <= t) at += 1440;                                    // 이미 지난 시각이면 다음 날
  return at;
}
// LLM이 뽑은 기억 후보를 검증한다 → 받아들인 것만 기록(journal)에 들어간다
export function validateMemories(g, npc, transcript, cands, { t = g.t } = {}) {
  const norm = (s) => String(s).replace(/[\s"'“”‘’.,!?…·—-]/g, "");
  const T = norm(transcript.map((x) => x.text).join(""));
  const accepted = [], rejected = [], perTag = {};
  for (const c of cands || []) {
    const why = [];
    if (c.npc && c.npc !== npc) why.push("그 자리에 없던 인물");
    if (!KINDS.includes(c.kind)) why.push("모르는 종류");
    if (c.kind === "impression" && !IMPRESSION_TAGS.includes(c.tag)) why.push("허용되지 않은 인상");
    const ev = norm(c.evidence || "");
    let found = ev.length >= 4 && T.includes(ev);
    for (let i = 0; !found && i + 6 <= ev.length; i += 3) if (T.includes(ev.slice(i, i + 6))) found = true;
    if (!found) why.push("대화에 근거가 없음");
    if (why.length) { rejected.push({ ...c, why }); continue; }
    let delta = clamp(Number(c.delta) || 0, -5, 5);
    if (c.kind === "impression") { const used = perTag[c.tag] || 0; delta = clamp(delta, -5 - used, 5 - used); perTag[c.tag] = used + delta; }
    const mem = { kind: c.kind, tag: c.tag || null, delta, text: String(c.text || c.evidence).slice(0, 120), salience: clamp(Number(c.salience) || 2, 1, 5), source: "llm" };
    // 기록관의 제안 — 규칙을 거쳐 세계에 닿는다 (28 §6)
    if (c.kind === "promise" && c.promise) {
      const place = resolvePlace(g, c.promise.place), when = resolveWhen(c.promise.when, t);
      if (place && when) mem.promise = { place, from: when, to: when + 60, what: String(c.promise.what || "약속").slice(0, 60) };
      else mem.note = "약속의 장소·시각을 엔진이 알아듣지 못함 → 기억으로만";
    }
    if (c.kind === "claim" && c.claim) {
      const about = g.content.names[String(c.claim.about || "").trim()] || null;
      mem.claim = { about, content: String(c.claim.content || "").slice(0, 80), believed: !!c.claim.believed };
    }
    if (c.kind === "learned") {
      // 플레이어가 그 NPC에게 말해 준 사실 — 플레이어가 아는 사실이어야 한다
      if (!c.fact || !knowsFact(g, c.fact)) { rejected.push({ ...c, why: ["플레이어가 모르는 사실 ID"] }); continue; }
      const card = cardOf(g, npc);
      if ((card.knows || []).includes(c.fact) || (card.hides || []).some((h) => h.fact === c.fact) || g.S.knows.get(c.fact)?.has(npc)) { rejected.push({ ...c, why: ["그 NPC는 이미 아는 사실 — 들은 게 아니다"] }); continue; }
      mem.fact = c.fact;
    }
    accepted.push(mem);
  }
  return { accepted, rejected };
}

// ── 회귀 (03): 세계는 처음으로, 영혼(기억·이름·재능·아는 사람)은 남는다 ──
export function regressRun(g) {
  const carry = g.run.carry;
  const notebook = [...carry.notebook, ...g.P.notebook.map((n) => (n.startsWith("◇") ? n : `◇ ${g.run.loop}회차 — ${n}`))];
  const future = [...new Set([...carry.future, ...g.P.knows])];
  const record = loopRecord(g);
  const deaths = [...carry.deaths, ...(g.ended ? [{ loop: g.run.loop, ...g.ended, t: g.t, at: g.at }] : [])];
  // 이름과 재능은 영혼의 것 — 회귀해도 남는다 (WORLD_BIBLE §1.3.1, 06)
  return newRun({ seed: g.run.seed, loop: g.run.loop + 1, carry: { notebook: notebook.slice(-200), future, deaths, trueName: trueName(g), sibling: sibling(g), talent: g.P.talent || carry.talent || null, soul: settleSoul(g, record) } });
}
// 이번 회차를 영혼에 정산한다 — 관계는 수치가 아니라 '그 회차에 어떤 사이였나'로 (03 §4.1, 08 §5)
function settleSoul(g, record) {
  const old = soul(g), loop = g.run.loop;
  const S = JSON.parse(JSON.stringify(old));
  for (const f of g.P.knows) { const k = (S.knowledge[f] ??= { first: loop, last: loop, seen: 0 }); k.last = loop; k.seen += 1; }
  for (const n of g.P.met) {
    const r = relOf(g, n), m = mind(g, n);
    const impressions = Object.entries(m.impressions || {}).filter(([, v]) => Math.abs(v) >= 2).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([k, v]) => (v > 0 ? k : `${k}(아님)`));
    const lines = [...(m.memories || [])].filter((x) => x.source !== "engine" || x.salience >= 4).sort((a, b) => (b.salience || 0) - (a.salience || 0)).slice(0, 3).map((x) => x.text);
    const told = [...(m.revealed || [])];
    const P = (S.people[n] ??= { loops: [] });
    P.loops = [...P.loops.filter((x) => x.loop !== loop), { loop, like: r.like, trust: r.trust, impressions, lines, told, died: g.L.bodies.some((b) => b.npc === n) || !!g.S.dead?.has?.(n) }].slice(-6);
  }
  S.places = [...new Set([...(S.places || []), ...g.P.been])];
  S.obs = g.P.obs || {};                       // 지난 회차의 같은 날·같은 30분에 누가 어디 있었나 (◇ 표류를 알아본다)
  if (g.ended?.trace) {                        // 죽음의 흔적: 같은 흔적을 또 얻으면 단계가 오른다
    const tr = g.ended.trace, old = (S.traces ||= []).find((x) => x.id === tr.id && (x.npc || null) === (tr.npc || null));
    if (old) old.level = Math.min(3, (old.level || 1) + 1); else S.traces.push({ id: tr.id, npc: tr.npc || null, name: TRACE_TEXT[tr.id]?.name || tr.id, level: 1, loop });
  }
  S.memUsed ||= {};
  for (const id of g.P.memUsed || []) S.memUsed[id] = [...(S.memUsed[id] || []), loop].slice(-5);
  S.records = [...S.records, record].slice(-30);
  S.unlocked = [...new Set([...S.unlocked, ...unlockedNow(g)])];
  S.furthest = Math.max(S.furthest || START, g.t);
  return S;
}
// 회차 기록 (03 §5.1, 14 §6.6): 기간·끝·가져온 것·두고 온 것
export function loopRecord(g) {
  const days = Math.max(0, Math.floor((g.t - START) / 1440));
  const learned = [...g.P.knows].filter((f) => !soul(g).knowledge[f]);
  const moved = [...g.P.met].map((n) => ({ n, r: relOf(g, n) })).filter(({ r }) => Math.abs(r.like) + Math.abs(r.trust) >= 20)
    .sort((a, b) => Math.abs(b.r.like) + Math.abs(b.r.trust) - Math.abs(a.r.like) - Math.abs(a.r.trust)).slice(0, 4)
    .map(({ n, r }) => ({ npc: n, name: nameOf(g, n), how: r.like + r.trust >= 0 ? "가까워졌다" : "멀어졌다" }));
  const tr = g.ended?.trace;
  return {
    loop: g.run.loop, days, endT: g.t, end: fmt(g.t), at: placeName(g, g.at),
    kind: g.ended?.kind || "alive", why: g.ended?.why || null,
    chain: causeChain(g), trace: tr ? TRACE_TEXT[tr.id]?.name || tr.id : null, rewind: rewindDates(g.t),
    learned: learned.length, keyFacts: learned.slice(-2).map((f) => g.content.facts[f]?.text).filter(Boolean),
    leftBehind: moved, coin: g.S.purse.player, deeds: g.deeds.map((d) => d.kind).slice(-3),
    goals: goals(g).map((x) => `${x.who}: ${x.what}`),
  };
}
// 원인 사슬 (14 §6.6, 16 메아리 형식 — 평가어 없이): 마지막에 한 일부터 거꾸로 셋
function causeChain(g) {
  // 같은 행동이 이어지면 하나로 ('— 세 번')
  const runs = [];
  for (const x of (g.P.acts || []).slice().reverse()) { const last = runs[runs.length - 1]; if (last && last.label === x.label) last.n++; else runs.push({ label: x.label, n: 1 }); }
  const acts = runs.slice(0, 3);
  if (!acts.length) return g.ended?.why ? `${g.ended.why}.` : "";
  const CNT = ["", "", "두", "세", "네", "다섯", "여섯", "일곱", "여덟"];
  const [a, b, c] = acts.map((x) => { const p = pastTense(x.label); return x.n > 1 ? `${p.replace(/\.$/, "")} — ${CNT[x.n] || x.n} 번.` : p; });
  return `너는 ${a}${b ? ` 그 전에 ${b}` : ""}${c ? ` 그 전에 ${c}` : ""}`.replace(/\.\s*그 전에/g, ". 그 전에");
}
// 선택지 문장(현재형)을 과거형으로 — 자주 나오는 끝말만. 모르는 끝은 그대로 두고 '했다'를 붙이지 않는다
const PAST = [["덤벼든다", "덤벼들었다"], ["묻는다", "물었다"], ["걷는다", "걸었다"], ["건다", "걸었다"], ["눕는다", "누웠다"], ["받는다", "받았다"], ["먹는다", "먹었다"], ["숨긴다", "숨겼다"], ["챙긴다", "챙겼다"], ["뒤진다", "뒤졌다"], ["본다", "보았다"], ["보인다", "보였다"], ["기다린다", "기다렸다"], ["보낸다", "보냈다"], ["떠난다", "떠났다"], ["건넨다", "건넸다"], ["붙인다", "붙였다"], ["끝낸다", "끝냈다"], ["쫓아간다", "쫓아갔다"], ["간다", "갔다"], ["온다", "왔다"], ["잔다", "잤다"], ["산다", "샀다"], ["쓴다", "썼다"], ["선다", "섰다"], ["판다", "팔았다"], ["잡는다", "잡았다"], ["한다", "했다"], ["대답한다", "대답했다"], ["준다", "주었다"], ["올린다", "올렸다"], ["끌어내린다", "끌어내렸다"], ["조아린다", "조아렸다"], ["내려간다", "내려갔다"], ["말한다", "말했다"], ["든다", "들었다"]];
function pastTense(label) {
  let t = String(label || "").replace(/\s*\([^)]*\)/g, "").replace(/\s*—.*$/, "").trim();
  for (const [a, b] of PAST.sort((x, y) => y[0].length - x[0].length)) if (t.endsWith(a)) return t.slice(0, -a.length) + b + ".";
  return t.endsWith(".") ? t : `${t}.`;
}
// 되감기 날짜 (14 §4.1 ④): 60일 이하는 날, 그보다 길면 달. 마지막 줄은 언제나 낙엽월 1일
function rewindDates(t) {
  const out = [], days = Math.floor((t - START) / 1440);
  if (days <= 60) for (let d = days; d >= 0; d--) { const c = fromMinutes(START + d * 1440); out.push(`${MONTHS[c.m - 1]} ${c.d}일`); }
  else { const seen = new Set(); for (let d = days; d >= 0; d -= 5) { const c = fromMinutes(START + d * 1440); const k = `${MONTHS[c.m - 1]}`; if (!seen.has(k)) { seen.add(k); out.push(k); } } out.push("낙엽월 1일"); }
  return out;
}
const DAYS_KO = ["", "하루", "이틀", "사흘", "나흘", "닷새", "엿새", "이레", "여드레", "아흐레"];
const TENS_KO = ["", "열", "스무", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
export function koDays(n) { if (n >= 100) return `${n}일`; const t = Math.floor(n / 10), u = n % 10; if (!u) return t === 1 ? "열흘" : `${TENS_KO[t]}날`; return `${TENS_KO[t]}${DAYS_KO[u]}`; }
const ORD_KO = ["", "첫", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
export const koOrdinal = (n) => (n <= 10 ? `${ORD_KO[n]} 번째` : `${TENS_KO[Math.floor(n / 10)]}${["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"][n % 10]} 번째`);
// 회차 기록 카드 (14 §6.6) — 문단 = 한 박자. short: 첫 죽음의 세 줄
export function recordCard(r, { short = false } = {}) {
  const end = r.end.split(" ").slice(2, 4).join(" ");
  const head = `낙엽월 1일 저녁부터 ${koDays(r.days + 1)}.`;
  const cut = (x, n) => { const t = x.replace(/\s*\([^)]*\)/g, "").split(/[.,—]/)[0].trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  const carry = [r.trace, ...(r.keyFacts || []).map((x) => cut(x, 30))].filter(Boolean);
  if (short) return [head, r.chain || r.why || "", carry.length ? `가져가는 것 — ${carry.slice(0, 2).join(". ")}.` : ""].filter(Boolean);
  const lines = [`${koOrdinal(r.loop)} 저녁부터\n낙엽월 1일 — ${end} (${koDays(r.days + 1)})`];
  if (r.chain) lines.push(`"${r.chain}"`);
  lines.push(`── 가져온 것 ──\n기억 ${r.learned}${r.keyFacts?.length ? ` (${r.keyFacts.map((x) => cut(x, 24)).join(" · ")})` : ""}${r.trace ? `\n죽음 — ${r.trace}` : ""}`);
  const left = (r.leftBehind || []).map((x) => `${x.name} — ${x.how === "가까워졌다" ? "너와 가까워졌다. 기억하지 못한다." : "너를 멀리했다. 그것도 잊었다."}`);
  lines.push(`── 두고 온 것 ──\n${[...left, `너 — 동화 ${r.coin}못${r.deeds?.length ? ", 손에 남았던 것들" : ""}. 그 밤은 이제 없다.`].join("\n")}`);
  return lines;
}

// 해금 (14 §8): 처음 15분엔 다섯 개만. 이번 회차에 일어난 일 + 영혼에 남은 해금
function unlockedNow(g) {
  const u = new Set(soul(g).unlocked);
  if (g.P.notebook.length || g.run.carry.notebook.length) u.add("notebook");
  if (g.P.met.size) u.add("people");
  if (mine(g).length) u.add("items");
  if ((g.S.wanted?.player?.heat || 0) > 0) u.add("wanted");
  if (g.deeds.length) u.add("reputation");
  if (g.run.loop >= 2) { u.add("loop"); u.add("memory"); }
  if (g.P.settlement !== SETTLEMENT || g.P.been.size >= 3) u.add("map");
  return [...u];
}

// 값: 기본값 × 흥정(호감·신뢰 ±20%) × 흉년(굶주림월 먹을 것 ×3) × 장물(불법 ×2)
function priceOf(g, n, gid) {
  const good = g.content.game.economy.goods[gid], r = relOf(g, n);
  const haggle = 1 - clamp((r.like * 0.6 + r.trust * 0.4) / 250, -0.2, 0.2);
  const famine = fromMinutes(g.t).m === 12 && good.tags?.includes("음식") ? 3 : 1;
  return Math.max(1, Math.round(good.price * haggle * famine * (good.illegal ? 2 : 1)));
}
// 점호 몸수색 (14 §0:14 — 첫 회차는 반드시 플레이어, 그 뒤는 셋 중 하나): 숨길 수 있는 것은 손재주로 숨긴다.
// 은화(12못 이상)는 절도 의심으로 빼앗기고, 무기·위조 문서는 죄가 된다
function rollcallSearch(g, day) {
  const searched = g.run.loop === 1 && day === Math.floor(START / 1440) + 1 ? true : hash(g.seed, "search", day) < 1 / 3;
  if (!searched) return;
  const found = [];
  for (const it of mine(g)) {
    const hideable = it.tags?.includes("숨길수있음") || it.visibility === "숨김";
    const P = hideable ? prob(g.P.skills.손재주 + g.P.mods.민첩 * 2 + 8, 20) : 0.05;
    if (hash(g.seed, "frisk", day, it.id) >= P) found.push(it);
  }
  const coin = g.S.purse.player;
  let text = "크릭 감독이 당신의 옷과 부츠를 뒤진다.";
  if (coin >= 12 && hash(g.seed, "frisk-coin", day) >= prob(g.P.skills.손재주 + 8, 18)) {
    g.S.purse.player = 0; g.S.purse[overseer(g)] = (g.S.purse[overseer(g)] || 0) + coin;
    text += ` 동전 ${coin}못이 나왔다 — 인간이 은화를? 즈닉이 가져가고 채찍 다섯.`;
    g.P.status.pain = clamp(g.P.status.pain + 10, 0, 100);
  }
  for (const it of found) {
    g.L.items.delete(it.id);
    if (it.tags?.includes("무기") || it.illegal) {
      const w = (g.S.wanted.player ??= { heat: 0, by: new Set(), reasons: [] });
      w.heat += 3; w.since ??= g.t; w.by.add(overseer(g)); w.reasons.push(`점호에서 ${it.name}이(가) 나왔다`);
      deed(g, "weapon", null);
      text += ` ${it.name}이(가) 나왔다. 광장이 조용해진다.`;
    } else text += ` ${it.name}을(를) 빼앗겼다.`;
  }
  if (!found.length && !(coin >= 12)) text += " 아무것도 나오지 않았다.";
  g.feed.push({ kind: "rule", text: josa(text) });
}

// 플레이어가 아는 행방 (24 §3.6): 진짜 위치가 아니라 '늘 그 시각엔 거기' — 표류 없는 일과로 추정한다. 그래서 가끔 틀린다
let ESTIMATOR = null;
function estimate(g, n) {
  if (!ESTIMATOR || ESTIMATOR.bundle !== g.content.bundle) ESTIMATOR = { bundle: g.content.bundle, W: createWorld(g.content.bundle, { loopSeed: 0 }) };
  if (!n) return null;
  const w = ESTIMATOR.W.where(n, g.t);
  return w.kind === "away" ? "이 고장에 없을 것" : w.at ? `아마 ${placeName(g, w.at)}` : null;
}

// ── 평판 (10 · 21 §8) ──
function deed(g, kind, victim, at = g.at) {
  const k = classifyDeed(kind, victim ? profOf(g, victim) : {}, victim ? cardOf(g, victim) : {});
  g.deeds.push({ id: `d${g.deeds.length + 1}`, kind: k, victim, at, placeName: placeName(g, at), t: g.t });
}
// 행적을 아는 사람이 생긴 때(known)와 플레이어가 했다고 믿는 사람이 생긴 때(identified) — 반응 층의 믿음에서
function deedKnowledge(g, d) {
  let known = null, ident = null;
  for (const [, m] of g.S.beliefs || []) for (const b of m.values()) {
    const about = d.victim ? b.object === d.victim : (b.subject === "player" && b.at === d.at && b.t >= d.t);
    if (!about) continue;
    if (known == null || b.t < known) known = b.t;
    if (b.subject === "player" && (ident == null || b.t < ident)) ident = b.t;
  }
  return { ...d, knownAt: known, identifiedAt: ident };
}
export function reputation(g) { return g.rep.summary(g.deeds.map((d) => deedKnowledge(g, d)), g.t); }
// 처음 보는 사람이 나를 보는 눈 — 그 사람이 속한 집단의 시선 (화술 판정에 ±8까지)
function groupOf(g, n) {
  const c = cardOf(g, n), r = `${c.rank || ""} ${c.job || ""}`;
  if (/사제|순종|정화청/.test(r)) return "순종의 빛";
  if (/목줄|크릭|감독/.test(r) && !/농노/.test(c.rank || "")) return "목줄단";
  if (/사냥꾼|바르그/.test(r)) return "바르그 조합";
  if (/레이번|남작|영주가/.test(r)) return "영주가";
  if (/용인|귀족|가주/.test(r)) return "용인 귀족";
  if ((c.race || "인간").includes("인간")) return "인간 노예";
  return null;
}

// ── 장면 보기 (UI와 LLM이 같은 것을 본다 — 플레이어가 알 수 있는 것만) ──
// 화면과 서술에 쓰는 이름: 셋째가 이름을 아는 사람은 이름, 모르는 사람은 겉모습 구절 (content/base/npcs/public_*.yaml)
export function displayName(g, n) {
  const pub = g.content.game.public?.[n];
  if (pub && String(pub).startsWith("?") && !g.P.met.has(n) && !soulPerson(g, n) && !knownNames(g).has(nameOf(g, n))) return String(pub).slice(1).trim();
  return nameOf(g, n);
}
export function whoIs(g, n) { const pub = g.content.game.public?.[n]; return pub && !String(pub).startsWith("?") ? String(pub) : null; }
// 지킬 사람과 시한 (14 §1.1 "첫 1분에 시한과 지킬 사람이 생긴다")
function goals(g) {
  const out = [];
  const daysTo = (y, m, d) => Math.max(0, Math.ceil((toMinutes(y, m, d) - g.t) / 1440));
  if (g.S.vars.goal_kit_known) out.push({ who: "키트", what: g.S.vars.kit_sold ? "1차 호송에 끌려갔다" : g.S.vars.kit_on_list ? "1차 매각 명단 스물여섯째 줄 — 서리월 9일 호송" : "명단에서 빠졌다", days: g.S.vars.kit_on_list && !g.S.vars.kit_sold ? daysTo(312, 10, 9) : null });
  if (g.S.vars.goal_sara_known || g.P.knows.has("fact_gf_sara_on_sale_list")) out.push({ who: "사라", what: g.S.vars.sara_sold ? "2차 호송에 끌려갔다" : g.S.vars.sara_on_list ? "2차 매각 명단 — 굶주림월 3일 호송" : "명단에서 빠졌다", days: g.S.vars.sara_on_list && !g.S.vars.sara_sold ? daysTo(312, 12, 3) : null });
  return out;
}

// ── 지도 (07): 지금 고장의 건물 배치 + 대륙 지도. 플레이어가 가 본 곳·아는 곳만 밝게 ──
export function mapView(g) {
  const st = g.content.bundle.settlements[g.P.settlement];
  estimate(g, null);   // 추정기 준비
  // 아는 사람을 '늘 그 시각엔 거기' 자리에 찍는다 (24 §3.6 — 진짜 위치가 아니라 추정, 그래서 가끔 틀린다)
  const people = [...g.P.met].map((n) => { const w = ESTIMATOR.W.where(n, g.t); return { id: n, name: displayName(g, n), at: w?.kind === "at" ? w.at : null }; });
  const locs = (st?.locations || []).filter((l) => l.xy).map((l) => {
    const acc = locAccess(g, l.id, g.t);
    return { id: l.id, name: l.name, xy: l.xy, kind: l.kind || null, access: acc, here: g.at === l.id || g.W.loc.get(g.at)?.parent === l.id,
      secret: acc === "secret" && !g.P.knowsPlaces.has(l.id), people: people.filter((p) => p.at === l.id || g.W.loc.get(p.at)?.parent === l.id).map((p) => p.name) };
  }).filter((l) => !l.secret);
  const outer = (st?.outer || []).map((o) => ({ id: o.id, name: o.name, hours: o.hours }));
  const visited = new Set([SETTLEMENT, ...(g.P.visited || [])]);
  const nodeOfS = (sid) => g.content.bundle.settlements[sid]?.node;
  const visitedNodes = new Set([...visited].map(nodeOfS).filter(Boolean));
  const heard = new Set(); for (const f of g.P.knows) for (const n of g.content.bundle.map.nodes) if ((g.content.facts[f]?.text || "").includes(n.name)) heard.add(n.id);
  const nodes = g.content.bundle.map.nodes.map((n) => ({ id: n.id, name: n.name, x: n.x, y: n.y, major: !!n.major, here: n.id === nodeOfS(g.P.settlement), visited: visitedNodes.has(n.id), heard: heard.has(n.id) }));
  const exits = new Set(G_options_ids(g));
  return { settlement: { id: g.P.settlement, name: st?.name, grid: st?.grid || null, locations: locs, outer, goable: [...exits].filter((x) => x.startsWith("go:")).map((x) => x.slice(3)) },
    world: { nodes, edges: g.content.bundle.map.edges.map((e) => ({ from: e.from, to: e.to, road: e.road })), here: nodeOfS(g.P.settlement) } };
}
const G_options_ids = (g) => (g.story || g.convo || g.ended ? [] : rawOptions(g).map((o) => o.id));

// 지금 펼쳐진 대본 장면의 첫 글 (서버가 시작·불러오기 때 LLM 없이 보여 준다)
export function storyIntro(g) {
  if (!g.story) return null;
  const st = SL(g, g.story.id);
  return storyText(g, st, g.story.phase !== "choice");
}

export function view(g) {
  const c = fromMinutes(g.t);
  const people = present(g).map((w) => {
    const n = w.npc, r = relOf(g, n), m = mind(g, n);
    const aboutMe = g.L.beliefs(n).filter((b) => b.subject === "player" || (b.kind === "suspect" && b.subject === "player"));
    return {
      id: n, name: displayName(g, n), who: whoIs(g, n), doing: w.kind === "captive" ? "붙잡혀 있다" : w.doing, asleep: asleep(w, g.t),
      wears: worn(g, n).filter((i) => i.visibility === "보임").map((i) => i.name),
      mood: moodWords(r, m), aboutPlayer: aboutMe.map((b) => ({ kind: b.kind, choice: b.choice || null, reason: b.reason || null })),
    };
  });
  return {
    loop: g.run.loop, t: g.t, time: fmt(g.t), month: MONTHS[c.m - 1], hm: `${String(c.hh).padStart(2, "0")}:${String(c.mm).padStart(2, "0")}`,
    night: isNight(g.t), rain: g.W.rainy(Math.floor(g.t / 1440)),
    place: { id: g.at, name: placeName(g, g.at) }, people,
    bodies: bodiesHere(g).map((b) => nameOf(g, b.npc)),
    convo: g.convo ? { npc: g.convo.npc, name: nameOf(g, g.convo.npc), turns: g.convo.turns } : null,
    player: { ...g.P.status, coin: g.S.purse.player, items: mine(g).map((i) => ({ id: i.id, name: i.name })), wanted: g.S.wanted?.player?.heat || 0 },
    notebook: [...g.run.carry.notebook, ...g.P.notebook],
    ended: g.ended ? (() => { const r = loopRecord(g); return { ...g.ended, firstDeath: !g.run.carry.deaths.length, loop: g.run.loop, record: { short: recordCard(r, { short: true }), full: recordCard(r), rewind: r.rewind } }; })() : null,
    story: g.story ? { id: g.story.id, phase: g.story.phase } : null, goals: goals(g), trueName: trueName(g),
    people_known: [...new Set([...g.P.met, ...Object.keys(soul(g).people)])].map((n) => ({
      id: n, name: nameOf(g, n), who: whoIs(g, n), thisLoop: g.P.met.has(n),
      lastSeen: g.P.seen[n] ? `${fmt(g.P.seen[n].t).slice(7)} ${placeName(g, g.P.seen[n].at)}` : null, guess: estimate(g, n),
      mood: g.P.met.has(n) ? moodWords(relOf(g, n), mind(g, n)) : "이번 회차엔 아직 나를 모른다",
      past: (soulPerson(g, n)?.loops || []).map((x) => `${x.loop}회차: ${pastBond(x)}${x.impressions.length ? ` · 그는 나를 '${x.impressions.join("·")}'(으)로 보았다` : ""}${x.lines[0] ? ` · ${x.lines[0]}` : ""}${x.died ? " · 그 회차에 죽었다" : ""}`),
    })),
    unlocked: unlockedNow(g),
    reputation: (() => { const r = reputation(g); return { views: r.views, titles: r.titles, reach: r.reach, news: r.news.slice(-6) }; })(),
  };
}
const pastBond = (x) => { const s = x.like * 0.6 + x.trust * 0.4; return s >= 40 ? "깊이 믿는 사이였다" : s >= 20 ? "마음을 연 사이였다" : s >= 8 ? "나쁘지 않은 사이였다" : s <= -25 ? "원수였다" : s <= -10 ? "나를 믿지 않았다" : "스쳐 간 사이였다"; };
export function moodWords(r, m) {
  const s = r.like * 0.6 + r.trust * 0.4;
  if (m.anger >= 2) return "화가 나 있다";
  if (m.fear >= 3) return "겁을 먹었다";
  if (s >= 25) return "마음을 열었다";
  if (s >= 8) return "나쁘지 않게 본다";
  if (s <= -15) return "믿지 않는다";
  return "경계한다";
}

// ── 기록을 남기며 한 걸음 (서버가 부른다) ──
export function act(g, choice) {
  const e = { i: g.run.journal.length, kind: "act", id: choice.id, tags: choice.tags || [], text: choice.text || null };
  const res = apply(g, e);
  g.run.journal.push(e);
  return res;
}
export function recordMemories(g, npc, mems) {   // 기억과 기록관의 제안 모두 같은 기록으로
  if (!mems.length) return;
  const e = { i: g.run.journal.length, kind: "memory", npc, mems };
  apply(g, e); g.run.journal.push(e);
}
