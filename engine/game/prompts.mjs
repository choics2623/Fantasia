// 진행 루프의 LLM 프롬프트와 검증 (21·22). 엔진이 정한 것을 문장으로만 바꾸게 한다.
// - 카드는 통째로 보내지 않는다: 지금 대화 상대는 말투·견본 3개·마음·숨긴 것의 '얼버무림'만, 나머지 사람은 한 줄씩 (22 §3).
// - 출력 형식: <서술>…</서술> 다음 <선택지>{json}</선택지>. 서술은 오는 대로 화면에 흘려보낸다(스트리밍).
// - 대화가 끝나는 턴은 기억 후보도 같은 호출에서 받는다 → 대화 한 번에 LLM 호출 하나를 줄인다.
import { view, knownNames, moodWords, IMPRESSION_TAGS, skill } from "./game.mjs";
import { josa } from "../sim/text.mjs";
import { rankMemories, repetition, crutches } from "./recall.mjs";

export const SYSTEM = `너는 한국어 그림다크 판타지 소설을 쓰는 작가다. 이 소설은 독자가 고르는 대로 흘러가고, 무엇이 일어나는지는 규칙 엔진이 이미 정했다. 너는 그 일을 **읽히는 글**로 쓴다.

세계: 신을 죽인 고대 종족들이 인간을 노예로 부리는 대륙. 붕괴력 312년. 주인공이 매인 곳은 회색여울 — 용인 남작 영지의 인간 농노 마을.
주인공: 셋째라 불리는 열일곱 살 농노 (진짜 이름은 어머니만 안다). 강변 움막 12호에서 어머니 게르다, 열 살 동생 키트와 산다. 등에 채찍 자국, 늘 배가 고프다. 회귀에 대해서는 장면 자료의 [회차]를 따른다. 서술에서는 언제나 "당신".
주인공은 이 마을에서 나고 자랐다 — 마을 사람은 이름으로 안다. 그러나 독자는 모른다: 사람이 **서술에 처음 나올 때** 이름과 함께 누구인지 한 구절로 밝힌다 (예: "브람 — 수탉의 배급 관리인, 외다리 사내 — 이"). 이름을 모르는 사람은 겉모습으로만 부른다.
고유명사: '절름발이 수탉'은 배급 막사의 이름이다(닭이 아니다). '수탉'이라고만 하면 그 막사.

어떻게 쓰나:
- **이어 쓴다.** 바로 앞의 서술에서 그대로 이어진다. 이미 쓴 배경(비, 불, 냄새, 다른 사람의 소리)은 되풀이하지 않는다. 배경은 장면이 바뀔 때만 한 번 깐다.
- **문단으로 쓴다.** 2~3문단, 문단마다 2~5문장. 몸짓과 대사는 한 문단 안에 함께 둔다 — 대사만 한 줄로 따로 떼지 않는다. 문장 길이에 리듬을 둔다: 짧은 문장 사이에 긴 문장 하나.
- **사람을 쓴다.** 대화 중이면 상대의 반응이 중심이다: 무엇을 말하고, 무엇을 말하지 않고, 손이 무엇을 하는가. 상대의 말투 카드와 견본 대사의 결을 따른다.
- **감정은 이름 붙이지 않는다.** 두려움 대신 멈춘 손, 슬픔 대신 세는 손가락. 비유는 이 세계의 사물로만, 드물게.
- **주인공은 고른 것만 한다.** '셋째가 고른 것'의 말과 몸짓을 쓰고, 주인공이 하지 않은 말·결심·행동을 지어내지 않는다. 속마음은 한 문장 이내.
- **줄기를 잊지 않는다.** [이야기의 줄기]의 약속·맹세·쫓기는 처지는 장면의 공기에 배어 있게 — 다만 매번 설명하지 않는다. 앞에서 생긴 일과 어긋나지 않게.
- **되풀이하지 않는다.** 앞 서술의 문장·몸짓·비유를 다시 쓰지 않는다. [피할 표현]에 있는 낱말과 문장 첫머리는 이번에 쓰지 않는다.
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
  // 꺼낼 기억: 중요도만이 아니라 이번 박자의 화제와 닮은 것·최근 것·약속과 위협 먼저, 서로 닮은 것은 하나만 (recall.mjs)
  const topic = [res?.text, res?.label, res?.topic, ...(res?.notes || [])].filter(Boolean).join(" ");
  const mems = rankMemories(m.memories || [], { topic, now: g.t, k: 6 }).map((x) => `- ${x.text}${x.count > 1 ? " (여러 번)" : ""}`);
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
    ...regressionLines(g, n),
  ].filter(Boolean).join("\n");
}

const stripMeta = (x) => String(x).replace(/\s*\([^)]*(플레이어|회차|%)[^)]*\)/g, "");
// 카드의 회귀 메모 (22 §1, 14 §7.3): 세계 상태가 같으면 대사는 글자 그대로 같다 — 플레이어만 기억한다
function regressionLines(g, n) {
  const rg = g.content.cards[n]?.regression || {}, loop = g.run.loop;
  const fixed = (rg.fixed || []).filter((x) => !/^회귀점의 사실/.test(x)).map(stripMeta);
  const out = [];
  if (fixed.length) out.push(`매 회차 똑같이 하는 일·하는 말 (이 시각·장면에 해당하면 글자 그대로 — 바꾸지 않는다):\n${fixed.map((x) => "- " + x).join("\n")}`);
  if (loop >= 2 && rg.deja_vu === "strong") out.push("기시감: 셋째를 처음 보는데 이유 없이 오래 쳐다본다. 왜인지는 본인도 모른다.");
  else if (loop >= 2 && rg.deja_vu === "weak") out.push("기시감: 셋째의 얼굴에서 아주 잠깐 멈칫한다 — 그뿐이다.");
  if (loop >= 2) out.push("이 사람에게 이 저녁은 처음이다. 지난 회차에 셋째와 있었던 일을 하나도 모른다.");
  return out;
}
// 지난 회차의 셋째와 이 사람 (영혼에 남은 것) — 서술은 주인공의 속마음으로만 짚는다 (14 §7.3 '두 겹')
function pastLine(g, n) {
  const P = g.run.carry.soul?.people?.[n]; if (!P?.loops?.length) return "";
  const x = P.loops[P.loops.length - 1];
  const s = x.like * 0.6 + x.trust * 0.4;
  const bond = s >= 40 ? "깊이 믿는 사이였다" : s >= 20 ? "마음을 연 사이였다" : s <= -25 ? "원수였다" : s <= -10 ? "나를 믿지 않았다" : "스쳐 간 사이였다";
  return ` · [주인공의 기억: ${x.loop}회차엔 ${bond}${x.died ? ", 그 회차에 죽었다" : ""}${x.lines?.[0] ? ` — "${x.lines[0]}"` : ""}]`;
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
  for (const f of res.feed || []) if (!["ink", "drift", "grow", "voice", "dayend", "echo", "recap"].includes(f.kind)) L.push(`그사이 주인공 주변에서: ${f.text}`);
  const ink = (res.feed || []).filter((f) => ["ink", "drift", "voice", "echo"].includes(f.kind));
  if (ink.length) L.push(`주인공의 기억이 스친다 (화면이 이 줄을 따로 보여 준다 — 서술에 옮겨 쓰지 말고, 어긋나게 쓰지도 말 것): ${ink.map((f) => f.text).join(" / ")}`);
  if (res.ending) L.push("이 박자로 대화를 닫는다.");
  if (res.id === "routine_day") L.push("하루를 건너뛰었다: 배급 줄·막사·잠·점호를 두세 문장의 몽타주로. 그사이 주인공 주변에서 일어난 일만 짚는다. 없으면 같은 하루의 무게만.");
  return L.map(josa);
}

// 상태가 문장을 바꾼다 (19 §3): 숫자가 아니라 문장의 결로
function bodyLine(g, v) {
  const L = [];
  if (v.player.hunger >= 3) L.push("굶주림 — 음식 낱말(빵·죽·김)이 눈에 걸린다. 생각이 자꾸 먹을 것으로 미끄러진다");
  if (v.player.pain >= 60) L.push("통증 — 문장 사이에 아픔이 끼어든다. 한 박자에 한 번");
  if (v.player.fatigue >= 70) L.push("피로 — 감각이 둔하다. 소리가 멀다. 문장이 무겁게 늘어진다");
  if (v.player.stress >= 70) L.push("짓눌림 — 사소한 것에 오래 머문다. 손이 저절로 무언가를 센다");
  const fear = (v.player.wanted || 0) >= 2 || v.people.some((p) => (g.content.game.sim.profiles[p.id] || {}).role === "hunter");
  if (fear) L.push("공포 — 문장이 짧아진다. 쉼표가 많아진다. 소리에 먼저 반응한다");
  if (v.traits?.length) L.push(`기질 — 주인공은 이제 ${v.traits.join(", ")} 사람이다. 고르는 말과 몸짓에 배어난다`);
  return L.length ? `[몸의 상태 — 서술의 결이 이것을 따른다]\n${L.map((x) => "- " + x).join("\n")}` : "";
}
// 화자의 결 (18 §4): 같은 일을 누가 들려주느냐
const NARRATOR_STYLE = {
  silent_god: "건조하게. 판단하지 않고 보이는 것과 들리는 것만 쓴다. 문장은 짧고, 여운은 독자에게 맡긴다.",
  ash_teller: "불길하게. 사소한 것에서 징조를 본다 — 꺼지는 불, 갑자기 그친 소리, 너무 조용한 개. 문단 끝에 서늘한 한 줄.",
  old_teller: "옛이야기처럼, 따뜻하지만 감상에 빠지지 않게. 사람의 손과 얼굴을 오래 본다. 가끔 '그날 밤' 같은 돌아보는 결.",
  dice: "빠르고 날카롭게. 우연이 갈리는 순간 — 미끄러지는 발, 늦게 돌아보는 눈 — 을 짚는다. 군더더기 없이.",
};
// 이곳의 감각: 장소의 갈래 × 시각 × 날씨 × 계절 — 새 장면의 첫 문단이 고를 재료 (전부 쓰지 않는다)
const SENSE_FAMILY = {
  food: ["canteen", "tavern", "inn", "kitchen", "shop"], worship: ["chapel", "shrine", "temple", "cathedral", "altar", "sacred_tree", "crypt", "tomb"],
  work: ["work", "forge", "smelter", "workshop", "stable", "shed", "yard", "shipyard", "depot", "pens", "pen", "kennel", "field", "orchard", "loft"],
  power: ["keep", "office", "palace", "manor", "hall", "court", "council", "guardhouse", "checkpoint", "gate", "post", "watch", "tower", "customs", "registry", "throne", "ballroom", "chamber", "archive", "library", "scriptorium", "school"],
  home: ["home", "hut", "homes", "tenement", "slum", "barracks", "quarters", "lodging", "house", "residence", "burrow"],
  death: ["graveyard", "grave", "graves", "pit", "prison", "cellar", "vault", "sewer", "culvert"],
  water: ["quay", "dock", "canal", "well", "spring", "lake", "pool", "bank", "cistern", "lighthouse", "bridge"],
  crowd: ["square", "street", "market", "district", "ground", "flat", "arena"],
};
const SENSES = {
  food: ["솥에서 오르는 김", "그을린 기름 냄새", "숟가락이 그릇 바닥을 긁는 소리", "사람 몸의 온기와 쉰내"],
  worship: ["밀랍 타는 냄새", "발밑 돌의 냉기", "낮게 웅얼거리는 기도", "그을음 앉은 성상"],
  work: ["쉬지 않는 맷돌·망치 소리", "겨와 쇳가루가 섞인 먼지", "짐승의 똥과 짚 냄새", "굳은살 박인 손"],
  power: ["반질반질한 바닥", "잉크와 밀랍 봉인 냄새", "울리는 장화 소리", "문지기의 무심한 눈"],
  home: ["짚과 젖은 흙벽 냄새", "낮은 천장", "누군가의 기침", "꺼져 가는 화덕의 재"],
  death: ["축축한 흙", "녹슨 쇠 냄새", "쥐가 지나가는 소리", "갇힌 공기"],
  water: ["물비린내", "젖은 밧줄과 이끼", "쉬지 않는 물소리", "미끄러운 돌"],
  crowd: ["수레바퀴와 흥정 소리", "진흙에 찍힌 발자국", "말뚝에 붙은 낡은 게시문", "굶은 개"],
  open: ["바람", "젖은 풀과 진흙", "멀리서 우는 새", "어디서든 보이는 하늘"],
};
const SEASON = [["봄", "녹은 진흙과 새싹 냄새"], ["여름", "파리와 땀, 마른 먼지"], ["가을", "젖은 낙엽, 일찍 지는 해"], ["겨울", "입김과 언 손가락, 빈 곳간"]];
function senseLine(g, v) {
  const fam = Object.entries(SENSE_FAMILY).find(([, ks]) => ks.includes(v.place.kind))?.[0] || "open";
  const h = Number(v.hm.slice(0, 2)), mi = Math.max(0, ["해빙월", "파종월", "꽃월", "푸른월", "태양월", "건초월", "수확월", "포도월", "낙엽월", "서리월", "긴밤월", "굶주림월", "재의 날"].indexOf(v.month));
  const time = h < 6 && h >= 4 ? "새벽 — 찬 공기, 첫 종" : h >= 21 || h < 4 ? "밤 — 어둠, 횃불 하나, 순찰의 발소리" : h >= 18 ? "저녁 — 연기, 길어진 그림자" : h < 11 ? "아침 — 낮게 드는 빛" : "한낮 — 빛이 정직하다";
  const season = mi === 12 ? ["재의 날", "잿빛 하늘, 굶는 날들"] : SEASON[Math.floor(mi / 3)];
  return `[이곳의 감각 — 첫 문단에서 이 가운데 한두 가지만, 몸으로 느끼게] ${SENSES[fam].join(", ")} · ${time}${v.rain ? " · 비 — 젖은 옷, 진흙" : ""} · ${season[0]}: ${season[1]}`;
}
// 이야기의 줄기: 장면이 바뀌어도 서술이 잊으면 안 되는 것 (대화 기록은 대화가 끝나면 비워지므로 따로)
function threadBlock(g, v, thread) {
  const L = [];
  const day = Math.floor(g.t / 1440);
  const today = (thread || []).filter((x) => Math.floor(x.t / 1440) === day).slice(-6);
  if (today.length) L.push(`오늘 한 일: ${today.map((x) => `${x.hm} ${x.text}`).join(" → ")}`);
  else if ((thread || []).length) L.push(`지난번에 한 일: ${thread.slice(-3).map((x) => x.text).join(" → ")}`);
  for (const p of v.promises || []) L.push(`약속 — ${p.who}, ${p.when} ${p.where}: ${p.what}${p.soon ? " (곧이다)" : ""}`);
  for (const o of (v.oaths || []).filter((o) => o.state === "held")) L.push(`맹세 — ${o.line}`);
  if (v.player.wanted >= 1) L.push(`쫓기는 처지 — ${v.player.wantedWord}`);
  if (v.ladder) L.push(`윗선의 대응 — ${v.ladder.name}`);
  for (const h of (v.hunters || []).filter((h) => h.now && h.track >= 2)) L.push(`뒤를 밟는 자 — ${h.name} (${h.disposition})`);
  if (v.lastHook && today.length < 2) L.push(`지난 밤 마음에 걸린 것 — ${v.lastHook}`);
  return L.length ? `[이야기의 줄기 — 서술이 잊지 않을 것]\n${L.map((x) => "- " + x).join("\n")}` : "";
}
function convoFlow(g, transcript, talkLog) {
  if (!g.convo) return "";
  const c = g.convo, L = [];
  L.push(`${c.turns + 1}번째 말을 주고받는다. 상대는 ${c.patience >= 4 ? "아직 들어 줄 여유가 있다" : c.patience >= 2 ? "슬슬 지친다 — 대답이 짧아진다" : "곧 자리를 뜨려 한다 — 한두 마디로 끊는다"}.`);
  const asked = transcript.filter((t) => t.who === "player").slice(-Math.max(1, c.turns)).slice(0, -1).map((t) => t.text.slice(0, 40));
  if (asked.length) L.push(`이 대화에서 이미 오간 말: ${asked.join(" / ")} — 같은 대답을 되풀이하지 않는다`);
  const past = (talkLog?.[c.npc] || []).slice(-2);
  for (const x of past) L.push(`지난 대화 (${x.when}): ${x.asked.length ? `셋째가 꺼낸 말 — ${x.asked.join(" / ")}` : "짧은 인사"}${x.last ? ` · 끝은 — ${x.last}` : ""}`);
  return `[대화의 흐름]\n${L.map((x) => "- " + x).join("\n")}`;
}
function avoidBlock(tail) {
  if (!tail?.length) return "";
  const { words, openers } = crutches(tail.slice(-12));
  const L = [];
  if (words.length) L.push(`여러 번 쓴 낱말 — ${words.join(", ")}`);
  if (openers.length) L.push(`되풀이한 문장 첫머리 — ${openers.map((o) => `"${o}…"`).join(", ")}`);
  return L.length ? `[피할 표현 — 이번 박자에서 쓰지 않는다]\n${L.map((x) => "- " + x).join("\n")}` : "";
}
export function turnPrompt(g, res, opts, { transcript = [], memories = false, sceneNew = false, introduced = new Set(), thread = [], talkLog = {}, tail = [], retry = null } = {}) {
  const v = view(g);
  const loopLine = v.loop === 1
    ? "[회차] 첫 회차. 주인공은 아직 한 번도 죽지 않았다 — 회귀를 모른다. 다만 글자를 모르는데 글자가 읽히는 이상한 감각이 막 깨어났다."
    : `[회차] ${v.loop}회차. 주인공은 ${v.loop - 1}번 죽고 이 저녁으로 돌아왔다. 다음에 무슨 일이 일어나는지 일부를 안다. 아무도 모른다 — 다른 사람들에게 이 저녁은 처음이다.`;
  const personLine = (p) => {
    const unknownName = p.name !== (g.content.cards[p.id]?.name);
    const tag = unknownName ? `${p.name} (이름을 모른다 — 이름을 쓰지 말 것)` : `${p.name}${p.who ? ` (${p.who})` : ""}${introduced.has(p.id) ? "" : " [서술에 처음 나온다 — 누구인지 한 구절로]"}`;
    const today = `${v.month} ${v.time.split(" ")[3]}`;   // 예: '낙엽월 1일'
    const fixedNow = (g.content.cards[p.id]?.regression?.fixed || []).filter((x) => x.includes(today)).slice(0, 1).map(stripMeta);
    return `- ${tag}: ${(p.doing || "").length <= 4 ? "그 자리에 있다" : p.doing}${p.asleep ? " (잠듦)" : ""}${p.wears.length ? ` · 지닌 것: ${p.wears.join(", ")}` : ""} · ${p.mood}${fixedNow.length ? ` · 매 회차 이 날 같은 일: ${fixedNow[0]}` : ""}${pastLine(g, p.id)}`;
  };
  const scene = [
    loopLine,
    `[지금] ${v.time}, ${v.place.name}. ${v.night ? "밤." : ""} ${v.rain ? "비." : ""} 배고픔 ${v.player.hunger}/4, 아픔 ${v.player.pain}/100.`,
    `[이 자리에 있는 사람]\n${v.people.map(personLine).join("\n") || "- 아무도 없다"}`,
    v.goals?.length ? `[주인공이 지키려는 사람 — 서술이 이 무게를 잊지 않게]\n${v.goals.map((x) => `- ${x.who}: ${x.what}${x.days != null ? ` (${x.days}일 남음)` : ""}`).join("\n")}` : "",
    v.bodies.length ? `[시체] ${v.bodies.join(", ")}` : "",
    bodyLine(g, v),
    (() => { const L = v.lexicon || []; const unk = L.filter((w) => !w.meaning).map((w) => w.word), kn = L.filter((w) => w.meaning).map((w) => `${w.word}=${w.meaning.split(" — ")[0]}`); return unk.length || kn.length ? `[낱말] ${kn.length ? `주인공이 아는 말: ${kn.join(", ")}. ` : ""}${unk.length ? `모르는 말(서술에 나오면 뜻을 풀지 말고 소리로만): ${unk.join(", ")}` : ""}` : ""; })(),
    // 글 (19 §4.2): 글을 모르는 주인공의 서술에 글의 내용이 새지 않게
    (() => { const r = skill(g, "읽고쓰기"); return r >= 30 ? "" : `[글] 주인공은 ${r < 1 ? "글을 전혀 읽지 못한다. 서술에 글(게시문·편지·장부·명단)이 나오면 내용을 쓰지 말고 글자 모양만(▯▯▯)" : r < 10 ? "숫자만 읽는다. 글이 나오면 숫자 말고는 ▯로" : "이름과 짧은 말만 읽는다. 긴 글은 ▯로"} 쓴다.`; })(),
    // 알려진 사정: 대본 장면이 남긴 사정 가운데 이 자리 사람과 닿는 것 먼저 (서술이 잊지 않게)
    (() => { const here = new Set(v.people.map((p) => p.id)); const F = Object.entries(g.content.game.flags || {}).filter(([k]) => g.S.vars[k]).sort((a, b) => (here.has(b[1].npc) ? 1 : 0) - (here.has(a[1].npc) ? 1 : 0)).slice(0, 5); return F.length ? `[알려진 사정]\n${F.map(([, x]) => `- ${x.line}`).join("\n")}` : ""; })(),
    (() => { const seen = v.player.items.filter((i) => i.seen).map((i) => `${i.slot}에 ${i.name}`); const b = v.player.bloody ? ["옷에 핏자국"] : []; return seen.length || b.length ? `[주인공의 겉모습 — 남들 눈에 보인다] ${[...seen, ...b].join(", ")}` : ""; })(),
  ].filter(Boolean).join("\n");
  const convoNpc = g.convo?.npc || res?.convoEnded?.npc;
  const card = convoNpc ? `[대화 상대 카드]\n${convoCard(g, convoNpc, res)}` : "";
  const phrased = opts.filter(PHRASED).map((o) => ({ id: o.id, 행동: o.label, ...(o.topic ? { 주제: o.topic } : {}), ...(o.risk ? { 위험: o.risk } : {}) }));
  const mem = memories && convoNpc ? `,\n "memories": [{"kind": "impression|emotion|promise|claim|suspicion", "tag": "인상일 때: ${IMPRESSION_TAGS.join("|")}", "delta": "인상일 때 -5~5", "text": "${g.content.cards[convoNpc]?.name}의 입장에서 쓴 기억 한 줄", "evidence": "대화 기록에서 그대로 옮긴 구절", "salience": "1~5"}]  ← 대화가 끝났다. 상대가 셋째에 대해 기억하게 될 미묘한 것 0~3개` : "";
  return [
    `[문체 — 화자: ${v.narrator?.name || "침묵하는 신"}] ${NARRATOR_STYLE[v.narrator?.id] || NARRATOR_STYLE.silent_god}`,
    scene, threadBlock(g, v, thread), card, convoFlow(g, transcript, talkLog),
    `[장면] ${sceneNew ? "새 장면이다 — 첫 문단에 이곳과 사람들을 한 번 깔아라." : "같은 장면이 이어진다 — 배경을 다시 쓰지 말고, 바로 앞 서술에서 이어서 반응만 쓴다."}`,
    sceneNew ? senseLine(g, v) : "",
    avoidBlock(tail),
    retry ? `[다시 쓰기] ${retry}` : "",
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
  // 이름을 모르는 사람의 진짜 이름 (예: 이졸을 처음 본 날)
  for (const p of view(g).people) { const real = g.content.cards[p.id]?.name; if (real && real !== p.name) for (const x of real.split(/\s+/)) if (x.length > 1) set.add(x); }
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
export function validateTurn(g, parsed, opts, { res, free, prompt = "", tail = [] } = {}) {
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
  // 되풀이: 새 박자가 최근 서술과 거의 같으면 (바이그램 60% 넘게) — 한 번 다시 쓰게 한다 (실패로 치지는 않는다)
  const rep = tail.length ? Math.max(0, ...repetition(beats, tail.slice(-8))) : 0;
  if (rep >= 0.6) problems.push(`반복 — 앞 서술과 ${Math.round(rep * 100)}% 닮음`);
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
  return { ok, beats, choices, problems, repeat: rep >= 0.6 };
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
    ...jobs.map((j, i) => {
      // 이미 가진 기억 (같은 내용을 또 뽑지 않게 — 엔진도 거의 같은 기억은 하나로 합친다)
      const had = rankMemories(g.M[j.npc]?.memories || [], { topic: j.transcript.map((x) => x.text).join(" "), now: g.t, k: 5 }).map((x) => `  · ${x.text}`);
      return `[대화 ${i + 1}] NPC: ${j.npc} (${g.content.cards[j.npc]?.name}), 끝난 시각: ${j.time}${had.length ? `\n이미 가진 기억 (같은 내용은 다시 뽑지 마라):\n${had.join("\n")}` : ""}\n${j.transcript.map((x) => `${x.who === "player" ? "셋째" : "서술"}: ${x.text}`).join("\n")}`;
    }),
    `출력: {"records": [{"npc": "npc id", "kind": "impression|emotion|promise|claim|learned|suspicion|debt|threat", "tag": "인상일 때: ${IMPRESSION_TAGS.join("|")}", "delta": "인상일 때 -5~5", "text": "그 NPC의 입장에서 한 줄", "evidence": "대화 기록 그대로", "salience": "1~5",
  "promise": {"place": "장소 이름", "when": "오늘 밤|내일 정오|모레 새벽 다섯 시 처럼", "what": "무엇을"},
  "claim": {"about": "주인공이 말한 대상 인물 이름", "content": "주인공의 주장 한 줄", "fact": "위 사실 목록 가운데 이 주장과 같은 내용의 id (없으면 빼라)", "contradicts": "위 사실 목록 가운데 이 주장과 어긋나는 id (없으면 빼라)"},
  "fact": "learned일 때 사실 id"}]}
대화마다 0~4개. 약속·주장·들은 사실이 없으면 그 칸은 빼라. 주장을 NPC가 믿었는지는 적지 마라 — 엔진이 판정한다.`,
  ].join("\n\n");
}
export function parseRecords(text) {
  const s = String(text || ""); const i = s.indexOf("{"), j = s.lastIndexOf("}");
  try { return JSON.parse(s.slice(i, j + 1)).records || []; } catch { return null; }
}
