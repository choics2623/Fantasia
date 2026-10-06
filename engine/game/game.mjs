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
import { fmt, toMinutes, fromMinutes, isSabbath, parseClock, MONTHS } from "../sim/calendar.mjs";
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
export function band(p) { return p >= 0.85 ? "거의 확실하다" : p >= 0.65 ? "해볼 만하다" : p >= 0.4 ? "반반이다" : p >= 0.2 ? "불리하다" : "무모하다"; }
export function tierOf(P, r) {
  if (r < P * 0.15) return "대성공";
  if (r < P) return "성공";
  if (r < P + (1 - P) * 0.35) return "부분 성공";
  if (r > 1 - (1 - P) * 0.15) return "대실패";
  return "실패";
}
const OK = (t) => t === "성공" || t === "대성공";

// ── 회귀점 (14 첫 시간, WORLD_BIBLE §1.3) ──
export const START = toMinutes(312, 9, 1, 18, 30);
const SETTLEMENT = "greyford";
const HOME = "gf_north_barracks";
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
export function newRun({ seed = 7, loop = 1, carry = null } = {}) {
  return { v: 1, seed, loop, journal: [], carry: carry || { notebook: [], future: [], deaths: [] } };
}
const loopSeed = (run) => Math.floor(hash(run.seed, "loop", run.loop) * 1e9);

// ── 재생: 기록으로 세계를 만든다 ──
export function boot(content, run) {
  const g = build(content, run);
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
  const g = {
    content, run, W, S, A, L, seed,
    t: START, at: "gf_rooster",
    P: { ...NEW_PLAYER(), alive: true, captured: false, knows: new Set(), met: new Set(), knowsPlaces: new Set(), found: new Set(), notebook: [], heard: new Set(), lastRollcall: null },
    M: {},             // NPC의 마음 (회차 안에서만): {fear, anger, memories[], impressions{}, revealed:Set, toldPlayer:Set}
    convo: null,       // {npc, turns, patience, transcript[]}
    ended: null,       // {kind: dead|captured, why}
    feed: [],          // 이번 턴에 플레이어가 겪은 일 (서술 재료)
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
const profOf = (g, n) => ({ perception: 50, nerve: 50, ...(g.content.game.sim.defaults_by_settlement?.[SETTLEMENT] || {}), ...(g.content.game.sim.profiles[n] || {}) });
const knowsFact = (g, f) => g.P.knows.has(f) || g.run.carry.future.includes(f);
const isFuture = (g, f) => g.run.carry.future.includes(f) && !g.P.knows.has(f);
function learn(g, f, how) {
  if (g.P.knows.has(f)) return false;
  g.P.knows.add(f);
  const text = g.content.facts[f]?.text || f;
  g.P.notebook.push(`${how} — ${text}`);
  // 사실에 장소 이름이 나오면 그 장소를 안다 (숨은 장소에 들어갈 수 있게)
  for (const [id, l] of g.W.loc) if (l.settlement === SETTLEMENT && l.name && text.includes(l.name.replace(/'.*'/, "").trim().split(" ")[0]) && (l.access === "secret")) g.P.knowsPlaces.add(id);
  if (f === "fact_gf_egil_family_in_cellar") g.P.knowsPlaces.add("gf_rooster_cellar");
  return true;
}

// ── 지금 장면 ──
function present(g, t = g.t) {
  return g.W.whoIsAt(g.at, t, g.W.npcs()).filter((w) => (w.kind === "at" || w.kind === "captive") && w.at === g.at && !g.S.dead.has(w.npc));
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
function mine(g) { return [...g.L.items.values()].filter((i) => i.owner === "player"); }
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
function exits(g) {
  const here = g.W.loc.get(g.at);
  const out = [];
  for (const [id, l] of g.W.loc) {
    if (l.settlement !== SETTLEMENT || id === g.at) continue;
    const isRoomHere = l.parent && (l.parent === g.at || l.parent === here?.parent);
    const isTop = !l.parent;
    if (!isTop && !isRoomHere) continue;
    if (l.outer && (l.node !== "greyford" && l.outerHours > 3)) continue;
    let a = locAccess(g, id, g.t);
    if (a === "secret" && !g.P.knowsPlaces.has(id)) continue;
    if (a === "locked") continue;
    out.push({ id, name: l.name, access: a, minutes: g.W.travelMinutes(g.at, id) });
  }
  return out.sort((x, y) => x.minutes - y.minutes);
}

// ── 할 수 있는 것 (어포던스) — LLM은 이 목록을 문장으로만 바꾼다 ──
export function options(g) { return rawOptions(g).map((o) => ({ ...o, label: josa(o.label) })); }
function rawOptions(g) {
  if (g.ended) return [{ id: "regress", kind: "regress", label: "눈을 감는다 — 회귀점으로" }];
  const o = [];
  if (g.convo) {
    const n = g.convo.npc, c = cardOf(g, n);
    o.push({ id: "small_talk", kind: "talk", label: `${c.name}에게 이런저런 말을 붙인다`, skill: "화술", request: -10 });
    for (const topic of topicsFor(g, n)) o.push({ id: `ask:${topic}`, kind: "talk", label: `${topic}에 대해 묻는다`, skill: "화술", request: 5, topic });
    for (const f of [...g.P.knows, ...g.run.carry.future]) {
      const hid = (g.content.reveals[n] || []).find((r) => r.fact === f);
      if (hid && !mind(g, n).revealed.has(f)) o.push({ id: `press:${f}`, kind: "talk", label: `${c.name}이 숨기는 것을 안다고 넌지시 말한다`, skill: "위압", request: 8, fact: f });
    }
    if (g.S.purse.player >= 12) o.push({ id: "give:coin", kind: "talk", label: "1 발톱(12못)을 건넨다", skill: "화술", request: -15 });
    for (const it of mine(g)) {
      o.push({ id: `show:${it.id}`, kind: "talk", label: `${it.name}을(를) 꺼내 보인다`, risk: "물건을 알아볼 수 있다" });
      if (profOf(g, n).role === "fence" || (it.value || 0) > 0) o.push({ id: `sell:${it.id}`, kind: "talk", label: `${it.name}을(를) 팔겠다고 한다` });
    }
    o.push({ id: "leave", kind: "talk", label: "이야기를 끝낸다" });
    return o;
  }
  for (const w of present(g)) {
    if (w.kind === "captive") continue;
    o.push({ id: `talk:${w.npc}`, kind: "scene", label: `${nameOf(g, w.npc)}에게 말을 건다${asleep(w, g.t) ? " (자고 있다)" : ""}`, npc: w.npc });
  }
  for (const w of present(g)) if (w.kind !== "captive") o.push({ id: `attack:${w.npc}`, kind: "scene", label: `${nameOf(g, w.npc)}에게 덤벼든다${hasWeapon(g) ? " (칼이 있다)" : " (맨손)"}`, skill: "싸움", npc: w.npc, risk: "죽을 수 있다" });
  for (const b of bodiesHere(g)) {
    const left = (g.S.purse[b.npc] || 0) > 0 || worn(g, b.npc).length;
    if (left) o.push({ id: `loot:${b.npc}`, kind: "scene", label: `${nameOf(g, b.npc)}의 시체를 뒤진다`, npc: b.npc });
    o.push({ id: `hide_body:${b.npc}`, kind: "scene", label: `${nameOf(g, b.npc)}의 시체를 숨긴다`, npc: b.npc });
  }
  o.push({ id: "search", kind: "scene", label: "이곳을 뒤져 본다", skill: "통찰" });
  for (const it of g.L.items.values()) if (it.at === g.at && !it.worn && it.owner !== "player" && g.P.found.has(it.id)) o.push({ id: `take:${it.id}`, kind: "scene", label: `${it.name}을(를) 챙긴다` });
  for (const e of exits(g)) {
    const sneak = ["owner", "staff", "closed", "secret", "home_locked"].includes(e.access) && !(e.id === HOME);
    o.push({ id: `go:${e.id}`, kind: "move", label: `${e.name}(으)로 간다${e.minutes ? ` (${e.minutes}분)` : ""}${sneak ? " — 몰래" : ""}`, minutes: e.minutes, skill: sneak ? "은신" : null, to: e.id });
  }
  o.push({ id: "wait:60", kind: "time", label: "한 시간 기다린다" });
  if (g.at === HOME || isNight(g.t)) o.push({ id: "sleep", kind: "time", label: g.at === HOME ? "침상에 눕는다" : "이곳에서 웅크리고 잔다" });
  return o;
}

export function knownNames(g) {
  const out = new Set();
  for (const f of [...g.P.knows, ...g.run.carry.future]) for (const nm of g.content.facts[f]?.names || []) out.add(nm);
  for (const n of g.P.met) { const nm = nameOf(g, n); out.add(nm); out.add(nm.split(/\s+/)[0]); }
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
export function odds(g, opt) {
  if (!opt.skill) return null;
  const p = g.P;
  const n = opt.npc || g.convo?.npc;
  const pr = n ? profOf(g, n) : { perception: 50, nerve: 50 };
  const m = n ? mind(g, n) : { fear: 0, anger: 0 };
  const r = n ? relOf(g, n) : { like: 0, trust: 0 };
  let S = p.skills[opt.skill] || 10, D = 10;
  const parts = [];
  const statMod = opt.skill === "싸움" ? (p.mods.근력 + p.mods.민첩) * 2 : opt.skill === "위압" ? (p.mods.의지 + p.mods.근력) * 2 : opt.skill === "은신" ? p.mods.민첩 * 2 : (p.mods.지능 + p.mods.감각) * 2;
  S += statMod;
  const status = -(p.status.hunger >= 2 ? 5 : 0) - (p.status.pain >= 30 ? 3 : 0) - (p.status.pain >= 60 ? 6 : 0);
  S += status;
  if (opt.skill === "화술" && n) { const grp = groupOf(g, n), v = grp ? (reputation(g).views[grp] || 0) : 0; if (v) { const b = clamp(Math.round(v * 0.3), -8, 8); S += b; parts.push(`${grp}의 시선 ${b >= 0 ? "+" : ""}${b}`); } }
  if (opt.skill === "화술") { S += Math.round(r.like * 0.3 + r.trust * 0.2); D += 5 + Math.round(pr.nerve / 10) + (opt.request || 0) + m.anger * 5 + m.fear * 2; }
  if (opt.skill === "위압") { D += Math.round(pr.nerve / 4) + (opt.request || 0) - m.fear * 4; if (opt.fact) S += Math.min(15, (g.content.facts[opt.fact]?.danger || 2) * 3); }
  if (opt.skill === "통찰") D += 18;
  if (opt.skill === "은신") { const watchers = g.W.whoIsAt(opt.to, g.t + (opt.minutes || 0), g.W.npcs()).filter((w) => w.kind === "at").length; D += 10 + watchers * 6 + (isNight(g.t) ? -6 : 4); parts.push(`지켜보는 눈 ${watchers}`); }
  if (opt.skill === "싸움") {
    const w = g.W.where(n, g.t);
    const armed = worn(g, n).some((i) => i.tags?.includes("무기"));
    D += 10 + Math.round(pr.nerve / 5) + (armed ? 8 : 0) + (profOf(g, n).role === "hunter" ? 12 : 0);
    if (hasWeapon(g)) { S += 10; parts.push("칼 +10"); }
    if (asleep(w, g.t)) { S += 20; parts.push("자는 상대 +20"); }
  }
  const P = prob(S, D);
  return { P, S: Math.round(S), D: Math.round(D), parts };
}

// ── 한 걸음: 기록 하나를 적용한다 (결정적) ──
// entry: {i, kind:'act', id, tags?, text?} | {i, kind:'memory', npc, mems:[...]} | {i, kind:'regress'}
export function apply(g, e, { replay = false } = {}) {
  g.feed = [];
  if (e.kind === "memory") { for (const m of e.mems) applyRecord(g, e.npc, m); return { kind: "memory" }; }
  const opt = options(g).find((o) => o.id === e.id);
  if (!opt) throw new Error(`지금은 할 수 없는 행동: ${e.id}`);
  const roll = hash(g.seed, "roll", e.i);
  const od = odds(g, { ...opt, tags: e.tags });
  const bonus = Math.min(25, (e.tags || []).reduce((s, t) => s + tagBonus(g, t), 0));
  const P = od ? prob(od.S + bonus, od.D) : 1;
  const tier = od ? tierOf(P, roll) : "성공";
  const res = { id: e.id, label: opt.label, kind: opt.kind, tier, P, roll, skill: opt.skill || null, changes: [], reveal: null, notes: [], futureUsed: [] };
  const [verb, arg] = e.id.split(/:(.*)/s);
  const before = g.t;
  DO[verb](g, arg, res, opt, e);
  successions(g);
  res.notes = res.notes.map(josa); res.label = josa(res.label);
  if (g.ended) g.ended.why = josa(g.ended.why);
  if (!replay) res.feed = g.feed.map((f) => ({ ...f, text: josa(f.text) }));
  return res;
}
const TAGS = {
  uses_fact: (g, v) => (knowsFact(g, v) ? Math.min(15, (g.content.facts[v]?.danger || 2) * 3) : 0),
  appeals_interest: () => 6, appeals_fear: () => 6,
  offers_item: (g, v) => (mine(g).some((i) => i.id === v) || (v === "coin" && g.S.purse.player > 0) ? 5 : 0),
};
function tagBonus(g, t) { const [k, v] = String(t).split(":"); return TAGS[k] ? TAGS[k](g, v) : 0; }

// 시간이 흐른다: 세계를 굴리고, 그 사이 플레이어 주변에서 일어난 일을 모은다
function pass(g, minutes, { sleeping = false } = {}) {
  const from = g.t, to = g.t + minutes;
  const logFrom = g.S.log.length;
  // 점호·통금은 시각에 걸리는 일이다 — 지나가는 시각마다 본다
  let t = from;
  while (t < to) {
    const next = Math.min(to, Math.floor(t / 30) * 30 + 30);
    g.L.advance(next);
    successions(g);
    const c = fromMinutes(next);
    const hm = c.hh * 60 + c.mm;
    // 점호 (04:45~05:00, 안식일 제외): 그 시각 광장에 없으면 즈닉이 안다
    if (hm === 5 * 60 && !isSabbath(c.day) && g.P.lastRollcall !== c.day && overseer(g) && !g.S.dead.has(overseer(g))) {   // 점호는 감독관 자리의 일 — 즈닉이 죽으면 이은 사람이, 공석이면 점호도 없다
      g.P.lastRollcall = c.day;
      if (g.at !== ROLLCALL) { g.S.vars.player_missed_rollcall = (g.S.vars.player_missed_rollcall || 0) + 1; g.feed.push({ kind: "rule", text: "새벽 점호에 나가지 않았다. 즈닉의 명단에 빈칸이 생겼다." }); }
    }
    // 통금 순찰 (21:00·23:00·02:00): 막사 밖에 있는 인간은 걸린다 — 은신 판정
    if (["21:00", "23:00", "02:00"].some((x) => parseClock(x) === hm) && g.at !== HOME && !g.W.loc.get(g.at)?.outer && !g.ended) {
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
  }
  g.t = Math.min(to, g.ended?.t ?? to);
  if (sleeping) { g.P.status.pain = clamp(g.P.status.pain - 10, 0, 100); }
  // 하루에 한 번 배가 고파진다 (배급을 받으면 준다)
  if (Math.floor(to / 1440) > Math.floor(from / 1440)) g.P.status.hunger = clamp(g.P.status.hunger + 1, 0, 4);
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

// 수배: 쫓는 윗선이 같은 자리에 있으면 붙잡힌다. 수배 3 이상이면 낮 동안 사람을 풀어 찾는다 —
// 막사·광장처럼 뻔한 곳은 금방, 숨은 곳(비밀 장소)·마을 밖은 느리게. 숨을 곳을 찾아 달아나는 것이 길이다
function manhunt(g, next) {
  const w = g.S.wanted?.player;
  if (!w || w.heat < 3 || g.ended || next - (w.since ?? next) < 60 || next % 60 !== 0) return;
  const hm = ((next % 1440) + 1440) % 1440;
  const day = hm >= 6 * 60 && hm < 21 * 60;
  const l = g.W.loc.get(g.at) || {};
  const hidden = l.access === "secret" || l.outer;
  const p = hidden ? 0.08 : g.at === HOME ? 0.7 : day ? 0.45 : 0.15;
  if (hash(g.seed, "hunt", next) < p) {
    const by = [...w.by].find((n) => !g.S.dead.has(n));
    g.ended = { kind: "captured", why: `${nameOf(g, by)}의 사람들이 당신을 찾아냈다 — ${w.reasons.slice(-1)[0] || ""}`, t: next };
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
    g.ended = { kind: "captured", why: `${nameOf(g, who)}이(가) 당신을 붙잡았다 — ${w.reasons.slice(-1)[0] || ""}`, t: g.t };
    g.feed.push({ kind: "rule", text: g.ended.why });
  }
}

const DO = {
  // ── 장면 ──
  talk(g, n, res) {
    const w = g.W.where(n, g.t);
    g.P.met.add(n);
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
  sleep(g, _, res) {
    const c = fromMinutes(g.t);
    let wake = toMinutes(c.y, c.m, c.d, 4, 40); if (wake <= g.t) wake += 1440;
    pass(g, wake - g.t, { sleeping: true });
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
  take(g, id, res) { pass(g, 2); g.L.player.takeFrom(g.t, g.at, id); res.notes.push(`${g.L.items.get(id).name}을(를) 챙겼다`); },
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
      if (res.tier === "대실패" && (profOf(g, n).nerve >= 60 || g.P.status.pain >= 100)) { g.P.alive = false; g.ended = { kind: "dead", why: `${nameOf(g, n)}의 손에 죽었다`, t: g.t }; }
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
  const cands = [...g.W.loc].filter(([, l]) => l.settlement === SETTLEMENT && l.name);
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
      mem.fact = c.fact;
    }
    accepted.push(mem);
  }
  return { accepted, rejected };
}

// ── 회귀 (03): 세계는 처음으로, 기억(수첩·알게 된 사실)은 남는다 ──
export function regressRun(g) {
  const carry = g.run.carry;
  const notebook = [...carry.notebook, ...g.P.notebook.map((n) => (n.startsWith("◇") ? n : `◇ ${g.run.loop}회차 — ${n}`))];
  const future = [...new Set([...carry.future, ...g.P.knows])];
  const deaths = [...carry.deaths, ...(g.ended ? [{ loop: g.run.loop, ...g.ended }] : [])];
  return newRun({ seed: g.run.seed, loop: g.run.loop + 1, carry: { notebook: notebook.slice(-200), future, deaths } });
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
export function view(g) {
  const c = fromMinutes(g.t);
  const people = present(g).map((w) => {
    const n = w.npc, r = relOf(g, n), m = mind(g, n);
    const aboutMe = g.L.beliefs(n).filter((b) => b.subject === "player" || (b.kind === "suspect" && b.subject === "player"));
    return {
      id: n, name: nameOf(g, n), doing: w.kind === "captive" ? "붙잡혀 있다" : w.doing, asleep: asleep(w, g.t),
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
    notebook: [...g.run.carry.notebook, ...g.P.notebook], ended: g.ended,
    reputation: (() => { const r = reputation(g); return { views: r.views, titles: r.titles, reach: r.reach, news: r.news.slice(-6) }; })(),
  };
}
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
