// 진행 루프의 LLM 프롬프트와 검증 (21·22). 엔진이 정한 것을 문장으로만 바꾸게 한다.
// - 카드는 통째로 보내지 않는다: 지금 대화 상대는 말투·견본 3개·마음·숨긴 것의 '얼버무림'만, 나머지 사람은 한 줄씩 (22 §3).
// - 출력 형식: <서술>…</서술> 다음 <선택지>{json}</선택지>. 서술은 오는 대로 화면에 흘려보낸다(스트리밍).
// - 대화가 끝나는 턴은 기억 후보도 같은 호출에서 받는다 → 대화 한 번에 LLM 호출 하나를 줄인다.
import { view, knownNames, moodWords, IMPRESSION_TAGS } from "./game.mjs";
import { josa } from "../sim/text.mjs";

export const SYSTEM = `너는 한국어 그림다크 판타지 소설을 쓰는 작가다. 이 소설은 독자가 고르는 대로 흘러가고, 무엇이 일어나는지는 규칙 엔진이 이미 정했다. 너는 그 일을 **읽히는 글**로 쓴다.

세계: 신을 죽인 고대 종족들이 인간을 노예로 부리는 대륙. 붕괴력 312년. 주인공이 매인 곳은 회색여울 — 용인 남작 영지의 인간 농노 마을.
주인공: 셋째라 불리는 열일곱 살 농노. 등에 채찍 자국, 늘 배가 고프다. 한 번 죽었다가 이 가을 첫날 저녁으로 돌아왔다 — 아무도 모른다. 서술에서는 언제나 "당신".
고유명사: '절름발이 수탉'은 배급 막사의 이름이다(닭이 아니다). '수탉'이라고만 하면 그 막사.

어떻게 쓰나:
- **이어 쓴다.** 바로 앞의 서술에서 그대로 이어진다. 이미 쓴 배경(비, 불, 냄새, 다른 사람의 소리)은 되풀이하지 않는다. 배경은 장면이 바뀔 때만 한 번 깐다.
- **문단으로 쓴다.** 2~3문단, 문단마다 2~5문장. 몸짓과 대사는 한 문단 안에 함께 둔다 — 대사만 한 줄로 따로 떼지 않는다. 문장 길이에 리듬을 둔다: 짧은 문장 사이에 긴 문장 하나.
- **사람을 쓴다.** 대화 중이면 상대의 반응이 중심이다: 무엇을 말하고, 무엇을 말하지 않고, 손이 무엇을 하는가. 상대의 말투 카드와 견본 대사의 결을 따른다.
- **감정은 이름 붙이지 않는다.** 두려움 대신 멈춘 손, 슬픔 대신 세는 손가락. 비유는 이 세계의 사물로만, 드물게.
- 설교하지 않는다. 현대어·외래어를 쓰지 않는다.

이 결로 쓴다 (견본 — 그대로 베끼지 말 것):
<견본>
당신 앞의 노인이 그릇을 내밀자 브람은 국자를 솥 바닥까지 넣었다가, 반 국자를 슬쩍 덜어 노인 그릇에 더 붓는다. 노인은 고개를 숙인다. 줄에 선 누구도 그것을 보지 못한 척한다.

당신 차례에서 국자가 멈춘다. "죽은 한 그릇이다." 브람은 당신 얼굴을 오래 보지 않는다. 대신 그릇을 쥔 당신 손등의 갈라진 자리를 본다. 국자가 다시 솥으로 들어간다. 이번에는 바닥까지.
</견본>

절대 규칙:
- 엔진의 결과를 바꾸지 않는다. 실패면 상대는 넘어오지 않는다. 지시에 없는 비밀을 밝히지 않는다. 숨긴 것은 '얼버무림' 지시대로만.
- 확률·성공 가능성, 숫자(호감·신뢰)를 말하지 않는다.
- 장면에 없는 인물, 주어진 자료에 없는 고유명사를 만들지 않는다.
- 형식: <서술>문단들(문단 사이는 빈 줄)</서술> 그다음 <선택지>JSON 하나</선택지>. 그 밖의 말은 쓰지 않는다.`;

const PHRASED = (o) => o.kind === "talk" || o.id.startsWith("talk:") || o.id.startsWith("attack:");

function samplePick(card, ctx) {
  const ss = card.voice?.samples || [];
  const want = [ctx.first && "첫 만남", ctx.anger && "적대", ctx.fear && "겁", ctx.reveal && "비밀", ctx.future && "회귀자", ctx.warm && "호의", ctx.trade && "거래", "슬픔"].filter(Boolean);
  const out = [];
  for (const w of want) { const s = ss.find((x) => x.situation?.includes(w) && !out.includes(x)); if (s) out.push(s); if (out.length >= 3) break; }
  for (const s of ss) { if (out.length >= 3) break; if (!out.includes(s)) out.push(s); }
  return out.map((s) => `(${s.situation}) ${s.line}`);
}

function convoCard(g, n, res) {
  const c = g.content.cards[n] || {}, m = g.M[n] || { memories: [], revealed: new Set(), fear: 0, anger: 0 };
  const r = g.S.rel.get(`${n}>player`) || { like: 0, trust: 0 };
  const v = c.voice || {};
  const revealed = [...(m.revealed || [])].map((f) => g.content.facts[f]?.text).filter(Boolean);
  const guarded = (g.content.reveals[n] || []).filter((x) => !m.revealed?.has(x.fact) && x.cover).map((x) => x.cover);
  const aboutMe = g.L.beliefs(n).filter((b) => b.subject === "player").map((b) => b.kind === "suspect" ? `당신이 ${g.content.cards[b.object]?.name || b.object}을(를) 해쳤다고 믿는다 (${b.reason || ""}) — ${b.choice === "silence" ? "모른 척하기로 했다" : b.choice === "blackmail" ? "약점으로 쥐고 있다" : b.choice === "report" ? "이미 윗선에 고했다" : "어떻게 할지 정하지 못했다"}` : b.kind === "saw_item" ? `당신이 ${g.L.items.get(b.item)?.name}을(를) 가진 것을 보았다` : null).filter(Boolean);
  const mems = [...(m.memories || [])].sort((a, b) => (b.salience || 0) - (a.salience || 0)).slice(0, 6).map((x) => `- ${x.text}`);
  return [
    `이름: ${c.name} (${c.race || "인간"}, ${c.age ?? "?"}세). ${c.job || ""}`,
    `말투(셋째에게): ${v.register?.to_player_default || v.register?.to_equal || ""}. 길이: ${v.length || "짧게"}`,
    v.tics?.length ? `말버릇: ${v.tics.join(" / ")}` : "",
    v.use?.length ? `쓰는 말: ${v.use.join(", ")}` : "", v.avoid?.length ? `쓰지 않는 말: ${v.avoid.join(", ")}` : "",
    `성격: ${(c.personality?.temperament || []).join(", ")}`,
    `견본 대사:\n${samplePick(c, { first: g.convo?.turns === 0, anger: m.anger >= 2, fear: m.fear >= 2, reveal: !!res?.reveal, future: res?.futureUsed?.length, warm: r.like > 15, trade: /sell|give/.test(res?.id || "") }).map((x) => "  " + x).join("\n")}`,
    `셋째를 대하는 마음: ${moodWords(r, m)}. 첫 태도: ${c.toward_player || ""}`,
    aboutMe.length ? `셋째에 대해 믿는 것:\n${aboutMe.map((x) => "- " + x).join("\n")}` : "",
    revealed.length ? `이미 셋째에게 털어놓은 것:\n${revealed.map((x) => "- " + x).join("\n")}` : "",
    guarded.length ? `숨기는 것이 있다 — 내용은 말하지 않는다. 화제가 닿으면 이렇게 얼버무린다:\n${guarded.map((x) => "- " + x).join("\n")}` : "",
    mems.length ? `셋째에 대한 기억:\n${mems.join("\n")}` : "셋째에 대한 기억: 없음",
    (c.hard_rules || []).length ? `절대 하지 않는 것: ${c.hard_rules.join(" / ")}` : "",
  ].filter(Boolean).join("\n");
}

function outcomeLines(g, res) {
  if (!res) return ["장면 시작 (또는 다시 시작)."];
  const L = [`주인공의 행동: ${res.text || res.label}`];
  if (res.skill) L.push(`판정: ${res.skill} — ${res.tier}`);
  const who = g.content.cards[(res.convoEnded || g.convo)?.npc]?.name;
  if (res.reveal) L.push(`결과: ${who || "상대"}이(가) 주인공에게 이 사실을 말해 준다 (말하는 쪽은 ${who || "상대"}, 주인공은 처음 듣는다) → ${g.content.facts[res.reveal]?.text}`);
  else if (res.cover) L.push(`결과: ${who}은(는) 숨긴다. 얼버무림: ${res.cover}`);
  else if (res.tier === "실패" || res.tier === "대실패") L.push("결과: 상대는 넘어오지 않는다. 숨긴 것의 힌트도 주지 않는다.");
  if (res.rumor) L.push(`${who}이(가) 소문 하나를 흘린다: ${res.rumor}`);
  if (res.futureUsed?.length) L.push(`${who}은(는) 셋째가 그걸 어떻게 아는지 섬뜩해한다 (아직 아무도 모르는 일이다)`);
  for (const n of res.notes || []) L.push(`엔진 메모: ${n}`);
  for (const f of res.feed || []) L.push(`그사이 주인공 주변에서: ${f.text}`);
  if (res.ending) L.push("이 박자로 대화를 닫는다.");
  if (res.id === "routine_day") L.push("하루를 건너뛰었다: 배급 줄·막사·잠·점호를 두세 문장의 몽타주로. 그사이 주인공 주변에서 일어난 일만 짚는다. 없으면 같은 하루의 무게만.");
  return L.map(josa);
}

export function turnPrompt(g, res, opts, { transcript = [], memories = false, sceneNew = false } = {}) {
  const v = view(g);
  const scene = [
    `[지금] ${v.time}, ${v.place.name}. ${v.night ? "밤." : ""} ${v.rain ? "비." : ""} 배고픔 ${v.player.hunger}/4, 아픔 ${v.player.pain}/100.`,
    `[이 자리에 있는 사람]\n${v.people.map((p) => `- ${p.name}: ${(p.doing || "").length <= 4 ? "그 자리에 있다" : p.doing}${p.asleep ? " (잠듦)" : ""}${p.wears.length ? ` · 지닌 것: ${p.wears.join(", ")}` : ""} · ${p.mood}`).join("\n") || "- 아무도 없다"}`,
    v.bodies.length ? `[시체] ${v.bodies.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  const convoNpc = g.convo?.npc || res?.convoEnded?.npc;
  const card = convoNpc ? `[대화 상대 카드]\n${convoCard(g, convoNpc, res)}` : "";
  const phrased = opts.filter(PHRASED).map((o) => ({ id: o.id, 행동: o.label, ...(o.topic ? { 주제: o.topic } : {}), ...(o.risk ? { 위험: o.risk } : {}) }));
  const mem = memories && convoNpc ? `,\n "memories": [{"kind": "impression|emotion|promise|claim|suspicion", "tag": "인상일 때: ${IMPRESSION_TAGS.join("|")}", "delta": "인상일 때 -5~5", "text": "${g.content.cards[convoNpc]?.name}의 입장에서 쓴 기억 한 줄", "evidence": "대화 기록에서 그대로 옮긴 구절", "salience": "1~5"}]  ← 대화가 끝났다. 상대가 셋째에 대해 기억하게 될 미묘한 것 0~3개` : "";
  return [
    scene, card,
    `[장면] ${sceneNew ? "새 장면이다 — 첫 문단에 이곳과 사람들을 한 번 깔아라." : "같은 장면이 이어진다 — 배경을 다시 쓰지 말고, 바로 앞 서술에서 이어서 반응만 쓴다."}`,
    transcript.length ? `[지금까지 (바로 앞에서 이어 쓴다)]\n${transcript.slice(-10).map((t) => `${t.who === "player" ? "▸ 셋째가 고른 것" : "서술"}: ${t.text}`).join("\n")}` : "",
    `[이번 박자 — 엔진이 정한 결과]\n${outcomeLines(g, res).join("\n")}`,
    phrased.length ? `[다음 선택지로 쓸 행동]\n각 행동을 **주인공이 실제로 할 말 한마디나 몸짓 하나**로 다시 써라 (40자 이내). 주어진 문장을 베끼지 말 것. 행동의 뜻을 넘지 말 것 — '주제'가 있으면 그 주제만 묻는다. 새 화제를 만들지 않고, 숨긴 것을 짐작하는 말을 넣지 않는다.\n예) "브람에게 이런저런 말을 붙인다" → "그릇을 받으며 '비가 사흘째네요' 하고 말을 흘린다" / "하겐에 대해 묻는다" → "구석에서 웃는 사내 쪽으로 턱을 든다 — '저 사람은 누구예요?'"\n${JSON.stringify(phrased)}` : "[다음 선택지] 없음",
    `출력:\n<서술>\n박자들\n</서술>\n<선택지>\n{"choices": [{"id": "주어진 id 그대로", "text": "선택지 문장"}]${mem}}\n</선택지>`,
  ].filter(Boolean).join("\n\n");
}

export function parseTurn(text) {
  const s = String(text || "");
  const nar = /<서술>([\s\S]*?)(?:<\/서술>|$)/.exec(s)?.[1] || "";
  const beats = nar.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
  let json = {};
  const ch = /<선택지>([\s\S]*?)(?:<\/선택지>|$)/.exec(s)?.[1];
  if (ch) { const i = ch.indexOf("{"), j = ch.lastIndexOf("}"); if (i >= 0 && j > i) try { json = JSON.parse(ch.slice(i, j + 1)); } catch { json = { _bad: true }; } }
  return { beats, choices: json.choices || [], memories: json.memories || [], bad: !nar.trim() || json._bad };
}

// 누설 검사의 대상: **이 장면 사람들이 숨기거나 아는 사실에 걸린 이름** 중 플레이어가 아직 모르는 것.
// (예: 브람이 숨긴 사실의 '에길'.) 사람 이름 전체로 검사하면 별명이 흔한 낱말('국자'·'하나'·'노을')이라 헛경보가 난다.
function leakNames(g) {
  const set = new Set();
  const people = [...new Set([...(view(g).people.map((p) => p.id)), g.convo?.npc].filter(Boolean))];
  for (const n of people) {
    const c = g.content.cards[n] || {};
    for (const f of [...(c.knows || []), ...(c.hides || []).map((h) => h.fact)]) {
      if (g.P.knows.has(f)) continue;
      for (const nm of g.content.facts[f]?.names || []) if (nm.length > 1) set.add(nm);
    }
  }
  return [...set];
}
// 이름 누설·확률 누설 검사. 쓸 수 없는 선택지 문장은 엔진의 기본 문장으로 바꾼다
export function validateTurn(g, parsed, opts, { res, free, prompt = "" } = {}) {
  const problems = [];
  const allowed = knownNames(g);
  if (res?.reveal) for (const n of g.content.facts[res.reveal]?.names || []) allowed.add(n);
  if (free) for (const nm of Object.keys(g.content.names)) if (free.includes(nm)) allowed.add(nm);
  // 누설 검사는 '비밀이 걸린 이름'(사실 자료의 names)과 이 고장 사람 이름만 본다 — 다른 지역 사람 이름이 흔한 낱말('웃음')이라 생기는 헛경보를 막는다
  const NAMES = leakNames(g);
  const leak = (s) => NAMES.filter((n) => s.includes(n) && !allowed.has(n) && ![...allowed].some((a) => a.includes(n)));
  const beats = parsed.beats.map((b) => (b.length > 320 ? b.slice(0, 318) + "…" : b));
  for (const b of beats) { const l = leak(b); if (l.length) problems.push(`서술에 아직 모르는 이름: ${l.join(", ")}`); }
  if (/확률|퍼센트|%|호감도|신뢰도/.test(beats.join(""))) problems.push("서술이 수치를 언급");
  const byId = new Map(opts.map((o) => [o.id, o]));
  const norm = (id) => String(id || "").replace(/[\s_]/g, "");   // LLM이 'ask:요즘_마을_사정'처럼 공백을 바꿔 써도 같은 행동
  const choices = opts.map((o) => {
    const c = parsed.choices.find((x) => norm(x.id) === norm(o.id));
    let text = o.label, phrased = false;
    if (c && typeof c.text === "string" && c.text.trim() && PHRASED(o)) {
      const l = leak(c.text);
      if (l.length) problems.push(`선택지 이름 누설(${l.join(",")}) → 기본 문장`);
      else if (/확실히|반드시|분명 성공/.test(c.text)) problems.push("선택지가 확률을 흘림 → 기본 문장");
      else { text = c.text.slice(0, 80); phrased = true; }
    }
    return { ...o, text, phrased };
  });
  const known = new Set(opts.map((o) => norm(o.id)));
  for (const c of parsed.choices) if (!known.has(norm(c.id))) problems.push(`목록에 없는 행동: ${c.id}`);
  const ok = beats.length > 0 && !problems.some((p) => p.startsWith("서술"));
  return { ok, beats, choices, problems };
}

// 자유 입력 → 행동 하나 + 논거 태그 (판정은 엔진이 한다)
export function interpretPrompt(g, free, opts) {
  const facts = [...g.P.knows, ...g.run.carry.future].map((f) => `${f}: ${g.content.facts[f]?.text}`).join("\n");
  return `플레이어가 직접 쓴 행동을 아래 행동 중 하나로 옮겨라. 판정은 엔진이 한다. 출력은 JSON 하나뿐.\n\n[플레이어 입력]\n${free}\n\n[가능한 행동]\n${JSON.stringify(opts.map((o) => ({ id: o.id, 행동: o.label })))}\n\n[플레이어가 아는 사실]\n${facts || "(없음)"}\n\n출력: {"id": "가장 가까운 행동 id", "tags": ["uses_fact:<사실id> | appeals_interest:<무엇> | appeals_fear:<무엇> | offers_item:<물건id|coin> — 플레이어 말에 실제로 들어 있는 것만"]}`;
}
export function parseInterpret(g, text, opts) {
  const s = String(text || ""); const i = s.indexOf("{"), j = s.lastIndexOf("}");
  let j0 = {}; try { j0 = JSON.parse(s.slice(i, j + 1)); } catch { return null; }
  const problems = [];
  let id = j0.id;
  if (!opts.some((o) => o.id === id)) { problems.push(`목록에 없는 행동: ${id}`); id = opts.find((o) => o.id === "small_talk")?.id || null; }
  const tags = (j0.tags || []).filter((t) => {
    const [k, v] = String(t).split(":");
    if (!["uses_fact", "appeals_interest", "appeals_fear", "offers_item"].includes(k)) { problems.push(`모르는 태그 ${t}`); return false; }
    if (k === "uses_fact" && !(g.P.knows.has(v) || g.run.carry.future.includes(v))) { problems.push(`모르는 사실을 근거로 씀: ${v}`); return false; }
    return true;
  });
  return id ? { id, tags, problems } : null;
}

// 테스트 전용 가짜 LLM 출력 (플레이어에게는 쓰지 않는다 — LLM 필수)
export function mockTurn(g, res, opts, { memories = false } = {}) {
  const v = view(g);
  const b = [`[가짜] ${v.place.name}. ${v.people.map((p) => p.name).join(", ") || "아무도 없다"}.`];
  if (res) b.push(`[가짜] ${res.label} — ${res.tier}${res.notes?.length ? ". " + res.notes.join(". ") : ""}`);
  const choices = opts.filter(PHRASED).map((o) => ({ id: o.id, text: "[가짜] " + o.label }));
  const mems = memories ? [] : undefined;
  return `<서술>\n${b.join("\n\n")}\n</서술>\n<선택지>\n${JSON.stringify({ choices, ...(mems ? { memories: mems } : {}) })}\n</선택지>`;
}

// ── 기록관 (28 §6): 끝난 대화를 '제안'으로 옮긴다. 플레이어는 기다리지 않는다 (뒤에서 돈다) ──
export const RECORDER_SYSTEM = `너는 텍스트 게임의 기록관이다. 끝난 대화를 읽고, 그 NPC가 앞으로 기억하거나 행동에 옮길 것을 구조화된 제안으로 뽑는다.
세계를 바꾸지 않는다 — 제안만 한다. 엔진이 대화 기록에서 근거를 확인하고 받아들일지 정한다.
근거(evidence)는 반드시 대화 기록에서 글자 그대로 옮긴다. 대화에 없는 것은 쓰지 않는다. 출력은 JSON 하나뿐.`;

export function recorderPrompt(g, jobs) {
  const facts = [...g.P.knows, ...g.run.carry.future].map((f) => `${f}: ${g.content.facts[f]?.text}`).join("\n");
  const places = [...g.W.loc.values()].filter((l) => l.settlement === g.P.settlement && !l.parent).map((l) => l.name).join(", ");
  return [
    `[주인공이 아는 사실 — 주인공이 NPC에게 이것을 말해 주었으면 kind "learned"로, fact에 이 id를]\n${facts || "(없음)"}`,
    `[마을의 장소 이름 — 약속 장소는 이 중에서]\n${places}`,
    ...jobs.map((j, i) => `[대화 ${i + 1}] NPC: ${j.npc} (${g.content.cards[j.npc]?.name}), 끝난 시각: ${j.time}\n${j.transcript.map((x) => `${x.who === "player" ? "셋째" : "서술"}: ${x.text}`).join("\n")}`),
    `출력: {"records": [{"npc": "npc id", "kind": "impression|emotion|promise|claim|learned|suspicion|debt|threat", "tag": "인상일 때: ${IMPRESSION_TAGS.join("|")}", "delta": "인상일 때 -5~5", "text": "그 NPC의 입장에서 한 줄", "evidence": "대화 기록 그대로", "salience": "1~5",
  "promise": {"place": "장소 이름", "when": "오늘 밤|내일 정오|모레 새벽 다섯 시 처럼", "what": "무엇을"},
  "claim": {"about": "주인공이 말한 대상 인물 이름", "content": "주인공의 주장 한 줄", "believed": true},
  "fact": "learned일 때 사실 id"}]}
대화마다 0~4개. 약속·주장·들은 사실이 없으면 그 칸은 빼라.`,
  ].join("\n\n");
}
export function parseRecords(text) {
  const s = String(text || ""); const i = s.indexOf("{"), j = s.lastIndexOf("}");
  try { return JSON.parse(s.slice(i, j + 1)).records || []; } catch { return null; }
}
