// 규칙 엔진 — 21_LLM_HYBRID.md의 "판정하는 규칙" 쪽.
// 가능한 행동(어포던스), 확률(01), 결과 등급, 수치, 메모리 검증·상한, 회귀를 모두 여기서 정한다.
// LLM은 문장만 쓴다. 이 파일에는 LLM 호출이 없다.

// ───────────────────────── 사실 ─────────────────────────
export const FACTS = {
  fact_egil_in_cellar: { text: "브람이 지하실에 북방 탈주자 에길(아홉 살)과 그 어머니를 숨기고 있다", weight: 15, secret: true, names: ["에길"] },
  fact_hagen_drinks_volk: { text: "하겐이 사흘에 한 번 수탉에서 노예사냥꾼 볼크와 술을 마신다", weight: 8, secret: false, names: ["하겐", "볼크"] },
  fact_ledger_hole: { text: "브람의 배급 장부에는 매주 빵 여섯 덩이만큼 구멍이 있다", weight: 10, secret: true, names: [] },
  fact_volk_dogs: { text: "볼크의 개들은 빗속에서도 냄새를 찾는다. 사흘째 밤에 언덕을 뒤진다", weight: 8, secret: false, names: ["볼크"] },
  fact_sale_list: { text: "사흘 뒤 새벽 서른한 명이 세렌 노예상에게 팔려 간다", weight: 10, secret: false, names: [] },
};

// 세계의 고유명사 — 누설·환각 검사용
const WORLD_NAMES = ["브람", "셋째", "하겐", "볼크", "에길", "마르타", "즈닉", "사라", "페인", "오스릭", "게르다", "헨릭", "고드릭", "이졸", "키트", "엘사"];
const SCENE_NAMES = ["브람", "셋째", "즈닉", "하겐"]; // 이 장면에 있거나 누구나 아는 이름

// ───────────────────────── 상태 ─────────────────────────
export function newBram() {
  return { like: 0, trust: 0, fear: 1, warmth: 0, anger: 0, revealed: [], memories: [], patience: 8, impressions: {} };
}
export function newGame() {
  return {
    loop: 1, day: 2, turn: 0, over: false,
    player: {
      skills: { 화술: 22, 기만: 15, 위압: 8, 통찰: 18, 손재주: 12 },
      mods: { 지능: 0.5, 감각: 1, 의지: 0, 근력: -0.5 },
      items: { silver: 2, bread_half: 1 },
      knows: ["fact_hagen_drinks_volk"],     // 이번 회차에 알게 된 것
      future: [],                            // 지난 회차에서 가져온 기억 (아직 일어나지 않은 일)
      status: { hunger: 2, pain: 30 },
    },
    bram: newBram(),
    transcript: [],
    notebook: [],        // 플레이어 쪽 — 회귀해도 남는다
    lastRegressMemories: [],
    log: [],
  };
}

export function regress(g) {
  // 03: NPC 메모리·관계는 회귀점으로, 플레이어의 기억과 수첩은 남는다
  const keepNotebook = g.notebook.map((n) => (n.startsWith("◇") ? n : "◇ 지난 회차 — " + n));
  const learned = [...new Set([...g.player.knows, ...g.player.future])].filter((f) => f !== "fact_hagen_drinks_volk");
  const next = newGame();
  next.loop = g.loop + 1;
  next.player.future = [...new Set([...learned, "fact_egil_in_cellar", "fact_volk_dogs", "fact_sale_list"])]; // 첫 밤(prototypes/first-night)에서 겪은 것: 에길, 볼크의 개, 매각 명단
  next.notebook = keepNotebook;
  next.lastRegressMemories = g.bram.memories.map((m) => m.text);
  return next;
}

// ───────────────────────── 판정 (01) ─────────────────────────
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function prob(S, D) { return clamp(1 / (1 + Math.exp(-(S - D) / 8)), 0.03, 0.97); }
export function band(p) {
  if (p >= 0.85) return "거의 확실하다";
  if (p >= 0.65) return "해볼 만하다";
  if (p >= 0.4) return "반반이다";
  if (p >= 0.2) return "불리하다";
  return "무모하다";
}
export function tier(P, r) {
  if (r < P * 0.15) return "대성공";
  if (r < P) return "성공";
  if (r < P + (1 - P) * 0.35) return "부분 성공";
  if (r > 1 - (1 - P) * 0.15) return "대실패";
  return "실패";
}
const knowsFact = (g, f) => g.player.knows.includes(f) || g.player.future.includes(f);
const isFuture = (g, f) => g.player.future.includes(f) && !g.player.knows.includes(f) && !g.bram.revealed.includes(f);

// ───────────────────────── 어포던스 (02) ─────────────────────────
// 각 행동: 판정 스킬, 요청 크기, 결과별 효과. 문장 템플릿은 LLM이 없을 때 쓰는 대체 문장.
const AFF = {
  small_talk: {
    verb: "잡담", skill: "화술", request: -10, risk: "none",
    fallback: "비 이야기를 꺼내며 말을 붙인다",
    fx: { 대성공: { like: 6, trust: 2, warmth: 1 }, 성공: { like: 4 }, "부분 성공": { like: 2 }, 실패: {}, 대실패: { like: -3 } },
  },
  share_bread: {
    verb: "주다", skill: "화술", request: -15, risk: "none", item: "bread_half", consume: true,
    fallback: "빵 반쪽을 브람 쪽으로 민다",
    fx: { 대성공: { like: 10, trust: 5, warmth: 2, mem: ["debt"] }, 성공: { like: 8, trust: 3, mem: ["debt"] }, "부분 성공": { like: 4, mem: ["debt"] }, 실패: { like: 1 }, 대실패: { like: -2, note: "동정받는 것을 싫어한다" } },
  },
  buy_drink: {
    verb: "사다", skill: "화술", request: -10, risk: "low", item: "silver", consume: true,
    fallback: "은화 한 닢을 꺼내 술 한 잔을 청한다",
    fx: { 대성공: { like: 6, trust: 2, mem: ["suspicion_silver"] }, 성공: { like: 5, mem: ["suspicion_silver"] }, "부분 성공": { like: 3, mem: ["suspicion_silver"] }, 실패: { like: 0, mem: ["suspicion_silver"] }, 대실패: { trust: -4, mem: ["suspicion_silver"] } },
  },
  ask_hagen: {
    verb: "묻다", skill: "화술", request: 0, risk: "low", topic: "하겐",
    fallback: "하겐이 요즘 누구와 어울리는지 묻는다",
    fx: { 대성공: { reveal: "fact_hagen_drinks_volk", trust: 2 }, 성공: { reveal: "fact_hagen_drinks_volk" }, "부분 성공": { reveal: "hint_hagen" }, 실패: {}, 대실패: { trust: -3, fear: 1 } },
  },
  ask_cellar: {
    verb: "묻다", skill: "화술", request: 15, risk: "mid", topic: "지하실", hideIfRevealed: "fact_egil_in_cellar",
    fallback: "요즘 지하실에 쥐가 많지 않으냐고 돌려서 묻는다",
    fx: { 대성공: { reveal: "fact_egil_in_cellar", trustGate: 10 }, 성공: { reveal: "hint_cellar" }, "부분 성공": { fear: 1, note: "경계한다" }, 실패: { trust: -3 }, 대실패: { trust: -8, fear: 2, anger: 1 } },
  },
  ask_ledger: {
    verb: "묻다", skill: "화술", request: 12, risk: "mid", topic: "장부", hideIfRevealed: "fact_ledger_hole",
    fallback: "배급이 왜 늘 모자라는지 넌지시 묻는다",
    fx: { 대성공: { reveal: "fact_ledger_hole", trustGate: 15 }, 성공: { reveal: "hint_ledger" }, "부분 성공": { fear: 1 }, 실패: { trust: -2 }, 대실패: { trust: -6, anger: 1 } },
  },
  lie_hagen: {
    verb: "속이다", skill: "기만", request: 5, risk: "mid", claim: "하겐이 브람을 볼크에게 팔려 한다",
    fallback: "하겐이 당신을 볼크에게 팔려 한다고 거짓말한다",
    fx: { 대성공: { fear: 2, trust: 4, mem: ["claim_believed"] }, 성공: { fear: 1, trust: 2, mem: ["claim_believed"] }, "부분 성공": { fear: 1, mem: ["claim_doubted"] }, 실패: { trust: -5, mem: ["liar"] }, 대실패: { trust: -10, anger: 2, mem: ["liar"] } },
  },
  threaten_cellar: {
    verb: "위협", skill: "위압", request: 8, risk: "high", fact: "fact_egil_in_cellar", needsFact: true,
    fallback: "지하실에 누가 있는지 안다고, 낮게 말한다",
    fx: { 대성공: { fear: 3, trust: -10, like: -10, reveal: "fact_egil_in_cellar", mem: ["threat"] }, 성공: { fear: 2, trust: -12, like: -8, mem: ["threat"] }, "부분 성공": { fear: 2, trust: -15, anger: 1, mem: ["threat"] }, 실패: { anger: 2, trust: -15, mem: ["threat"] }, 대실패: { anger: 3, trust: -25, mem: ["threat"], note: "브람이 국자를 쥔다" } },
  },
  offer_egil: {
    verb: "제안", skill: "화술", request: 15, risk: "high", fact: "fact_egil_in_cellar", needsFact: true,
    fallback: "에길 일가를 늪 너머로 빼내 주겠다고 속삭인다",
    fx: { 대성공: { trust: 14, like: 6, reveal: "fact_egil_in_cellar" }, 성공: { trust: 9, reveal: "fact_egil_in_cellar" }, "부분 성공": { trust: 2, fear: 2 }, 실패: { fear: 2, trust: -5 }, 대실패: { fear: 3, trust: -12, anger: 1 } },
  },
  warn_volk: {
    verb: "경고", skill: "화술", request: 8, risk: "low", fact: "fact_volk_dogs", needsFact: true,
    fallback: "볼크의 개들이 사흘째 밤에 언덕을 뒤진다고 일러 준다",
    fx: { 대성공: { trust: 8, fear: 1 }, 성공: { trust: 6, fear: 1 }, "부분 성공": { trust: 2, fear: 1 }, 실패: { trust: -2 }, 대실패: { trust: -4, fear: 2 } },
  },
  leave: { verb: "떠나다", skill: null, risk: "none", fallback: "그릇을 내려놓고 빗속으로 나간다", fx: {} },
};
export const AFF_IDS = Object.keys(AFF);

export function affordances(g) {
  const out = [];
  for (const [id, a] of Object.entries(AFF)) {
    if (id === "leave") continue;
    if (a.item && !(g.player.items[a.item] > 0)) continue;
    if (a.needsFact && !knowsFact(g, a.fact)) continue;
    if (a.hideIfRevealed && g.bram.revealed.includes(a.hideIfRevealed)) continue;
    out.push(id);
  }
  out.push("leave");
  return out;
}

const ARG_RULES = {
  uses_fact: (g, v) => (knowsFact(g, v) ? FACTS[v]?.weight || 0 : 0),
  appeals_interest: (g, v) => (["hide_egil", "ledger", "survive_winter"].includes(v) ? 8 : 0),
  appeals_fear: (g, v) => (["volk", "martha"].includes(v) ? 8 : 0),
  offers_item: (g, v) => (g.player.items[v] > 0 ? 5 : 0),
};
export function argBonus(g, tags = []) {
  let sum = 0; const used = [];
  for (const t of tags) {
    const [k, v] = String(t).split(":");
    const f = ARG_RULES[k]; if (!f) continue;
    const b = f(g, v); if (b > 0) { sum += b; used.push(`${t} +${b}`); }
  }
  return { bonus: Math.min(25, sum), used };
}

export function odds(g, id, tags = []) {
  const a = AFF[id];
  if (!a.skill) return { P: 1, S: 0, D: 0, parts: [] };
  const p = g.player, b = g.bram;
  const statMod = a.skill === "위압" ? p.mods.의지 * 2 + p.mods.근력 * 2 : (p.mods.지능 + p.mods.감각) * 2;
  const rel = a.skill === "위압" ? 0 : Math.round(b.like * 0.3 + b.trust * 0.2);
  const status = -(p.status.hunger >= 2 ? 5 : 0) - (p.status.pain >= 30 ? 3 : 0);
  const fact = a.fact && knowsFact(g, a.fact) ? FACTS[a.fact].weight : 0;
  const arg = argBonus(g, tags);
  const S = p.skills[a.skill] + statMod + rel + status + fact + arg.bonus;
  const fearMod = a.skill === "위압" ? -b.fear * 4 : b.fear * 3;
  const D = 2 + Math.round(30 / 2) + a.request + fearMod + b.anger * 5;
  const parts = [
    `S = ${a.skill} ${p.skills[a.skill]} + 능력치 ${statMod.toFixed(0)} + 관계 ${rel} + 상태 ${status}` + (fact ? ` + 아는 사실 ${fact}` : "") + (arg.bonus ? ` + 논거 ${arg.bonus} (${arg.used.join(", ")})` : "") + ` = ${S.toFixed(0)}`,
    `D = 브람 의지 2 + 통찰/2 15 + 요청 ${a.request} + 기분 ${fearMod + b.anger * 5} = ${D}`,
  ];
  return { P: prob(S, D), S, D, parts };
}

// ───────────────────────── 한 턴 ─────────────────────────
export function resolve(g, id, { tags = [], playerText = null, rng = Math.random } = {}) {
  const a = AFF[id];
  const o = odds(g, id, tags);
  const t = a.skill ? tier(o.P, rng()) : "성공";
  const fx = a.fx[t] || {};
  const b = g.bram;
  const changes = [];
  const engineMems = [];
  const add = (k, v, lim) => { if (!v) return; const before = b[k]; b[k] = clamp(b[k] + v, lim[0], lim[1]); changes.push(`${k} ${before}→${b[k]}`); };
  add("like", fx.like, [-100, 100]); add("trust", fx.trust, [-100, 100]);
  add("fear", fx.fear, [0, 5]); add("warmth", fx.warmth, [0, 5]); add("anger", fx.anger, [0, 5]);
  if (a.consume && a.item) g.player.items[a.item]--;

  // 아직 일어나지 않은 일을 안다 → 의심 (잔향 징후). 정보가 밝혀지기 전에 판단한다.
  const usedFacts = [a.fact, ...tags.filter((x) => String(x).startsWith("uses_fact:")).map((x) => x.split(":")[1])].filter(Boolean);
  const futureUsed = usedFacts.filter((f) => isFuture(g, f));

  let reveal = null;
  if (fx.reveal) {
    if (fx.trustGate && b.trust < fx.trustGate) reveal = fx.reveal === "fact_egil_in_cellar" ? "hint_cellar" : "hint_ledger";
    else reveal = fx.reveal;
    if (FACTS[reveal]) {
      if (!b.revealed.includes(reveal)) b.revealed.push(reveal);
      if (!g.player.knows.includes(reveal)) g.player.knows.push(reveal);
      g.notebook.push(`브람에게서 들었다 — ${FACTS[reveal].text}`);
    }
  }

  // 규칙이 보장하는 기억 (21 §6.2-5)
  for (const m of fx.mem || []) {
    if (m === "debt") engineMems.push({ kind: "debt", tag: "빚", text: "셋째가 빵을 나눠 주었다. 갚아야 한다", salience: 3 });
    if (m === "suspicion_silver") engineMems.push({ kind: "suspicion", tag: "은화", text: "농노가 은화를 가지고 있었다. 어디서 났을까", salience: 2 });
    if (m === "threat") engineMems.push({ kind: "threat", tag: "위험함", text: "셋째가 지하실 일로 나를 겁박했다", salience: 5 });
    if (m === "claim_believed") engineMems.push({ kind: "claim", tag: "하겐", text: `셋째의 말: ${a.claim} (믿었다)`, salience: 4, truth: false, believed: true });
    if (m === "claim_doubted") engineMems.push({ kind: "claim", tag: "하겐", text: `셋째의 말: ${a.claim} (반신반의)`, salience: 3, truth: false, believed: false });
    if (m === "liar") engineMems.push({ kind: "impression", tag: "거짓말쟁이", delta: -5, text: "셋째는 거짓말을 한다", salience: 4 });
  }
  if (futureUsed.length) {
    engineMems.push({ kind: "suspicion", tag: "이상함", text: `셋째가 알 리 없는 것을 안다 — ${FACTS[futureUsed[0]].text.slice(0, 24)}…`, salience: 5 });
    add("fear", 1, [0, 5]);
  }
  for (const m of engineMems) addMemory(g, { ...m, source: "engine" });

  b.patience -= 1;
  g.turn++;
  const ending = id === "leave" || b.patience <= 0 || (t === "대실패" && a.risk === "high");
  if (ending) g.over = true;
  return { id, tier: t, odds: o, changes, reveal, note: fx.note || null, futureUsed, ending, playerText };
}

// ───────────────────────── 메모리 (21 §6) ─────────────────────────
const KINDS = ["fact_learned", "claim", "impression", "emotion", "promise", "debt", "threat", "suspicion"];
const TAGS = ["영리함", "위험함", "정직함", "거짓말쟁이", "다정함", "비굴함", "용감함", "이상함", "쓸모 있음", "짐", "빚", "은화", "하겐"];
const SLOTS = 30; // 브람 = A등급

function addMemory(g, m) {
  const b = g.bram;
  const mem = { id: `m${b.memories.length + 1}`, day: g.day, ...m };
  b.memories.push(mem);
  if (m.kind === "impression" && m.tag) b.impressions[m.tag] = clamp((b.impressions[m.tag] || 0) + (m.delta || 0), -20, 20);
  if (b.memories.length > SLOTS) {
    b.memories.sort((x, y) => y.salience - x.salience);
    b.memories.length = SLOTS;
  }
}

function normalize(s) { return String(s).replace(/[\s"'“”‘’.,!?…·—-]/g, ""); }
function evidenceFound(transcript, ev) {
  const t = normalize(transcript.map((x) => x.text).join(""));
  const e = normalize(ev);
  if (e.length < 4) return false;
  for (let i = 0; i + 6 <= e.length; i += 3) if (t.includes(e.slice(i, i + 6))) return true;
  return t.includes(e);
}

// LLM이 뽑은 기억 후보를 검증해서 받아들인다
export function acceptMemories(g, candidates) {
  const accepted = [], rejected = [];
  const perTag = {};
  for (const c of candidates || []) {
    const why = [];
    if (c.npc && c.npc !== "npc_bram") why.push("그 자리에 없던 인물");
    if (!KINDS.includes(c.kind)) why.push("모르는 종류");
    if (c.kind === "impression" && !TAGS.includes(c.tag)) why.push("허용되지 않은 인상 태그");
    if (!c.evidence || !evidenceFound(g.transcript, c.evidence)) why.push("대화에 근거가 없음");
    if (c.kind === "fact_learned" && !FACTS[c.factId]) why.push("사실 ID에 연결되지 않음 → 버림");
    if (why.length) { rejected.push({ ...c, why }); continue; }
    let delta = Number(c.delta) || 0;
    if (c.kind === "impression") {
      const cap = 5;
      const used = perTag[c.tag] || 0;
      const d2 = clamp(delta, -cap - used, cap - used);
      if (d2 !== delta) c.capped = `${delta}→${d2}`;
      delta = d2; perTag[c.tag] = used + d2;
    }
    const mem = { kind: c.kind, tag: c.tag || null, delta, text: c.text || c.evidence, evidence: c.evidence, salience: clamp(Number(c.salience) || 2, 1, 5), source: "llm", capped: c.capped };
    addMemory(g, mem);
    accepted.push(mem);
  }
  return { accepted, rejected };
}

// 통찰 판정 — 인상이 인물 수첩에 드러나는가 (21 §6.6)
export function insight(g, rng = Math.random) {
  const lines = [];
  for (const [tag, v] of Object.entries(g.bram.impressions)) {
    if (!v) continue;
    const P = prob(g.player.skills.통찰 + g.player.mods.감각 * 2 + Math.abs(v), 22);
    if (rng() < P) lines.push(`브람은 당신을 ${v > 0 ? "" : "조금도 "}${tag}${v > 0 ? "하다고 여기기 시작했다" : "하다고 여기지 않는다"}.`.replace("거짓말쟁이하다고", "거짓말쟁이라고").replace("위험함하다고", "위험하다고").replace("영리함하다고", "영리하다고").replace("정직함하다고", "정직하다고").replace("다정함하다고", "다정하다고").replace("이상함하다고", "이상하다고").replace("용감함하다고", "용감하다고").replace("비굴함하다고", "비굴하다고").replace("쓸모 있음하다고", "쓸모 있다고"));
  }
  if (g.bram.memories.some((m) => m.kind === "suspicion" && m.tag === "이상함") && rng() < 0.6) lines.push("브람이 당신을 오래 본다. 그릇을 닦던 손이 멈춰 있다.");
  for (const l of lines) if (!g.notebook.includes(l)) g.notebook.push(l);
  return lines;
}

// ───────────────────────── 프롬프트 재료 ─────────────────────────
function relationWords(b) {
  const s = b.like * 0.6 + b.trust * 0.4;
  if (b.anger >= 2) return "화가 나 있다. 당장 쫓아내고 싶다.";
  if (b.fear >= 3) return "겁을 먹었다. 이 아이가 무섭다.";
  if (s >= 15) return "조금 마음을 열었다. 그래도 지하실 이야기는 다르다.";
  if (s >= 5) return "나쁘지 않은 아이라고 생각한다.";
  if (s <= -10) return "믿지 않는다. 경계한다.";
  return "처음 보는 얼굴이다. 경계한다.";
}
const MOOD = (b) => [b.fear >= 2 ? "두려움" : b.fear === 1 ? "약간 긴장" : null, b.anger ? "분노" : null, b.warmth ? "숨긴 다정함" : null].filter(Boolean).join(", ") || "무덤덤";

export function bramCard(g, revealNow = null) {
  const b = g.bram;
  const knows = ["fact_hagen_drinks_volk", "fact_sale_list"].map((f) => FACTS[f].text);
  const guarded = [];
  if (b.revealed.includes("fact_egil_in_cellar") || revealNow === "fact_egil_in_cellar") knows.push(FACTS.fact_egil_in_cellar.text + " (이제 셋째도 안다)");
  else guarded.push("지하실에 숨긴 것이 있다. 무엇인지는 절대 먼저 말하지 않는다. 쥐 이야기로 얼버무린다.");
  if (b.revealed.includes("fact_ledger_hole") || revealNow === "fact_ledger_hole") knows.push(FACTS.fact_ledger_hole.text + " (이제 셋째도 안다)");
  else guarded.push("배급 장부 이야기는 피한다.");
  const mems = [...b.memories].sort((x, y) => y.salience - x.salience).slice(0, 8).map((m) => `- ${m.text}`);
  return [
    "이름: 브람 (인간, 52세). 배급 막사 '절름발이 수탉'의 관리인.",
    "말투: 말이 짧다. 반말. 대답 대신 그릇을 닦는다. 욕은 '빌어먹을' 하나만 쓴다.",
    "성격: 과묵, 의심 많음, 다정함을 숨김. 남에게 빚지는 것을 싫어한다.",
    "목표: 지하실에 숨긴 사람들을 겨울까지 지킨다. 장부의 구멍을 들키지 않는다.",
    "두려움: 볼크의 개. 목줄장 마르타의 장부.",
    `셋째를 대하는 마음: ${relationWords(b)}`,
    `지금 기분: ${MOOD(b)}`,
    `아는 것:\n${knows.map((k) => "- " + k).join("\n")}`,
    guarded.length ? `숨기는 것:\n${guarded.map((k) => "- " + k).join("\n")}` : "",
    mems.length ? `셋째에 대해 기억하는 것:\n${mems.join("\n")}` : "셋째에 대해 기억하는 것: 없음 (처음 본다)",
  ].filter(Boolean).join("\n");
}

const REVEAL_TEXT = {
  hint_cellar: "브람은 지하실에 '쥐가 아니라 사람'이 있다는 것만, 아주 짧게 흘린다. 누구인지는 말하지 않는다.",
  fact_egil_in_cellar: "브람은 지하실에 에길과 그 어머니가 있다는 것을 털어놓는다.",
  hint_hagen: "브람은 하겐이 '좋지 않은 손님'과 어울린다고만 말한다.",
  fact_hagen_drinks_volk: "브람은 하겐이 사흘에 한 번 볼크와 여기서 술을 마신다고 말한다.",
  hint_ledger: "브람은 배급이 모자라는 건 '위에서 떼어 가서'라고만 말한다.",
  fact_ledger_hole: "브람은 장부의 구멍이 자기 짓이라는 것을, 지하실 사람들 먹이려고 그랬다는 것을 인정한다.",
};

export function affordanceBrief(g, ids) {
  return ids.map((id) => {
    const a = AFF[id];
    const extra = [a.item ? `아이템: ${a.item === "silver" ? "은화" : "빵 반쪽"}` : "", a.fact ? `근거로 쓰는 기억: ${FACTS[a.fact].text}` : "", a.topic ? `주제: ${a.topic}` : "", a.claim ? `거짓 주장: ${a.claim}` : ""].filter(Boolean).join(" / ");
    return { affordance: id, 행동: a.verb, 위험: a.risk, 설명: a.fallback, ...(extra ? { 덧붙임: extra } : {}) };
  });
}

export function outcomeBrief(g, res, actionText) {
  const a = AFF[res.id];
  return {
    플레이어의_행동: actionText,
    판정: a.skill ? `${a.skill} 판정 — ${res.tier}` : "판정 없음",
    결과_지시: res.reveal ? REVEAL_TEXT[res.reveal] : res.tier === "대실패" ? "브람은 크게 언짢아한다. 비밀에 대한 힌트는 하나도 주지 않는다. " + (res.note || "") : res.tier === "실패" ? "브람은 넘어오지 않는다. 숨기는 것에 대한 힌트(소리, 시선, 암시)도 주지 않는다." : res.tier === "부분 성공" ? "브람은 반쯤만 반응한다. 대가가 따른다 (경계·의심)." : res.note || "브람이 반응한다.",
    아직_일어나지_않은_일을_말함: res.futureUsed.length ? "예 — 브람은 셋째가 그걸 어떻게 아는지 섬뜩해한다" : "아니오",
    대화_끝: res.ending ? "예 — 이 박자로 장면을 닫는다" : "아니오",
  };
}

// ───────────────────────── 검증 ─────────────────────────
export function validateTurn(g, out, ids, res) {
  const problems = [];
  const allowed = new Set([...SCENE_NAMES, ...g.player.knows.flatMap((f) => FACTS[f]?.names || []), ...g.player.future.flatMap((f) => FACTS[f]?.names || []), ...g.bram.revealed.flatMap((f) => FACTS[f]?.names || [])]);
  if (res && res.reveal && FACTS[res.reveal]) FACTS[res.reveal].names.forEach((n) => allowed.add(n));
  const lastPlayer = [...g.transcript].reverse().find((t) => t.who === "player");
  if (lastPlayer) WORLD_NAMES.forEach((n) => { if (lastPlayer.text.includes(n)) allowed.add(n); });
  const leak = (s) => WORLD_NAMES.filter((n) => s.includes(n) && !allowed.has(n));
  let beats = Array.isArray(out?.beats) ? out.beats.filter((x) => typeof x === "string" && x.trim()) : [];
  beats = beats.slice(0, 3).map((x) => (x.length > 260 ? x.slice(0, 258) + "…" : x));
  for (const bt of beats) { const l = leak(bt); if (l.length) problems.push(`서술에 아직 모르는 이름: ${l.join(", ")}`); }
  if (/확률|퍼센트|%/.test(beats.join(""))) problems.push("서술이 확률을 언급");
  const seen = new Set();
  const choices = [];
  for (const c of out?.choices || []) {
    if (!ids.includes(c.affordance)) { problems.push(`목록에 없는 행동: ${c.affordance}`); continue; }
    if (seen.has(c.affordance)) continue;
    if (typeof c.text !== "string" || !c.text.trim()) continue;
    const l = leak(c.text);
    if (l.length) { problems.push(`선택지에 모르는 이름(${l.join(",")}) → 대체 문장`); continue; }
    if (/확실히|반드시 통|분명 성공/.test(c.text)) { problems.push("선택지가 확률을 흘림 → 대체 문장"); continue; }
    seen.add(c.affordance); choices.push({ affordance: c.affordance, text: c.text.slice(0, 90) });
  }
  for (const id of ids) if (!seen.has(id)) choices.push({ affordance: id, text: AFF[id].fallback, fallback: true });
  const beatsOk = beats.length && !problems.some((p) => p.startsWith("서술"));
  return { beats: beatsOk ? beats : null, choices, problems };
}

export function validateInterpret(g, out, ids) {
  const problems = [];
  let id = out?.affordance;
  if (!ids.includes(id)) { problems.push(`해석된 행동이 목록에 없음: ${id} → 잡담으로`); id = ids.includes("small_talk") ? "small_talk" : ids[0]; }
  const tags = (out?.argument_tags || []).filter((t) => {
    const [k, v] = String(t).split(":");
    if (!ARG_RULES[k]) { problems.push(`모르는 논거 태그: ${t}`); return false; }
    if (k === "uses_fact" && !knowsFact(g, v)) { problems.push(`모르는 사실을 근거로 씀: ${v} (0 처리)`); return false; }
    return true;
  });
  return { id, tags, problems };
}

// 테스트 전용 가짜 LLM(mock)이 쓰는 자유 입력 해석 — 키워드 규칙. 플레이어에게는 쓰지 않는다 (LLM 필수)
export function keywordInterpret(g, text, ids) {
  const t = String(text);
  const has = (...w) => w.some((x) => t.includes(x));
  const tags = [];
  if (has("에길") && knowsFact(g, "fact_egil_in_cellar")) tags.push("uses_fact:fact_egil_in_cellar");
  if (has("볼크", "개들", "사냥꾼") && knowsFact(g, "fact_volk_dogs")) tags.push("uses_fact:fact_volk_dogs");
  if (has("마르타")) tags.push("appeals_fear:martha");
  if (has("겨울")) tags.push("appeals_interest:survive_winter");
  const pick = (...c) => c.find((x) => ids.includes(x));
  let id = null;
  if (has("에길", "지하실") && has("안다", "알아", "말하면", "일러", "고발")) id = pick("threaten_cellar");
  if (!id && has("에길") && has("데려", "빼내", "도와", "늪")) id = pick("offer_egil");
  if (!id && has("지하실", "쥐")) id = pick("ask_cellar", "offer_egil");
  if (!id && has("볼크", "개들") && has("조심", "온다", "뒤진")) id = pick("warn_volk");
  if (!id && has("하겐") && has("팔", "넘기")) id = pick("lie_hagen");
  if (!id && has("하겐", "볼크", "사냥꾼")) id = pick("ask_hagen");
  if (!id && has("장부", "배급", "모자라")) id = pick("ask_ledger");
  if (!id && has("빵")) id = pick("share_bread");
  if (!id && has("술", "은화")) id = pick("buy_drink");
  if (!id && has("간다", "나간다", "떠난다")) id = pick("leave");
  return { affordance: id || pick("small_talk", "leave"), argument_tags: tags };
}

// 테스트 전용 가짜 LLM(mock)이 쓰는 서술 템플릿. 플레이어에게는 쓰지 않는다 (LLM 필수)
export function fallbackBeats(g, res, actionText) {
  const t = res.tier;
  const r = res.reveal ? REVEAL_TEXT[res.reveal].replace("브람은", "").trim() : null;
  const base = {
    대성공: "브람의 손이 멈춘다. 그는 처음으로 당신을 똑바로 본다.",
    성공: "브람은 그릇을 내려놓는다. \"…그래.\"",
    "부분 성공": "브람은 대답 대신 그릇을 닦는다. 오래. 눈은 문 쪽에 가 있다.",
    실패: "브람은 고개를 젓는다. \"먹었으면 가.\"",
    대실패: "국자가 탁자를 친다. \"빌어먹을. 나가.\"",
  }[t];
  const beats = [base];
  if (r) beats.push(`브람이 낮게 말한다. 그는 ${r}`);
  if (res.futureUsed.length) beats.push("\"…네가 그걸 어떻게 알아?\" 브람의 목소리가 갈라진다.");
  if (res.ending && res.id !== "leave") beats.push("브람이 등을 돌린다. 이야기는 끝났다.");
  if (res.id === "leave") return ["당신은 그릇을 내려놓고 빗속으로 나간다. 등 뒤에서 브람이 그릇을 닦는 소리가 오래 들린다."];
  return beats;
}

export function affLabel(id) { return AFF[id]?.fallback || id; }
export function affSkill(id) { return AFF[id]?.skill || null; }
