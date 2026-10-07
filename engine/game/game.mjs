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
import * as DIR from "./director.mjs";
import * as DOM from "./domain.mjs";

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
const skillFn = (g, sk) => skill(g, sk);
export function perceived(g, P, skill, key) {
  const sk = skillFn(g, skill), sense = 10 + g.P.mods.감각 * 2;
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
// ── 스킬 (01 §5 성장, 03 §3 수련 상한, 06 §4 몸의 상한) ──
// 머리의 스킬(화술·기만·위압·통찰)은 회귀해도 그대로. 몸의 스킬(싸움·은신·손재주)은 수치를 기억하지만 몸의 상한에 묶인다.
const BODY_STAT = { 싸움: (s) => (s.근력 + s.체질) / 2, 은신: (s) => s.민첩, 손재주: (s) => s.민첩 };
// 어머니가 기억하는 너 (14 §6.2) — 재능: 깨어날 때 한 번 얹히고, 그 스킬은 1.25배 빨리 자라며 상한이 5 높다 (06 §3)
const TALENT = { voice: { name: "말을 먼저 배운 아이", skills: { 화술: 6, 기만: 3 }, grow: ["화술", "기만"] }, shadow: { name: "발소리 없는 아이", skills: { 은신: 8, 손재주: 3 }, grow: ["은신", "손재주"] }, gunnar: { name: "군나르의 손", skills: { 싸움: 8, 손재주: 2 }, grow: ["싸움"] } };
// 화면에는 숫자 대신 구간 이름 (01 §4, 10 §8)
const VIEW_BANDS = [[-6, "적대"], [-2, "경계"], [2, "무심"], [6, "호의"], [Infinity, "존경"]];
const viewBand = (x) => VIEW_BANDS.find(([max]) => x <= max)[1];
const wantedWord = (h) => (h <= 0 ? null : h < 2 ? "눈에 띄었다" : h < 3 ? "이름이 적혔다" : h < 5 ? "쫓기고 있다" : "현상금");
const ROMANCE_WORDS = ["모르는 사이", "눈이 간다", "마음이 기운다", "연인", "끈혼례"];
const statsOf = (g) => ({ 근력: 9 + g.P.mods.근력 * 2, 민첩: 9 + g.P.mods.민첩 * 2, 체질: 9, 지능: 9 + g.P.mods.지능 * 2, 감각: 9 + g.P.mods.감각 * 2 });
// 재능들: 어머니가 기억하는 너 + 회귀 각성으로 깨어난 것 (영혼)
const talentsOf = (g) => [...new Set([g.P.talent, ...(g.run.carry.soul?.extraTalents || []), ...(g.P.awakened || [])].filter(Boolean))];
const talentGrows = (g, sk) => talentsOf(g).some((t) => TALENT[t]?.grow?.includes(sk));
const talentBonus = (g, sk) => talentsOf(g).reduce((a, t) => a + (TALENT[t]?.skills?.[sk] || 0), 0);
export function bodyCap(g, sk) { return BODY_STAT[sk] ? 15 + (BODY_STAT[sk](statsOf(g)) - 9) * 5 + g.P.train + (talentGrows(g, sk) ? 5 : 0) : Infinity; }
const rawSkill = (g, sk) => (g.P.skills[sk] ?? 10) + (g.P.gain?.[sk] || 0);
// 실제 쓰는 스킬 = 상한까지는 그대로, 넘는 만큼은 1/4 ("기술이 몸을 이끈다")
export function skill(g, sk) {
  let v = rawSkill(g, sk) + talentBonus(g, sk);
  const cap = bodyCap(g, sk);
  if (v > cap) v = cap + (v - cap) * 0.25;
  return v;
}
// 글과 말은 다른 말로 잰다 (19 §4 표의 구간)
const LETTER_WORD = (v) => (v < 1 ? "글을 모른다" : v < 10 ? "숫자만 읽는다" : v < 30 ? "이름과 짧은 말을 읽는다" : "글을 읽는다");
const TONGUE_WORD = (v) => (v < 1 ? "쇳소리로만 들린다" : v < 20 ? "아는 낱말만 들린다" : v < 50 ? "반쯤 알아듣는다" : "알아듣는다");
export const skillWord = (v) => (v < 12 ? "서툴다" : v < 20 ? "어설프다" : v < 30 ? "쓸 만하다" : v < 42 ? "제법이다" : v < 55 ? "능숙하다" : v < 70 ? "뛰어나다" : "경지에 닿았다");
// 판정 하나가 남기는 것: 난이도 × 위험 × (실패면 1.2) × 재능 × (1 − 스킬/상한)². 너무 쉬운 판정(D < 스킬−20)은 아무것도 가르치지 않는다
// 수련 방식 (03 §3.1): 안전한 연습은 40에서 멈춘다 · 실전(목숨이 걸린 판정)은 ×2, 상한 없음 · 스승은 스승 −10까지 ×2.5
const PRACTICE = { attack: { risk: 2, cap: 100 }, story: { risk: 2, cap: 100 }, op: { risk: 2, cap: 100 }, small_talk: { risk: 0.6, cap: 40 }, ask: { risk: 0.6, cap: 40 }, give: { risk: 0.4, cap: 40 }, press: { risk: 1, cap: 60 }, search: { risk: 0.3, cap: 25 } };
function growSkill(g, sk, od, tier, verb) {
  if (!sk || !od) return;
  const { risk, cap } = PRACTICE[verb] || { risk: 1, cap: 100 };
  const cur = rawSkill(g, sk), capT = cap + (talentGrows(g, sk) ? 5 : 0);
  if (od.D < cur - 20 || cur >= capT) return;
  const before = skillWord(skill(g, sk));
  const d = 0.12 * (Math.max(10, od.D) / 10) * risk * (OK(tier) ? 1 : 1.2) * (talentGrows(g, sk) ? 1.25 : 1) * (1 - cur / capT) ** 2;
  (g.P.gain ??= {})[sk] = (g.P.gain[sk] || 0) + d;
  // 몸의 스킬을 쓰면 몸도 단련된다. 지난 회차들의 최고치까지는 세 배 (근육 기억)
  if (BODY_STAT[sk]) g.P.train = Math.min(60, g.P.train + 0.12 * risk * (g.P.train < (soul(g).trainPeak || 0) ? 3 : 1));
  const after = skillWord(skill(g, sk));
  if (after !== before) g.feed.push({ kind: "grow", text: `${sk} — ${after}`, skill: sk });
}
const NEW_PLAYER = () => ({
  name: "셋째", age: 17,
  skills: { 화술: 22, 기만: 15, 위압: 8, 통찰: 18, 손재주: 12, 은신: 16, 싸움: 12, 읽고쓰기: 0, 용언: 0 },   // 노예의 아이는 글을 모른다 (19 §4)
  mods: { 근력: -0.5, 민첩: 0.5, 지능: 0.5, 감각: 1, 의지: 0 },
  status: { hunger: 2, pain: 30, fatigue: 20, fear: 0, stress: 30 },
  temper: { 용기: 0, 자비: 0, 정직: 0, 신앙: 0, 탐욕: 0, 충성: 0 },   // 성향 (01 §1.3): 행동으로 움직이고, ±60에 특성이 된다
  gain: {}, train: 5,        // 단련도: 들일로 굳은 몸 (06 §4.2) — 회귀하면 여기로
});

// ── 콘텐츠 ── (content/build/*.json + cards.json)
export function prepareContent({ bundle, cards, game }) {
  cards = { ...cards, ...(game.extraCards || {}) };   // C등급 (손으로 쓴 이름 없는 사람들)
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
  // 기시감 (10 §5.2): 시간에 닿은 세력은 회차를 넘어 낌새를 챈다 — 셋째 회차부터 잿빛 탑의 밀정이 일찍 온다
  if (run.loop >= 3) ((g.nem ??= {}).npc_isol ??= { grudge: 1, track: 0, since: START });
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
  // 시각만 쓰면 회귀점의 날, '날짜 시각'이면 그 날 (마르타의 뒷문 등)
  const stT = (x) => (String(x).includes(" ") ? (() => { const [d, hm] = String(x).split(" "); const { y, m, d: dd } = parseDate(d); return toMinutes(y, m, dd) + parseClock(hm); })() : day0 + parseClock(x));
  for (const st of game.storylets || []) for (const x of st.stage || []) W.override({ npc: x.npc, from: stT(x.from), to: stT(x.to), kind: "at", at: x.at, doing: x.doing });
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
  // 영혼이 기억하는 스킬 (머리는 그대로, 몸은 상한에 묶여서 — skill()이 처리한다)
  for (const [sk, v] of Object.entries((run.carry.soul || {}).skills || {})) g.P.skills[sk] = Math.max(g.P.skills[sk] || 0, v);
  // 스트레스 이월 (14 §4.3): 30 + (죽기 전 − 30) × 0.4 + 죽음 가산, 상한 70 · 성향은 영혼에 남는다 (01 §1.3)
  if (run.carry.soul?.stressCarry != null) g.P.status.stress = run.carry.soul.stressCarry;
  if (run.carry.soul?.temper) g.P.temper = { ...g.P.temper, ...run.carry.soul.temper };
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
const hasTag = (g, t) => mine(g).some((i) => i.tags?.includes(t)) || (t === "광원" && g.P.fireAt != null && g.t - g.P.fireAt <= 60);
// 몸의 자리 (02 §2): 손·허리는 보이고, 부츠·소매는 한 칸씩 숨기고, 품은 옷 안
const SLOTS = { 손: { seen: true }, 허리: { seen: true }, 품: { seen: false }, 부츠: { seen: false, one: true, hide: true }, 소매: { seen: false, one: true, hide: true } };
// NPC 인벤토리의 자리 이름(허리띠·목·손가락…)도 받아 다섯 자리로 접는다
const SLOT_ALIAS = { 허리띠: "허리", 등: "허리", 목: "품", 손가락: "품", 주머니: "품", 몸: "품", 머리: "품", 발: "부츠" };
const slotOf = (it) => SLOTS[it.slot] ? it.slot : SLOT_ALIAS[it.slot] || (it.tags?.includes("무기") && !it.tags?.includes("숨길수있음") ? "허리" : "품");
const visibleMine = (g) => mine(g).filter((i) => SLOTS[slotOf(i)]?.seen);
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
    const ac = g.content.game.access?.[id] || {};
    if (ac.climb && !ac.climb.every((t) => hasTag(g, t))) continue;      // 오를 것이 없다
    let via = null;
    if (ac.breach && ac.breach.tools.every((t) => hasTag(g, t)) && ["locked", "owner", "closed", "staff"].includes(a)) { via = ac.breach.how; if (a === "locked") a = "closed"; }
    if (a === "locked") continue;
    out.push({ id, name: l.name, access: a, via, minutes: g.W.travelMinutes(g.at, id) + (via ? 10 : 0) });
  }
  return out.sort((x, y) => x.minutes - y.minutes);
}

// ── 할 수 있는 것 (어포던스) — LLM은 이 목록을 문장으로만 바꾼다 ──
export function options(g) {
  // ◈는 한 화면에 셋까지 (14 §7.5) — 나머지는 접힌 줄로
  let mem = 0;
  return rawOptions(g).map((o) => ({ ...o, label: josa(o.label), ...(o.memory && ++mem > 3 ? { more: true } : {}) }));
}
// 잠긴 선택지 (GAME_DESIGN §2.4): 있는 줄은 아는데 지금은 못 하는 것 — 회색과 이유. 존재를 모르는 것은 보이지 않는다.
// 행동 목록(options)과 따로 둔다: 고를 수 없으니 기록·재생과 상관이 없다
export function lockedOptions(g) {
  if (g.ended || g.fight || g.op) return [];
  const out = [], add = (label, why) => out.push({ label: josa(label), why });
  if (g.story) {
    const st = SL(g, g.story.id);
    for (const c of st.choices || []) {
      if (c.when && !storyWhen(g, c.when)) continue;   // 조건 자체를 모르는 선택지는 숨긴다
      if (c.needs) { const [, k, , v] = /^(\w+)\s*(>=|<=|>|<|==)\s*(\S+)$/.exec(c.needs) || []; if (k === "coin" && !(g.S.purse.player >= Number(v))) add(fill(g, c.label), `동전이 모자라다 (${v}못)`); }
    }
    return out;
  }
  if (g.convo) {
    const shop = g.content.game.economy?.shops?.[g.convo.npc];
    const hostile = bandOf(g, g.convo.npc) === "적대";
    for (const gid of shop?.sells || []) { const good = g.content.game.economy.goods[gid], price = priceOf(g, g.convo.npc, gid); if (good && hostile) add(`${good.name}을(를) 산다`, "너에게는 팔지 않는다 — 네 이름이 나쁘게 돈다"); else if (good && g.S.purse.player < price) add(`${good.name}을(를) 산다`, `${price}못이 든다`); }
    return out;
  }
  // 작전: 아는 작전의 자리에 있는데 시각이나 준비가 아니다
  for (const op of opsOf(g)) {
    const O = g.content.game.ops[op.id]; if (!O || op.done || O.at !== g.at) continue;
    if (op.missing.length) add(`작전 — ${O.target}`, `${op.missing.join("·")}이(가) 아직 없다`);
    else if (!options(g).some((o) => o.id === `op_start:${op.id}`)) add(`작전 — ${O.target}`, `지금은 때가 아니다 (${O.hours?.join("~") || ""})`);
  }
  // 스승: 여기 있는데 아직 받아 주지 않는다
  const here = new Set(present(g).map((w) => w.npc));
  for (const M of g.content.game.mentors || []) if (here.has(M.npc) && !g.S.dead.has(M.npc) && g.P.met.has(M.npc) && !storyWhen(g, M.needs)) add(`${displayName(g, M.npc)}에게 ${Object.keys(M.teach).join("·")}을(를) 배운다`, "아직 받아 주지 않는다 — 믿음이 모자라다");
  // 봉기: 밤의 광장, 준비가 모자라다
  if (g.at === ROLLCALL && isNight(g.t) && !g.S.vars.greyford_free && !g.S.vars.rising_failed) { const n = risingReady(g).filter((x) => x.ok).length; if (n >= 1 && n < 4) add("사람들을 부른다 — 여울강이 붉어지는 날", `준비된 것이 ${n}가지뿐이다 (넷이 있어야 한다)`); }
  return out;
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
  if (g.op) return opOptions(g);
  // 싸움 (GAME_DESIGN §6, 01 §3.4): 한 번의 굴림으로 끝나지 않으면 합을 나눈다 — 도주·항복·흥정이 정상 선택지
  if (g.fight) {
    const n = g.fight.npc, nm = displayName(g, n);
    return [
      { id: "fight_strike", kind: "fight", label: `${nm}에게 다시 달려든다`, skill: "싸움", npc: n, edge: g.fight.edge || 0, risk: "죽을 수 있다" },
      { id: "fight_guard", kind: "fight", label: "팔을 들어 막으며 틈을 본다", skill: "싸움", npc: n, request: -10 },
      { id: "fight_flee", kind: "fight", label: "등을 돌려 달아난다", skill: "은신", npc: n },
      { id: "fight_plead", kind: "fight", label: `"그만, 그만!" — ${nm}에게 매달린다`, skill: "화술", npc: n, request: 10 },
      { id: "fight_yield", kind: "fight", label: "무릎을 꿇는다" },
    ];
  }
  if (g.convo) {
    const n = g.convo.npc, c = cardOf(g, n);
    o.push({ id: "small_talk", kind: "talk", label: `${c.name}에게 이런저런 말을 붙인다`, skill: "화술", request: -10 });
    for (const topic of topicsFor(g, n)) o.push({ id: `ask:${topic}`, kind: "talk", label: `${topic}에 대해 묻는다`, skill: "화술", request: 5, topic });
    for (const f of [...g.P.knows, ...g.run.carry.future]) {
      const hid = (g.content.reveals[n] || []).find((r) => r.fact === f);
      if (hid && !mind(g, n).revealed.has(f)) o.push({ id: `press:${f}`, kind: "talk", label: `${c.name}이 숨기는 것을 안다고 넌지시 말한다`, skill: "위압", request: 8, fact: f, memory: isFuture(g, f) ? memMark(g, `press:${f}`, { fact: f, loop: soul(g).knowledge[f]?.last || g.run.loop - 1 }) : null });
    }
    if (g.S.purse.player >= 12) o.push({ id: "give:coin", kind: "talk", label: "1 발톱(12못)을 건넨다", skill: "화술", request: -15 });
    // 빚 (21 §6.1 debt): 그가 너에게 진 빚을 한 번 꺼내 쓴다 — 다음 부탁이 쉬워진다
    if (!g.convo.favor && mind(g, n).memories.some((x) => x.kind === "debt" && !x.used && x.source !== "engine-offer")) o.push({ id: "favor", kind: "talk", label: `"그때 일, 기억하지?" — ${c.name}에게 빚을 꺼낸다` });
    // 제안 (22 §1.2 player_offer): 내놓을 것이 있을 때만 — 받은 사람은 숨긴 것을 꺼낼 이유가 생긴다
    if (!g.convo.offer) for (const [k, label, ok] of OFFERS) if (ok(g)) o.push({ id: `offer:${k}`, kind: "talk", label, skill: "화술", request: 0 });
    for (const it of mine(g)) if (it.eat) o.push({ id: `give:${it.id}`, kind: "talk", label: `${it.name}을(를) 나눈다` });   // 빵 나누기 (20 §5.2)
    for (const it of mine(g)) {
      if (it.eat || it.use || it.coin) continue;                 // 먹을 것·약은 보이거나 팔 물건이 아니다
      o.push({ id: `show:${it.id}`, kind: "talk", label: `${it.name}을(를) 꺼내 보인다`, risk: "물건을 알아볼 수 있다" });
      if (profOf(g, n).role === "fence" || (it.value || 0) > 0) o.push({ id: `sell:${it.id}`, kind: "talk", label: `${it.name}을(를) 팔겠다고 한다` });
    }
    const shop = g.content.game.economy?.shops?.[n];
    for (const gid of bandOf(g, n) === "적대" ? [] : shop?.sells || []) {   // 적대: 문을 닫는다 (10 §4)
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
  if (g.P.status.fear < 3) for (const w of present(g)) if (w.kind !== "captive") o.push({ id: `attack:${w.npc}`, kind: "scene", more: true, label: `${displayName(g, w.npc)}에게 덤벼든다${hasWeapon(g) ? " (칼이 있다)" : " (맨손)"}`, skill: "싸움", npc: w.npc, risk: "죽을 수 있다" });
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
  // 글로 된 것 (19 §4.2): 읽어 본다 — 글을 모르면 글자 모양만
  for (const it of mine(g)) if (goodOf(g, it)?.read && !(g.P.readDocs ??= new Set()).has(it.id)) o.push({ id: `read:${it.id}`, kind: "scene", more: true, label: `${it.name}을(를) 펼쳐 읽는다` });
  // 스승 (03 §3.1): 그 사람이 여기 있고, 받아들였고, 오늘 아직 배우지 않았으면
  for (const M of mentorsHere(g)) for (const [sk, cap] of Object.entries(M.teach)) if (rawSkill(g, sk) < cap - 10) o.push({ id: `train:${M.npc}:${sk}`, kind: "time", label: `${displayName(g, M.npc)}에게 ${sk}을(를) 배운다 (두 시간)${M.fee?.startsWith("coin") ? ` — ${M.fee.split(" ")[1]}못` : M.fee?.startsWith("item") ? ` — ${g.content.game.economy.goods[M.fee.split(" ")[1]]?.name}` : ""}`, minutes: 120, risk: M.risk === "witness" ? "금지된 수업 — 들키면" : M.risk === "trap" ? null : null });
  for (const it of g.L.items.values()) if (it.at === g.at && !it.worn && (it.owner !== "player" || it.stashed) && g.P.found.has(it.id)) o.push({ id: `take:${it.id}`, kind: "scene", label: `${it.name}을(를) 챙긴다` });
  // 숨기기: 몸에 지니면 점호 몸수색에 걸린다 — 어딘가에 묻어 두고 다닌다
  for (const it of mine(g)) if (!it.stashed) o.push({ id: `stash:${it.id}`, kind: "scene", more: true, label: `${it.name}을(를) 이곳에 숨긴다` });
  // 몸의 어디에 지니는가 — 점호 몸수색과 남의 눈이 달라진다
  for (const it of mine(g)) {
    const cur = slotOf(it);
    for (const [sl, def] of Object.entries(SLOTS)) {
      if (sl === cur || it.coin) continue;
      if (def.hide && !it.tags?.includes("숨길수있음")) continue;
      if (def.one && mine(g).some((x) => x !== it && slotOf(x) === sl)) continue;
      if (sl === "손" && !it.tags?.includes("무기") && !it.tags?.includes("광원")) continue;
      o.push({ id: `wear:${it.id}:${sl}`, kind: "scene", more: true, label: `${it.name}을(를) ${sl === "손" ? "손에 쥔다" : sl === "허리" ? "허리에 찬다" : `${sl}에 넣는다`}` });
    }
  }
  if (g.P.bloody && WATER.has(g.at)) o.push({ id: "wash", kind: "scene", label: "옷의 피를 물에 빤다" });
  if (g.S.purse.player >= 12) o.push({ id: "stash:coin", kind: "scene", more: true, label: `동전 ${g.S.purse.player - 3}못을 이곳에 숨긴다 (부츠 속 3못만 남기고)` });
  for (const e of exits(g)) {
    const sneak = ["owner", "staff", "closed", "secret", "home_locked"].includes(e.access) && !(e.id === HOME);
    o.push({ id: `go:${e.id}`, kind: "move", label: `${e.via ? `${e.via} ` : ""}${e.name}(으)로 ${e.via ? "넘어 들어간다" : "간다"}${e.minutes ? ` (${e.minutes}분)` : ""}${sneak ? " — 몰래" : ""}`, minutes: e.minutes, skill: sneak ? "은신" : null, to: e.id, via: e.via });
  }
  // 다른 고장으로: 지도에서 이웃한 고장 (주인공은 농노다 — 허락 없이 떠나면 탈주다)
  for (const tr of travels(g)) o.push({ id: `travel:${tr.settlement}`, kind: "move", label: `${tr.name}(으)로 길을 떠난다 (${tr.hours}시간)${g.P.settlement === SETTLEMENT ? " — 탈주" : ""}`, minutes: Math.round(tr.hours * 60), risk: g.P.settlement === SETTLEMENT ? "점호에 두 번 빠지면 탈주 노예" : null });
  // 가르친다 (12 §7.2): 세 살부터, 움막에서 — 아이는 제자이기도 하다
  if (g.at === HOME && g.family?.children?.length) for (const [i, c] of g.family.children.entries()) if ((g.t - c.born) / 1440 >= 3 * YEAR && c.lastTaught !== Math.floor(g.t / 1440)) {
    const best = Object.keys(g.P.skills).concat(Object.keys(g.P.gain || {})).filter((k, j, a) => a.indexOf(k) === j).sort((x, y) => rawSkill(g, y) - rawSkill(g, x))[0];
    if (best) o.push({ id: `teach:${i}`, kind: "time", label: `${c.name}에게 ${best}을(를) 가르친다 (두 시간)`, minutes: 120 });
  }
  // 봉기: 채찍 기둥 광장, 밤, 준비 지표 넷 이상 (SCENARIOS §3.4)
  if (g.at === ROLLCALL && isNight(g.t) && !g.S.vars.greyford_free && !g.S.vars.rising_failed && risingReady(g).filter((x) => x.ok).length >= 4) o.push({ id: "rising", kind: "scene", label: "사람들을 부른다 — 여울강이 붉어지는 날", risk: "실패하면 붉은 길" });
  // 작전: 그 자리, 그 시각, 필수 준비를 갖췄으면
  for (const [id, op] of Object.entries(g.content.game.ops || {})) if (opAvailable(g, id, op)) o.push({ id: `op_start:${id}`, kind: "scene", label: `작전 — ${op.target}`, risk: "준비한 만큼만 쉬워진다" });
  // 영역 세우기 (09 §2): 그 자리를 알고, 그 자리의 사람이 너를 믿으면
  { _domData = g.content.game.domains; const at = DOM.canFound(g, DMH()); if (at && !g.storyDone.has("domain_found")) o.push({ id: "found_domain", kind: "scene", label: `${displayName(g, g.content.game.domains.sites[at].steward)}에게 — 여기 사람들을 돕겠다고 말한다` }); }
  // 숨긴 곳: 키트를 늑대굴로 (밤에, 같이 있을 때) · 숨긴 곳에 먹을 것을 두고 간다
  if (g.at === HOME && isNight(g.t) && present(g).some((w) => w.npc === "npc_kit") && !g.hide && knowsFact(g, "fact_gf_wolf_den")) o.push({ id: "hide_kit", kind: "scene", label: "키트를 데리고 늑대굴로 간다 — 숨긴다", risk: "통금 뒤의 길", minutes: 390 });
  if ((g.hide && !g.hide.lost && g.at === g.hide.at) || (g.domain && !g.domain.lost && atPlace(g, g.domain.at))) for (const it of mine(g)) if (it.eat) o.push({ id: `stock:${it.id}`, kind: "scene", label: `${it.name}을(를) 숨은 곳에 두고 간다` });
  // 진명 — 불 (소리 내지 않고): 한 시간 동안 빛이 된다. 몸이 값을 치른다. 본 사람이 있으면 '마녀'
  for (const [w, T] of Object.entries(g.content.game.truenames || {})) {
    if (!knowsWord(g, w) || (T.use || []).includes("night") && !isNight(g.t) || g.P.wordAt?.[w] === Math.floor(g.t / 60)) continue;
    if (T.effect === "water" && !g.P.bloody) continue;
    o.push({ id: `true_name:${w}`, kind: "scene", more: true, label: `${T.source}의 이름 — '${w}'을(를) 속으로 부른다`, risk: "본 사람이 있으면 재의 법" });
  }
  // 가족 (12): 입양 · 가문 세우기
  if (present(g).some((w) => w.npc === "npc_fayne") && relOf(g, "npc_fayne").trust >= 30 && (g.P.bond?.npc_fayne || 0) >= 10 && !g.family?.members.includes("npc_fayne")) o.push({ id: "adopt:npc_fayne", kind: "scene", label: "페인에게 — 움막 12호에 와서 같이 살자고 한다" });
  if (g.at === HOME && !g.family?.name && Object.values(g.P.bond || {}).some((v) => v >= 15)) o.push({ id: "found_house", kind: "scene", more: !soul(g).house, label: soul(g).house ? `가문을 다시 세운다 — '${soul(g).house.name}'` : "가문을 세운다 — 이름 없는 자들의 이름", input: soul(g).house ? null : "house" });
  // 이름 붙이기 / 밤의 의식
  for (const w of present(g)) if (cardOf(g, w.npc).nameable && !g.P.names?.[w.npc]) o.push({ id: `name:${w.npc}`, kind: "scene", label: `${displayName(g, w.npc)}에게 이름을 붙여 준다`, input: "npc_name", npc: w.npc });
  if (g.at === HOME && isNight(g.t) && present(g).some((w) => w.npc === "npc_kit") && g.P.lastRitual !== Math.floor((g.t - 6 * 60) / 1440)) {
    o.push({ id: "ritual:song", kind: "scene", label: "키트에게 강물 노래를 불러 준다" });
    if (mine(g).some((i) => i.eat)) o.push({ id: "ritual:bread", kind: "scene", label: "빵을 반으로 나눠 키트와 먹는다" });
  }
  // 맹세 (16 §5.3): 계기가 온 뒤, 아직 하지 않은 맹세 하나를 소리 내어 말할 수 있다 — 이 자리 사람들이 증인이 된다
  for (const oa of g.content.game.oaths || []) {
    if ((g.oaths || []).some((x) => x.id === oa.id) || !storyWhen(g, oa.offer_when) || g.t > parseDT(oa.deadline)) continue;
    o.push({ id: `oath:${oa.id}`, kind: "scene", more: present(g).length === 0, label: `소리 내어 맹세한다 — "${oa.line}"`, oath: true });
  }
  // 들일 (03 §2.1, 14 §5.1): 낮 노동은 몰아서. 할당을 못 채우면 즈닉의 채찍과 배급 삭감
  { const hm = ((g.t % 1440) + 1440) % 1440; if (g.P.settlement === SETTLEMENT && !g.S.vars.player_fugitive && hm >= 6 * 60 && hm < 14 * 60 && !isSabbath(Math.floor(g.t / 1440)) && g.P.lastWork !== Math.floor(g.t / 1440)) o.push({ id: "work_day", kind: "time", label: "들일에 나간다 (해 질 때까지)" }); }
  // 「기억대로 보낸다」 (03 §3.5, 18 §5.6): 지난 회차의 이 하루를 다시 고른다 — 어긋나면 멈춘다
  if (g.run.loop >= 2 && recallPlan(g).length >= 2) o.push({ id: "recall", kind: "time", label: "기억대로 보낸다 — 지난 회차의 이 하루처럼 (다음 아침까지)" });
  o.push({ id: "wait:60", kind: "time", label: "한 시간 기다린다" });
  // 18 「기억대로 보낸다」: 하루를 늘 하던 대로 — 저녁 배급, 막사, 잠, 점호. 그사이 눈앞에서 일어난 일만 남는다
  if (g.P.settlement === SETTLEMENT && !g.S.vars.player_fugitive) {
    o.push({ id: "routine_day", kind: "time", label: "하루를 늘 하던 대로 보낸다 (배급 → 막사 → 점호)" });
    // 몰아서 보내기 (03 §3.3): 그 사이에도 세계는 돈다 — 무슨 일이 생기면 거기서 멈춘다
    o.push({ id: "routine_days:3", kind: "time", more: true, label: "사흘을 늘 하던 대로 보낸다 — 일이 생기면 멈춘다" });
    o.push({ id: "routine_days:7", kind: "time", more: true, label: "이레를 늘 하던 대로 보낸다 — 일이 생기면 멈춘다" });
  }
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
  if (opt.opD != null) {   // 작전의 판정: 준비 하나에 +10 (11 §3.2)
    const op = g.content.game.ops[g.op.id], parts = [];
    let S = skill(g, opt.skill) + (opt.skill === "은신" ? g.P.mods.민첩 * 2 : 0);
    if (opt.id === "op_exec") for (const r of opReady(g, op)) { if (r.ok) { S += r.bonus; parts.push({ sign: "▲", text: `${r.phase} — ${r.label}${r.bonus === 5 ? " (기억뿐이다)" : ""}` }); } else parts.push({ sign: "▼", text: `${r.phase} — ${r.label} (없다)` }); }
    if (g.P.status.hunger >= 3) { S -= 5; parts.push({ sign: "▼", text: "배가 고프다" }); }
    return { P: prob(S, opt.opD), S: Math.round(S), D: opt.opD, parts };
  }
  const p = g.P;
  const n = opt.npc || g.convo?.npc;
  const pr = n ? profOf(g, n) : { perception: 50, nerve: 50 };
  const m = n ? mind(g, n) : { fear: 0, anger: 0 };
  const r = n ? relOf(g, n) : { like: 0, trust: 0 };
  const knowsHim = n && (p.met.has(n) || soulPerson(g, n));
  const parts = [];
  let S = skill(g, opt.skill), D = 10;
  if (BODY_STAT[opt.skill] && rawSkill(g, opt.skill) + talentBonus(g, opt.skill) > bodyCap(g, opt.skill)) parts.push({ sign: "▼", text: "손은 기억하는데 몸이 아직 따라오지 않는다" });
  const why = (sign, text) => parts.push({ sign, text: josa(text) });
  const statMod = opt.skill === "싸움" ? (p.mods.근력 + p.mods.민첩) * 2 : opt.skill === "위압" ? (p.mods.의지 + p.mods.근력) * 2 : opt.skill === "은신" ? p.mods.민첩 * 2 : (p.mods.지능 + p.mods.감각) * 2;
  S += statMod;
  if (p.status.hunger >= 2) { S -= 5; why("▼", p.status.hunger >= 3 ? "며칠째 제대로 못 먹었다 — 머리가 멍하다" : "배가 고프다"); }
  if (p.status.pain >= 30) { S -= p.status.pain >= 60 ? 9 : 3; why("▼", p.status.pain >= 60 ? "몸이 많이 아프다" : "등의 채찍 자국이 욱신거린다"); }
  if (p.status.fatigue >= 70) { S -= 5; why("▼", "눈꺼풀이 무겁다 — 지쳤다"); }
  if (p.status.fear >= 2 && ["싸움", "위압"].includes(opt.skill)) { S -= 3 * p.status.fear; why("▼", "다리가 떨린다"); }
  if (p.status.stress >= 70 && ["화술", "기만"].includes(opt.skill)) { S -= 5; why("▼", "목소리가 갈라진다 — 너무 많은 것을 짊어졌다"); }
  if (opt.skill === "화술" && n) { const grp = groupOf(g, n), v = grp ? (reputation(g).views[grp] || 0) : 0; if (v) { const b = clamp(Math.round(v * 0.3), -8, 8); S += b; why(b >= 0 ? "▲" : "▼", `${grp} 사이에서 네 이름이 ${b >= 0 ? "좋게" : "나쁘게"} 돈다`); } }
  // 칭호 (10 §4.1): 소문이 붙인 이름이 처음 보는 사람의 태도를 바꾼다
  if (n && opt.skill === "화술") {
    const titles = new Set([...(repCache(g).titles || []), ...(g.P.titles || [])]), human = /인간/.test(cardOf(g, n).race || "인간");
    if (titles.has("날을 아는 자") && human) { S += 4; why("▲", "'날을 아는 자' — 인간들은 너를 경외한다"); }
    if (titles.has("날을 아는 자") && groupOf(g, n) === "순종의 빛") { S -= 6; why("▼", "'날을 아는 자' — 사제들에게는 이단의 냄새"); }
    if (titles.has("개목걸이") && human) { S -= 8; why("▼", "'개목걸이' — 동족을 판 자"); }
    if (titles.has("빵을 나누는 이") && human) { S += 4; why("▲", "'빵을 나누는 이'"); }
  }
  if (g.convo?.favor && /^(ask|press):/.test(opt.id || "")) { S += 15; why("▲", "빚을 꺼냈다 — 한 번은 들어준다"); }
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
  if (opt.skill === "통찰") {
    D += 18; why("?", "무엇이 있을지 모른다");
    if (g.P.seeAt != null && g.t - g.P.seeAt <= 60) { S += 15; why("▲", "'보다'의 이름이 아직 눈에 남아 있다"); }
    const dark = g.content.game.access?.[g.at]?.dark || isNight(g.t);
    if (dark) { if (hasTag(g, "광원")) { S += 6; why("▲", "양초가 있다"); } else { S -= 10; why("▼", "어둡다 — 손으로 더듬어야 한다"); } }
  }
  if (opt.skill === "은신") {
    const watchers = g.W.whoIsAt(opt.to, g.t + (opt.minutes || 0), g.W.npcs()).filter((w) => w.kind === "at").length;
    D += 10 + watchers * 6 + (isNight(g.t) ? -6 : 4);
    if (opt.via) { S += 10; why("▲", "갈고리와 밧줄이 있다"); }
    if (g.P.closeAt != null && g.t - g.P.closeAt <= 30) { S += 12; why("▲", "등 뒤의 문은 닫혀 있다"); }
    if (g.content.game.access?.[opt.to]?.dark && !hasTag(g, "광원")) { S -= 10; why("▼", "그 아래는 캄캄하다 — 불이 없다"); }
    if (g.P.bloody) { S -= 4; why("▼", "옷에 피가 묻어 있다"); }
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
    if (opt.edge) { S += opt.edge; why("▲", "상대가 지쳤다 — 틈이 보인다"); }
    if (g.fight?.me) { S -= 5 * g.fight.me; why("▼", `${g.fight.me === 1 ? "한 대" : "여러 대"} 맞았다`); }
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
// 이 걸음의 기록 번호 (「기억대로 보낸다」의 하위 걸음은 "12.3" — 앞 번호만), 물건 id는 번호 + 걸음 안 순번
const jidx = (g) => Number(String(g._i ?? 0).split(".")[0]) || 0;
const uid = (g, base) => `${base}_${String(g._i ?? 0)}_${g._seq = (g._seq || 0) + 1}`;
// entry: {i, kind:'act', id, tags?, text?} | {i, kind:'memory', npc, mems:[...]} | {i, kind:'regress'}
export function apply(g, e, { replay = false } = {}) {
  g.feed = []; g._i = e.i; g._seq = 0; g._echoN = 0;      // 기록 번호: 실시간과 재생이 같은 값을 본다 (journal.length는 재생 때 전체 길이다)
  if (e.kind === "memory") { for (const m of e.mems) applyRecord(g, e.npc, m); return { kind: "memory" }; }
  if (e.kind === "narrator") { g.narrator = e.id; return { kind: "narrator" }; }   // 화자 바꾸기 (18 §4.4) — 기록에 남아 재생된다
  const res = step(g, e);
  DIR.updateTension(g, DH());
  if (g.ended) g.ended.why = josa(g.ended.why);
  if (!replay) res.feed = g.feed.map((f) => ({ ...f, text: josa(f.text) }));
  return res;
}
// 행동 하나 (기록 한 줄, 또는 「기억대로 보낸다」 속의 한 걸음). 주사위는 hash(시드, 'roll', 기록 번호)
function step(g, e) {
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
  const grown = opt.skill || opt.check?.skill;   // 대본 장면의 판정도 실전이다
  if (od && grown) growSkill(g, grown, od, tier, opt.check ? "story" : verb.startsWith("op_") ? "op" : verb);
  for (const [k, d] of Object.entries(TEMPER_OF[verb] || {})) temper(g, k, d);
  // 두려움 (01 §1.4): 사냥꾼과 같은 자리, 수배 — 쌓이고, 장면이 바뀌면 조금씩 가라앉는다
  const scary = present(g).some((w) => profOf(g, w.npc).role === "hunter") || heatHere(g) >= 3;
  g.P.status.fear = clamp(g.P.status.fear + (scary ? 1 : -1), 0, 5);
  if (!g.story && !g.ended && !g.convo) { const wt = windowTrigger(g); if (wt) openStory(g, wt); else nemesisCheck(g); }
  pickVoice(g, e, opt);
  if (e?.id?.startsWith("talk:")) (g.P.talkedBefore ??= new Set()).add(e.id);
  successions(g);
  for (const w of present(g)) g.P.seen[w.npc] = { t: g.t, at: g.at };   // 마지막으로 본 곳 (24 §3.6)
  g.P.been.add(g.at);
  if (!TRIVIAL.test(e.id)) g.P.acts = [...(g.P.acts || []), { id: e.id, label: res.label, t: g.t, at: g.at }].slice(-8);
  if (opt.memory) {
    (g.P.memUsed ??= new Set()).add(e.id);
    // 앎의 흔적 (03 §4.3): 처음 보는 사람의 비밀을 말할 때마다 — 시간에 닿은 것들이 낌새를 챈다
    echoSign(g, opt.fact ? Math.ceil((g.content.facts[opt.fact]?.danger || 2) / 2) : 1, opt.label);
  }
  memoryInk(g);
  if (!/^(story|story_name|recall)\b/.test(verb) && !e.sub) (g.P.path ??= []).push({ id: e.id, t: before });   // 기억된 길 (03 §3.5)
  res.notes = res.notes.map(josa); res.label = josa(res.label);
  return res;
}
const WATER = new Set(["gf_willow_bank", "gf_well_square", "gf_iron_bridge", "gf_hagen_shed"]);
const TRIVIAL = /^(wait|sleep|leave|small_talk|story:next|story_name)\b/;

// ── 하루의 끝 (18 §5.2·§5.3): 갈고리 한 줄 + 하루 요약 카드. 잠이 장(章)을 닫는다 ──
function threads(g) {
  const out = [];
  for (const b of g.content.game.director?.beats || []) {
    const at = parseDT(b.at), left = (at - g.t) / 1440;
    if (left < 0 || !storyWhen(g, b.when)) continue;
    const near = left <= 1.2, text = near ? b.near : b.far;
    if (!text) continue;
    const imm = left <= 1.2 ? 1 : left <= 3 ? 0.7 : left <= 7 ? 0.4 : 0.2;
    out.push({ id: b.id, text, score: b.danger * 10 * imm * (b.involved || 1) * (g.P.lastHookId === b.id ? 0.3 : 1) });
  }
  // 지난 회차의 끝 (개인 박자, §3.14): 그 날의 전날 · 넘어선 첫 밤
  const last = soul(g).records[soul(g).records.length - 1];
  if (last && last.kind !== "alive") {
    const left = (last.endT - g.t) / 1440;
    if (left > 0 && left <= 1.2) out.push({ id: "last_end", text: `내일, 지난번의 너는 ${last.at}에 있었다. 이번엔 아직 아무것도 정해지지 않았다.`, score: 45 });
    if (left < 0 && left > -1.2 && !g.P.passedLastEnd) out.push({ id: "passed", text: "여기서부터는 아무것도 모른다. 내일 아침 무슨 종이 울리는지도.", score: 40 });
  }
  const heat = heatHere(g, SETTLEMENT);
  if (heat >= 2) out.push({ id: "wanted", text: "감독관 초소의 등불이 늦게까지 꺼지지 않는다. 명단에 무언가가 더 적혔다.", score: 10 * Math.min(5, heat) * 0.6 });
  for (const [n, x] of Object.entries(g.nem || {})) if (x.track >= 3) out.push({ id: `nem_${n}`, text: `막사 문설주에 손톱자국 세 줄이 나 있다. ${displayName(g, n)}의 손 간격이다.`, score: 36 });
  return out.sort((a, b) => b.score - a.score);
}
function dayEnd(g) {
  const day = Math.floor(g.t / 1440);
  if (g.P.lastDayEnd === day || g.story || g.ended) return;
  const mk = g.P.dayMark || { notebook: 0, met: 0, coin: 3 };
  const th = threads(g)[0];
  const quiet = g.content.game.director?.quiet || [];
  // 매일 밤이 절벽이면 절벽이 아니다 — 세 밤 연속 갈고리였으면 넷째 밤은 아주 무거운 것만
  const streak = g.P.hookStreak || 0;
  let hook = th && th.score >= 12 && (streak < 3 || th.score >= 40) && (th.score >= 40 || DIR.hookAllowed(g, DH(), day)) ? th : null;
  const text = hook ? hook.text : quiet[Math.floor(hash(g.seed, "quiet", day) * quiet.length)] || "";
  g.P.hookStreak = hook ? streak + 1 : 0;
  g.P.lastHookId = hook?.id || null; g.P.lastHook = text;
  if (hook?.id === "passed") g.P.passedLastEnd = true;
  const goalsNow = goals(g).filter((x) => x.days != null).map((x) => `${x.who}까지 ${x.days}일`);
  const card = [`수첩 +${Math.max(0, g.P.notebook.length - mk.notebook)}`, `아는 사람 ${g.P.met.size}`, `동화 ${g.S.purse.player}못`, ...goalsNow].join(" · ");
  g.feed.push({ kind: "dayend", text, card });
  (g.P.days ??= []).push({ day: Math.floor((g.t - START) / 1440), date: fmt(g.t).replace(/^AS \d+ /, "").replace(/ \d\d:\d\d$/, ""), at: placeName(g, g.at), notes: g.P.notebook.slice(mk.notebook).slice(-3), hook: text });
  g.P.dayMark = { notebook: g.P.notebook.length, met: g.P.met.size, coin: g.S.purse.player, journal: jidx(g) + 1 };
  g.P.lastDayEnd = day;
}
// 두 겹의 날 (16 §4): 지난 회차의 같은 날과 오늘을 나란히 — 같음/달라짐은 플레이어가 본다
function twoDays(g) {
  const day = Math.floor((g.t - START) / 1440), prev = soul(g).days?.[g.run.loop - 1] || [];
  const then = prev.find((x) => x.day === day) || null, now = (g.P.days || []).find((x) => x.day === day) || null;
  // 같음/달라짐 표지 (16 §4.2): 자리, 그리고 그날 수첩에 남은 줄
  const marks = then && now ? [then.at === now.at ? "= 같은 자리에서 하루를 닫았다" : `≠ 지난번엔 ${then.at}, 이번엔 ${now.at}`, ...now.notes.filter((n) => !then.notes.includes(n)).map((n) => `+ 처음: ${n}`), ...then.notes.filter((n) => !now.notes.includes(n)).map((n) => `− 이번엔 없었다: ${n}`)] : [];
  return then || now ? { day, then, now, marks } : null;
}
// 아침 표지 (18 §5.2 ③): 마지막으로 잠에서 깬 때의 기록 길이 — 이야기 모드의 되돌리기 지점
export function morningMark(g) { return g.P.marks?.length ? g.P.marks[g.P.marks.length - 1] : null; }
// 지난 이야기 (18 §5.4): 실제로 얼마나 비웠나에 따라 — 한 줄 / 짧은 요약. 회차 2부터는 맨 위에 '{n}째 저녁.'
export function recap(g, gapHours) {
  if (gapHours < 6) return [];
  const out = [];
  if (g.run.loop >= 2) out.push(`${nthKo(g.run.loop)} 저녁.`);
  if (gapHours < 48) { if (g.P.lastHook) out.push(`지난밤: ${g.P.lastHook}`); return out; }
  const notes = g.P.notebook.slice(g.P.dayMark?.notebook ? Math.max(0, g.P.notebook.length - 3) : -3);
  out.push(...notes.map((x) => `· ${x}`));
  for (const t of threads(g).slice(0, 2)) out.push(`· ${t.text}`);
  out.push(`지금 — ${fmt(g.t).replace(/^AS \d+ /, "")} · ${placeName(g, g.at)} · 배고픔 ${g.P.status.hunger}/4`);
  return DIR.recapVoice(g, out, DH());
}
// 「다시, 낙엽월 1일」 (18 §5.7): 이번 회차에 들고 들어가는 것 — 첫 회귀에는 짧게
function againCard(g) {
  const S = soul(g), last = S.records[S.records.length - 1];
  const L = [`다시, 낙엽월 1일 — ${nthKo(g.run.loop)} 저녁`];
  if (S.furthest > START) L.push(`가장 멀리 간 날 — ${fmt(S.furthest).replace(/^AS \d+ /, "").replace(/ \d\d:\d\d$/, "")}`);
  if (last) L.push(`지난번 — ${last.end.replace(/^AS \d+ /, "").replace(/ \d\d:\d\d$/, "")}, ${last.at}`);
  const beats = (g.content.game.director?.beats || []).filter((b) => parseDT(b.at) > g.t && (b.far || b.near)).filter((b) => storyWhen(g, b.when) || (b.when || []).some((c) => /pknows|goal_/.test(c))).slice(0, g.run.loop === 2 ? 3 : 5);
  if (beats.length) L.push(`아는 박자\n${beats.map((b) => `· ${(b.far || b.near)}`).join("\n")}`);
  const held = [...(S.oaths || []).map((o) => `맹세 — ${o.line}`), ...(S.traces || []).map((t) => `흔적 — ${t.name}`)];
  if (held.length && g.run.loop >= 3) L.push(`품은 것\n${held.map((x) => `· ${x}`).join("\n")}`);
  return L.join("\n\n");
}
// 약속 (21 §6.1): 기한 달린 기대. 그 자리에 가면 지킨 것, 안 가면 — 그 사람은 기다렸다
function promisesTick(g, t) {
  for (const p of g.promises || []) {
    if (p.state !== "open") continue;
    if (t >= p.from && t <= p.to && g.at === p.place) { p.state = "kept"; bumpRel(g, p.npc, 3, 6); addMemory(g, p.npc, { kind: "emotion", tag: "정직함", text: "셋째가 약속한 대로 왔다", salience: 3, source: "engine" }); continue; }
    if (t > p.to + 60) {
      p.state = "broken"; bumpRel(g, p.npc, -5, -10);
      addMemory(g, p.npc, { kind: "emotion", tag: "거짓말쟁이", text: `셋째는 오지 않았다 — ${p.what}`, salience: 4, source: "engine" });
      g.feed.push({ kind: "echo", text: josa(`〰 ${displayName(g, p.npc)}이(가) ${placeName(g, p.place)}에서 기다렸다. 너는 가지 않았다.`) });
    }
  }
}
// 맹세의 판정과 메아리 (16 §3·§5)
function oathsTick(g, t) {
  for (const o of g.oaths || []) {
    if (o.state !== "held") continue;
    const oa = (g.content.game.oaths || []).find((x) => x.id === o.id);
    if (t < parseDT(oa.deadline)) continue;
    const broken = storyWhen(g, oa.broken, t);
    o.state = broken ? "broken" : "kept";
    for (const n of o.witnesses) bumpRel(g, n, broken ? -5 : 4, broken ? -15 : 10);
    echoOut(g, broken ? `〰 "${oa.line}" — 깨졌다. ${o.witnesses.length ? `${o.witnesses.map((n) => displayName(g, n)).join(", ")} 앞에서 한 말이었다.` : "너만 안다."}` : `〰 "${oa.line}" — 지켜졌다.`, 85);
  }
  // 지난 회차의 맹세 — 다시 말하지 않았어도, 조건이 맞으면 (회귀를 넘는 맹세, §5.8)
  for (const so of soul(g).oaths || []) {
    if ((g.oaths || []).some((x) => x.id === so.id) || (g.P.oathEchoed ??= new Set()).has(so.id)) continue;
    const oa = (g.content.game.oaths || []).find((x) => x.id === so.id);
    if (!oa || t < parseDT(oa.deadline)) continue;
    g.P.oathEchoed.add(so.id);
    if (!storyWhen(g, oa.broken, t)) echoOut(g, `〰 "${oa.line}" — 지켜졌다. 아무도 모른다.`, 75);
  }
  // 상실 (18 §3.3 L): 유대 있는 사람이 끌려가면
  for (const [v, n] of [["kit_sold", "npc_kit"], ["sara_sold", "npc_sara"], ["toby_sold", "npc_toby"]]) if (g.S.vars[v] && !(g.P.lossSeen ??= new Set()).has(v)) { g.P.lossSeen.add(v); if ((g.P.bond?.[n] || 0) >= 5 || n === "npc_kit") { DIR.loss(g, 7); DIR.crisis(g, 4); } }
  // 메아리: 네가 한 일이 세상에 닿은 순간 (원인 한 줄을 불러 준다)
  for (const ec of g.echoes || []) {
    if (ec.done || t < ec.t) continue;
    if (storyWhen(g, [ec.when], t)) { ec.done = true; echoOut(g, ec.text, ec.R || 70); }
  }
}
// 앞선 잔향자의 꿈 (14 §3.4): 잠에서 깰 때 — 굶주림월 4일 전에는 이레에 한 번, 그 뒤에는 사흘에 한 번
function dreamTick(g) {
  const D = g.content.game.dreams; if (!D?.fragments?.length) return;
  const day = Math.floor(g.t / 1440), late = g.t >= toMinutes(312, 12, 4);
  g.P.nextDream ??= Math.floor(START / 1440) + 6;
  if (day < g.P.nextDream) return;
  const n = (g.P.dreamN = (g.P.dreamN || 0) + 1);
  g.feed.push({ kind: "voice", who: D.who, text: D.fragments[(n - 1) % D.fragments.length] });
  g.P.nextDream = day + (late ? 3 : 7);
}
// 메아리 상한 (16 §3.3): 흔하면 무뎌진다 — 한 장면에 하나, 하루에 둘(큰 메아리는 하루 하나). 넘치면 R 순 대기열 → 잠자리의 「밤의 메아리」
function echoOut(g, text, R = 70) {
  const day = Math.floor(g.t / 1440), D = (g.P.echoDay ??= { day, n: 0, big: 0 });
  if (D.day !== day) Object.assign(D, { day, n: 0, big: 0 });
  const big = R >= 80;
  if ((g._echoN || 0) >= 1 || D.n >= 2 || (big && D.big >= 1)) { (g.P.echoQ ??= []).push({ text, R, day }); return; }
  g._echoN = (g._echoN || 0) + 1; D.n++; if (big) D.big++;
  g.feed.push({ kind: "echo", text });
}
function nightEchoes(g) {
  const Q = g.P.echoQ || []; if (!Q.length) return;
  const day = Math.floor(g.t / 1440);
  for (const q of Q) q.R -= 5 * Math.max(0, day - q.day), q.day = day;   // 기다리는 동안 하루에 R −5
  const keep = Q.filter((q) => q.R >= 50).sort((a, b) => b.R - a.R);
  (g.P.quietEchoes ??= []).push(...Q.filter((q) => q.R < 50).map((q) => q.text));   // 조용한 메아리로 보관 (회차 비교에 남는다)
  for (const q of keep.splice(0, 2)) g.feed.push({ kind: "echo", text: `밤의 메아리 — ${q.text.replace(/^〰\s*/, "")}` });
  g.P.echoQ = keep;
}
// ── 내면의 목소리 (15) — 엔진이 고른 한 줄이 그대로 화면에 (LLM이 쓰지 않는다) ──
function voiceWhen(g, c, e, opt) {
  const [k, a, b] = c.split(/\s+/);
  if (k === "first") return g.t >= START + 30;
  if (k === "after_first") return jidx(g) >= 2;
  if (k === "place") return g.at === a || g.W.loc.get(g.at)?.parent === a;
  if (k === "with") return present(g).some((w) => w.npc === a && w.kind !== "captive");
  if (k === "role") return present(g).some((w) => profOf(g, w.npc).role === a);
  if (k === "wanted") return (g.S.wanted?.player?.heat || 0) >= Number(b);
  if (k === "talk_new") return e?.id?.startsWith("talk:") && !(g.P.talkedBefore ??= new Set()).has(e.id);   // 조건은 상태를 바꾸지 않는다 — 표시는 걸음 끝에
  if (k === "story") return g.story?.id === a;
  if (k === "with_killer") { const tr = g.run.carry.deaths[g.run.carry.deaths.length - 1]?.trace; return !!tr?.npc && present(g).some((w) => w.npc === tr.npc); }
  if (k === "dark") { const d = g.deeds[g.deeds.length - 1]; return !!d && d.t === g.t && (DARK.has(d.kind) || (d.kind === "assault" && (cardOf(g, d.victim).age ?? 30) < 14)); }
  if (k === "death_place") { const d = g.run.carry.deaths[g.run.carry.deaths.length - 1]; return !!d?.at && g.at === d.at; }
  return storyWhen(g, [c]);
}
function pickVoice(g, e, opt) {
  const V = g.content.game.voices; if (!V) return;
  const st = (g.voice ??= { used: new Set(), day: -1, today: 0, cool: 0, lastAt: null });
  const day = Math.floor(g.t / 1440);
  if (st.day !== day) { st.day = day; st.today = 0; }
  if (st.cool > 0) { st.cool--; return; }
  if (st.today >= 8 || g.ended) return;
  if (g.run.loop >= 2 && jidx(g) < 1) return;          // 회귀 직후 첫 박자는 침묵
  const say = (who, id, text, once) => { if (once !== false) st.used.add(id); st.today++; st.cool = 2; g.feed.push({ kind: "voice", who, text }); return true; };
  const killerName = () => { const tr = g.run.carry.deaths[g.run.carry.deaths.length - 1]?.trace; return tr?.npc ? displayName(g, tr.npc) : "그 사람"; };
  // 지난 회차의 나 — 회귀 뒤 첫 마디는 그 회차의 마지막 장면
  if (g.run.loop >= 2 && V.loop_self) {
    const who = g.run.loop - 1 === 1 ? "첫 회차의 나" : `${koOrdinal(g.run.loop - 1)} 회차의 나`;
    const fix = (t) => josa(String(t).replace(/\{killer\}/g, killerName()));
    if (!st.used.has("self_first")) { const tr = g.run.carry.deaths[g.run.carry.deaths.length - 1]?.trace?.id; return say(who, "self_first", fix(V.loop_self.first[tr] || V.loop_self.first.default)); }
    for (const l of V.loop_self.lines || []) {
      const id = `self_${l.id}`;
      if (l.once !== false && st.used.has(id)) continue;
      if (l.id === "killer" && st.used.has(`${id}@${g.at}`)) continue;
      if ((l.when || []).every((c) => voiceWhen(g, c, e, opt))) { if (l.id === "killer") st.used.add(`${id}@${g.at}`); return say(who, id, fix(l.text), l.once); }
    }
  }
  for (const [vid, v] of Object.entries(V)) {
    if (vid === "loop_self") continue;
    for (const l of v.lines || []) {
      const id = `${vid}_${l.id}`;
      if (l.once && st.used.has(id)) continue;
      if ((l.when || []).every((c) => voiceWhen(g, c, e, opt))) return say(`${v.desc}`, id, l.text, l.once);
    }
  }
}
// ── 인물 수첩 (08 §5, 14 §7.3): 사람별 장 — 아는 사실, 아는 연결, 지난 회차, 내 메모 ──
function bookOf(g, n) {
  const nm = nameOf(g, n), first = nm.split(/\s+/)[0];
  const about = (f) => { const F = g.content.facts[f]; return !!F && ((F.names || []).some((x) => nm.includes(x)) || (F.text || "").includes(first)); };
  const facts = [...new Set([...g.P.knows, ...g.run.carry.future])].filter(about)
    .map((f) => { const k = soul(g).knowledge[f]; const seen = (k?.seen || 0) + (g.P.knows.has(f) ? 1 : 0); return { text: shortFact(g, f), sure: seen >= 3 ? "■" : seen === 2 ? "▣" : seen === 1 ? "□" : "◇", past: !g.P.knows.has(f) }; }).slice(0, 8);
  const links = [];
  // 사람 사이의 연결: 이 사람에 대한 사실에 함께 나오는 다른 이름 (플레이어가 아는 사실에서만)
  const others = new Set([...(g.P.met || []), ...Object.keys(soul(g).people)].map((x) => nameOf(g, x).split(/\s+/)[0]));
  for (const f of g.P.knows) {
    if (!about(f)) continue;
    const F = g.content.facts[f];
    for (const o of new Set([...(F.names || []), ...[...others].filter((x) => x.length > 1 && F.text.includes(x))])) if (!nm.includes(o) && !links.some((l) => l.other === o)) links.push({ other: o, kind: "목격", text: shortFact(g, f) });
  }
  // 관리자의 숨은 수치 — 회차를 넘어 관찰한 만큼 (09 §6.1)
  const seenN = soul(g).stewardSeen?.[n] || 0, SD = g.content.game.domains?.stewards?.[n];
  if (seenN && SD) facts.push({ text: `수완 ≈ ${SD.skill} · 야심 ≈ ${SD.ambition} · 신념 ${SD.belief} (${seenN}회 관찰)`, sure: seenN >= 3 ? "■" : seenN === 2 ? "▣" : "□", past: true });
  return { facts, links: links.slice(0, 5), memo: g.run.memos?.[n] || null };
}

function hurtInFight(g, res, n) { g.fight.me += n; g.P.status.pain = clamp(g.P.status.pain + 12 * n, 0, 100); res.notes.push(n > 1 ? "주먹이 정통으로 들어온다. 세상이 기운다" : "한 대 맞았다"); }
function fightEnd(g, res) {
  const F = g.fight; if (!F) return;
  if (F.foe >= 3 || F.me >= 3 || F.round > 6) DIR.crisis(g, 3);
  const n = F.npc;
  if (F.foe >= 3) { g.fight = null; g.L.player.kill(g.t, n, { at: g.at, stealth: 10 }); deed(g, "kill", n); g.P.bloody = true; res.notes.push(`${nameOf(g, n)}이(가) 쓰러진다. 일어나지 않는다`); return; }
  if (F.me >= 3) {
    g.fight = null;
    const deadly = worn(g, n).some((i) => i.tags?.includes("무기")) || profOf(g, n).role === "hunter" || profOf(g, n).nerve >= 70;
    if (deadly && (cardOf(g, n).age ?? 30) >= 14) { g.P.alive = false; g.ended = { kind: "dead", why: `${nameOf(g, n)}의 손에 죽었다`, t: g.t, trace: { id: profOf(g, n).role === "hunter" ? "teeth" : "blade", npc: n } }; }
    else { g.P.status.pain = Math.max(g.P.status.pain, 75); res.notes.push("흙바닥. 일어날 수가 없다. 상대는 침을 뱉고 간다"); }
    return;
  }
  if (F.round > 6) { g.fight = null; res.notes.push("둘 다 숨이 끊어질 것 같다. 상대가 먼저 물러난다"); }
}
// 기억된 길: 지난 회차의 행동 중 지금부터 다음 아침(04:40)까지, 시각 순서대로
function recallPlan(g) {
  const path = soul(g).paths?.[g.run.loop - 1] || [];
  const c = fromMinutes(g.t); let end = toMinutes(c.y, c.m, c.d, 4, 40); if (end <= g.t) end += 1440;
  return path.filter((x) => x.t >= g.t - 5 && x.t < end && x.id !== "recall");
}
const labelOfId = (g, id) => { const [v, a] = id.split(/:(.*)/s); return v === "go" ? `${placeName(g, a)}(으)로 가기` : v === "talk" ? `${displayName(g, a)}에게 말 걸기` : id; };
// ── 위협의 소비자 (27 반응 층의 threats → 장면) ──
// 협박꾼은 반나절 뒤부터, 같은 자리에서 마주치면 요구한다. 복수자는 쫓는 자가 된다.
function threatsTick(g, t) {
  if (g.story || g.convo || g.ended) return false;
  for (const [i, th] of (g.S.threats || []).entries()) {
    if (th.target !== "player" || th.done) continue;
    if (th.kind === "hunt") { th.done = true; const x = ((g.nem ??= {})[th.by] ??= { grudge: 0, track: 1, since: t }); x.grudge = Math.max(x.grudge, 3); continue; }
    if (!["blackmail", "leverage"].includes(th.kind) || t < th.t + 360 || g.S.dead.has(th.by)) continue;
    if (!present(g, t).some((w) => w.npc === th.by && !asleep(w, t) && w.kind !== "captive")) continue;
    const st = SL(g, "threat_demand"); if (!st) return false;
    const about = th.about?.startsWith?.("npc_") ? `${nameOf(g, th.about)}의 일` : g.content.game.economy.goods[th.about] ? `네가 산 ${g.content.game.economy.goods[th.about].name}` : "네가 한 일";
    g.storyCtx = { threat: i, who: th.by, whoName: displayName(g, th.by), about };
    g.t = t; g.storyDone.delete(st.id); openStory(g, st);
    return true;
  }
  return false;
}
// 쫓는 자 (17 §3.6 추적 거리 0~4): 하루에 한 번 거리가 줄어든다. 4가 되면 너를 찾아낸다.
// 냄새 (03 §7.1): 회차가 쌓일수록 사냥꾼이 일찍 코를 돌린다 = min(30, 3·(회차−1)^0.7)
export const smellOf = (g) => Math.min(30, 3 * Math.max(0, g.run.loop - 1) ** 0.7);
function nemesisDay(g, day) {
  for (const [n, x] of Object.entries(g.nem || {})) {
    if (g.S.dead.has(n)) { delete g.nem[n]; continue; }
    const w = g.W.where(n, day * 1440 + 720);
    if (!w || w.kind === "away" || g.W.loc.get(w.at)?.settlement !== g.P.settlement) continue;
    const heat = heatHere(g);
    if (hash(g.seed, "track", n, day) < 0.2 + 0.1 * x.grudge + smellOf(g) / 100 + heat * 0.05) x.track = Math.min(4, x.track + 1);
  }
}
function nemesisCheck(g) {
  for (const [n, x] of Object.entries(g.nem || {})) {
    if (x.track < 4 || g.S.dead.has(n)) continue;
    const st = SL(g, "nemesis_found"); if (!st) return;
    g.storyCtx = { nem: n, nemName: displayName(g, n) };
    x.track = 2; g.storyDone.delete(st.id); openStory(g, st);
    return;
  }
}
// 보이는 것이 반응을 바꾼다 (02 §3 ③): 허리·손의 칼, 피 묻은 옷 — 들어선 자리의 사람들이 본다
function seenCarrying(g, res) {
  const here = present(g).filter((w) => w.kind !== "captive" && !asleep(w, g.t)).map((w) => w.npc);
  if (!here.length) return;
  for (const it of visibleMine(g)) {
    if (!(it.tags?.includes("무기") || it.illegal || it.tags?.includes("금서"))) continue;
    const seen = g.L.player.show(g.t, it.id, g.at);
    // 같은 칼을 같은 윗선이 하루에 두 번 본다고 두 번 쌓이지 않는다
    const auth = seen.filter((x) => profOf(g, x).role === "authority" && !(g.P.seenArmed ??= {})[`${x}|${it.id}|${Math.floor(g.t / 1440)}`]);
    if (auth.length) { for (const x of auth) g.P.seenArmed[`${x}|${it.id}|${Math.floor(g.t / 1440)}`] = true; deed(g, "weapon", null); wantedAdd(g, 1, `${it.name}을(를) 드러내고 다녔다`, auth[0]); }
    if (seen.length) res.notes.push(`${seen.map((x) => displayName(g, x)).join(", ")}의 눈이 네 ${it.name}에 머문다`);
  }
  if (g.P.bloody) {
    for (const n of here) { bumpRel(g, n, -2, -4); if (profOf(g, n).role === "authority" && !(g.P.seenArmed ??= {})[`${n}|blood|${Math.floor(g.t / 1440)}`]) { g.P.seenArmed[`${n}|blood|${Math.floor(g.t / 1440)}`] = true; wantedAdd(g, 1, "피 묻은 옷", n); } }
    res.notes.push("네 옷의 핏자국을 보는 눈들이 있다");
  }
}
// 낱말 사전 (19 §4): 아는 낱말 / 소리로만 들리는 낱말
export function lexicon(g) {
  const out = [];
  for (const w of g.content.game.lexicon || []) {
    const known = (soul(g).lexicon || []).includes(w.word) || (w.learn_when || []).some((c) => storyWhen(g, [c]));
    out.push({ word: w.word, lang: w.lang, meaning: known ? w.meaning : null });
  }
  return out;
}
const ACHIEVEMENTS = [
  { id: "kit_kept", tp: 3, text: "키트를 첫 호송에서 빼냈다", when: (g) => g.t > toMinutes(312, 10, 9, 7) && !g.S.vars.kit_sold },
  { id: "sara_kept", tp: 3, text: "사라를 둘째 호송에서 빼냈다", when: (g) => g.t > toMinutes(312, 12, 3, 7) && !g.S.vars.sara_sold },
  { id: "fayne_saved", tp: 2, text: "하겐의 배에서 페인을 살렸다", when: (g) => !!g.S.vars.fayne_saved },
  { id: "den_saved", tp: 2, text: "대수색에서 늑대굴을 지켰다", when: (g) => !!g.S.vars.den_saved },
  { id: "egil_moved", tp: 2, text: "에길 일가를 잿빛 실에 넘겼다", when: (g) => !!g.S.vars.egil_moved },
  { id: "autumn", tp: 1, text: "낙엽월을 넘겼다", when: (g) => g.t > toMinutes(312, 9, 30, 23) },
  { id: "winter", tp: 2, text: "굶주림월을 넘겼다", when: (g) => g.t > toMinutes(312, 12, 4) },
  { id: "ten_facts", tp: 1, text: "열 가지 비밀을 알았다", when: (g) => g.P.knows.size >= 10 },
  { id: "no_blood", tp: 1, text: "이레 동안 아무도 죽이지 않았다", when: (g) => g.t - START >= 7 * 1440 && !g.deeds.some((d) => /^kill/.test(d.kind)) },
  { id: "rising", tp: 3, text: "회색여울이 사슬을 끊었다", when: (g) => !!g.S.vars.greyford_free },
  { id: "rising_90", tp: 3, text: "해방구가 아흔 날을 버텼다", when: (g) => !!g.S.vars.rising_held_90 },
  { id: "charter", tp: 3, text: "인간의 글자로 쓴 칙허", when: (g) => !!g.S.vars.kaspar_charter },
  { id: "oath_kept", tp: 2, text: "맹세를 지켰다", when: (g) => (g.oaths || []).some((o) => o.state === "kept") },
];
// ── 애착 (20 §4): 플레이어가 들인 것으로 잰다 — 나눈 빵, 대신 맞은 채찍, 붙여 준 이름, 밤의 의식 ──
function bond(g, n, d) { (g.P.bond ??= {})[n] = clamp((g.P.bond[n] || 0) + d, 0, 100); }
const knots = (v) => (v >= 40 ? 4 : v >= 25 ? 3 : v >= 12 ? 2 : v >= 5 ? 1 : 0);
// ── 연애의 가장 작은 판 (12 §2): 0 아는 사이 · 1 정다운 · 2 가까운 (호감40·신뢰30·함께한 일 셋) · 3 연인 · 4 끈혼례 ──
export function romanceStage(g, n) {
  if (g.S.vars[`${n.replace("npc_", "")}_bound`]) return 4;
  if (g.S.vars[`${n.replace("npc_", "")}_lover`]) return 3;
  const r = relOf(g, n), shared = (g.P.talks?.[n] || 0) + (g.P.bond?.[n] ? Math.floor(g.P.bond[n] / 5) : 0);
  if (r.like >= 40 && r.trust >= 30 && shared >= 3) return 2;
  return r.like >= 20 ? 1 : 0;
}
// ── 숨긴 곳 (09 단계 0~1): 사람을 숨기면 — 머릿수·먹을 것·드러남. 드러남이 1에 닿으면 찾아온다 ──
function hideTick(g, day) {
  const H = g.hide; if (!H || H.lost) return;
  H.food = Math.max(0, H.food - 0.5 * H.people.length);
  H.exposure = Math.max(0, H.exposure + 0.04 + 0.05 * H.people.length + (H.food <= 0 ? 0.1 : 0) - (H.food > 2 ? 0.02 : 0));
  if (H.exposure >= 1) {
    H.lost = true;
    for (const n of H.people) g.W.override({ npc: n, from: day * 1440, to: null, kind: "captive", at: ROLLCALL, doing: "숨은 곳에서 끌려 나왔다" });
    if (H.people.includes("npc_kit")) { g.S.vars.kit_on_list = true; g.S.vars.kit_found = true; }
    g.feed.push({ kind: "echo", text: `〰 ${placeName(g, H.at)}이(가) 드러났다. 숨겨 둔 ${H.people.map((n) => displayName(g, n)).join(", ")}이(가) 끌려 나왔다.` });
  }
}
// ── 작전 (11 §3): ① 정보 ② 접근 ③ 수단 → ④ 실행 ⑤ 탈출 ⑥ 은폐·누명 ──
const REQ = { 1: [], 2: ["정보"], 3: ["정보", "접근"], 4: ["정보", "접근", "약점"] };
function opReady(g, op) {
  return op.ready.map((r) => {
    const ok = storyWhen(g, [r.cond]);
    // 지난 회차의 기억만으로 아는 정보는 절반 (03 §4.4)
    const half = ok && /^pknows /.test(r.cond) && !g.P.knows.has(r.cond.split(" ")[1]);
    return { ...r, ok, bonus: ok ? (half ? 5 : 10) : 0 };
  });
}
function opsOf(g) {
  return Object.entries(g.content.game.ops || {}).filter(([, op]) => storyWhen(g, op.known_when)).map(([id, op]) => {
    const ready = opReady(g, op);
    const missing = REQ[op.security].filter((ph) => !ready.some((r) => r.phase === ph && r.ok));
    return { id, target: op.target, when: op.hint, security: op.security, ready: ready.map((r) => ({ label: `${r.phase} — ${r.label}`, ok: r.ok })), missing, done: !!g.P.opsDone?.[id] };
  });
}
function opAvailable(g, id, op) {
  if (g.P.opsDone?.[id] || !atPlace(g, op.at) || !storyWhen(g, op.known_when) || !storyWhen(g, op.when)) return false;
  if (op.night && !isNight(g.t)) return false;
  if (op.hours) { const hm = ((g.t % 1440) + 1440) % 1440; if (!(hm >= parseClock(op.hours[0]) && hm < parseClock(op.hours[1]))) return false; }
  return REQ[op.security].every((ph) => opReady(g, op).some((r) => r.phase === ph && r.ok));
}
function opOptions(g) {
  const O = g.op, op = g.content.game.ops[O.id];
  if (O.phase === "exec") return [{ id: "op_exec", kind: "op", label: `실행한다 — ${op.target}`, skill: op.skill, opD: op.D, risk: "들키면 끝이다" }, { id: "op_abort", kind: "op", label: "물러난다 — 오늘은 아니다" }];
  if (O.phase === "escape") {
    const route = opReady(g, op).some((r) => r.phase === "탈출" && r.ok);
    return [...(route ? [{ id: "op_flee:route", kind: "op", label: "준비해 둔 길로 빠진다", skill: "은신", opD: O.caught ? 40 : 22 }] : []), { id: "op_flee:any", kind: "op", label: "아무 데로나 달린다", skill: "은신", opD: O.caught ? 55 : 35 }];
  }
  return [{ id: "op_cover:wipe", kind: "op", label: "흔적을 지운다", skill: "손재주", opD: 30 }, { id: "op_cover:frame", kind: "op", label: `${displayName(g, op.scapegoat)}에게 누명을 씌운다`, risk: "그 사람이 대신 맞는다" }, { id: "op_cover:none", kind: "op", label: "그대로 둔다 — 빨리 잔다" }];
}
// 얼룩 (13 §3.2)// 얼룩 (13 §3.2): 어두운 행적은 영혼에 남는다 — 그 사람을 다시 보면 손이 무겁다
const DARK = new Set(["inform", "betray", "kill_serf"]);
// ── 영역 (09): domain.mjs ──
const DMH = () => ({ sites: () => DOMDATA().sites || {}, stewards: () => DOMDATA().stewards || {}, facilities: () => DOMDATA().facilities || {}, atPlace, storyWhen, relOf, hash, placeName, displayName, winterStart: toMinutes(312, 10, 30) });
let _domData = null; const DOMDATA = () => _domData || {};
function domainTick(g, day) {
  _domData = g.content.game.domains;
  if (g.domain?.open && !g.domain.lost && g.domain.siege?.length && day * 1440 >= g.domain.siege[0]) { g.domain.siege.shift(); (g.domainDue ??= []).push("siege"); }
  const ev = g.domain?.open ? (g.t >= g.domain?.nextReport ? (g.domain.nextReport += 10 * 1440, "report") : null) : DOM.domainDay(g, day, DMH());
  if (!ev) return;
  const D = g.domain;
  if (ev === "empty") { g.feed.push({ kind: "echo", text: `〰 ${placeName(g, D.at)}이(가) 비었다. 남은 사람이 없다.` }); return; }
  if (ev === "steward") { (g.domainDue ??= []).push("report"); return; }   // 후임 문제는 보고로 온다
  if (ev === "usurp") { g.feed.push({ kind: "echo", text: `〰 ${displayName(g, D.steward)}이(가) ${placeName(g, D.at)}을(를) 제 것으로 삼았다. 너는 이제 거기 사람이 아니다.` }); D.lost = true; return; }
  (g.domainDue ??= []).push(ev);
}
// 보고·수색대 장면은 조용한 순간에 연다 (전령이 온다 — 페인이, 혹은 바람이)
function domainStoryTick(g) {
  if (!g.domainDue?.length || g.story || g.convo || g.fight || g.ended) return false;
  const ev = g.domainDue.shift();
  if (ev === "hostage") { const F = g.family; F.hostage = F.members.find((n) => n === "npc_kit") || F.members[0]; g.storyCtx = { ...(g.storyCtx || {}), hostage: F.hostage }; }
  if (ev === "report" && g.domain) { g.domain.newsNow = g.domain.news || []; g.domain.news = []; }   // 이 보고가 전할 소식 (한 번 전하면 끝)
  const st = SL(g, { raid: "domain_raid", report: "domain_report", birth: "family_birth", hostage: "family_hostage", siege: "rising_siege", child: "child_question" }[ev]); if (!st) return false;
  g.storyDone.delete(st.id); openStory(g, st);
  return true;
}
function domainFill(g, text) {
  _domData = g.content.game.domains;
  const D = g.domain, V = D ? DOM.domainView(g, DMH()) : null;
  const S = D ? (g.content.game.domains.stewards[D.steward] || {}) : {};
  const near = D && atPlace(g, D.at);
  const ask = !V ? "" : V.foodDays < 10 ? "먹을 것이 모자랍니다. 새로 온 자들을 받을지 정해 주십시오." : V.exposure > DOM.THRESHOLD - 15 ? "너무 많이 보입니다. 발자국을 줄여야 합니다." : S.belief === "해방" ? "더 받을 수 있습니다. 문을 열지요." : "겨울을 넘길 수 있을지, 아직은 모릅니다.";
  const mem = (soul(g).domainMemory || []).includes("traitor") ? "〰 기억: 지난 회차의 이 무렵, 문을 열었다. 새로 온 사내 하나가 볼크에게 길을 팔았다." : "";
  return String(text || "").replace(/\{dom_(\w+)\}/g, (_, k) => {
    if (!V) { const s2 = g.content.game.domains.sites; const at = DOM.canFound(g, DMH()); const site = s2[at] || {}; return { name: site.name, steward: displayName(g, site.steward), pop: site.pop_var ? g.S.vars[site.pop_var] : site.pop, food: site.food_days }[k] ?? ""; }
    const news = [...(D.newsNow || []), ...(V.building ? [`${V.building.name} — 짓는 중 (${V.building.days}일 남음)`] : [])];
    return { messenger: near ? "" : "밤에, 페인이 처마에서 내려와 귓속말을 한다. 언덕에서 온 말이다.", name: V.at, stage: V.stage, pop: V.pop, food: V.foodDays, defense: V.defense, conceal: V.conceal, morale: V.morale, order: V.order, exposure: `${V.exposure}/${V.threshold}`, steward: V.steward, ask, memory: mem, news: news.length ? `소식: ${news.join(" · ")}` : "" }[k] ?? "";
  });
}
function domainEffect(g, [op, a], res) {
  _domData = g.content.game.domains;
  const D = g.domain, F = g.content.game.domains.facilities || {};
  if (op === "found") { const at = DOM.canFound(g, DMH()) || g.at; DOM.found(g, at, DMH()); g.P.met.add(g.domain.steward); g.P.notebook.push(`영역 — ${placeName(g, at)}. 관리자 ${displayName(g, g.domain.steward)}`); return; }
  if (!D) return;
  if (op === "policy") D.policy = a;
  else if (op === "morale") D.morale = clamp(D.morale + Number(a), 0, 100);
  else if (op === "exposure_mod") D.expMod = (D.expMod || 0) + Number(a);
  else if (op === "exposure_reset") { D.expMod = (D.expMod || 0) - 20; D.alarm = 0; }
  else if (op === "build") {
    // 짓기에는 날과 먹을 것이 든다 (09 §5): 일하는 손은 먹어야 한다. 시설의 조건(when)이 맞아야 한다
    if (D.built.includes(a) || D.building || (F[a]?.when && !storyWhen(g, F[a].when))) return;
    const days = F[a]?.days || 6; D.building = { id: a, until: g.t + days * 1440 };
    D.food = Math.max(0, D.food - Math.round(DOM.popOf(g, D) * 0.2 * days));
  }
  else if (op === "appoint") {
    // 관리자를 바꾼다 (09 §6): 새 사람은 너를 얼마나 믿느냐로 충성이 정해진다 — 야심 큰 사람은 칼이 된다
    if (!a || g.S.dead.has(a) || a === D.steward) return;
    const old = D.steward; D.steward = a; D.delegation = "direct"; D.usurped = false;
    if (old && !g.S.dead.has(old)) bumpRel(g, old, -6, -8);
    g.P.met.add(a); g.P.notebook.push(`영역 — 관리자를 ${old ? `${displayName(g, old)}에서 ` : ""}${displayName(g, a)}(으)로`);
  }
  else if (op === "delegate") D.delegation = a;
  else if (op === "food_add") D.food += Number(a);
  else if (op === "raid_held") { D.morale = clamp(D.morale + 8, 0, 100); D.expMod = (D.expMod || 0) - 10; DIR.crisis(g, 4); }
  else if (op === "raid_lost") {
    const lost = Math.round(DOM.popOf(g, D) * Number(a)); DOM.addPop(g, D, -lost); g.S.vars.fugitives_caught = (g.S.vars.fugitives_caught || 0) + lost;
    D.morale = clamp(D.morale - 15, 0, 100); D.expMod = (D.expMod || 0) - 15; DIR.crisis(g, 4); DIR.loss(g, 8);
    if (g.hide && g.hide.at === D.at && !g.hide.lost) g.hide.exposure = 1;
    res && res.notes?.push(`${lost}명이 끌려갔다`);
  }
}
// ── 봉기 (SCENARIOS §3.4 「여울강이 붉어지는 날」): 준비 지표 여섯 중 넷 ──
const RISING = [
  ["브란의 창날 마흔", (g) => !!g.S.vars.bran_spears],
  ["군나르의 훈련", (g) => !!g.S.vars.gunnar_trains],
  ["시그리드의 북방인", (g) => !!g.domain && !g.domain.lost && g.domain.steward === "npc_sigrid" && DOM.loyaltyOf(g, g.domain, DMH()) >= 40],
  ["성채 안의 손 (사라·오웬)", (g) => romanceStage(g, "npc_sara") >= 2 || relOf(g, "npc_owen_raven").trust >= 30],
  ["마르타의 전향", (g) => relOf(g, "npc_martha").trust >= 40],
  ["즈닉의 처리", (g) => g.S.dead.has("npc_znik") || !!g.S.vars.znik_submitted],
];
export const risingReady = (g) => { _domData = g.content.game.domains; return RISING.map(([label, f]) => ({ label, ok: f(g) })); };
function risingEffect(g, op, res) {
  _domData = g.content.game.domains;
  const ready = risingReady(g).filter((x) => x.ok).length;
  if (op === "success") {
    // 해방구 (09 §2 단계 3): 숨길 수 없는 땅 — 대신 진압군이 온다 (30·60·90일)
    g.domain = { at: "gf_whip_square", popVar: null, pop: 400, steward: g.S.dead.has("npc_gunnar") ? "npc_bran" : "npc_gunnar", food: 400 * 0.4 * 30, defense: 10 + ready * 5, morale: 70, order: 50, literacy: 0, built: [], policy: "open", delegation: "direct", since: g.t, nextReport: g.t + 10 * 1440, alarm: 0, lost: false, open: true, siege: [30, 60, 90].map((d) => g.t + d * 1440), held: 0 };
    g.S.vars.greyford_free = true; g.A.doEffect("kill npc_znik", g.t); g.S.vars.player_fugitive = false; if (wantedOf(g)) { const w = wantedOf(g); w.local[SETTLEMENT] = 0; w.heat = Object.values(w.local).reduce((a, b) => a + b, 0); }
    DIR.crisis(g, 5); temper(g, "용기", 10);
  } else if (op === "fail" || op === "fall") {
    // 반동 「두 번째 붉은 길」: 참가자의 칠할이 길가에서 — 처형자 명부는 회귀하면 없다. 이름은 네가 외운다
    g.S.vars.red_road = true; g.S.vars.rising_failed = true;
    const names = ["npc_bran", "npc_gunnar", "npc_sigrid", "npc_bram", "npc_dietmar", "npc_fayne"].filter((n) => !g.S.dead.has(n) && hash(g.seed, "redroad", n) < 0.7);
    for (const n of names) g.A.doEffect(`kill ${n}`, g.t);
    g.redRoad = names; DIR.loss(g, 15); DIR.crisis(g, 5);
    g.P.status.stress = clamp(g.P.status.stress + 20, 0, 100);
    if (g.domain?.open) g.domain.lost = true;
    if (hash(g.seed, "redroad", "player") < 0.6) g.ended = { kind: "dead", why: "두 번째 붉은 길 — 봉기는 진압되었다", t: g.t, trace: { id: "rope" } };
  } else if (op === "held") { g.domain.held++; g.domain.morale = clamp(g.domain.morale + 5, 0, 100); if (g.domain.held >= 3) { g.S.vars.rising_held_90 = true; g.P.notebook.push("해방구가 아흔 날을 버텼다 — 다라보다 아홉 날 길다"); } }
  else if (op === "truce") { g.domain.siege = g.domain.siege.map((t) => t + 10 * 1440); }
  else if (op === "charter") {
    // 하사받는다 (09 §3): 칙허 — 영역이 공인 영지가 된다. 하사한 자가 지면 휴지
    if (g.domain && !g.domain.lost) { g.domain.chartered = true; g.domain.open = true; }
    else { g.domain = { at: "greyford__west_pasture", popVar: null, pop: 30, steward: "npc_gunnar", food: 30 * 0.4 * 30, defense: 5, morale: 60, order: 60, literacy: 0, built: [], policy: "open", delegation: "direct", since: g.t, nextReport: g.t + 10 * 1440, alarm: 0, lost: false, open: true, chartered: true }; }
  }
}
// ── 진명 (GAME_DESIGN §5) ──
const knowsWord = (g, w) => { const T = g.content.game.truenames?.[w]; return !!T && (!!g.S.vars[T.var] || (soul(g).trueNames || []).includes(w)); };
function witchCheck(g, res) {
  const seen = present(g).filter((w) => w.kind !== "captive" && !asleep(w, g.t) && !g.family?.members.includes(w.npc)).map((w) => w.npc);
  if (!seen.length) return;
  wantedAdd(g, 3, "마녀 — 진명을 불렀다");
  g.S.vars.witch_seen = true; for (const n of seen) addMemory(g, n, { kind: "emotion", tag: "위험함", text: "셋째가 알 수 없는 것을 불렀다", salience: 5, source: "engine" });
  const x = ((g.nem ??= {}).npc_isol ??= { grudge: 0, track: 0, since: g.t }); x.grudge = Math.max(x.grudge, 2);
  res.notes.push(`${seen.map((n) => displayName(g, n)).join(", ")}이(가) 보았다`);
}
// ── 가족 (12 §6~8): 임신·출산 (긴 회차에서만), 인질 ──
function familyDay(g, day) {
  const F = g.family; if (!F) return;
  if (F.bound && !F.pregnant && (g.t - F.bound) >= 20 * 1440 && hash(g.seed, "preg", day) < 0.02 && !g.S.dead.has("npc_sara")) { F.pregnant = { since: g.t, due: g.t + 270 * 1440 }; g.P.notebook.push("사라가 네 손을 배 위에 올려놓는다. 아무 말도 하지 않는다."); }
  if (F.pregnant && g.t >= F.pregnant.due) { F.pregnant = null; (g.domainDue ??= []).push("birth"); }
  for (const c of F.children) childDay(g, c, day);
  const heat = heatHere(g, SETTLEMENT);   // 식구를 잡는 것은 회색여울의 윗선이다
  if (heat >= 4 && !F.hostageSeen && (F.members.length || F.children.length)) { F.hostageSeen = true; (g.domainDue ??= []).push("hostage"); }
}
// ── 양육 (12 §7.2): 아이는 자란다 · 보고 배운다 · 가르친 것이 아이의 것이 된다 · 뜻대로만 자라지 않는다 ──
const YEAR = 365;   // 열두 달 × 30일 + 재의 날 닷새 (sim/calendar)
const AXES = ["용기", "자비", "정직", "신앙", "탐욕", "충성"];
// 같은 아이는 다시 만들지 않는다 (12 §7.3): 출생 순간의 시드로 굴리고, 잃은 아이와 겹치면 다시 굴린다
function newChild(g, name, sex) {
  const lost = (soul(g).lostChildren || []).filter((c) => c.temper);
  let temper, k = 0;
  do { temper = Object.fromEntries(AXES.map((a) => [a, Math.round((hash(g.seed, "childT", g.t, a, k) - 0.5) * 40)])); k++; }
  while (k < 20 && lost.some((c) => AXES.every((a) => Math.abs((c.temper[a] || 0) - temper[a]) < 8)));
  const own = AXES[Math.floor(hash(g.seed, "childOwn", g.t, k) * AXES.length)];   // 이 아이만의 고집 — 이 축은 너를 닮지 않는다
  return { name, sex, born: g.t, place: HOME, temper, own, skills: {}, seen: [], taught: 0 };
}
export const childAge = (g, c) => { const d = Math.floor((g.t - c.born) / 1440); return d >= YEAR ? `${Math.floor(d / YEAR)}살` : d >= 30 ? `${Math.floor(d / 30)}개월` : `${d}일`; };
const CHILD_MILESTONES = [
  [40, "first_smile", (c) => `${c.name}이(가) 처음으로 너를 보고 웃는다. 이유는 없다.`],
  [330, "first_steps", (c) => `${c.name}이(가) 움막 기둥을 놓고 세 걸음을 걷는다. 네 번째에 넘어진다. 울지 않는다.`],
  [420, "first_word", (c) => `${c.name}의 첫 말. 엄마도 아빠도 아니다 — "빵".`],
  [900, "first_lie", (c) => `${c.name}이(가) 처음으로 거짓말을 한다. 빵 부스러기가 입가에 붙어 있다. 너는 웃음을 참는다. 이 마을에서 거짓말은 살아남는 기술이다.`],
  [1440, "whip", (c) => `${c.name}이(가) 채찍 기둥 쪽을 오래 본다. 묻지 않는다. 아이들은 묻지 않는 법을 일찍 배운다.`],
];
function childDay(g, c, day) {
  const age = Math.floor((g.t - c.born) / 1440);
  for (const [d, id, line] of CHILD_MILESTONES) if (age >= d && !c.seen.includes(id)) { c.seen.push(id); g.feed.push({ kind: "echo", text: `〰 ${line(c)}` }); g.P.notebook.push(`${c.name} — ${line(c)}`); }
  // 보고 배운다: 두 살부터, 너의 성향 쪽으로 천천히. 고집하는 축은 반대로 조금
  if (age >= 2 * YEAR) for (const a of AXES) {
    const pv = g.P.temper[a] || 0, d = (pv - c.temper[a]) * 0.004;
    c.temper[a] = clamp(c.temper[a] + (a === c.own ? -d * 0.5 : d), -100, 100);
  }
  if (age >= 5 * YEAR && !c.asked && !g.storyDone.has("child_question")) { c.asked = true; g.storyCtx = { ...(g.storyCtx || {}), child: c.name }; (g.domainDue ??= []).push("child"); }
}
export function childTraits(c) { return Object.entries(c.temper || {}).filter(([, v]) => Math.abs(v) >= 30).map(([k, v]) => TRAITS[k][v > 0 ? 1 : 0]); }
function familyEffect(g, [op, a]) {
  const F = (g.family ??= { members: [], children: [] });
  if (op === "bound") { F.bound = g.t; F.members.includes(a) || F.members.push(a); }
  else if (op === "ransom") { const w = wantedOf(g); if (w) { const k = SETTLEMENT; w.local[k] = Math.max(0, (w.local[k] || 0) - 2); w.heat = Object.values(w.local).reduce((a, b) => a + b, 0); } }
  else if (op === "child_temper") { for (const c of F.children) { const [ax, d] = a.split(":"); c.temper[ax] = clamp((c.temper[ax] || 0) + Number(d), -100, 100); } }
  else if (op === "abandon") { const h = F.hostage; if (h === "npc_kit") { g.S.vars.kit_on_list = true; } DIR.loss(g, 10); F.members = F.members.filter((x) => x !== h); }
}
// ── 연출가 (18): director.mjs — 여기서는 도우미만 넘긴다 ──
const DH = () => ({ START, soul, goals, threads, atPlace, storyWhen, parseClock, isNight, hash });
function tension(g) { return g.dir?.T ?? DIR.tensionRaw(g, DH()); }
function vignetteTrigger(g, t) {
  if (g.run.opening === false && !g.run.lethal) return null;
  if (g.story || g.ended || g.convo || g.fight) return null;
  if (t < START + 11 * 60) return null;            // 첫 저녁과 첫 밤은 대본의 것이다 (2일 새벽까지)
  return DIR.pickScene(g, t, DH());
}
// 성향 (01 §1.3): −100~100. ±60에서 특성이 된다. 처음의 나(0)에서 얼마나 멀어졌나 = 본디의 거리 (15 §7.5)
function temper(g, axis, d) { if (g.P.temper[axis] == null) return; g.P.temper[axis] = clamp(g.P.temper[axis] + d, -100, 100); }
const TRAITS = { 용기: ["겁 많은", "대담한"], 자비: ["냉혹한", "다정한"], 정직: ["거짓에 능한", "곧은"], 신앙: ["믿지 않는", "경건한"], 탐욕: ["욕심 없는", "탐욕스러운"], 충성: ["누구도 믿지 않는", "곁을 지키는"] };
export function traits(g) { return Object.entries(g.P.temper).filter(([, v]) => Math.abs(v) >= 60).map(([k, v]) => TRAITS[k][v > 0 ? 1 : 0]); }
// 행동이 성향을 민다 — 고른 것이 그 사람을 만든다
const TEMPER_OF = { attack: { 자비: -3, 용기: 2 }, give: { 자비: 2, 탐욕: -1 }, press: { 정직: -1, 용기: 1 }, loot: { 탐욕: 2, 자비: -1 }, hide_body: { 정직: -2 }, ration: {}, oath: { 충성: 3 }, wash: { 정직: -1 } };
// ── 기억 표지 (14 §7.5): ┊ 지난 회차에 일어났던 일 · ◇ 기억과 어긋남 ──
// 엔진이 고른 줄을 그대로 화면에 (LLM이 쓰지 않는다). 회차 안에서 같은 방아쇠에 한 번, 한 박자에 둘까지.
function memoryInk(g) {
  const day = Math.floor(g.t / 1440), key = `${day}|${Math.floor((g.t % 1440) / 30)}|${g.at}`;
  const here = present(g).filter((w) => w.kind !== "captive").map((w) => w.npc);
  const obs = (g.P.obs ??= {});
  if (obs[key] == null && Object.keys(obs).length < 6000) obs[key] = here.join(",");   // 넉 달 치 — 글자로 접어 영혼을 가볍게
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
  // 얼룩: 지난 회차에 판 사람 (13 §3.2) — 재회의 무게
  for (const st of soul(g).stains || []) if (st.victim && here.includes(st.victim)) { if (!said.has(`stain:${st.victim}`)) g.P.status.stress = clamp(g.P.status.stress + 5, 0, 100); ink(`stain:${st.victim}`, `┊ 너는 이 사람을 ${st.kind === "inform" ? "팔았었다" : st.kind === "betray" ? "사냥대에 넘겼었다" : "죽였었다"}. 이 사람은 모른다.`); }
  // 재회 (12 §2.2): 지난 회차의 연인
  for (const [n, stg] of Object.entries(soul(g).romance || {})) if (stg >= 3 && here.includes(n)) ink(`love:${n}`, stg >= 4 ? "┊ 이 손목에 끈이 감겨 있었다. 지금은 너를 모른다." : "┊ 이 손이 네 손을 잡았었다. 지금은 너를 모른다.");
  // 처형자 명부 (SCENARIOS §3.4): 명부의 이름들은 모두 살아 있다. 당신은 그 이름을 외운다
  for (const n of soul(g).redRoad || []) if (here.includes(n)) ink(`redroad:${n}`, `┊ 이 사람은 붉은 길 옆에서 죽었었다. 네가 불렀기 때문에. 지금은 살아 있다.`);
  // 그 회차에만 있던 아이 (20 §6.1 소멸)
  for (const c of soul(g).lostChildren || []) if (g.at === c.place) ink(`child:${c.name}:${c.loop}`, `┊ 여기서 ${c.name}이(가) 태어났었다. 이번엔 태어나지 않는다.`);
  // 지난 회차에 이름을 붙여 준 것 (이번엔 그 이름을 모른다)
  for (const n of here) if (soul(g).names?.[n] && !g.P.names?.[n]) ink(`named:${n}`, `┊ 너는 이 개를 '${soul(g).names[n]}'(이)라 불렀다. 지금은 아무도 그렇게 부르지 않는다.`);
  // 지난 회차에 너를 쫓던 사람 (17 §3.7 휴면 숙적): 그는 모른다. 너는 안다
  for (const x of soul(g).nemeses || []) if (here.includes(x.npc)) ink(`nem:${x.npc}`, "┊ 이 사람은 너를 쫓았었다. 지금은 너를 모른다.");
  // ◇ 표류: 지난 회차의 같은 날·같은 30분·같은 자리와 지금이 다르다 (회차마다 처음 3번만 진동, H5)
  const pastRaw = soul(g).obs?.[key];
  const past = typeof pastRaw === "string" ? pastRaw.split(",").filter(Boolean) : pastRaw;
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
  fall: { name: "발밑", ink: "발밑이 꺼지는 것 같다. 돌바닥은 그대로다.", why: "발이 먼저 기억한다. 여기서 떨어졌다." },
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
  if (g.story || g.ended) return;     // 대본 장면이 열려 있으면 시간은 그 장면의 선택이 흘린다 (끝난 판은 흐르지 않는다)
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
        const w = wantedAdd(g, 3, "탈주", overseer(g), SETTLEMENT); w.since ??= next; w.settlement = SETTLEMENT;
        g.deeds.push({ id: `d${g.deeds.length + 1}`, kind: "flee", victim: null, at: ROLLCALL, placeName: placeName(g, ROLLCALL), t: next });
        g.L.believe(overseer(g), next, { kind: "trespass", subject: "player", at: ROLLCALL, source: "noticed", reason: "탈주" }, { react: false });
        g.S.log.push({ t: next, npc: overseer(g), agenda: "sim", vis: "public", text: "감독관이 셋째를 탈주 노예로 올렸다 — 바르그 조합에 현상금" });
      }
    }
    // 통금 순찰 (21:00·23:00·02:00): 막사 밖에 있는 인간은 걸린다 — 은신 판정
    if (!g.P.traveling && g.P.settlement !== SETTLEMENT && hm % 60 === 0 && !g.ended) checkpoint(g, null, isNight(next) ? 0.04 : 0.08, next);
    if (g.P.settlement === SETTLEMENT && !g.P.traveling && ["21:00", "23:00", "02:00"].some((x) => parseClock(x) === hm) && g.at !== HOME && !g.W.loc.get(g.at)?.outer && !g.ended) {
      const P = prob(skill(g, "은신") + g.P.mods.민첩 * 2 + 6, 22);
      if (hash(g.seed, "patrol", next) >= P) {
        g.P.status.pain = clamp(g.P.status.pain + 15, 0, 100);
        g.feed.push({ kind: "rule", text: "통금 순찰에 걸렸다. 크릭 감독의 몽둥이 — 그리고 막사로 끌려간다." });
        g.at = HOME;
        g.S.vars.player_curfew = (g.S.vars.player_curfew || 0) + 1;
      }
    }
    if (g.P.settlement === SETTLEMENT && isNight(next) && g.at !== HOME && !g.P.traveling && next % 60 === 0) g.P.nightOut = (g.P.nightOut || 0) + 1;
    manhunt(g, next);
    t = next;
    if (g.ended) break;
    if (trig) { openStory(g, trig.st); break; }
    const wt = !sleeping || true ? windowTrigger(g, next) : null;
    if (wt) { g.t = next; openStory(g, wt); break; }
    const vg = vignetteTrigger(g, next);
    if (vg) { g.t = next; openStory(g, vg); break; }
    if (threatsTick(g, next)) break;
    if (domainStoryTick(g)) { g.t = next; break; }
    oathsTick(g, next);
    promisesTick(g, next);
  }
  g.t = Math.min(g.story ? t : to, g.ended?.t ?? to);
  for (let d = Math.floor(from / 1440) + 1; d <= Math.floor(to / 1440); d++) {
    nemesisDay(g, d);
    hideTick(g, d);
    DIR.directorDay(g, d);
    domainTick(g, d);
    familyDay(g, d);
    wantedCool(g, d);
    liesTick(g);
    flagsDay(g, d);
    echoTick(g, d);
    ladderTick(g, d);
    // 감정은 며칠에 걸쳐 흐려진다 (21 §6.4) — 사실과 약속은 남고, 마음의 열기만 식는다
    for (const m of Object.values(g.M)) for (const x of m.memories) if (x.kind === "emotion") x.salience = Math.max(0.5, (x.salience || 1) - 0.2);
  }
  if (sleeping) { g.P.status.pain = clamp(g.P.status.pain - 10, 0, 100); g.P.status.fatigue = clamp(g.P.status.fatigue - Math.round(minutes / 60) * 12, 0, 100); }
  else g.P.status.fatigue = clamp(g.P.status.fatigue + Math.round(minutes / 60) * 3 + (g.P.working ? Math.round(minutes / 60) * 3 : 0), 0, 100);
  // 하루에 한 번 배가 고파진다 (배급을 받으면 준다)
  for (let d = Math.floor(from / 1440) + 1; d <= Math.floor(to / 1440); d++) {
    // 굶주림: 이미 바닥(4)이면 몸이 먹힌다 — 아픔 +15, 100이면 죽는다
    if (g.P.status.hunger >= 4) { g.P.status.pain = clamp(g.P.status.pain + 15, 0, 100); g.feed.push({ kind: "rule", text: "사흘째 빈속이다. 손이 떨리고 무릎이 꺾인다." }); }
    g.P.status.hunger = clamp(g.P.status.hunger + 1, 0, 4);
    if (g.P.status.pain >= 100 && !g.ended) {
      // 첫 회차의 무작위 사망 감쇄 (14 §3.3): 고른 길의 끝이 아닌 죽음은 한 번 빈사로 — 첫 회귀는 플레이어가 고른 길의 끝에서 와야 한다
      if (g.run.loop === 1 && !g.P.spared) { g.P.spared = true; g.P.status.pain = 80; g.P.status.hunger = 2; g.feed.push({ kind: "rule", text: "눈앞이 하얘진다. 누군가 너를 막사로 끌고 간다. 입에 묽은 죽이 흘러든다 — 게르다다." }); g.at = HOME; continue; }
      g.P.alive = false; g.ended = { kind: "dead", why: "굶주림과 상처 — 몸이 더 버티지 못했다", t: d * 1440, trace: { id: "hunger" } };
    }
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
// 수배 (10 §6): 고장마다 따로 — 까마귀 문에서 한 일로 회색여울 막사에서 잡히지 않는다. 쫓는 사람은 늘 있다 (그 고장의 윗선)
function authorityOf(g, sid = g.P.settlement) {
  if (sid === SETTLEMENT && overseer(g) && !g.S.dead.has(overseer(g))) return overseer(g);
  return (g.content.game.sim.defaults_by_settlement?.[sid]?.report_to || []).find((n) => !g.S.dead.has(n)) || null;
}
function wantedOf(g) {
  const w = g.S.wanted?.player; if (!w) return null;
  w.local ??= { [w.settlement || SETTLEMENT]: w.heat || 0 };   // 옛 모양(고장 하나)도 읽는다
  return w;
}
export function wantedAdd(g, heat, reason, by = null, sid = g.P.settlement) {
  const w = (g.S.wanted.player ??= { heat: 0, by: new Set(), reasons: [], local: {} }); wantedOf(g);
  w.local[sid] = (w.local[sid] || 0) + heat; w.heat = Object.values(w.local).reduce((a, b) => a + b, 0);
  w.since ??= g.t; w.lastAt = g.t;
  const hunter = by || authorityOf(g, sid); if (hunter) w.by.add(hunter);
  if (reason) w.reasons.push(reason);
  return w;
}
const heatHere = (g, sid = g.P.settlement) => wantedOf(g)?.local?.[sid] || 0;
// 시간이 지나면 식는다 (10 §6.3): 사흘 조용하면 하루에 0.25씩 — 탈주 노예라는 사실(변수)은 식지 않는다
function wantedCool(g, day) {
  const w = wantedOf(g); if (!w || day * 1440 - (w.lastAt ?? w.since ?? 0) < 3 * 1440) return;
  for (const k of Object.keys(w.local)) w.local[k] = Math.max(0, +(w.local[k] - 0.25).toFixed(2));
  w.heat = Object.values(w.local).reduce((a, b) => a + b, 0);
}

// 낯선 고장의 인간: 길목·순찰에서 통행증을 요구받는다. 없으면 탈주 노예로 붙잡힌다. 위조 통행증은 기만 판정.
// 소문(평판)이 이 고장까지 닿았고 얼굴이 알려졌으면 더 어렵다. 자유민의 땅(윗선이 없는 고장)은 묻지 않는다.
function checkpoint(g, res, p, T = g.t) {
  // T: 검문이 일어나는 시각 — pass() 안에서는 g.t가 아직 출발 시각이다 (매시 다른 굴림이어야 한다)
  const chain = g.content.game.sim.defaults_by_settlement?.[g.P.settlement]?.report_to || [];
  if (!chain.length || g.ended) return;
  if (g.P.clearedUntil > T) return;                       // 한 번 넘긴 검문은 하루 동안 다시 묻지 않는다
  const l = g.W.loc.get(g.at) || {};
  if (l.outer || ["secret", "serf"].includes(l.access)) p *= 0.25;   // 마을 밖·숨은 곳·인간 거처는 덜 묻는다
  if ((g.P.ladder?.[g.P.settlement] || 0) >= 1) p *= 1.5;              // 현상금이 붙으면 검문이 강해진다 (10 §5.1)
  const roll = hash(g.seed, "check", g.P.settlement, T);
  if (roll >= p) return;
  const pass = mine(g).find((i) => i.tags?.includes("통행증"));
  const rep = reputation(g);
  const known = rep.news.some((n) => n.identified && n.scope !== "village");
  let ok = false, text;
  if (pass) {
    const P2 = prob(skill(g, "기만") + g.P.mods.지능 * 2 + (pass.tags.includes("위조") ? 0 : 20) - (known ? 10 : 0), 22);
    ok = hash(g.seed, "check-pass", T) < P2;
    text = ok ? "경비가 통행증을 오래 들여다보다가 돌려준다." : "경비가 통행증의 인장을 손톱으로 긁는다. 위조다.";
  } else text = "경비가 묻는다. 누구의 것이냐, 통행증은. 대답할 것이 없다.";
  if (ok) g.P.clearedUntil = T + 1440;
  if (!ok) { g.ended = { kind: "captured", why: `${text} 탈주 노예로 붙잡혔다 — ${g.content.bundle.settlements[g.P.settlement]?.name}`, t: T, trace: { id: "rope" } }; }
  (res?.notes || g.feed).push(res ? text : { kind: "rule", text });
}

// 수배: 쫓는 윗선이 같은 자리에 있으면 붙잡힌다. 수배 3 이상이면 낮 동안 사람을 풀어 찾는다 —
// 막사·광장처럼 뻔한 곳은 금방, 숨은 곳(비밀 장소)·마을 밖은 느리게. 숨을 곳을 찾아 달아나는 것이 길이다
function manhunt(g, next) {
  const w = wantedOf(g);
  if (!w || heatHere(g) < 3 || g.ended || next - (w.since ?? next) < 60 || next % 60 !== 0) return;
  if (g.P.traveling) return;   // 쫓는 사람들은 자기 고장에서만 찾는다 — 고장마다 수배가 따로다 (소문이 닿은 곳은 검문이 맡는다)
  const hm = ((next % 1440) + 1440) % 1440;
  const day = hm >= 6 * 60 && hm < 21 * 60;
  const l = g.W.loc.get(g.at) || {};
  const hidden = l.access === "secret" || l.outer;
  const p = (hidden ? 0.08 : g.at === HOME ? 0.7 : day ? 0.45 : 0.15) * ((g.P.ladder?.[g.P.settlement] || 0) >= 3 ? 1.4 : 1);   // 수색령: 집집마다
  if (hash(g.seed, "hunt", next) < p) {
    const by = [...w.by].find((n) => !g.S.dead.has(n) && g.W.where(n, next)?.settlement === g.P.settlement) || authorityOf(g);
    g.ended = { kind: "captured", why: `${by ? `${nameOf(g, by)}의 사람들이` : "경비대가"} 당신을 찾아냈다 — ${w.reasons.slice(-1)[0] || ""}`, t: next, trace: { id: "rope", ...(by ? { npc: by } : {}) } };
    g.feed.push({ kind: "rule", text: g.ended.why });
  }
}
function checkDanger(g) {
  if (g.ended) return;
  const w = wantedOf(g);
  if (!w || heatHere(g) < 2) return;
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
  if (st.severity) DIR.crisis(g, st.severity);   // 실제로 열린 장면만 긴장 곡선을 흔든다
  const needName = (st.input === "true_name" && !trueName(g)) || st.input === "child_name";
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
    if (at > t && at <= next && atPlace(g, tr.at) && storyWhen(g, tr.when, at)) return { t: at, st };
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
// at: 장소 id, 장소 목록, 또는 "@고장" (그 고장 어디든)
const atPlace = (g, at) => !at || [].concat(at).some((x) => (x.startsWith("@") ? g.P.settlement === x.slice(1) : g.at === x || g.W.loc.get(g.at)?.parent === x));
const parseDT = (x) => { const [d, hm = "00:00"] = String(x).split(" "); const { y, m, d: dd } = parseDate(d); return toMinutes(y, m, dd) + parseClock(hm); };
// 대본 장면의 조건: 목표 행동 문법 + 플레이어 쪽 (pknows 사실 · been 장소 · loop >= n · rel_trust npc >= n · trace 흔적)
function storyWhen(g, conds, t = g.t) {
  for (const c of conds || []) {
    const [k, a, b, d] = c.replace(/^not /, "").split(/\s+/), neg = c.startsWith("not ");
    let r;
    if (k === "pknows") r = knowsFact(g, a);
    else if (k === "been") r = g.P.been.has(a);
    else if (k === "loop") r = { ">=": g.run.loop >= Number(b), "==": g.run.loop === Number(b) }[a];
    else if (k === "rel_trust") r = { ">=": relOf(g, a).trust >= Number(d), "<": relOf(g, a).trust < Number(d) }[b];
    else if (k === "trace") r = (soul(g).traces || []).some((x) => x.id === a);
    else if (k === "with") r = present(g, t).some((w) => w.npc === a && w.kind !== "captive");
    else if (k === "domain_any") r = !!g.domain && !g.domain.lost;
    else if (k === "domain_has") r = !!g.domain?.built.includes(a);
    else if (k === "domain_lacks") r = !!g.domain && !g.domain.built.includes(a);
    else if (k === "domain_delegation") r = g.domain?.delegation === a;
    else if (k === "domain_steward") r = g.domain?.steward === a;
    else if (k === "domain_building") r = !!g.domain?.building;
    else if (k === "domain_memory") r = (soul(g).domainMemory || []).includes(a);
    else if (k === "has") r = hasTag(g, a);
    else if (k === "romance") r = { ">=": romanceStage(g, a) >= Number(d) }[b];
    else r = g.A.cond(c.replace(/^not /, ""), t);
    if (neg ? r : !r) return false;
  }
  return true;
}
// 기간 안에 조건이 맞는 첫 순간에 열리는 장면 (치명적 자리 — 14 §3.2)
function windowTrigger(g, t = g.t) {
  if (g.run.opening === false && !g.run.lethal) return null;
  if (g.story || g.ended || g.convo) return null;
  for (const st of g.content.game.storylets || []) {
    const tr = st.trigger || {};
    // 시각이 정해진 장면을 놓쳤으면 (그 자리에 없었으면) late까지 그 자리에 오는 순간 열린다 — 첫 회차의 재능 장면 (14 §8 #6)
    const win = tr.window || (tr.at_time && tr.late ? { from: tr.at_time, to: tr.late } : null);
    if (!win || g.storyDone.has(st.id)) continue;
    const fromL = win.from_loop ? Object.entries(win.from_loop).filter(([k]) => g.run.loop >= Number(k)).map(([, v]) => v).pop() : null;
    if (t < parseDT(fromL || win.from) || t > parseDT(win.to)) continue;
    if (!atPlace(g, tr.at)) continue;
    if (tr.night && !isNight(t)) continue;
    if (tr.with && !present(g, t).some((w) => w.npc === tr.with && w.kind !== "captive" && !asleep(w, t))) continue;
    if (!storyWhen(g, tr.when, t)) continue;
    return st;
  }
  return null;
}
// 이름: 첫 회차에 받은 이름은 이 회차의 상태(P)에, 회귀할 때 carry로 넘어간다 (재생해도 이름 입력은 기록에서 다시 온다)
const trueName = (g) => g.P.trueName || g.run.carry.trueName || null;
const sibling = (g) => g.P.sibling || g.run.carry.sibling || "형";
// 문맹과 모르는 말 (19 §4): {read|글} · {lang:용언|말} — 읽고쓰기·언어 스킬만큼만 보인다. 배우면 같은 글이 풀려 보인다
const readMask = (g, t) => {
  const r = skill(g, "읽고쓰기");
  if (r >= 30) return t;
  const names = new Set([...g.P.met].map((n) => displayName(g, n)).concat([trueName(g) || "", "셋째"]).filter(Boolean));
  return t.replace(/[^\s.,'"·—!?]+/g, (w) => (/^\d+$/.test(w) && r >= 1) || (r >= 10 && [...names].some((nm) => w.startsWith(nm))) ? w : "▯".repeat(Math.min(4, [...w].length)));
};
const tongueMask = (g, lang, t) => {
  const r = skill(g, lang === "용언" ? "용언" : lang);
  if (r >= 50) return `${t} (${lang})`;
  const known = new Set((lexicon(g) || []).filter((w) => w.meaning && (w.lang || "용언") === lang).map((w) => w.meaning.split(" — ")[0].trim()));
  if (r < 1 && !known.size) return `${t.replace(/[^\s.,!?]+/g, (w) => "■".repeat(Math.min(3, [...w].length)))} (${lang}이다. 알아들을 수 없다)`;
  return t.replace(/[^\s.,!?]+/g, (w) => ([...known].some((k) => w.startsWith(k)) || (r >= 20 && hash(g.seed, "tongue", w) < 0.7)) ? w : "■".repeat(Math.min(3, [...w].length)));
};
export const literacyFilter = (g, text) => String(text || "").replace(/\{read\|([^}]*)\}/g, (_, t) => readMask(g, t)).replace(/\{lang:([^|}]+)\|([^}]*)\}/g, (_, l, t) => tongueMask(g, l, t));
const fill = (g, text) => josa(domainFill(g, literacyFilter(g, String(text || "")))).trim().replace(/\{name\}/g, trueName(g) || "…").replace(/\{sibling\}/g, sibling(g))
  .replace(/\{(who|about|nem)\}/g, (_, k) => g.storyCtx?.[k + "Name"] || g.storyCtx?.[k] || "…")
  .replace(/\{hostage\}/g, () => displayName(g, g.storyCtx?.hostage || g.family?.hostage || "npc_kit"))
  .replace(/\{birth_helper\}/g, () => (relOf(g, "npc_elsa").trust >= 40 ? "엘사가 와 있다. 늙은 손이 빠르다." : "아무도 오지 않았다. 너와 게르다뿐이다."))
  .replace(/\{child\}/g, () => g.storyCtx?.child || g.family?.children?.at(-1)?.name || "아이")
  .replace(/\{rising_ready\}/g, () => risingReady(g).filter((x) => x.ok).map((x) => x.label).join(", ") || "없다")
  .replace(/\{rising_who\}/g, () => ["npc_bran", "npc_gunnar", "npc_sigrid", "npc_sara", "npc_martha", "npc_bram"].filter((n) => !g.S.dead.has(n) && (relOf(g, n).trust >= 20 || g.P.met.has(n))).map((n) => displayName(g, n)).join(", ") || "몇 안 되는 얼굴")
  .replace(/\{rising_siege_text\}/g, () => ["레이번가의 기사 열둘이 남쪽 길에 선다. 깃발은 없다 — 깃발이 필요 없는 자들이다.", "바알카르의 용인 백인대가 쇠다리를 건넌다. 창끝이 해를 가린다.", "와이번 그림자가 광장을 지난다. 한 번. 두 번. 세 번째는 내려온다."][Math.min(2, g.domain?.held || 0)])
  .replace(/\{gaze\}/g, () => String(Math.min(6, 3 + 0.5 * (g.run.loop - 1))).replace(".5", "과 반"))
  .replace(/\{volk_last\}/g, () => (g.S.vars.volk_lied ? '"도망치는 고기가 더 맛있다."' : '"너는 거짓말은 안 했다. 그러니 나도 안 하겠다. 아프다."'))
  .replace(/\{again_card\}/g, () => againCard(g))
  .replace(/\{record_full\}/g, () => { const r = soul(g).records.filter((x) => x.loop === g.run.loop - 1).pop(); return r ? recordCard(r).join("\n\n") : "…셀 것이 없다."; });
function storyOptions(g) {
  const st = SL(g, g.story.id);
  if (g.story.phase === "input") return st.input === "child_name" ? [{ id: "story_childname", kind: "story", label: "아이의 이름", input: "child_name" }] : [{ id: "story_name", kind: "story", label: "어머니가 부르는 이름", input: "true_name" }];
  const out = [];
  for (const c of st.choices || []) {
    // 두 번째 회차부터 어머니의 세 카드 중 고른 것만 진하다 — 다시 고를 수 없다 (14 §6.2)
    if (st.id === "serf_mother_memory" && g.P.talent && c.id !== `talent_${g.P.talent}`) continue;
    if (c.needs) { const [, k, op, v] = /^(\w+)\s*(>=|<=|>|<|==)\s*(\S+)$/.exec(c.needs) || []; if (k === "coin" && !(g.S.purse.player >= Number(v))) continue; }
    if (c.needs_fact && !knowsFact(g, c.needs_fact)) continue;
    if (c.when && !storyWhen(g, c.when)) continue;
    if (c.needs_tp && ((soul(g).tp || 0) - (g.P.tpSpent || 0) < c.needs_tp || talentsOf(g).includes(c.talent) || (g.P.awakened || []).length)) continue;
    if (c.needs_been && !g.P.been.has(c.needs_been)) continue;
    let memory = null;
    if (c.needs_memory) { memory = memoryOK(g, c.needs_memory); if (!memory) continue; memory = memMark(g, `story:${c.id}`, memory); }
    out.push({ id: `story:${c.id}`, kind: "story", label: fill(g, c.label), skill: c.check?.skill || null, check: c.check || null, minutes: c.minutes || 0, memory, risk: c.risk || null });
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
  let S = skill(g, ck.skill) + mod + status;
  const parts = [];
  if (status) parts.push({ sign: "▼", text: p.status.hunger >= 2 ? "배가 고프다" : "몸이 아프다" });
  // 경고 하나에 +10 (논거 보정, 14 §3.3) — 모은 경고만큼 '무모하다'가 '반반이다'로
  for (const w of ck.warn || []) if (storyWhen(g, [w])) { S += 10; parts.push({ sign: "▲", text: WARN_TEXT(g, w) }); }
  if (ck.auto && storyWhen(g, [ck.auto])) return { P: 0.97, S: 99, D: ck.D, parts: [{ sign: "▲", text: "몸이 먼저 안다" }] };
  // 회차가 쌓일수록 시간에 닿은 것들이 낌새를 챈다 (14 §7.4 — 볼크의 코)
  let D = ck.D + (ck.D_per_loop || 0) * (g.run.loop - 1);
  if (ck.per_defense && g.domain) { _domData = g.content.game.domains; const dv = DOM.defenseOf(g, g.domain, DMH()); D -= Math.round(ck.per_defense * dv); if (dv) parts.push({ sign: "▲", text: `방어 ${dv}` }); }
  if (ck.per_ready) { const n = risingReady(g).filter((x) => x.ok).length; D -= ck.per_ready * n; parts.push({ sign: "▲", text: `준비된 것 ${n}가지` }); }
  if (ck.D_per_loop && g.run.loop > 1) parts.push({ sign: "▼", text: "젖은 재 냄새가 짙다" });
  return { P: prob(S, D), S, D, parts };
}
const WARN_TEXT = (g, w) => { const [k, a] = w.split(/\s+/); if (k === "pknows") return `너는 안다 — ${shortFact(g, a) || a}`; if (k === "been") return `${placeName(g, a)}에 가 본 적이 있다`; if (k === "date") return "볼크가 마을에 왔다"; if (k === "var") return g.content.game.flags?.[a]?.warn || "들은 것이 있다"; return "들은 것이 있다"; };
function storyEffect(g, e, res) {
  const parts = String(e).split(/\s+/), k = parts[0], rest = String(e).slice(k.length + 1);
  if (k === "learn") learn(g, parts[1], "그 저녁");
  else if (k === "rel") { const [, n, field, v] = parts; bumpRel(g, n, field === "like" ? Number(v) : 0, field === "trust" ? Number(v) : 0); }
  else if (k === "var" && (parts[2] === "+=" || parts[2] === "-=")) g.A.doEffect(e, g.t);
  else if (k === "var") { const [, name, , v] = parts; g.S.vars[name] = v === "true" ? true : v === "false" ? false : isNaN(Number(v)) ? v : Number(v); }
  else if (k === "coin") g.S.purse.player = Math.max(0, g.S.purse.player + Number(parts[1]));
  else if (k === "hunger") g.P.status.hunger = clamp(g.P.status.hunger + Number(parts[1]), 0, 4);
  else if (k === "pain") g.P.status.pain = clamp(g.P.status.pain + Number(parts[1]), 0, 100);
  else if (k === "item") { const good = g.content.game.economy.goods[parts[1]]; if (good) g.L.give("player", { ...good, id: uid(g, `it_${parts[1]}`), gid: parts[1] }); }
  else if (k === "talent") { if (!g.P.talent) g.P.talent = parts[1]; }   // 재능의 값은 skill()이 얹는다 (영혼의 스킬과 겹치지 않게)
  else if (k === "note") g.P.notebook.push(fill(g, rest));
  else if (k === "memory") { const [, n, tag] = parts; addMemory(g, n, { kind: "impression", tag, delta: 0, text: parts.slice(3).join(" "), salience: 4, source: "engine" }); }
  else if (k === "goto") g.at = parts[1];
  else if (k === "ration") { g.P.lastRation = Math.floor(g.t / 1440); g.P.status.hunger = clamp(g.P.status.hunger - 1, 0, 4); }
  else if (k === "agenda") g.A.doEffect(rest, g.t);
  else if (k === "bond") bond(g, parts[1], Number(parts[2]));
  else if (k === "domain") domainEffect(g, parts.slice(1), res);
  else if (k === "family") familyEffect(g, parts.slice(1));
  else if (k === "rising") risingEffect(g, parts[1], res);
  else if (k === "skill_gain") (g.P.gain ??= {})[parts[1]] = (g.P.gain[parts[1]] || 0) + Number(parts[2]);
  else if (k === "awaken") { (g.P.awakened ??= []).push(parts[1]); g.P.tpSpent = (g.P.tpSpent || 0) + 3; }
  else if (k === "temper") temper(g, parts[1], Number(parts[2]));
  else if (k === "stress") g.P.status.stress = clamp(g.P.status.stress + Number(parts[1]), 0, 100);
  else if (k === "fatigue") g.P.status.fatigue = clamp(g.P.status.fatigue + Number(parts[1]), 0, 100);
  else if (k === "fear") g.P.status.fear = clamp(g.P.status.fear + Number(parts[1]), 0, 5);
  else if (k === "then") g._then = parts[1];
  else if (k === "die" || k === "die_if") {
    let i = 1, p = 1;
    if (k === "die_if") { p = Number(parts[1]); i = 2; }
    const trace = parts[i], tail = parts.slice(i + 1);
    if (hash(g.seed, "die", g.story?.id || "", String(g._i ?? 0)) >= p) return;
    if (tail.length === 1 && SL(g, tail[0])) { g._then = tail[0]; return; }        // 죽음이 다음 장면에서 온다 (사라의 무릎 위)
    const npc = tail[0]?.startsWith("npc_") ? tail.shift() : null;
    g.P.alive = false; g.ended = { kind: "dead", why: fill(g, tail.join(" ")), t: g.t, trace: { id: trace, npc } };
  }
  else if (k === "captured") g.ended = { kind: "captured", why: fill(g, rest), t: g.t, trace: { id: "rope" } };
  else if (k === "wanted") wantedAdd(g, Number(parts[1]), parts.slice(2).join(" ") || null);
  else if (k === "nemesis") { const n = parts[1], gr = Number(parts[2] || 2); const x = ((g.nem ??= {})[n] ??= { grudge: 0, track: 0, since: g.t }); x.grudge = Math.max(x.grudge, gr); }
  else if (k === "smell_mark") { if (hash(g.seed, "smell", parts[1], g.run.loop) < 0.25 + smellOf(g) / 40) storyEffect(g, `nemesis ${parts[1]} 1`, res); }
  // deed <종류> [대상] [seen|unseen] — 장면 속 일은 본 사람이 있다(기본). 아무도 모르게 한 일은 unseen: 평판은 시체·소문을 따라 나중에 온다
  else if (k === "deed") { const vis = ["seen", "unseen"].includes(parts.at(-1)) ? parts.at(-1) : "seen"; const rest2 = parts.slice(1).filter((x) => x !== "seen" && x !== "unseen"); deed(g, rest2[0], rest2[1] || null, g.at, { witnessed: vis === "seen" }); }
  // slay <npc> [은밀도] — 세계 안에서 죽인다: 시체가 남고, 본 사람이 고하고, 발견되면 수색이 온다 (agenda kill은 기록만 지운다)
  else if (k === "slay") {
    const n = parts[1], stealth = Number(parts[2] ?? g.storyCtx?.stealth ?? 40);
    if (!g.S.dead.has(n)) {
      const seen = g.L.player.kill(g.t, n, { at: g.at, stealth });
      deed(g, "kill", n); g.P.bloody = true;
      if (seen.length) res?.notes?.push(`누군가 보았다: ${seen.map((x) => displayName(g, x)).join(", ")}`);
    }
  }
  else if (k === "threat_pay") { const th = g.S.threats[g.storyCtx?.threat]; const n = Number(parts[1]); g.S.purse.player -= n; g.S.purse[th.by] = (g.S.purse[th.by] || 0) + n; th.paid = (th.paid || 0) + 1; th.t = g.t + 30 * 1440; }
  else if (k === "threat_delay") { const th = g.S.threats[g.storyCtx?.threat]; th.t = g.t + Number(parts[1]) * 1440 - 360; }
  else if (k === "threat_refuse") {
    const th = g.S.threats[g.storyCtx?.threat]; th.done = true;
    wantedAdd(g, 2, `${nameOf(g, th.by)}이(가) 감독관에게 고했다`);
    g.L.believe(th.by, g.t, { kind: "suspect", subject: "player", object: th.about, at: g.at, source: "told", reason: "협박을 거절했다", choice: "report" }, { react: false });
  }
  else if (k === "nem_track") { const x = g.nem?.[g.storyCtx?.nem]; if (x) x.track = Number(parts[1]); }
  else if (k === "nem_caught") { const n = g.storyCtx?.nem; g.ended = { kind: "captured", why: `${nameOf(g, n)}에게 붙잡혔다`, t: g.t, trace: { id: profOf(g, n).role === "hunter" ? "teeth" : "rope", npc: n } }; }
  else if (k === "nem_kill") { const n = g.storyCtx?.nem; g.L.player.kill(g.t, n, { at: g.at, stealth: 20 }); deed(g, "kill", n); g.P.bloody = true; delete g.nem[n]; }
  else if (k === "nem_die") { const n = g.storyCtx?.nem; g.P.alive = false; g.ended = { kind: "dead", why: `${nameOf(g, n)}의 손에 죽었다`, t: g.t, trace: { id: profOf(g, n).role === "hunter" ? "teeth" : "blade", npc: n } }; }
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
    const echo = (c.check ? (OK(res.tier) ? c.success : c.failure)?.echo : null) || c.echo;
    if (echo) (g.echoes ??= []).push({ ...echo, label: c.label, t: g.t });
    for (const ef of effects) storyEffect(g, ef, res);
    for (const ef of st.after_all || []) storyEffect(g, ef, res);
    // 줄을 떠나는 선택: 키트가 자리를 맡는다. 15분 넘게 비우면 키트가 맞는다 (⏱가 진짜라는 첫 교훈, 14 §6.1)
    let extra = "";
    if (c.leave_line && st.after_choice) {
      extra = "\n\n" + st.after_choice.leave_line_text;
      if ((c.minutes || 0) > 15) { for (const ef of st.after_choice.late_effects || []) storyEffect(g, ef, res); extra += "\n\n돌아왔을 때 키트의 손등에 붉은 줄이 셋 있다. 즈닉이 출결 막대를 짚고 지나간다. \"두 자리 맡는 쥐새끼.\""; }
    }
    if (c.miss_ration) g.P.lastRation = Math.floor(g.t / 1440);   // 배식을 놓쳤다
    // 함께 지난 장면 (22 §1.2 flag story): 그 장면에 있던 사람은 이제 '그 이야기를 아는 사이'다 — 숨긴 것 하나가 더 열릴 수 있다
    for (const n of new Set([st.trigger?.with, ...effects.map((e) => (/^(rel|memory|bond) (npc_\w+)/.exec(e) || [])[2])].filter(Boolean))) g.S.vars[`story:${n}`] = true;
    g.storyDone.add(st.id); g.story = null;
    res.storyText = fill(g, text) + extra;
    if (g.ended) return;
    const then = g._then; g._then = null;
    if (then) { const nx = SL(g, then); if (nx) { g.storyDone.delete(nx.id); openStory(g, nx); res.storyText += "\n\n" + g.feed.pop().text; return; } }
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
    if (!cardOf(g, n).nameable) bond(g, n, 1);
    // C등급은 세 번 말을 섞으면 B등급으로 (08 §2) — 기억 칸이 늘어난다
    const tc = (g.P.talks ??= {}); tc[n] = (tc[n] || 0) + 1;
    if (cardOf(g, n).tier === "C" && tc[n] >= 3) (g.P.promoted ??= new Set()).add(n);
    g.convo = { npc: n, turns: 0, patience: 6 + Math.max(0, Math.round(relOf(g, n).like / 10)), transcript: [] };
    if (asleep(w, g.t)) { mind(g, n).anger += 1; res.notes.push(`${nameOf(g, n)}은(는) 자다 깼다`); }
    pass(g, 1);
  },
  go(g, to, res, opt) {
    const sneak = opt.skill === "은신";
    pass(g, Math.max(1, opt.minutes || 1));
    if (g.ended) return;                 // 가는 길에 붙잡히거나 쓰러졌다 — 거기서 끝이다
    if (sneak && !OK(res.tier)) {
      const seen = g.L.player.trespass(g.t, to, res.tier === "대실패" ? 1 : 0.7);
      if (seen.length) deed(g, "trespass", null, to);
      res.notes.push(seen.length ? `들어가다 ${seen.map((n) => nameOf(g, n)).join(", ")}의 눈에 띄었다` : "발소리가 났지만 아무도 보지 못한 듯하다");
    }
    g.at = to;
    seenCarrying(g, res);
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
    dayEnd(g);
    nightEchoes(g);
    const start = g.t, feedAll = [];
    const step = (fn) => { const from = g.feed.length; fn(); feedAll.push(...g.feed.slice(from)); };   // 새로 생긴 줄만 (같은 줄이 여러 번 쌓이지 않게)
    feedAll.push(...g.feed);   // 하루의 끝 카드 (dayEnd)
    const ra = g.content.game.economy?.ration;
    // 1) 저녁 배급까지 (이미 지났으면 바로 막사로)
    const m = ((g.t % 1440) + 1440) % 1440;
    if (ra && m < parseClock(ra.to) - 10 && g.P.lastRation !== Math.floor(g.t / 1440)) {
      step(() => { g.at = "gf_rooster"; pass(g, Math.max(1, parseClock(ra.from) - m)); });
      if (!g.ended && present(g).some((w) => w.npc === "npc_bram")) step(() => { g.P.lastRation = Math.floor(g.t / 1440); g.P.status.hunger = clamp(g.P.status.hunger - 1, 0, 4); pass(g, 15); });
    }
    // 2) 통금 전에 막사로, 자고, 점호 — 깨어난 아침에 표지를 남긴다 (되돌리기)
    if (!g.ended && !g.story) {
      (g.P.marks ??= []).push(jidx(g) + 1);
      const cnt = SL(g, "count_before_sleep");
      if (cnt && g.run.loop >= (cnt.trigger?.first_sleep_loop || 2) && !g.storyDone.has(cnt.id) && soul(g).records.length && g.run.opening !== false) { g.at = HOME; g.feed = feedAll; openStory(g, cnt); res.storyText = g.feed.pop()?.text; return; }
    }
    if (!g.ended && !g.story) step(() => { g.at = HOME; const c = fromMinutes(g.t); let wake = toMinutes(c.y, c.m, c.d, 4, 40); if (wake <= g.t) wake += 1440; pass(g, wake - g.t, { sleeping: true }); if (!g.story && !g.ended) dreamTick(g); });
    if (!g.ended && !g.story && !isSabbath(Math.floor(g.t / 1440))) step(() => { pass(g, 5); g.at = ROLLCALL; pass(g, 20); });
    g.feed = feedAll;
    res.notes.push(`${fmt(start).slice(4, 16)}부터 ${fmt(g.t).slice(4, 16)}까지, 늘 하던 대로`);
  },
  routine_days(g, n, res, opt, e) {
    const QUIET = new Set(["ink", "drift", "grow", "voice", "dayend", "recap"]);
    const feedAll = []; let done = 0, why = null;
    for (let i = 0; i < Number(n); i++) {
      const sub = { ...res, notes: [] };
      g.feed = [];
      DO.routine_day(g, null, sub, opt, e);
      feedAll.push(...g.feed); done++;
      const loud = g.feed.find((f) => !QUIET.has(f.kind) && !f.quiet);
      if (g.story || g.ended || g.convo || g.fight) { why = g.ended ? "끝" : "장면"; break; }
      if (loud) { why = loud.text; break; }
      if (g.P.settlement !== SETTLEMENT || g.S.vars.player_fugitive) break;
    }
    g.feed = feedAll;
    res.notes.push(`${done}일을 보냈다${why && done < Number(n) ? " — 거기서 멈췄다" : ""}`);
  },
  sleep(g, _, res, opt, e) {
    dayEnd(g);
    nightEchoes(g);   // 쉼표 — 대기열의 메아리를 둘까지
    (g.P.marks ??= []).push(jidx(g) + 1);   // 이 잠까지 포함한 기록 길이 = 깨어난 아침 (하위 걸음이어도 바깥 기록 다음)
    // 두 번째 회차부터, 첫 잠자리 전에 지난 회차를 센다 (14 §6.6)
    const cnt = SL(g, "count_before_sleep");
    if (cnt && g.run.loop >= (cnt.trigger?.first_sleep_loop || 2) && !g.storyDone.has(cnt.id) && soul(g).records.length && g.run.opening !== false) { openStory(g, cnt); res.storyText = g.feed.pop()?.text; return; }
    const c = fromMinutes(g.t);
    let wake = toMinutes(c.y, c.m, c.d, 4, 40); if (wake <= g.t) wake += 1440;
    pass(g, wake - g.t, { sleeping: true });
    if (g.story) return;               // 잠이 장면에 깼다 (첫 밤, 첫 종…)
    dreamTick(g);
    // 점호 날이면 막사 사람들과 함께 광장으로 끌려 나간다
    if (!isSabbath(Math.floor(g.t / 1440)) && g.at === HOME) { pass(g, 5); g.at = ROLLCALL; res.notes.push("첫 종. 막사 문이 열리고 모두 광장으로 밀려 나간다 — 점호"); pass(g, 20); }
  },
  search(g, _, res) {
    pass(g, 10);
    if (!OK(res.tier) && res.tier !== "부분 성공") { res.notes.push("아무것도 찾지 못했다"); return; }
    const found = [...g.L.items.values()].filter((i) => i.at === g.at && !i.worn && i.owner !== "player");
    for (const i of found) g.P.found.add(i.id);
    // 장소가 알려 주는 것 (22 §1.2 "장소로만"): 그 자리를 뒤지면
    let place = false;
    for (const R of g.content.game.placeReveals || []) {
      if (R.at !== g.at || knowsFact(g, R.fact) || !storyWhen(g, R.needs)) continue;
      place = true;
      if (R.read && skill(g, "읽고쓰기") < R.read) { res.notes.push(R.unread || "글자가 있다. 읽을 수 없다"); continue; }
      res.notes.push(R.text); learn(g, R.fact, `${placeName(g, g.at)}에서 직접 보았다`);
    }
    if (found.length || !place) res.notes.push(found.length ? `찾았다: ${found.map((i) => i.name).join(", ")}` : "특별한 것은 없다");
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
    if (g.ended) return;
    let it;
    if (id === "coin") { const n = g.S.purse.player - 3; g.S.purse.player = 3; it = g.L.give("player", { id: uid(g, "it_coin"), name: `동전 ${n}못`, coin: n, tags: ["화폐"], value: n }); }
    else it = g.L.items.get(id);
    Object.assign(it, { at: g.at, worn: false, stashed: true });
    g.P.found.add(it.id);
    res.notes.push(`${it.name}을(를) ${placeName(g, g.at)} 어딘가에 숨겼다`);
  },
  attack(g, n, res) {
    pass(g, 2);
    if (g.ended) return;
    if (OK(res.tier)) {
      const seen = g.L.player.kill(g.t, n, { at: g.at, stealth: res.tier === "대성공" ? 60 : 20 });
      deed(g, "kill", n);
      g.P.bloody = true;
      res.notes.push(`${nameOf(g, n)}이(가) 쓰러졌다. 움직이지 않는다`);
      if (seen.length) res.notes.push(`누군가 보았다: ${seen.map((x) => nameOf(g, x)).join(", ")}`);
    } else {
      g.L.player.assault(g.t, n, { at: g.at });
      deed(g, "assault", n);
      if (res.tier === "부분 성공" && !g.fight) { g.fight = { npc: n, round: 1, me: 0, foe: 1, edge: 0 }; res.notes.push(`${nameOf(g, n)}이(가) 비틀거린다. 아직 끝나지 않았다`); return; }
      if (["hunter", "authority"].includes(profOf(g, n).role) || profOf(g, n).nerve >= 60) { const x = ((g.nem ??= {})[n] ??= { grudge: 0, track: 0, since: g.t }); x.grudge = Math.max(x.grudge, 2); }
      g.P.status.pain = clamp(g.P.status.pain + (res.tier === "대실패" ? 40 : 20), 0, 100);
      res.notes.push(`${nameOf(g, n)}을(를) 쓰러뜨리지 못했다`);
      if (res.tier === "대실패" && (cardOf(g, n).age ?? 30) >= 14 && (profOf(g, n).nerve >= 60 || worn(g, n).some((i) => i.tags?.includes("무기")) || g.P.status.pain >= 100)) { g.P.alive = false; g.ended = { kind: "dead", why: `${nameOf(g, n)}의 손에 죽었다`, t: g.t, trace: { id: "blade", npc: n } }; }
    }
    checkDanger(g);
  },
  wear(g, arg, res) {
    const [id, sl] = arg.split(":"); const it = g.L.items.get(id);
    it.slot = sl; it.visibility = SLOTS[sl].seen ? "보임" : "숨김"; pass(g, 2);
    res.notes.push(`${it.name}을(를) ${sl}에 지녔다`);
    if (SLOTS[sl].seen) seenCarrying(g, res);
  },
  recall(g, _, res, opt, e) {
    const plan = recallPlan(g);
    let k = 0, done = 0, why = null;
    for (const st of plan) {
      if (g.ended || g.story) { why = g.story ? "장면이 열린다" : null; break; }
      const o = options(g).find((x) => x.id === st.id);
      if (!o) { why = `기억과 다르다 — ${josa(`${labelOfId(g, st.id)}을(를) 할 수 없다`)}`; break; }
      const od = optionOdds(g, o);
      if (od && (od.P < 0.5 || o.risk)) { why = `${o.label} — 직접 고를 일이다`; break; }
      const logLen = g.S.log.length, feedLen = g.feed.length;
      step(g, { i: `${e.i}.${k++}`, kind: "act", id: st.id, tags: [], sub: true });
      done++;
      if (g.feed.slice(feedLen).some((f) => f.kind === "world" || f.kind === "rule" || f.kind === "echo")) { why = "이런 일은 없었다"; break; }
    }
    res.notes.push(done ? `지난 회차처럼 ${done}걸음을 보냈다` : "기억대로 보낼 것이 없다");
    if (why) res.notes.push(`멈춘다: ${why}`);
  },
  work_day(g, _, res) {
    const day = Math.floor(g.t / 1440);
    g.P.lastWork = day; g.at = "greyford__west_pasture"; g.P.working = true;
    // 첫 들일: 낫 세 번, 그리고 키트 (대본 장면)
    const zl = SL(g, "znik_lash");
    if (zl && !g.storyDone.has(zl.id) && g.run.opening !== false) { openStory(g, zl); res.storyText = g.feed.pop()?.text; g.P.working = false; return; }
    const hm = ((g.t % 1440) + 1440) % 1440;
    pass(g, Math.max(60, 18 * 60 - hm));
    g.P.working = false;
    if (g.ended || g.story) return;
    g.P.train = Math.min(60, g.P.train + 0.4 * (g.P.train < (soul(g).trainPeak || 0) ? 3 : 1));
    // 할당: 지친 몸, 빈속은 단을 덜 묶는다
    const P = clamp(0.8 - g.P.status.fatigue / 250 - (g.P.status.hunger >= 3 ? 0.2 : 0) - (g.P.status.pain >= 60 ? 0.2 : 0), 0.1, 0.95);
    if (hash(g.seed, "quota", day) >= P) {
      g.P.status.pain = clamp(g.P.status.pain + 12, 0, 100); g.P.lastRation = day;
      res.notes.push("할당을 못 채웠다. 즈닉의 채찍 셋 — 오늘 저녁 배급은 없다"); g.P.status.stress = clamp(g.P.status.stress + 4, 0, 100);
    } else res.notes.push("해 질 때까지 고랑을 탔다. 단은 모자라지 않았다");
    g.at = "gf_rooster";
  },
  teach(g, i, res) {
    const c = g.family.children[Number(i)];
    const sk = Object.keys(g.P.skills).concat(Object.keys(g.P.gain || {})).filter((k, j, a) => a.indexOf(k) === j).sort((x, y) => rawSkill(g, y) - rawSkill(g, x))[0];
    const mine = rawSkill(g, sk), cur = c.skills[sk] || 5;
    c.skills[sk] = Math.min(mine, cur + Math.max(1, (mine - cur) / 8)); c.taught++; c.lastTaught = Math.floor(g.t / 1440);
    // 가르치는 사람을 닮는다 — 가르치는 동안 보이는 것도 같이 배운다
    for (const a of AXES) c.temper[a] = clamp(c.temper[a] + Math.sign(g.P.temper[a] || 0) * (a === c.own ? 0 : 1), -100, 100);
    pass(g, 120);
    res.notes.push(c.skills[sk] >= mine - 1 ? `${c.name}이(가) 너보다 빨리 한다. 너는 아무 말도 하지 않는다. 자랑스러워서.` : `${c.name}의 손이 ${sk}을(를) 따라 한다. 서툴다. 어제보다 덜 서툴다.`);
  },
  // 읽는다 (19 §4.2): 글을 알면 사실이 된다. 모르면 글자 모양만 — 글을 아는 사람에게 보여야 한다
  read(g, id, res) {
    pass(g, 10);
    const it = g.L.items.get(id), R = goodOf(g, it)?.read; if (!R) return;
    const lit = skill(g, "읽고쓰기") >= (R.D || 30), tongue = !R.lang || skill(g, R.lang) >= (R.langD || 30);
    if (lit && tongue) {
      (g.P.readDocs ??= new Set()).add(id);
      res.notes.push(literacyFilter(g, R.text || ""));
      for (const f of R.facts || []) learn(g, f, `${it.name}에서 읽었다`);
    } else res.notes.push(lit ? `글자는 읽힌다. 말이 ${R.lang}이다 — ${tongueMask(g, R.lang, R.text || "")}` : `${readMask(g, R.text || "")} — 글자다. 읽을 수 없다. 글을 아는 사람에게 보여야 한다`);
  },
  favor(g, _, res) {
    const n = g.convo.npc, d = mind(g, n).memories.find((x) => x.kind === "debt" && !x.used && x.source !== "engine-offer");
    if (d) d.used = g.t;
    g.convo.favor = true; pass(g, 1);
    res.notes.push(`${nameOf(g, n)}이(가) 잠깐 눈을 내리깐다. 갚아야 할 것이 있다는 얼굴이다`);
  },
  // 제안한다 (22 §1.2 player_offer): 이 대화에서 숨긴 것의 문이 하나 더 열린다
  offer(g, kind, res) {
    const n = g.convo.npc;
    talkTurn(g, res, { 대성공: [3, 2], 성공: [2, 1], "부분 성공": [1, 0], 실패: [0, -1], 대실패: [-2, -3] });
    if (kind === "coin") { g.S.purse.player -= 12; g.S.purse[n] = (g.S.purse[n] || 0) + 12; mind(g, n).gifts = (mind(g, n).gifts || 0) + 12; }
    g.convo.offer = kind;
    addMemory(g, n, { kind: "debt", tag: null, text: `셋째가 제안했다 — ${OFFERS.find((x) => x[0] === kind)?.[1].replace(/"/g, "")}`, salience: 3, source: "engine-offer" });
    res.notes.push(`${nameOf(g, n)}이(가) 그 말을 오래 곱씹는다`);
  },
  // 배운다 (03 §3.1): 스승의 스킬 −10까지, 연습의 2.5배. 받아들여지면 시험이 여는 비밀(trial:<npc>)
  train(g, arg, res) {
    const [n, sk] = arg.split(":"); const M = (g.content.game.mentors || []).find((x) => x.npc === n); if (!M) return;
    const cap = M.teach[sk] - 10, cur = rawSkill(g, sk);
    const first = !g.S.vars[`trial:${n}`];
    if (first) { g.S.vars[`trial:${n}`] = true; res.notes.push(fill(g, M.text || "")); }
    if (M.fee && M.fee !== "none") { const [k, v] = M.fee.split(" "); if (k === "coin") { g.S.purse.player -= Number(v); g.S.purse[n] = (g.S.purse[n] || 0) + Number(v); } else if (k === "item") { const it = mine(g).find((i) => i.gid === v); if (it) g.L.items.delete(it.id); } }
    const d = Math.max(0.6, (cap - cur) * 0.09) * (talentGrows(g, sk) ? 1.25 : 1);
    (g.P.gain ??= {})[sk] = (g.P.gain[sk] || 0) + Math.min(d, Math.max(0, cap - cur));
    (g.P.trainedDay ??= {})[n] = Math.floor(g.t / 1440);
    g.P.status.fatigue = clamp(g.P.status.fatigue + 15, 0, 100);
    bumpRel(g, n, 1, 1); bond(g, n, 1);
    pass(g, 120);
    const after = skill(g, sk);
    res.notes.push(`${sk} — ${sk === "읽고쓰기" ? LETTER_WORD(after) : sk === "용언" ? TONGUE_WORD(after) : skillWord(after)}`);
    // 수업의 대가 (CHARACTERS 각 스승의 '주의'): 금지된 수업은 목격될 수 있고, 어떤 스승은 제자를 판다
    if (M.risk === "witness" && hash(g.seed, "lesson", n, Math.floor(g.t / 1440)) < (present(g).some((w) => profOf(g, w.npc).role === "authority") ? 0.5 : g.S.dead.has("npc_isol") ? 0.04 : 0.1)) { wantedAdd(g, 1, "금지된 글을 배웠다"); res.notes.push("창밖에서 누군가 걸음을 멈췄다가 지나간다"); }
    if (M.risk === "sells" && hash(g.seed, "lesson-sell", n, Math.floor(g.t / 1440)) < 0.08) wantedAdd(g, 1, `${nameOf(g, n)}이(가) 제자 이야기를 흘렸다`);
    if (M.risk === "trap") g.S.vars.hagen_knows_escape_intent = true;
  },
  rising(g, _, res) { const st = SL(g, "rising_call"); g.storyDone.delete(st.id); openStory(g, st); res.storyText = g.feed.pop()?.text; },
  op_start(g, id, res) { g.op = { id, phase: "exec" }; const op = g.content.game.ops[id]; res.notes.push(op.exec_text); pass(g, 5); },
  op_abort(g, _, res) { g.op = null; res.notes.push("물러난다. 다음 밤이 있다 — 아마도"); },
  op_exec(g, _, res) {
    const O = g.op, op = g.content.game.ops[O.id]; pass(g, 20);
    O.ok = OK(res.tier) || res.tier === "부분 성공"; O.caught = !OK(res.tier);
    g.storyCtx = { ...(g.storyCtx || {}), stealth: res.tier === "대성공" ? 85 : OK(res.tier) ? 65 : 25 };   // 소리 없이 해냈나 — slay가 쓴다
    if (O.ok) for (const e of op.success) storyEffect(g, e, res);
    res.notes.push(O.ok ? (O.caught ? "해냈다. 그러나 소리가 났다" : "해냈다. 아무도 모른다 — 아직은") : "실패했다. 발소리가 다가온다");
    O.phase = "escape"; DIR.crisis(g, 3);
  },
  op_flee(g, how, res) {
    const O = g.op, op = g.content.game.ops[O.id]; pass(g, 10);
    if (OK(res.tier) || (res.tier === "부분 성공" && !O.caught)) { res.notes.push(how === "route" ? "준비해 둔 길이 너를 삼킨다" : "어둠이 너를 숨겨 준다"); O.phase = O.ok ? "cover" : null; if (!O.ok) g.op = null; return; }
    for (const e of op.caught) storyEffect(g, e, res);
    res.notes.push("붙잡혔다 — 아니면 거의"); g.op = null;
  },
  op_cover(g, how, res) {
    const O = g.op, op = g.content.game.ops[O.id]; g.op = null; (g.P.opsDone ??= {})[O.id] = g.t; pass(g, 15);
    if (how === "wipe" && !OK(res.tier)) { wantedAdd(g, 1, `${op.target} — 흔적이 남았다`); res.notes.push("흔적이 남았다"); }
    else if (how === "frame") {
      // 누명 (11 §3.2 ⑥): 그 사람이 대신 채찍 기둥에 선다. 너만 안다 — 얼룩이 된다
      g.A.doEffect(`punish ${op.scapegoat} at gf_whip_square for 3`, g.t);
      g.S.vars[`framed_${op.scapegoat.replace("npc_", "")}`] = true;
      deed(g, "inform", op.scapegoat, g.at); temper(g, "정직", -4); temper(g, "자비", -3);
      res.notes.push(`${displayName(g, op.scapegoat)}의 물건 하나를 그 자리에 떨어뜨린다. 내일 아침 채찍 기둥에 선 것은 ${displayName(g, op.scapegoat)}이다`);
    } else if (how === "none" && O.caught) wantedAdd(g, 2, op.target);
    else res.notes.push("손을 털고 어둠 속으로");
  },
  found_domain(g, _, res) { const st = SL(g, "domain_found"); openStory(g, st); res.storyText = g.feed.pop()?.text; },
  hide_kit(g, _, res) {
    g.P.status.fatigue = clamp(g.P.status.fatigue + 25, 0, 100);
    const day0 = g.t;
    g.at = "hungry_hill__wolf_den"; pass(g, 390);
    g.W.override({ npc: "npc_kit", from: day0, to: null, kind: "at", at: "hungry_hill__wolf_den", doing: "늑대굴 안쪽, 시그리드의 무리 사이에 웅크려 있다" });
    g.hide = { at: "hungry_hill__wolf_den", people: ["npc_kit"], food: 2, exposure: 0.1, since: day0 };
    g.S.vars.kit_on_list = false; g.S.vars.kit_hidden = true;
    res.notes.push("키트를 늑대굴에 맡겼다. 시그리드가 한 번 쳐다보고, 고개를 끄덕인다");
    bond(g, "npc_kit", 6);
  },
  stock(g, id, res) {
    g.L.items.delete(id);
    if (g.hide && g.at === g.hide.at) { g.hide.food += 1; g.hide.exposure = Math.max(0, g.hide.exposure - 0.03); }
    if (g.domain && atPlace(g, g.domain.at)) { g.domain.food += 15; g.domain.morale = clamp(g.domain.morale + 1, 0, 100); bumpRel(g, g.domain.steward, 1, 2); }
    pass(g, 5); res.notes.push("숨은 곳에 먹을 것을 두었다");
  },
  // 진명 (한 근원, 한 작용): 몸이 값을 치르고, 본 사람이 있으면 마녀
  true_name(g, w, res) {
    const T = g.content.game.truenames[w];
    (g.P.wordAt ??= {})[w] = Math.floor(g.t / 60);
    g.P.status.pain = clamp(g.P.status.pain + (T.cost?.pain || 0), 0, 100); g.P.status.fatigue = clamp(g.P.status.fatigue + (T.cost?.fatigue || 0), 0, 100);
    if (T.effect === "light") g.P.fireAt = g.t;
    if (T.effect === "see") { g.P.seeAt = g.t; for (const it of g.L.items.values()) if (it.at === g.at && !it.worn && it.owner !== "player") g.P.found.add(it.id); }
    if (T.effect === "water") g.P.bloody = false;
    if (T.effect === "close") g.P.closeAt = g.t;
    res.notes.push(T.text);
    witchCheck(g, res);
  },
  adopt(g, n, res) {
    (g.family ??= { members: [], children: [] }).members.includes(n) || g.family.members.push(n);
    for (let d = 0; d < 90; d++) { const day0 = (Math.floor(g.t / 1440) + d) * 1440; g.W.override({ npc: n, from: day0 + 22 * 60, to: day0 + 29 * 60, kind: "at", at: HOME, doing: "움막 12호 구석에 웅크려 잔다 — 이제 식구다" }); }
    bond(g, n, 10); bumpRel(g, n, 10, 10); pass(g, 5);
    res.notes.push(`${displayName(g, n)}이(가) 대답 대신 처마에서 내려온다. 그날 밤부터 움막 12호의 숨소리가 하나 는다`);
  },
  found_house(g, _, res, opt, e) {
    const remembered = soul(g).house;
    const [name, motto] = remembered ? [remembered.name, remembered.motto] : String(e.text || "").split("|");
    const fam = (g.family ??= { members: [], children: [] });
    fam.name = (name || "").trim().slice(0, 10) || "이름 없는 집"; fam.motto = (motto || "").trim().slice(0, 40) || "우리는 서로의 이름을 안다"; fam.since = g.t;
    for (const [n, v] of Object.entries(g.P.bond || {})) if (v >= 10 && !fam.members.includes(n) && !cardOf(g, n).nameable) fam.members.push(n);
    pass(g, 20);
    res.notes.push(remembered ? `'${fam.name}'. 처음 듣는 사람들이 그 가훈을 처음처럼 따라 말한다 — "${fam.motto}"` : `'${fam.name}' — 옷 안쪽에 실 한 땀. 가훈: "${fam.motto}"`);
    g.P.notebook.push(`가문 — ${fam.name}. "${fam.motto}" (${fam.members.map((n) => displayName(g, n)).join(", ")})`);
  },
  story_childname(g, _, res, opt, e) {
    const nm = String(e.text || "").trim().slice(0, 10) || "아이";
    const fam = g.family, sex = hash(g.seed, "child", g.run.loop, fam.children.length) < 0.5 ? "딸" : "아들";
    fam.children.push(newChild(g, nm, sex));   // 강변 움막 12호
    g.story.phase = "choice"; const st = SL(g, g.story.id);
    res.storyText = fill(g, st.after_input).replace(/\{child\}/g, nm);
    g.storyDone.add(st.id); g.story = null; bond(g, "npc_sara", 10);
    g.P.notebook.push(`${nm} — ${sex}. ${fmt(g.t).replace(/^AS \d+ /, "")}, 강변 움막 12호에서. 이 회차에만 있다`);
    // 그림다크: 출산은 위험하다 (12 §6) — 치료사 없는 노예 출산
    if (hash(g.seed, "birthrisk", g.run.loop, fam.children.length) < (relOf(g, "npc_elsa").trust >= 40 ? 0.03 : 0.15)) { g.A.doEffect("kill npc_sara", g.t); res.storyText += "\n\n사라의 손이 식는다. 아이의 울음은 그치지 않는다."; DIR.loss(g, 15); DIR.crisis(g, 5); }
  },

  // 이름 붙이기 (20 §5.1): 이름 없는 것에 이름을 — 그 이름은 너만 기억한다
  name(g, n, res, opt, e) {
    const nm = String(e.text || "").trim().slice(0, 10) || "…";
    (g.P.names ??= {})[n] = nm; bond(g, n, 8); pass(g, 2);
    res.notes.push(`이제 이 개는 '${nm}'이다. 아무도 그렇게 부르지 않는다. 너만`);
  },
  // 밤의 의식 (20 §5.2): 움막, 통금 뒤, 키트와 — 노래 하나, 빵 반 쪽
  ritual(g, kind, res) {
    pass(g, 15); g.P.lastRitual = Math.floor((g.t - 6 * 60) / 1440);
    if (kind === "song") { bond(g, "npc_kit", 3); bond(g, "npc_gerda", 1); g.P.status.stress = clamp(g.P.status.stress - 4, 0, 100); res.notes.push("강물 노래 한 소절. 키트가 따라 부르다 잠든다"); }
    else { const it = mine(g).find((i) => i.eat); if (it) g.L.items.delete(it.id); bond(g, "npc_kit", 5); g.P.status.hunger = clamp(g.P.status.hunger - 1, 0, 4); g.P.status.stress = clamp(g.P.status.stress - 3, 0, 100); res.notes.push("빵을 반으로. 큰 쪽을 키트에게"); }
  },
  oath(g, id, res) {
    const oa = (g.content.game.oaths || []).find((x) => x.id === id);
    const witnesses = present(g).filter((w) => w.kind !== "captive" && !asleep(w, g.t)).map((w) => w.npc);
    (g.oaths ??= []).push({ id, t: g.t, witnesses, state: "held" });
    for (const n of witnesses) addMemory(g, n, { kind: "promise", tag: "맹세", text: `셋째가 맹세했다: "${oa.line}"`, salience: 4, source: "engine" });
    res.notes.push(witnesses.length ? `${witnesses.map((n) => displayName(g, n)).join(", ")}이(가) 들었다` : "아무도 듣지 않았다. 너만 안다");
    g.P.notebook.push(`맹세 — ${oa.line}${witnesses.length ? ` (증인: ${witnesses.map((n) => displayName(g, n)).join(", ")})` : ""}`);
    pass(g, 1);
  },
  // ── 싸움의 합 ──
  fight_strike(g, _, res) { const F = g.fight; pass(g, 1); F.round++; F.edge = 0; if (OK(res.tier)) { F.foe += res.tier === "대성공" ? 2 : 1; res.notes.push(`${nameOf(g, F.npc)}이(가) 휘청인다`); } else hurtInFight(g, res, res.tier === "대실패" ? 2 : 1); fightEnd(g, res); },
  fight_guard(g, _, res) { const F = g.fight; pass(g, 1); F.round++; if (OK(res.tier) || res.tier === "부분 성공") { F.edge = 12; res.notes.push("팔이 주먹을 받아 낸다. 상대의 숨이 거칠다"); } else hurtInFight(g, res, 1); fightEnd(g, res); },
  fight_flee(g, _, res) { const F = g.fight; pass(g, 2); if (OK(res.tier)) { g.fight = null; res.notes.push("골목으로, 담 너머로 — 따돌렸다"); const x = ((g.nem ??= {})[F.npc] ??= { grudge: 0, track: 1, since: g.t }); x.grudge = Math.max(x.grudge, 2); } else { hurtInFight(g, res, 1); fightEnd(g, res); } },
  fight_plead(g, _, res) { const F = g.fight; pass(g, 1); if (OK(res.tier)) { g.fight = null; bumpRel(g, F.npc, -6, -10); res.notes.push(`${nameOf(g, F.npc)}이(가) 주먹을 거둔다. 침을 뱉는다`); } else { hurtInFight(g, res, 1); fightEnd(g, res); } },
  fight_yield(g, _, res) {
    const F = g.fight; g.fight = null; pass(g, 5);
    g.P.status.pain = clamp(g.P.status.pain + 25, 0, 100); res.notes.push("발길질이 몇 번. 그리고 끝난다");
    if (profOf(g, F.npc).role === "hunter") g.ended = { kind: "captured", why: `${nameOf(g, F.npc)}에게 무릎을 꿇었다 — 목줄이 채워진다`, t: g.t, trace: { id: "rope", npc: F.npc } };
    else if (profOf(g, F.npc).role === "authority") wantedAdd(g, 2, "감독에게 덤볐다", F.npc);
  },
  wash(g, _, res) { pass(g, 20); g.P.bloody = false; res.notes.push("찬물에 옷을 비벼 빤다. 핏물이 흐려진다"); },
  loot(g, n, res) { pass(g, 5); if (g.ended) return; g.P.bloody = true; const got = g.L.player.loot(g.t, n); res.notes.push(got.length ? `가져왔다: ${got.join(", ")}` : "남은 것이 없다"); },
  hide_body(g, n, res) { pass(g, 20); g.L.player.hideBody(g.t, n); res.notes.push("시체를 짚더미 밑에 밀어 넣었다"); },
  // ── 대화 ──
  small_talk(g, _, res) {
    const n = g.convo.npc;
    talkTurn(g, res, { 대성공: [6, 2], 성공: [4, 0], "부분 성공": [2, 0], 실패: [0, 0], 대실패: [-3, -1] });
    // 마음이 열리면 들은 소문을 하나 흘린다 (27 반응 층의 믿음에서)
    if (OK(res.tier)) {
      const hot = g.L.beliefs(n).filter((b) => b.heat > 0.3 && b.subject !== "player" && ["dead", "suspect", "missing", "saw_item"].includes(b.kind)).sort((a, b) => b.heat - a.heat)[0];
      if (hot) { const line = describeBelief(g, hot); if (!g.P.heard.has(line)) { g.P.heard.add(line); g.P.notebook.push(`${nameOf(g, n)}에게 들은 소문 — ${line}`); res.rumor = line; } }
      // 내 소문이 돌아온다 (14 §8 #12): 내가 한 일이 남의 입으로 — 왜곡되어, 대개는 누가 했는지 모른 채
      else {
        const nw = reputation(g).news.filter((x) => x.scope === "village").slice(-1)[0];
        if (nw) {
          const line = nw.identified ? `셋째라는 애가 ${nw.place}에서 그랬대 — ${nw.label}${nw.distortion === "과장" ? ". 열 명이라던가" : ""}` : `요즘 ${nw.place} 쪽에서 ${nw.label} 일이 있었대. 누가 했는지는 아무도 몰라`;
          if (!g.P.heard.has(line)) { g.P.heard.add(line); g.P.notebook.push(`${nameOf(g, n)}에게 들은 내 소문 — ${line}`); res.rumor = line; }
        }
      }
    }
  },
  ask(g, topic, res) {
    const n = g.convo.npc, c = cardOf(g, n), m = mind(g, n);
    if (g.convo.favor) g.convo.favor = "spent";   // 빚은 한 번만
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
    if (what !== "coin") {   // 먹을 것을 나눈다 — 판정 없이, 마음이 움직인다 (굶주린 마을에서 빵은 돈보다 무겁다)
      const it = g.L.items.get(what); g.L.items.delete(what);
      const hungry = (cardOf(g, n).rank || "").match(/노예|농노|고아/) || profOf(g, n).role === "serf";
      bumpRel(g, n, hungry ? 8 : 4, hungry ? 4 : 1); g.convo.turns++;
      addMemory(g, n, { kind: "emotion", tag: "다정함", text: `셋째가 ${it.name}을(를) 나눠 주었다`, salience: hungry ? 4 : 2, source: "engine" });
      if (hungry) addMemory(g, n, { kind: "debt", tag: "빚", text: `굶을 때 셋째가 ${it.name}을(를) 나눠 주었다`, salience: 3, source: "engine" });   // 빵 한 덩이의 빚 — 한 번은 꺼내 쓸 수 있다
      res.notes.push(`${it.name}을(를) 나눴다`);
      if (hungry) deed(g, "share_food", null, g.at, { witnessed: true });
      bond(g, n, hungry ? 8 : 5);
      return;
    }
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
    // 작전의 열매: 헨릭에게 그의 진짜 장부를 — 스물여섯째 줄이 지워진다
    if (n === "npc_henrik" && g.L.items.get(id)?.gid === "henrik_ledger") { mind(g, n).fear += 3; g.S.vars.kit_on_list = false; g.S.vars.henrik_blackmailed = true; res.notes.push("헨릭의 얼굴에서 핏기가 빠진다. 그가 명부를 펴고, 스물여섯째 줄을 긋는다"); g.S.threats.push({ by: n, target: "player", kind: "hunt", about: "henrik_ledger", t: g.t }); }
    // 글을 아는 사람에게 보이면 읽어 준다 (19 §4.2 "글을 아는 누군가에게 보여줘야 한다") — 그 사람도 알게 된다
    const R = goodOf(g, g.L.items.get(id))?.read;
    if (n && R && LITERATE.has(n) && !g.P.readDocs?.has(id)) {
      if (relOf(g, n).trust >= 15 || OK(res.tier)) {
        (g.P.readDocs ??= new Set()).add(id);
        res.notes.push(`${nameOf(g, n)}이(가) 소리 죽여 읽어 준다 — "${(R.text || "").slice(0, 80)}"`);
        for (const f of R.facts || []) { learn(g, f, `${nameOf(g, n)}이(가) 읽어 주었다`); if (!g.S.knows.has(f)) g.S.knows.set(f, new Set()); g.S.knows.get(f).add(n); }
        addMemory(g, n, { kind: "fact_learned", tag: null, text: `셋째가 ${g.L.items.get(id).name}을(를) 보여 주었다`, salience: 4, source: "engine" });
      } else res.notes.push(`${nameOf(g, n)}이(가) 글을 힐끗 보고는 고개를 돌린다. "나는 아무것도 못 봤다."`);
    }
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
    const it = g.L.give("player", { ...good, id: uid(g, `it_${gid}`), value: good.price, gid });
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
export function revealCtx(g, n, tier) {
  const r = relOf(g, n);
  const toldBy = new Set(Object.entries(g.M).filter(([k, m]) => k !== n && m.toldPlayer.size).map(([k]) => k));
  const m = mind(g, n);
  const flags = new Set(Object.keys(g.S.vars).filter((k) => g.S.vars[k] === true && /^(trial|story):/.test(k)));
  // 술자리: 저녁의 수탉(주막) — 혀가 풀리는 자리 / 제안: 이 대화에서 내놓은 것
  const hm = ((g.t % 1440) + 1440) % 1440, l = g.W.loc.get(g.at) || {};
  const tavern = g.at === "gf_rooster" || /tavern|inn|주막|술집/.test(`${l.kind || ""}${l.name || ""}`);
  const scene = tavern && (hm >= 18 * 60 || hm < 2 * 60) ? "술자리" : null;
  return { npc: n, trust: r.trust, like: r.like, tier, dead: g.S.dead, toldBy, scene, offer: !!g.convo?.offer, flags,
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
// 제안할 수 있는 것: [id, 선택지, 할 수 있나]
const OFFERS = [
  ["letters", "\"글자를 가르쳐 줄게.\" — 흙바닥에 손가락으로", (g) => skill(g, "읽고쓰기") >= 10],
  ["route", "\"빠져나갈 길이 있어.\" — 잿빛 실 이야기를 꺼낸다", (g) => knowsFact(g, "fact_gf_greyash_route") || (!!g.domain && !g.domain.lost)],
  ["shelter", "\"숨을 곳이 있어. 언덕에.\"", (g) => !!g.domain && !g.domain.lost],
  ["coin", "\"값은 치를게.\" — 1 발톱을 보여 준다", (g) => g.S.purse.player >= 12],
];
const goodOf = (g, it) => (it?.gid ? g.content.game.economy.goods[it.gid] : null);
const LITERATE = new Set(["npc_osric", "npc_owen_raven", "npc_henrik", "npc_martha", "npc_lea", "npc_godric_raven", "npc_kaspar", "npc_sara", "npc_lm_jonas", "npc_alberic", "npc_melisande", "npc_mateus"]);
function mentorsHere(g) {
  if (g.convo || g.fight || g.story) return [];
  const here = new Set(present(g).filter((w) => w.kind !== "captive" && !asleep(w, g.t)).map((w) => w.npc));
  const today = Math.floor(g.t / 1440);
  return (g.content.game.mentors || []).filter((M) => here.has(M.npc) && !g.S.dead.has(M.npc) && storyWhen(g, M.needs) && (g.P.trainedDay?.[M.npc] ?? -1) !== today && feeOK(g, M.fee));
}
const feeOK = (g, fee) => { if (!fee || fee === "none") return true; const [k, v] = fee.split(" "); return k === "coin" ? g.S.purse.player >= Number(v) : k === "item" ? mine(g).some((i) => i.gid === v) : true; };
// ── 앎의 흔적 (03 §4.3): 목격자 앞에서 미래를 쓰면 — 소문 → 목줄단의 밀고 → 잿빛 탑과 바르그의 추적. 대신 끌려가는 사람이 생긴다 ──
function echoSign(g, severity, what) {
  g.S.vars.echo_signs = (g.S.vars.echo_signs || 0) + severity;
  const seen = present(g).filter((w) => w.kind !== "captive" && !asleep(w, g.t)).map((w) => w.npc);
  for (const n of seen) g.L.believe(n, g.t, { kind: "echo_sign", subject: "player", at: g.at, source: "saw", heat: Math.min(1, 0.5 + severity * 0.2), content: String(what || "").slice(0, 30), reason: "셋째가 알 리 없는 것을 안다" }, { react: false });
}
const echoBelievers = (g, sid = g.P.settlement) => Object.keys(g.content.cards).filter((n) => !g.S.dead.has(n) && g.L.beliefs(n).some((b) => b.kind === "echo_sign") && (g.W.where(n, g.t)?.settlement || null) === sid);
const ECHO_STAGES = ["", "소문", "밀고", "추적"];
function echoTick(g, day) {
  const sid = g.P.settlement, who = echoBelievers(g, sid), E = (g.P.echoStage ??= {});
  const informer = who.some((n) => profOf(g, n).role === "authority" || n === "npc_martha" && relOf(g, n).trust < 40);
  const stage = who.length >= 8 ? 3 : who.length >= 5 || (informer && who.length >= 2) ? 2 : who.length >= 3 ? 1 : 0;
  if (stage <= (E[sid] || 0)) return;
  E[sid] = stage;
  if (stage >= 1) { g.P.titles = [...new Set([...(g.P.titles || []), "날을 아는 자"])]; g.feed.push({ kind: "echo", text: "〰 셋째가 앞일을 안다는 말이 돈다. 우물가에서, 배급 줄에서." }); }
  if (stage >= 2) {
    wantedAdd(g, 1, "잔향 징후 — 목줄단의 밀고", authorityOf(g, sid), sid);
    const x = ((g.nem ??= {}).npc_isol ??= { grudge: 0, track: 0, since: g.t }); x.grudge = Math.max(x.grudge, 1);
    g.feed.push({ kind: "echo", text: "〰 목줄단의 누군가가 초소에 다녀갔다. 네 이름이 적힌 쪽지를 들고." });
  }
  if (stage >= 3) {
    for (const n of ["npc_isol", "npc_volk"]) if (!g.S.dead.has(n)) { const x = ((g.nem ??= {})[n] ??= { grudge: 0, track: 0, since: g.t }); x.grudge = Math.max(x.grudge, 2); x.track = Math.max(x.track, 1); }
    // 대신 끌려가는 사람 (03 §4.3): 징후자로 몰린 다른 인간 — 회귀하면 지워진다. 그 회차 안에서는 진짜다
    const pool = Object.keys(g.content.cards).filter((n) => cardOf(g, n).tier === "C" && !g.S.dead.has(n) && g.W.where(n, g.t)?.settlement === sid && /인간/.test(cardOf(g, n).race || "인간"));
    const victim = pool[Math.floor(hash(g.seed, "scapegoat", day) * pool.length)];
    if (victim) { g.A.doEffect(`kill ${victim}`, g.t); g.P.notebook.push(`${displayName(g, victim)} — 잔향 징후자로 몰려 끌려갔다. 앞일을 아는 것은 너였다`); g.feed.push({ kind: "echo", text: `〰 ${displayName(g, victim)}이(가) 징후자로 끌려갔다. 너 때문이다.` }); DIR.loss(g, 8); (g.P.scapegoats ??= []).push(victim); }
  }
}
// ── 세력의 대응 사다리 (10 §5.1): 무관심 → 지역 현상금 → 바르그 사냥대 → 수색령과 본보기 → 와이번 ──
const LADDER = ["무관심", "지역 현상금", "바르그 사냥대", "수색령과 본보기", "와이번 기사단"];
export function ladderStage(g, sid = g.P.settlement) {
  const heat = heatHere(g, sid), echo = g.P.echoStage?.[sid] || 0;
  const killedAuth = g.deeds.some((d) => /^kill/.test(d.kind) && d.victim && profOf(g, d.victim).role === "authority" && deedKnowledge(g, d).identifiedAt != null);
  let st = heat >= 9 ? 4 : heat >= 6 || echo >= 3 ? 3 : heat >= 4 || echo >= 2 || killedAuth ? 2 : heat >= 2 || echo >= 1 ? 1 : 0;
  if (st === 4 && !(g.domain && !g.domain.lost)) st = 3;   // 하늘의 기사단은 영역을 찾을 때 온다
  return st;
}
function ladderTick(g, day) {
  const sid = g.P.settlement, L = (g.P.ladder ??= {}), st = ladderStage(g, sid), was = L[sid] || 0;
  if (st > was) {
    L[sid] = st;
    const lines = ["", "초소 문에 그림 한 장이 붙는다. 얼굴은 서툴다. 셋째라는 이름은 또렷하다 — 현상금.", "바르그의 개 짖는 소리가 마을 밖에서 들린다. 사냥대가 왔다. 냄새를 맡으러.", "집집마다 문이 열린다. 숨긴 자를 내놓지 않으면 대신 매달겠다는 포고 — 본보기.", "와이번 그림자가 언덕을 쓸고 지나간다. 한 번. 두 번."];
    g.feed.push({ kind: "echo", text: `〰 ${lines[st]}` }); g.P.notebook.push(`세력의 눈 — ${LADDER[st]}`);
    if (st >= 2 && !g.S.dead.has("npc_volk")) { const x = ((g.nem ??= {}).npc_volk ??= { grudge: 0, track: 0, since: g.t }); x.grudge = Math.max(x.grudge, 2); }
    if (st >= 4 && g.domain && !g.domain.lost) (g.domainDue ??= []).push("raid");
  } else if (st < was && day % 3 === 0) L[sid] = st;   // 식으면 천천히 내려간다
  // 본보기 (3단계): 사흘에 한 번, 누군가 채찍 기둥에 — 인간들이 주인공 때문에 맞는다
  if ((L[sid] || 0) >= 3 && day % 3 === 0 && sid === SETTLEMENT) {
    const pool = Object.keys(g.content.cards).filter((n) => cardOf(g, n).tier === "C" && !g.S.dead.has(n) && g.W.where(n, g.t)?.settlement === sid);
    const v = pool[Math.floor(hash(g.seed, "example", day) * pool.length)];
    if (v) { g.A.doEffect(`punish ${v} at gf_whip_square for 1`, g.t); g.feed.push({ kind: "echo", text: `〰 ${displayName(g, v)}이(가) 채찍 기둥에 묶였다. 셋째를 숨겼다는 이유로. 숨긴 적이 없다.` }); DIR.loss(g, 3); }
  }
  if (g.domain && !g.domain.lost && (L[sid] || 0) >= 2) g.domain.expMod = (g.domain.expMod || 0) + 0.5;   // 사냥대가 냄새를 맡는다 — 숨은 곳이 위험해진다
}
// 대본 장면이 남긴 깃발의 결과 가운데 '며칠 뒤'가 필요한 것 (A13): 목표 행동 문법에는 상대 시각이 없다
function flagsDay(g, day) {
  const V = g.S.vars, P = g.P, T = day * 1440;
  // 명단을 태웠다 — "세렌에 사본이 있다. 그래도 서른 날은 번다"
  if (V.list_burned && !V.list_restored) {
    P.listBurnedDay ??= day;
    if (day - P.listBurnedDay >= 30) {
      V.list_restored = true;
      if (!V.sara_sold && !g.S.dead.has("npc_sara") && !V.sara_freed) V.sara_on_list = true;
      if (!V.kit_sold && !g.S.dead.has("npc_kit")) V.kit_on_list = true;
      g.feed.push({ kind: "echo", text: "〰 세렌에서 명단 사본이 왔다는 말이 돈다. 불탄 이름들이 다시 적혔다." });
      g.S.log.push({ t: T, npc: "npc_owen_raven", agenda: "sim", vis: "public", text: "세렌의 사본으로 매각 명단을 다시 썼다" });
    }
  }
  // 사슬에서 풀린 사라 — 늑대굴로 간다
  if (V.sara_freed && !P.saraMoved && !g.S.dead.has("npc_sara")) {
    P.saraMoved = true;
    g.W.override({ npc: "npc_sara", from: T, to: null, kind: "at", at: "hungry_hill__wolf_den", doing: "늑대굴 안쪽 — 손목의 쐐기 자국을 문지른다" });
    if (V.sigrid_group != null) V.sigrid_group += 1;
  }
  // 마르타의 눈 — 밤에 마을 안을 돌아다니면 즈닉이 듣는다
  if (V.martha_watches_you && P.settlement === SETTLEMENT && (P.nightOut || 0) > 0 && hash(g.seed, "martha_eye", day) < 0.3) wantedAdd(g, 1, "마르타가 본 것을 즈닉에게 전했다", overseer(g), SETTLEMENT);
  P.nightOut = 0;
  // 겁먹은 헨릭 — 이레가 지나도 장부가 네 손에 있으면 하겐에게 동전을 쥐여 준다
  if (V.henrik_blackmailed && !V.henrik_hired && !g.S.dead.has("npc_henrik") && !g.S.dead.has("npc_hagen")) {
    P.blackmailDay ??= day;
    if (day - P.blackmailDay >= 7 && mine(g).some((i) => i.gid === "henrik_ledger")) {
      V.henrik_hired = true;
      const x = ((g.nem ??= {}).npc_hagen ??= { grudge: 0, track: 0, since: T }); x.grudge = Math.max(x.grudge, 2);
      g.feed.push({ kind: "echo", text: "〰 수탉 뒤뜰에서 헨릭이 하겐에게 무언가를 쥐여 주는 것을 누가 보았다고 한다." });
    }
  }
  // 통금에 세 번 걸리면 즈닉의 명단에 오른다
  if ((V.player_curfew || 0) >= 3 && !P.curfewListed) { P.curfewListed = true; wantedAdd(g, 1, "통금을 세 번 어겼다", overseer(g), SETTLEMENT); }
}
// 배신감 (21 §5.3): 믿은 거짓말은 사실처럼 작동하다가, 반대 증거(그 사람이 진실을 알게 됨)를 만나면 신뢰가 무너진다
function liesTick(g) {
  for (const [n, m] of Object.entries(g.M || {})) for (const mem of m.memories || []) {
    const c = mem.claim; if (!c?.believed || c.truth !== false || c.exposed || !c.contra) continue;
    const knows = (cardOf(g, n).knows || []).includes(c.contra) || !!g.S.knows.get(c.contra)?.has(n);
    if (!knows || g.S.dead.has(n)) continue;
    c.exposed = g.t;
    bumpRel(g, n, -10, -20);
    addMemory(g, n, { kind: "impression", tag: "거짓말쟁이", delta: -5, text: `셋째의 말은 거짓이었다 — "${c.content}"`, salience: 5, source: "engine" });
    addMemory(g, n, { kind: "emotion", tag: "배신감", text: "믿었던 말이 거짓이었다", salience: 5, source: "engine" });
    if (g.P.met.has(n)) g.P.notebook.push(`${displayName(g, n)} — 네가 한 말이 거짓이었다는 것을 알았다 ("${c.content}")`);
  }
}
// 기록 하나를 세계에 — 기억은 마음에, 약속은 일정에, 주장은 믿음(소문)에, 들은 사실은 지식에
function applyRecord(g, n, mem) {
  addMemory(g, n, mem);
  if (mem.promise && !g.S.dead.has(n)) {
    g.W.override({ npc: n, from: mem.promise.from, to: mem.promise.to, kind: "at", at: mem.promise.place, doing: `셋째와 약속한 대로 기다린다 — ${mem.promise.what}` });
    g.P.notebook.push(josa(`${nameOf(g, n)}과(와)의 약속 — ${fmt(mem.promise.from)}, ${placeName(g, mem.promise.place)}: ${mem.promise.what}`));
    (g.promises ??= []).push({ npc: n, ...mem.promise, state: "open" });
  }
  // 협박 (21 §6.1 threat): 두려움 + 원한의 씨앗 — 사냥꾼·윗선·담이 큰 사람은 숙적 후보가 된다 (17)
  if (mem.kind === "threat" && !g.S.dead.has(n) && (["hunter", "authority"].includes(profOf(g, n).role) || profOf(g, n).nerve >= 60)) { const x = ((g.nem ??= {})[n] ??= { grudge: 0, track: 0, since: g.t }); x.grudge = Math.max(x.grudge, 1); }
  if (mem.claim?.caught) addMemory(g, n, { kind: "impression", tag: "거짓말쟁이", delta: -3, text: `셋째가 거짓말을 했다 — "${mem.claim.content}"`, salience: 3, source: "engine" });
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
    // 하루 상한 (21 §6.3): 인상이 쌓여도 하루에 호감 ±15, 신뢰 ±12까지 — 태그 다섯이 +25가 되지 않게
    const day = Math.floor(g.t / 1440), cap = ((g.P.impDay ??= {})[n] ??= { day, like: 0, trust: 0 });
    if (cap.day !== day) Object.assign(cap, { day, like: 0, trust: 0 });
    const lim = (k, v, max) => { const room = v >= 0 ? max - cap[k] : -max - cap[k]; const d = v >= 0 ? Math.min(v, Math.max(0, room)) : Math.max(v, Math.min(0, room)); cap[k] += d; return d; };
    const dl = good ? (mem.delta || 0) : bad ? -Math.abs(mem.delta || 0) : 0, dt = good ? Math.round((mem.delta || 0) / 2) : bad ? -Math.abs(mem.delta || 0) : 0;
    if (good || bad) bumpRel(g, n, lim("like", dl, 15), lim("trust", dt, 12));
  }
  const slots = { S: 60, A: 30, B: 12, C: 4 }[g.P.promoted?.has(n) ? "B" : cardOf(g, n).tier] || 4;   // C등급(이름 없는 주민)은 4칸 (21 §6.4)
  if (m.memories.length > slots) {
    // 슬롯이 차면 중요도가 낮은 것부터 요약한다 (21 §6.4) — 지우지 않고 한 줄로 접는다
    m.memories.sort((a, b) => (b.salience || 0) - (a.salience || 0) || (b.t || 0) - (a.t || 0));
    const folded = m.memories.splice(slots - 1);
    const old = folded.find((x) => x.kind === "summary"), tags = Object.entries(m.impressions).filter(([, v]) => Math.abs(v) >= 3).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k]) => k);
    const count = (old?.count || 0) + folded.filter((x) => x.kind !== "summary").length;
    m.memories.push({ kind: "summary", text: `셋째와 몇 번 얽혔다 (${count})${tags[0] ? ` — ${tags[0]} 아이` : ""}`, salience: 1, count, source: "engine" });
  }
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
    if (c.kind === "impression") {
      const used = perTag[c.tag] || 0; delta = clamp(delta, -5 - used, 5 - used); perTag[c.tag] = used + delta;
      // 대화 한 번의 상한 (21 §6.3): 호감 ±8 · 신뢰 ±6 — 좋은 인상은 호감으로, 나쁜 인상은 신뢰로 깎인다
      const good = ["영리함", "정직함", "다정함", "용감함", "쓸모 있음"].includes(c.tag), bad = ["위험함", "거짓말쟁이", "비굴함", "짐"].includes(c.tag);
      const room = good ? 8 - (perTag._like || 0) : bad ? 6 - (perTag._trust || 0) : 5;
      if (good || bad) { const k = good ? "_like" : "_trust"; const d = Math.sign(delta) * Math.min(Math.abs(delta), Math.max(0, room)); perTag[k] = (perTag[k] || 0) + Math.abs(d); delta = d; }
    }
    const mem = { kind: c.kind, tag: c.tag || null, delta, text: String(c.text || c.evidence).slice(0, 120), salience: clamp(Number(c.salience) || 2, 1, 5), source: "llm" };
    // 기록관의 제안 — 규칙을 거쳐 세계에 닿는다 (28 §6)
    if (c.kind === "promise" && c.promise) {
      const place = resolvePlace(g, c.promise.place), when = resolveWhen(c.promise.when, t);
      if (place && when) mem.promise = { place, from: when, to: when + 60, what: String(c.promise.what || "약속").slice(0, 60) };
      else mem.note = "약속의 장소·시각을 엔진이 알아듣지 못함 → 기억으로만";
    }
    if (c.kind === "claim" && c.claim) {
      // 주장 (21 §5.3): 진위는 엔진이 안다 — 사실 DB와 대조. 믿는지는 기만 vs 통찰 판정. 기록관(LLM)의 'believed'는 쓰지 않는다
      const about = g.content.names[String(c.claim.about || "").trim()] || null;
      const content = String(c.claim.content || "").slice(0, 80);
      const same = c.claim.fact && knowsFact(g, c.claim.fact) ? c.claim.fact : null;
      const contra = c.claim.contradicts && knowsFact(g, c.claim.contradicts) && g.content.facts[c.claim.contradicts]?.truth !== false ? c.claim.contradicts : null;
      const truth = contra ? false : same ? g.content.facts[same]?.truth !== false : null;   // null: 엔진도 모르는 말 — 지어낸 이야기일 수도
      const S = skill(g, "기만") + g.P.mods.지능 * 2 + (truth === true ? 15 : 0) + Math.round(relOf(g, npc).trust / 5);
      const npcKnows = (f) => !!f && ((cardOf(g, npc).knows || []).includes(f) || (cardOf(g, npc).hides || []).some((h) => h.fact === f) || !!g.S.knows.get(f)?.has(npc));
      const D = Math.round((profOf(g, npc).perception ?? 50) * 0.6 + 10) + (npcKnows(contra) ? 40 : 0);   // 진실을 아는 사람에게 하는 거짓말
      const believed = hash(g.seed, "claim", npc, String(t), content) < prob(S, D);
      mem.claim = { about, content, believed, truth, fact: same, contra };
      if (!believed && truth === false) mem.claim.caught = true;   // 그 자리에서 거짓말인 줄 안다
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
// 시대의 끝 (03 §4.5·§4.6): 회귀를 놓으면, 다음 죽음이 진짜 죽음이다. 세계는 나 없이 흘러간다
export function epilogue(g) {
  const v = g.S.vars, out = [];
  out.push(v.kit_sold ? "서리월 9일, 키트는 사슬 속에서 남쪽으로 갔다. 그 뒤의 일은 아무도 적지 않았다." : v.kit_hidden ? "키트는 늑대굴에서 겨울을 났다. 봄에, 시그리드의 무리와 함께 북쪽으로 갔다." : "키트는 명단에서 빠졌다. 열두 살에 글자 하나를 배웠다. 누구에게서인지 말하지 않았다.");
  out.push(v.sara_sold ? "사라는 굶주림월 3일의 사슬에 있었다. 세렌의 어느 집에서, 그녀는 누군가의 이름을 소리 없이 불렀다." : v.sara_bound ? "사라는 손목의 끈을 풀지 않았다. 아무도 그것이 무엇인지 묻지 않았다." : "사라는 성채에서 늙었다. 우물가에서 가끔 누군가를 기다리는 얼굴을 했다.");
  // 마지막 회차에서만, 관리자는 주인공이 죽은 뒤에도 영역을 이끈다 (09 §6.5)
  if (g.domain && !g.domain.lost) out.push(`${placeName(g, g.domain.at)}은(는) ${displayName(g, g.domain.steward)}이(가) 이끌었다. ${(g.domain.built || []).includes("school") ? "그 동굴에서 글자를 배운 아이가 열이 넘었다." : "그 겨울, 아무도 그곳을 찾지 못했다."}`);
  out.push((v.fugitives_caught || 0) >= 19 ? "늑대굴은 비었다. 굶주린 언덕에 연기가 오르지 않는다." : "회색여울은 그 뒤로도 저녁마다 빵 냄새가 났다. 배급 줄은 줄지 않았다.");
  return out;
}
export function regressRun(g) {
  const carry = g.run.carry;
  if (carry.final && g.ended?.kind === "dead") return null;   // 진짜 죽음 — 돌아오지 않는다
  const notebook = [...carry.notebook, ...g.P.notebook.map((n) => (n.startsWith("◇") ? n : `◇ ${g.run.loop}회차 — ${n}`))];
  const future = [...new Set([...carry.future, ...g.P.knows])];
  const record = loopRecord(g);
  const deaths = [...carry.deaths, ...(g.ended ? [{ loop: g.run.loop, ...g.ended, t: g.t, at: g.at }] : [])];
  // 이름과 재능은 영혼의 것 — 회귀해도 남는다 (WORLD_BIBLE §1.3.1, 06)
  const next = newRun({ seed: g.run.seed, loop: g.run.loop + 1, carry: { notebook: notebook.slice(-200), future, deaths, trueName: trueName(g), sibling: sibling(g), talent: g.P.talent || carry.talent || null, soul: settleSoul(g, record), final: !!g.run.release } });
  // 플레이어의 설정은 회차를 넘는다: 이야기 모드(03 §6)·고른 화자(18 §4)·인물 수첩 메모(08 §5 "수첩은 남는다")·회차별 되돌리기 횟수
  for (const k of ["mode", "memos", "rewinds"]) if (g.run[k] != null) next[k] = g.run[k];
  if (g.narrator || g.run.narrator) next.narrator = g.narrator || g.run.narrator;   // (opening·lethal은 검사용 깃발 — 넘기지 않는다)
  return next;
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
  S.visitedSettlements = [...new Set([...(S.visitedSettlements || []), ...(g.P.visited || [])])];   // 지도 기억은 남는다 (07 §3)
  S.obs = g.P.obs || {};                       // 지난 회차의 같은 날·같은 30분에 누가 어디 있었나 (◇ 표류를 알아본다)
  if (g.ended?.trace) {                        // 죽음의 흔적: 같은 흔적을 또 얻으면 단계가 오른다
    const tr = g.ended.trace, old = (S.traces ||= []).find((x) => x.id === tr.id && (x.npc || null) === (tr.npc || null));
    if (old) old.level = Math.min(3, (old.level || 1) + 1); else S.traces.push({ id: tr.id, npc: tr.npc || null, name: TRACE_TEXT[tr.id]?.name || tr.id, level: 1, loop });
  }
  S.skills ||= {};
  for (const sk of Object.keys(g.P.skills)) S.skills[sk] = Math.max(S.skills[sk] || 0, Math.round(rawSkill(g, sk) * 10) / 10);
  S.trainPeak = Math.max(S.trainPeak || 0, g.P.train);
  // 업적 → 재능 점수 (03 §4.2): 잔향에 조용히 새겨진다. 회차 기록에는 붙지 않는다
  S.achievements ||= [];
  for (const a of ACHIEVEMENTS) if (!S.achievements.includes(a.id) && a.when(g)) { S.achievements.push(a.id); S.tp = (S.tp || 0) + a.tp; }
  S.tp = (S.tp || 0) - (g.P.tpSpent || 0);
  S.extraTalents = [...new Set([...(S.extraTalents || []), ...(g.P.awakened || [])])];
  const brutal = ["water", "teeth", "spear", "rope"].includes(g.ended?.trace?.id);
  S.stressCarry = Math.min(70, Math.round(30 + (g.P.status.stress - 30) * 0.4 + (g.ended?.kind === "dead" ? (brutal ? 12 : 5) : 0)));
  S.temper = { ...g.P.temper };
  S.lexicon = [...new Set([...(S.lexicon || []), ...lexicon(g).filter((w) => w.meaning).map((w) => w.word)])];
  for (const o of g.oaths || []) { const oa = (g.content.game.oaths || []).find((x) => x.id === o.id); if (oa && !(S.oaths ||= []).some((x) => x.id === o.id)) S.oaths.push({ id: o.id, line: oa.line, loop, state: o.state }); }
  S.nemeses = [...(S.nemeses || []), ...Object.entries(g.nem || {}).map(([npc, x]) => ({ npc, loop, grudge: x.grudge }))].slice(-12);
  S.echoNamed = S.echoNamed || !!g.S.vars.echo_named;
  S.paths = { ...(S.paths || {}), [loop]: (g.P.path || []).slice(0, 800) };
  for (const k of Object.keys(S.paths)) if (Number(k) < loop - 2) delete S.paths[k];   // 최근 세 회차만
  // 애착은 회귀를 건넌다 — 주는 쪽만 (held = max(held × 0.9, 이번 최고치), 20 §4.3)
  S.bonds ||= {};
  for (const [n, v] of Object.entries({ ...Object.fromEntries(Object.keys(S.bonds).map((k) => [k, 0])), ...(g.P.bond || {}) })) S.bonds[n] = Math.round(Math.max((S.bonds[n] || 0) * 0.9, v));
  S.names = { ...(S.names || {}), ...(g.P.names || {}) };
  S.days = { ...(S.days || {}), [loop]: (g.P.days || []).slice(-120) };
  for (const k of Object.keys(S.days)) if (Number(k) < loop - 3) delete S.days[k];
  S.stains = [...(S.stains || []), ...g.deeds.filter((d) => DARK.has(d.kind)).map((d) => ({ kind: d.kind, victim: d.victim, loop }))].slice(-40);
  S.romance = { ...(S.romance || {}) }; for (const n of ["npc_sara"]) S.romance[n] = Math.max(S.romance[n] || 0, romanceStage(g, n));
  S.trueNames = [...new Set([...(S.trueNames || []), ...Object.entries(g.content.game.truenames || {}).filter(([, T]) => g.S.vars[T.var]).map(([w]) => w)])];
  // 영역의 기억 (09 §6.5~6.6): 관리자는 너를 잊는다. 누구에게 무엇을 맡겨야 하는지는 네가 안다
  if (g.domain) {
    S.domainMemory = [...new Set([...(S.domainMemory || []), "site:" + g.domain.at, ...(g.domain.policy === "open" && (g.S.vars.fugitives_caught || 0) > 0 ? ["traitor"] : [])])];
    const ob = (S.stewardSeen ||= {}); const st = g.domain.steward; ob[st] = (ob[st] || 0) + 1;
  }
  if (g.redRoad?.length) S.redRoad = [...new Set([...(S.redRoad || []), ...g.redRoad])];
  if (g.S.vars.greyford_free) S.risingDone = true;
  if (g.family?.name) S.house = { name: g.family.name, motto: g.family.motto };
  S.lostChildren = [...(S.lostChildren || []), ...((g.family?.children || []).map((c) => ({ ...c, loop })))].slice(-20);
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
    stains: g.deeds.filter((d) => DARK.has(d.kind)).length,
    children: (g.family?.children || []).map((c) => c.name), house: g.family?.name || null,
    built: g.domain && !g.domain.lost ? `${placeName(g, g.domain.at)} — 머릿수 ${DOM.popOf(g, g.domain)}` : null,
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
// '{n}째 저녁' (18 §5.4): 첫째·둘째·셋째·넷째·다섯째 … 열한째 · 스무째
const NTH_U = ["", "첫", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉"], NTH_U2 = ["", "한", "두", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉"];
const NTH_T = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
export const nthKo = (n) => (n >= 100 ? `${n}번째` : n < 10 ? `${NTH_U[n]}째` : n % 10 === 0 ? `${n === 20 ? "스무" : NTH_T[n / 10]}째` : `${NTH_T[Math.floor(n / 10)]}${NTH_U2[n % 10]}째`);
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
  // 그 회차에 세운 것 (14 §6.6) — 아이는 잊는 것이 아니라 없어지는 것
  if (r.children?.length || r.house || r.built) lines.push(`── 그 회차에 세운 것 ──\n${[...(r.children || []).map((n) => `${n} — 그 회차에 태어났다. 다시 태어나지 않는다.`), ...(r.house ? [`'${r.house}' — 가문원들은 서로를 모르는 사람들로 돌아갔다.`] : []), ...(r.built ? [`${r.built}. 아직 아무도 거기 없다.`] : [])].join("\n")}`);
  if (r.stains) lines.push(`── 손에 남은 것 ──\n${r.stains}번. 아무도 기억하지 못한다. 너만.`);
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
// 대우 (10 §4): 그 사람이 속한 집단의 시선 구간 — 호의는 깎아 주고, 경계는 올려 받고, 적대는 팔지 않는다
const repCache = (g) => { const k = `${g.t}|${g.deeds.length}|${(g.S.beliefs?.size || 0)}`; if (g._rep?.k !== k) g._rep = { k, r: reputation(g) }; return g._rep.r; };
function bandOf(g, n) { const grp = n ? groupOf(g, n) : null; const v = grp ? (repCache(g).views[grp] || 0) : 0; return viewBand(v); }
function priceOf(g, n, gid) {
  const good = g.content.game.economy.goods[gid], r = relOf(g, n);
  const haggle = 1 - clamp((r.like * 0.6 + r.trust * 0.4) / 250, -0.2, 0.2);
  const famine = fromMinutes(g.t).m === 12 && good.tags?.includes("음식") ? 3 : 1;
  const band = { 존경: 0.8, 호의: 0.9, 무심: 1, 경계: 1.25, 적대: 1.5 }[bandOf(g, n)] || 1;
  return Math.max(1, Math.round(good.price * haggle * famine * band * (good.illegal ? 2 : 1)));
}
// 점호 몸수색 (14 §0:14 — 첫 회차는 반드시 플레이어, 그 뒤는 셋 중 하나): 숨길 수 있는 것은 손재주로 숨긴다.
// 은화(12못 이상)는 절도 의심으로 빼앗기고, 무기·위조 문서는 죄가 된다
function rollcallSearch(g, day) {
  // 움막 12호의 금을 본 감독은 다음 점호에 반드시 뒤진다
  const marked = g.S.vars.hut12_marks_seen && !g.P.hut12Searched; if (marked) g.P.hut12Searched = true;
  const searched = marked || (g.run.loop === 1 && day === Math.floor(START / 1440) + 1 ? true : hash(g.seed, "search", day) < 1 / 3);
  if (!searched) return;
  const found = [];
  for (const it of mine(g)) {
    // 자리마다 다르다: 손·허리는 그대로 드러나고, 품은 더듬으면 나오고, 부츠·소매는 손재주로 숨긴다 (02 §2)
    const sl = slotOf(it), hideable = it.tags?.includes("숨길수있음");
    const P = SLOTS[sl].seen ? 0 : sl === "품" ? (hideable ? prob(skill(g, "손재주") + g.P.mods.민첩 * 2, 24) : 0.05) : prob(skill(g, "손재주") + g.P.mods.민첩 * 2 + 8, 20);
    if (hash(g.seed, "frisk", day, it.id) >= P) found.push(it);
  }
  const coin = g.S.purse.player;
  let text = "크릭 감독이 당신의 옷과 부츠를 뒤진다.";
  if (coin >= 12 && hash(g.seed, "frisk-coin", day) >= prob(skill(g, "손재주") + 8, 18)) {
    g.S.purse.player = 0; g.S.purse[overseer(g)] = (g.S.purse[overseer(g)] || 0) + coin;
    text += ` 동전 ${coin}못이 나왔다 — 인간이 은화를? 즈닉이 가져가고 채찍 다섯.`;
    g.P.status.pain = clamp(g.P.status.pain + 10, 0, 100);
  }
  for (const it of found) {
    g.L.items.delete(it.id);
    if (it.tags?.includes("무기") || it.illegal) {
      wantedAdd(g, 3, `점호에서 ${it.name}이(가) 나왔다`, overseer(g), SETTLEMENT);
      deed(g, "weapon", null);
      text += ` ${it.name}이(가) 나왔다. 광장이 조용해진다.`;
    } else text += ` ${it.name}을(를) 빼앗겼다.`;
  }
  if (!found.length && !(coin >= 12)) text += " 아무것도 나오지 않았다.";
  g.feed.push({ kind: "rule", text: josa(text), quiet: !found.length && !(coin >= 12 && g.S.purse.player === 0) });   // 아무것도 안 나온 몸수색은 늘 있는 일
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
function deed(g, kind, victim, at = g.at, { witnessed = false } = {}) {
  const k = classifyDeed(kind, victim ? profOf(g, victim) : {}, victim ? cardOf(g, victim) : {});
  // 본 사람이 있는 일 (빵을 나눔, 장면 속의 밀고): 그 자리에서 알려지고 누가 했는지도 안다
  g.deeds.push({ id: `d${g.deeds.length + 1}`, kind: k, victim, at, placeName: placeName(g, at), t: g.t, ...(witnessed ? { seenAt: g.t } : {}) });
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
  if (d.seenAt != null) { known = Math.min(known ?? d.seenAt, d.seenAt); ident = Math.min(ident ?? d.seenAt, d.seenAt); }
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
  if (g.P.names?.[n]) return g.P.names[n];
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
  const remembered = new Set((soul(g).visitedSettlements || []).map((sid) => g.content.bundle.settlements[sid]?.node).filter(Boolean));
  const nodeOfS = (sid) => g.content.bundle.settlements[sid]?.node;
  const visitedNodes = new Set([...visited].map(nodeOfS).filter(Boolean));
  const heard = new Set(); for (const f of g.P.knows) for (const n of g.content.bundle.map.nodes) if ((g.content.facts[f]?.text || "").includes(n.name)) heard.add(n.id);
  const nodes = g.content.bundle.map.nodes.map((n) => ({ id: n.id, name: n.name, x: n.x, y: n.y, major: !!n.major, here: n.id === nodeOfS(g.P.settlement), visited: visitedNodes.has(n.id), remembered: remembered.has(n.id) && !visitedNodes.has(n.id), heard: heard.has(n.id) }));
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
    fight: g.fight ? { npc: g.fight.npc, name: displayName(g, g.fight.npc), round: g.fight.round, me: g.fight.me, foe: g.fight.foe } : null,
    skills: Object.keys(g.P.skills).map((sk) => { const v = skill(g, sk); return { name: sk, word: sk === "읽고쓰기" ? LETTER_WORD(v) : sk === "용언" ? TONGUE_WORD(v) : skillWord(v), body: !!BODY_STAT[sk], lagging: !!BODY_STAT[sk] && rawSkill(g, sk) + talentBonus(g, sk) > bodyCap(g, sk) }; }),
    player: { ...g.P.status, coin: g.S.purse.player, items: mine(g).map((i) => ({ id: i.id, name: i.name, slot: slotOf(i), tags: i.tags || [], seen: !!SLOTS[slotOf(i)]?.seen })), bloody: !!g.P.bloody, wanted: heatHere(g), wantedWord: wantedWord(heatHere(g)) },
    notebook: [...g.run.carry.notebook, ...g.P.notebook],
    ended: g.ended ? (() => { const r = loopRecord(g); return { ...g.ended, firstDeath: !g.run.carry.deaths.length, loop: g.run.loop, final: !!g.run.carry.final && g.ended.kind === "dead", canRelease: g.run.loop >= 3 && !g.run.carry.final, epilogue: g.run.carry.final && g.ended.kind === "dead" ? epilogue(g) : null, record: { short: recordCard(r, { short: true }), full: recordCard(r), rewind: r.rewind } }; })() : null,
    story: g.story ? { id: g.story.id, phase: g.story.phase } : null, goals: goals(g), trueName: trueName(g),
    people_known: [...new Set([...g.P.met, ...Object.keys(soul(g).people)])].map((n) => ({
      id: n, name: nameOf(g, n), who: whoIs(g, n), thisLoop: g.P.met.has(n),
      lastSeen: g.P.seen[n] ? `${fmt(g.P.seen[n].t).slice(7)} ${placeName(g, g.P.seen[n].at)}` : null, guess: estimate(g, n),
      mood: g.P.met.has(n) ? moodWords(relOf(g, n), mind(g, n)) : "이번 회차엔 아직 나를 모른다",
      ...bookOf(g, n), knots: knots(g.P.bond?.[n] || 0), heldKnots: knots(soul(g).bonds?.[n] || 0),
      past: (soulPerson(g, n)?.loops || []).map((x) => `${x.loop}회차: ${pastBond(x)}${x.impressions.length ? ` · 그는 나를 '${x.impressions.join("·")}'(으)로 보았다` : ""}${x.lines[0] ? ` · ${x.lines[0]}` : ""}${x.died ? " · 그 회차에 죽었다" : ""}`),
    })),
    unlocked: unlockedNow(g),
    oaths: (g.oaths || []).map((o) => ({ line: (g.content.game.oaths || []).find((x) => x.id === o.id)?.line, state: o.state, witnesses: o.witnesses.map((n) => displayName(g, n)) })),
    pastOaths: (soul(g).oaths || []).filter((o) => !(g.oaths || []).some((x) => x.id === o.id)).map((o) => o.line),
    lastHook: g.P.lastHook || null,
    lexicon: lexicon(g),
    twoDays: twoDays(g),
    domain: (() => { _domData = g.content.game.domains; return DOM.domainView(g, DMH()); })(),
    hide: g.hide ? { at: placeName(g, g.hide.at), people: g.hide.people.map((n) => displayName(g, n)), food: Math.round(g.hide.food * 10) / 10, exposure: g.hide.exposure < 0.3 ? "아직 아무도 모른다" : g.hide.exposure < 0.6 ? "냄새가 새기 시작했다" : g.hide.exposure < 1 ? "누군가 그쪽을 본다" : "드러났다", lost: !!g.hide.lost } : null,
    family: g.family ? { name: g.family.name || null, motto: g.family.motto || null, members: g.family.members.map((n) => displayName(g, n)), children: g.family.children.map((c) => ({ name: c.name, sex: c.sex, age: childAge(g, c), traits: childTraits(c), skills: Object.fromEntries(Object.entries(c.skills || {}).map(([k, v]) => [k, Math.round(v)])), taught: c.taught || 0, own: c.own })), pregnant: !!g.family.pregnant } : null,
    trueNames: Object.keys(g.content.game.truenames || {}).filter((w) => knowsWord(g, w)).map((w) => ({ word: w, source: g.content.game.truenames[w].source })),
    rising: (() => { const r = risingReady(g); return r.some((x) => x.ok) || g.S.vars.greyford_free ? { ready: r, free: !!g.S.vars.greyford_free, failed: !!g.S.vars.rising_failed } : null; })(),
    succession: g.S.vars.varskar_dead || g.S.vars.kaspar_warned ? { dead: !!g.S.vars.varskar_dead, kaspar: g.S.vars.faction_kaspar, throne: !!g.S.vars.kaspar_throne, charter: !!g.S.vars.kaspar_charter } : null,
    ops: opsOf(g), final: !!g.run.carry.final,
    romance: { npc_sara: romanceStage(g, "npc_sara"), words: { npc_sara: ROMANCE_WORDS[romanceStage(g, "npc_sara")] } },
    narrator: { id: g.narrator || g.run.narrator || "silent_god", name: DIR.narratorOf(g).name }, director: g.dir ? { phase: g.dir.phase, T: g.dir.T, target: DIR.targetT(g) } : null,
    traits: traits(g), mode: g.run.mode || "grim", echoNamed: !!g.S.vars.echo_named || (soul(g).echoNamed || false),
    talents: talentsOf(g).map((t) => ({ id: t, name: TALENT[t]?.name || t, grows: TALENT[t]?.grow || [] })),
    achievements: (soul(g).achievements || []).map((a) => (typeof a === "string" ? a : a.id)).map((id) => ACHIEVEMENTS.find((x) => x.id === id)?.text || id),
    ladder: (() => { const st = ladderStage(g); return st ? { stage: st, name: LADDER[st] } : null; })(),
    echo: g.P.echoStage?.[g.P.settlement] ? ECHO_STAGES[g.P.echoStage[g.P.settlement]] : null,
    reputation: (() => { const r = reputation(g); return { views: r.views, extraTitles: g.P.titles || [], bands: Object.fromEntries(Object.entries(r.views || {}).map(([k, x]) => [k, viewBand(x)])), titles: r.titles, reach: r.reach, news: r.news.slice(-6) }; })(),
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
export function setNarrator(g, id) {
  if (!DIR.NARRATORS[id]) throw new Error("모르는 화자: " + id);
  const e = { i: g.run.journal.length, kind: "narrator", id };
  apply(g, e); g.run.journal.push(e);
}
export function recordMemories(g, npc, mems) {   // 기억과 기록관의 제안 모두 같은 기록으로
  if (!mems.length) return;
  const e = { i: g.run.journal.length, kind: "memory", npc, mems };
  apply(g, e); g.run.journal.push(e);
}
