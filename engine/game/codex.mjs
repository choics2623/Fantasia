// 백과 (19 §5 보강): 이야기 속 이름 — 사람·장소·세력·말·세상 — 을 누르면 카드가 열린다.
// 아는 만큼만 보인다: 0 모름(목록에 없다) · 1 들어 봤다(? — 이름뿐) · 2 안다 · 3 깊이 안다(숨은 사정을 하나라도 안다).
// 회귀해도 아는 것은 남는다: 영혼의 사람·사실·장소·낱말, 그리고 서술에서 들은 이름(run.heard — 세션이 다음 회차로 넘긴다).
// 읽기만 한다 — 세계를 바꾸지 않으므로 재생과 상관없다.
import { view, displayName, whoIs, knownNodes, estimateOf, lexicon, soulOf, knowsFact, storyWhen, placeName, planJourney, journeySchedule } from "./game.mjs";
import { josa } from "../sim/text.mjs";

export const KIND_LABEL = { npc: "사람", loc: "장소", node: "장소", reg: "땅", fac: "세력", word: "말", gl: "세상" };
const FAC_KIND = { polity: "나라", org: "조직", house: "가문", faith: "신앙", secret: "비밀 결사" };
const LOC_KIND = { keep: "성채", work: "일터", barracks: "막사", home: "집", square: "광장", office: "관청", canteen: "배급소", chapel: "예배당", store: "곳간", lodging: "숙소", graveyard: "묘지", checkpoint: "검문소", kennel: "개 우리", outdoor: "물가·들", ruin: "폐허", hut: "움막", tower: "탑" };
const NODE_TYPE = { city: "도시", fort: "요새", wild: "황야", mine: "광산·농장", ruin: "폐허", temple: "성소", secret: "숨은 곳", village: "마을", port: "나루·항구", site: "유적", island: "섬" };
const ROAD = { imperial: "제국 가도", road: "큰길", trail: "오솔길", secret: "숨은 길", sea: "뱃길", river: "물길" };
const ACCESS = { public: "누구나 드나든다", serf: "농노의 자리", staff: "일꾼만 드나든다", owner: "주인의 자리 — 허락 없이는 못 든다", locked: "잠겨 있다", secret: "숨은 곳" };
const HOME = "greyford";
// 이야기에서 이름으로 잡지 않을 흔한 낱말 (별명이 흔한 낱말인 사람이 있다)
const STOP = new Set(["국자", "하나", "노을", "바람", "그림자", "늑대", "여우", "까마귀", "아이", "엄마", "형", "누나", "할멈", "영감", "나리", "주인", "손님", "셋째", "당신", "어머니", "아버지", "사내", "여자", "노인"]);
const first = (s) => String(s || "").split(/(?<=[.!?…])\s/)[0];
// 사람 이름의 조각: '볼크 회색송곳니'의 '볼크'는 이름이지만 '마구간 노예 얀'의 '마구간'·'노예'는 아니다.
// 칭호·직업·흔한 낱말은 빼고(여러 사람의 첫 조각인 것, 직업 꼬리, 따옴표 별칭), 두 글자 이상만
const EPITHET = new Set(["마구간", "노예", "숯불", "붉은", "늙은", "어린", "외팔", "회색", "잿빛", "서리", "거울", "이름", "웃음", "은방울", "목각", "재채기", "엉겅퀴", "새벽", "유리", "할멈", "노래꾼", "꼬마", "셋꼬리", "거꾸로", "열넷", "쇠눈", "이빨", "갈고리", "두더지", "상인", "취사장", "우편", "검문", "계산", "의장", "떠돌이", "훈제", "보초", "짐꾼", "교관", "손님", "급식", "어부", "약사", "필사", "견습", "순례", "고해", "빛의", "심문", "양초", "공물", "시간", "왕녀", "왕비", "레이디", "시종", "전령", "집사", "여관", "수석", "성벽", "바람의", "노파", "무녀", "서기", "원로", "사제", "수녀", "간수", "크릭", "대사제", "대장장이", "나가", "예순", "내기", "회랑", "망꾼장", "솥지기", "까마귀지기", "보급관", "의무실", "무기장", "문지기", "곡창지기", "서리왕", "썩은이빨", "돌팔", "바위배", "쇠무릎", "눈늑대가죽", "노래", "등불지기", "물지기", "화덕지기", "등대지기", "채석감", "경매관", "조합장", "역참장", "백인대장", "전쟁장", "정찰장", "상인장", "관측장", "줄지기", "끝지기", "받아들임지기", "집행인", "집전관", "정원지기", "사냥꾼", "간호인", "대재판관", "룬판관", "부두장", "탑주", "금고지기", "바구니지기", "장작지기", "고리지기", "촛불지기", "저울사제", "쉼터지기", "신학원장", "우물지기", "숙소장", "재삽", "계수소", "수도자", "직조공", "소금장수", "심문관", "밀고", "시종장"]);
const ROLE_TAIL = /(지기|장|관|꾼|사|공|녀|수|인|원|병|님)$/;
// 여러 사람이 함께 쓰는 조각(성씨 '레이번' 같은)은 한 사람을 가리키지 못한다
let SHARED = null;
const sharedTokens = (cards) => {
  if (SHARED?.cards === cards) return SHARED.set;
  const n = new Map();
  for (const c of Object.values(cards)) for (const t of new Set(String(c?.name || "").split(/\s+/))) n.set(t, (n.get(t) || 0) + 1);
  SHARED = { cards, set: new Set([...n].filter(([, k]) => k >= 2).map(([t]) => t)) };
  return SHARED.set;
};
function personTokens(c, cards) {
  const name = String(c?.name || "").trim(); if (name.length < 2) return [];
  const parts = name.split(/\s+/);
  if (parts.length === 1) return STOP.has(name) ? [] : [name];
  const shared = cards ? sharedTokens(cards) : new Set();
  return [name, ...parts.filter((t) => t.length >= 2 && !/['"‘’()]/.test(t) && !EPITHET.has(t) && !STOP.has(t) && !ROLE_TAIL.test(t) && !shared.has(t))];
}
// 그 고장 사람 (일과의 집이 그 고장인 사람)
const residents = (g, sid) => Object.entries(g.content.bundle.routines || {}).filter(([, R]) => g.W.loc.get(R.home)?.settlement === sid).map(([n]) => n);
// 낱말 경계: 앞은 한글이 아니고, 뒤는 한글이 아니거나 조사 첫 글자 ('노예사냥'의 '노예'는 이름이 아니다)
const JOSA1 = new Set([..."이가은는을를의에와과도만로으께랑야아처보까부마조뿐한씨들"]);
export function nameAt(text, name, from = 0) {
  for (let i = text.indexOf(name, from); i >= 0; i = text.indexOf(name, i + 1)) {
    const before = text[i - 1], after = text[i + name.length];
    if (before && /[가-힣]/.test(before)) continue;
    if (after && /[가-힣]/.test(after) && !JOSA1.has(after)) continue;
    return i;
  }
  return -1;
}

const knownFacts = (g) => [...new Set([...g.P.knows, ...g.run.carry.future])];
const factText = (g, f) => g.content.facts[f]?.text || "";
function cond(g, c) {
  const [k, a] = String(c).split(/\s+/);
  if (k === "met") return g.P.met.has(a) || !!soulOf(g).people?.[a];
  if (k === "visited") return g.P.settlement === a || (g.P.visited || []).includes(a) || (soulOf(g).visitedSettlements || []).includes(a);
  if (k === "echo_named") return !!g.S.vars.echo_named || !!soulOf(g).echoNamed;
  try { return storyWhen(g, [c]); } catch { return false; }
}
const any = (g, list) => (list || []).some((c) => cond(g, c));

// ── 무엇을 얼마나 아는가 ──
function glLevel(g, e, H) {
  let lv;
  if (!e.known) lv = e.heard && !e.hidden ? 1 : 0;
  else if (!e.known_when) lv = 2;
  else lv = any(g, e.known_when) ? 2 : e.heard && !e.hidden ? 1 : 0;
  if (lv < 1 && H.has(`gl:${e.id}`)) lv = 1;
  if (lv >= 2 && e.deep && any(g, e.deep_when)) lv = 3;
  return lv;
}
function facLevel(g, id, F, H, texts) {
  const k = g.content.game.glossary?.factions?.[id] || {};
  let lv = k.known && (!k.known_when || any(g, k.known_when)) ? 2 : k.heard ? 1 : 0;
  if (H.has(`fac:${id}`)) lv = Math.max(lv, 1);
  const names = facNames(g, id);
  const told = texts.some((t) => names.some((n) => t.includes(n)));
  if (told) lv = Math.max(lv, 1);
  if (lv >= 2 && told) lv = 3;
  return lv;
}
const facNames = (g, id) => {
  const F = g.content.game.factions[id] || {}, k = g.content.game.glossary?.factions?.[id] || {};
  const base = String(F.name || "").split(/\s*[(—]/)[0].trim();
  return [...new Set([base, ...(k.aka || [])].filter((x) => x && x.length >= 2))];
};
function peopleLevels(g, H, facts) {
  const out = new Map(), S = soulOf(g);
  const add = (n, lv) => { if (!g.content.cards[n]) return; if (lv > (out.get(n) || 0)) out.set(n, lv); };
  for (const n of g.P.met) add(n, 2);
  for (const n of Object.keys(S.people || {})) add(n, 2);
  for (const n of Object.keys(g.P.seen || {})) add(n, 2);   // 본 사람 — 주인공은 이 마을 사람을 이름으로 안다
  for (const n of residents(g, HOME)) if (whoIs(g, n)) add(n, 2);   // 회색여울의 이름난 사람들 — 나고 자란 마을이다
  for (const f of facts) for (const nm of g.content.facts[f]?.names || []) add(g.content.names[nm], 1);
  for (const id of H) if (id.startsWith("npc:")) add(id.slice(4), 1);
  for (const [n, lv] of out) if (lv >= 2 && (g.content.cards[n]?.hides || []).some((h) => knowsFact(g, h.fact))) out.set(n, 3);
  return out;
}
function placeLevels(g) {
  const out = new Map(), S = soulOf(g), sets = g.content.bundle.settlements;
  for (const sid of new Set([HOME, g.P.settlement])) for (const l of sets[sid]?.locations || []) {
    if (l.parent) continue;
    if (l.access === "secret" && !g.P.knowsPlaces?.has(l.id)) continue;
    out.set(l.id, 2);
  }
  for (const id of [...(g.P.been || []), ...(S.places || [])]) if (g.W.loc.get(id) && !g.W.loc.get(id).parent) out.set(id, 2);
  return out;
}
function nodeLevels(g) {
  const K = knownNodes(g), S = soulOf(g), sets = g.content.bundle.settlements, out = new Map();
  const seenS = new Set([HOME, g.P.settlement, ...(g.P.visited || []), ...(S.visitedSettlements || [])].map((sid) => sets[sid]?.node).filter(Boolean));
  for (const n of g.content.bundle.map.nodes) if (K.has(n.id)) out.set(n.id, seenS.has(n.id) ? 2 : 1);
  return out;
}

// ── 목록 (이야기의 이름 잇기 + 백과 칸) ──
export function codexSig(g, heard = []) {
  return [g.run.loop, g.P.knows.size, g.P.met.size, Object.keys(g.P.seen || {}).length, (g.P.visited || []).length, g.P.been?.size || 0, (g.P.knownNodes || []).length,
    lexicon(g).filter((w) => w.meaning).length, heard.length, g.S.vars.echo_named ? 1 : 0, g.P.settlement].join("|");
}
export function codexIndex(g, { heard = [] } = {}) {
  const H = new Set(heard), facts = knownFacts(g), texts = facts.map((f) => factText(g, f)), out = [];
  const push = (id, kind, name, aka, level, short) => { if (level > 0 && name) out.push({ id, kind, name, aka: (aka || []).filter((a) => a && a.length >= 2 && !STOP.has(a) && a !== name), level, short }); };
  for (const [n, lv] of peopleLevels(g, H, facts)) {
    const c = g.content.cards[n], nm = displayName(g, n), named = nm === c.name;
    const aka = named ? personTokens(c, g.content.cards).filter((t) => t !== nm) : [];
    push(`npc:${n}`, "npc", nm, aka, lv, lv >= 2 ? (whoIs(g, n) || c.job || "아는 사람") : "들어 본 이름");
  }
  const sets = g.content.bundle.settlements;
  for (const [id, lv] of placeLevels(g)) {
    const l = g.W.loc.get(id), st = sets[l.settlement] || {};
    push(`loc:${id}`, "loc", l.name, [...(l.aka || []), l.name.replace(/\s*'.*'$/, "").replace(/·.*$/, "")], lv, `${LOC_KIND[l.kind] || "장소"} · ${st.name || ""}${st.descs?.[id] ? ` — ${first(st.descs[id])}` : ""}`);
  }
  const regions = g.content.bundle.map.regions || [], nodeLv = nodeLevels(g), regLv = new Map();
  for (const n of g.content.bundle.map.nodes) {
    const lv = nodeLv.get(n.id) || (H.has(`node:${n.id}`) ? 1 : 0);
    if (!lv) continue;
    push(`node:${n.id}`, "node", n.name, [], lv, `${NODE_TYPE[n.type] || "곳"} · ${regions.find((r) => r.id === n.region)?.name || ""}`);
    regLv.set(n.region, Math.max(regLv.get(n.region) || 0, lv));
  }
  for (const r of regions) { const lv = Math.max(regLv.get(r.id) || 0, H.has(`reg:${r.id}`) ? 1 : 0); push(`reg:${r.id}`, "reg", r.name, [], lv, "땅 — 여러 곳을 아우르는 이름"); }
  for (const [id, F] of Object.entries(g.content.game.factions || {})) {
    const lv = facLevel(g, id, F, H, texts), k = g.content.game.glossary?.factions?.[id] || {};
    const names = facNames(g, id);
    push(`fac:${id}`, "fac", names[0] || F.name, names.slice(1), lv, `${FAC_KIND[F.kind] || "세력"} · ${first(lv >= 2 ? k.known || k.heard || "" : k.heard || "이름만 들었다")}`);
  }
  for (const w of lexicon(g)) push(`word:${w.word}`, "word", w.word, [], w.meaning ? 2 : 1, `${w.lang} · ${w.meaning ? w.meaning.split(" — ")[0] : "뜻을 모른다"}`);
  for (const e of g.content.game.glossary?.entries || []) {
    const lv = glLevel(g, e, H);
    push(`gl:${e.id}`, "gl", e.name, e.aka || [], lv, `${e.kind} · ${first(lv >= 2 ? e.known : e.heard || "")}`);
  }
  // 같은 곳이 두 번 나오지 않게: 고장 안의 장소와 이름이 같은 지도 노드(레이번 성채)는 장소 하나로
  const locNames = new Set(out.filter((e) => e.kind === "loc").map((e) => e.name));
  return { sig: codexSig(g, heard), entries: out.filter((e) => !(e.kind === "node" && locNames.has(e.name))) };
}

// 서술에 나온 이름 찾기 (세션이 '들은 이름'으로 적는다) — 아직 모르는 것까지 본다.
// 사람: 온 이름은 누구든, 이름 조각('볼크')은 이 고장·회색여울 사람만 (먼 고장의 '마라'가 '…하지 마라'에 걸리지 않게)
let NAMES = null;
export function codexNames(g) {
  const key = `${g.P.settlement}`;
  if (NAMES?.content === g.content && NAMES.key === key) return NAMES.list;
  const list = [];
  const add = (name, id) => { if (name && name.length >= 2 && !STOP.has(name)) list.push([name, id]); };
  const regionOf = (sid) => { const node = g.content.bundle.map.nodes.find((n) => n.id === g.content.bundle.settlements[sid]?.node); return (g.content.bundle.map.regions || []).find((r) => r.id === node?.region)?.name; };
  const regions = new Set([regionOf(HOME), regionOf(g.P.settlement)].filter(Boolean));
  const local = new Set([...residents(g, HOME), ...residents(g, g.P.settlement)]);
  for (const c of Object.values(g.content.cards)) {
    if (!c?.name) continue;
    if (local.has(c.id) || regions.has(c.region)) for (const t of personTokens(c, g.content.cards)) add(t, `npc:${c.id}`);
    else if (c.name.length >= 3) add(c.name, `npc:${c.id}`);   // 먼 고장 사람은 온 이름으로만
  }
  for (const n of g.content.bundle.map.nodes) add(n.name, `node:${n.id}`);
  for (const r of g.content.bundle.map.regions || []) add(r.name, `reg:${r.id}`);
  for (const id of Object.keys(g.content.game.factions || {})) for (const nm of facNames(g, id)) add(nm, `fac:${id}`);
  for (const e of g.content.game.glossary?.entries || []) for (const nm of [e.name, ...(e.aka || [])]) add(nm, `gl:${e.id}`);
  list.sort((a, b) => b[0].length - a[0].length);
  NAMES = { content: g.content, key, list };
  return list;
}
export function heardIn(g, texts) {
  const found = new Set(), T = texts.join("\n");
  for (const [nm, id] of codexNames(g)) if (T.includes(nm) && nameAt(T, nm) >= 0) found.add(id);
  return [...found];
}

// ── 카드 하나 ──
const L = (text, o = {}) => ({ text: josa(text), ...o });
const unknownLine = (text = "아직 모른다") => ({ text, unknown: true });
export function codexEntry(g, id, { heard = [] } = {}) {
  const [kind, ...rest] = String(id).split(":"), key = rest.join(":");
  const idx = codexIndex(g, { heard }).entries.find((e) => e.id === id);
  const level = idx?.level || 0;
  const base = { id, kind, kindLabel: KIND_LABEL[kind] || "", level, image: kind === "word" ? null : key, sections: [] };
  if (!idx) return { ...base, name: "?", sub: "아직 모르는 것", sections: [{ title: "", lines: [unknownLine("아무것도 모른다 — 이름조차.")] }] };
  const facts = knownFacts(g), about = (names) => facts.filter((f) => names.some((n) => n && factText(g, f).includes(n))).slice(0, 6).map((f) => L(factText(g, f), { mark: g.P.knows.has(f) ? "□" : "◇", past: !g.P.knows.has(f) }));
  const S = (title, lines) => { if (lines?.length) base.sections.push({ title, lines }); };

  if (kind === "npc") {
    const c = g.content.cards[key] || {}, v = view(g), pk = (v.people_known || []).find((p) => p.id === key);
    const seen = level >= 2;
    const sub = [whoIs(g, key) || (seen ? c.job : null), seen ? [c.race, c.age != null ? `${c.age}세` : null].filter(Boolean).join(", ") : null].filter(Boolean);
    const out = { ...base, name: idx.name, sub: sub.join(" · ") || "들어 본 이름" };
    if (!seen) { S("들은 것", about([c.name, c.name?.split(/\s+/)[0]])); S("모르는 것", [unknownLine("만난 적이 없다 — 얼굴도, 하는 일도 아직 모른다")]); out.sections = base.sections; return out; }
    S("겉모습", (Array.isArray(c.appearance) ? c.appearance : c.appearance ? [c.appearance] : []).slice(0, 3).map((x) => L(x)));
    const here = v.people.find((p) => p.id === key);
    if (here || pk?.thisLoop) S("나를 대하는 마음", [L(here?.mood || pk?.mood || "모른다", { mark: "" }), ...(pk?.knots ? [L(`매듭 ${"⟡".repeat(pk.knots)}`)] : [])]);
    const est = estimateOf(g, key);
    if (est) S("지금 어디쯤", [L(est.text, { conf: Math.round(est.conf * 100) / 100 })]);
    const knownLines = [...(pk?.facts || []).map((f) => L(f.text, { mark: f.sure, past: f.past })), ...(pk?.links || []).map((l) => L(`${l.other} — ${l.text}`, { mark: "—", faint: true }))];
    S("아는 것", knownLines.length ? knownLines : [L("아직 별로 아는 것이 없다", { faint: true })]);
    const hidden = (c.hides || []).filter((h) => !knowsFact(g, h.fact)).length;
    if (hidden) S("모르는 것", Array.from({ length: Math.min(3, hidden) }, () => unknownLine("숨긴 것이 있다 — 아직 모른다")));
    S("지난 회차", (pk?.past || []).map((x) => L(x, { past: true })));
    out.memo = pk?.memo ?? g.run.memos?.[key] ?? "";
    out.memoable = true;
    out.sections = base.sections;
    return out;
  }
  if (kind === "loc") {
    const l = g.W.loc.get(key) || {}, st = g.content.bundle.settlements[l.settlement] || {};
    const out = { ...base, name: l.name || key, sub: [LOC_KIND[l.kind] || "장소", st.name].filter(Boolean).join(" · ") };
    if (st.descs?.[key]) S("어떤 곳", [L(st.descs[key])]);
    S("드나듦", [L(ACCESS[l.access || "public"] || "누구나 드나든다"), ...(l.hours ? [L(`여는 때 — ${String(l.hours).replace(/-/g, "–")}`, { faint: true })] : [])]);
    const ppl = [...g.P.met].map((n) => ({ n, e: estimateOf(g, n) })).filter((x) => x.e?.at === key).slice(0, 5);
    S("이 시각에 있을 법한 사람", ppl.map((x) => L(`${displayName(g, x.n)} — ${x.e.text}`, { conf: Math.round(x.e.conf * 100) / 100 })));
    S("아는 것", about([l.name, l.name?.replace(/\s*'.*'$/, ""), ...(l.aka || [])]));
    if (!(g.P.been || new Set()).has(key) && !(soulOf(g).places || []).includes(key)) S("모르는 것", [unknownLine("들어가 본 적이 없다")]);
    out.sections = base.sections;
    return out;
  }
  if (kind === "node") {
    const M = g.content.bundle.map, n = M.nodes.find((x) => x.id === key) || {}, region = (M.regions || []).find((r) => r.id === n.region);
    const out = { ...base, name: n.name, sub: [NODE_TYPE[n.type] || "곳", region?.name].filter(Boolean).join(" · ") };
    if (level >= 2 && n.desc) S("어떤 곳", [L(n.desc)]); else S("어떤 곳", [unknownLine("가 본 적이 없다 — 들은 이름뿐")]);
    const K = knownNodes(g), roads = M.edges.filter((e) => (e.from === key || e.to === key) && K.has(e.from) && K.has(e.to));
    S("길", roads.map((e) => { const o = M.nodes.find((x) => x.id === (e.from === key ? e.to : e.from)); return L(`${o?.name} — ${ROAD[e.road] || "길"}, ${e.hours}시간${e.danger >= 4 ? " · 위험한 길목" : ""}${e.cond ? ` · ${e.cond}` : ""}`); }));
    const sid = Object.entries(g.content.bundle.settlements).find(([, st]) => st.node === key)?.[0];
    if (sid && sid !== g.P.settlement) { const p = planJourney(g, key, "fast"); if (p) { const sc = journeySchedule(g, p); S("가는 길", [L(`걸어서 ${p.hours}시간${sc.camps ? ` · 노숙 ${sc.camps}밤` : ""} · ${p.path.length - 1}구간${p.passNeeded ? " · 통행증 없이 검문을 지난다" : ""}`)]); } }
    S("아는 것", about([n.name]));
    out.sections = base.sections;
    return out;
  }
  if (kind === "reg") {
    const M = g.content.bundle.map, r = (M.regions || []).find((x) => String(x.id) === key) || {}, K = knownNodes(g);
    const out = { ...base, name: r.name, sub: "땅" };
    S("아는 곳", M.nodes.filter((n) => n.region === r.id && K.has(n.id)).map((n) => L(n.name)));
    S("아는 것", about([r.name]));
    if (level < 2) S("모르는 것", [unknownLine("가 본 적이 없다")]);
    out.sections = base.sections;
    return out;
  }
  if (kind === "fac") {
    const F = g.content.game.factions[key] || {}, k = g.content.game.glossary?.factions?.[key] || {}, names = facNames(g, key);
    const out = { ...base, name: names[0] || F.name, sub: [FAC_KIND[F.kind] || "세력", level >= 2 && F.name !== names[0] ? F.name : null].filter(Boolean).join(" · ") };
    S(level >= 2 ? "알려진 것" : "들은 것", [L(level >= 2 ? k.known || k.heard || "이름 말고는 모른다" : k.heard || "이름만 들었다")]);
    if (level >= 2 && F.motto) S("그들의 말", [L(`"${F.motto}"`)]);
    if (level >= 2 && F.seat) { const M = g.content.bundle.map, seat = String(F.seat); S("자리", [L(M.nodes.find((n) => n.id === seat)?.name || g.content.bundle.settlements[seat]?.name || seat)]); }
    const people = (F.offices || []).filter((o) => o.holder && (g.P.met.has(o.holder) || soulOf(g).people?.[o.holder])).map((o) => L(`${displayName(g, o.holder)} — ${o.title}`));
    S("아는 사람", people);
    S("아는 것", about(names));
    if (level < 3) S("모르는 것", [unknownLine(level < 2 ? "누구인지, 무엇을 하는지 아직 모른다" : "더 깊은 사정이 있다 — 아직 모른다")]);
    out.sections = base.sections;
    return out;
  }
  if (kind === "word") {
    const w = lexicon(g).find((x) => x.word === key) || {};
    const out = { ...base, name: key, sub: `${w.lang || "말"}` };
    S("뜻", [w.meaning ? L(w.meaning) : unknownLine("뜻을 모른다 — 쇳소리 같은 말")]);
    out.sections = base.sections;
    return out;
  }
  if (kind === "gl") {
    const e = (g.content.glossary?.entries || g.content.game.glossary?.entries || []).find((x) => x.id === key) || {};
    const out = { ...base, name: e.name, sub: e.kind };
    if (level >= 2) S("아는 것", [L(e.known)]); else S("들은 것", [L(e.heard || "이름만 들었다")]);
    if (level >= 3) S("깊이 아는 것", [L(e.deep, { deep: true })]);
    else if (level >= 2 && e.deep) S("모르는 것", [unknownLine("이 말에는 아직 모르는 깊은 사정이 있다")]);
    else if (level < 2 && e.known) S("모르는 것", [unknownLine("더 알게 되면 여기에 적힌다")]);
    out.sections = base.sections;
    return out;
  }
  return { ...base, name: idx.name, sub: "" };
}
