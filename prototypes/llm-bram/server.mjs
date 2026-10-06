// 로컬 실험 서버 — 21_LLM_HYBRID.md §10의 LlmProvider를 바꿔 끼운다.
//   LLM_PROVIDER=cli      (기본) 내 PC의 Claude Code 로그인 = 구독으로 돌린다. 혼자 테스트 전용.
//   LLM_PROVIDER=api      ANTHROPIC_API_KEY + `npm i @anthropic-ai/sdk` 필요. 종량제.
//   LLM_PROVIDER=offline  LLM 없이 규칙 기반 대체 문장만 (게임이 LLM 없이도 도는지 확인).
// 실행: node server.mjs  →  http://localhost:5173
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as E from "./engine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const PROVIDER = process.env.LLM_PROVIDER || "cli";
const MODEL = process.env.LLM_MODEL || (PROVIDER === "api" ? "claude-haiku-4-5" : "haiku");

// ───────────────────────── 공통 프롬프트 ─────────────────────────
const STYLE = `너는 한국어 그림다크 판타지 텍스트 게임의 문장 담당이다. 규칙 엔진이 이미 결과를 정했다. 너는 그것을 문장으로만 쓴다.
세계: 신을 죽인 고대 종족들이 인간을 노예로 부리는 대륙. 붕괴력 312년 낙엽월 2일 저녁, 회색여울 마을의 배급 막사 '절름발이 수탉'. 밖은 비.
주인공: '셋째'라 불리는 열일곱 살 인간 농노. 등에 채찍 자국. 배가 고프다.
문체: 2인칭. 서술에서 주인공은 언제나 "당신"이다 ("셋째"는 다른 인물이 부를 때만). 짧은 문장. 박자 하나는 150자 안팎. 감정 형용사보다 몸과 사물. 설교하지 않는다. 현대어·외래어 금지.
절대 규칙:
- 엔진의 결과 지시를 바꾸지 않는다. 실패면 상대는 넘어오지 않는다. 지시에 없는 비밀을 밝히지 않는다.
- 확률이나 성공 가능성을 암시하지 않는다.
- 주어진 인물 카드에 없는 고유명사를 만들지 않는다.
- 출력은 JSON 하나뿐. 설명, 마크다운, 코드펜스 없이.`;

const TURN_SCHEMA = `{"beats": ["서술 박자 1~3개. 각 200자 이내. 브람의 대사는 큰따옴표로."], "choices": [{"affordance": "주어진 id 그대로", "text": "그 행동을 이 장면에 맞게 쓴 선택지 문장, 60자 이내. 행동을 바꾸지 말 것"}]}`;
const INTERPRET_SCHEMA = `{"affordance": "가장 가까운 행동 id", "argument_tags": ["uses_fact:<사실id> | appeals_interest:<hide_egil|ledger|survive_winter> | appeals_fear:<volk|martha> | offers_item:<silver|bread_half> 중 플레이어 말에 실제로 들어 있는 것만"], "said": "플레이어가 한 말을 한 문장으로"}`;
const MEMORY_SCHEMA = `{"memories": [{"npc": "npc_bram", "kind": "fact_learned|claim|impression|emotion|promise|debt|threat|suspicion", "tag": "인상일 때: 영리함|위험함|정직함|거짓말쟁이|다정함|비굴함|용감함|이상함|쓸모 있음|짐", "delta": "인상일 때 -5~5 정수", "text": "브람의 입장에서 쓴 기억 한 줄", "evidence": "대화 기록에서 그대로 옮긴 근거 구절", "salience": "1~5"}]}`;

function turnPrompt(g, outcome, ids) {
  return `[인물 카드]\n${E.bramCard(g, outcome?.reveal)}\n\n[최근 대화]\n${g.transcript.slice(-8).map((t) => `${t.who === "player" ? "셋째" : t.who === "bram" ? "브람/서술" : "서술"}: ${t.text}`).join("\n") || "(아직 없음)"}\n\n[이번 박자 — 엔진이 정한 결과]\n${outcome ? JSON.stringify(outcome, null, 1) : "장면 시작. 셋째가 배급 줄 끝에서 브람의 탁자 앞에 섰다. 브람이 귀리죽을 퍼 준다."}\n\n[다음 선택지로 쓸 행동 — 전부, 이 순서로]\n${JSON.stringify(E.affordanceBrief(g, ids), null, 1)}\n\n출력 형식:\n${TURN_SCHEMA}`;
}
function interpretPrompt(g, text, ids) {
  const facts = [...g.player.knows, ...g.player.future].map((f) => `${f}: ${E.FACTS[f].text}`).join("\n");
  return `플레이어가 직접 쓴 행동을 엔진의 행동 하나로 옮겨라. 판정은 엔진이 한다.\n\n[플레이어 입력]\n${text}\n\n[가능한 행동]\n${JSON.stringify(E.affordanceBrief(g, ids), null, 1)}\n\n[플레이어가 아는 사실]\n${facts || "(없음)"}\n\n출력 형식:\n${INTERPRET_SCHEMA}`;
}
function memoryPrompt(g) {
  return `대화가 끝났다. 브람이 이 대화에서 셋째에 대해 기억하게 될 것을 뽑아라. 엔진이 이미 기록한 것(빚, 위협, 거짓말 등)은 빼고, 말투·태도·인상처럼 미묘한 것 위주로 0~4개. 근거(evidence)는 반드시 아래 기록에서 그대로 옮긴다.\n\n[이미 엔진이 기록한 기억]\n${g.bram.memories.map((m) => "- " + m.text).join("\n") || "(없음)"}\n\n[대화 기록]\n${g.transcript.map((t) => `${t.who === "player" ? "셋째" : "서술"}: ${t.text}`).join("\n")}\n\n출력 형식:\n${MEMORY_SCHEMA}`;
}

// ───────────────────────── 공급자 ─────────────────────────
function parseJson(text) {
  if (!text) throw new Error("빈 응답");
  const s = String(text).replace(/```json|```/g, "");
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i < 0 || j < 0) throw new Error("JSON 없음: " + s.slice(0, 120));
  return JSON.parse(s.slice(i, j + 1));
}

// 시스템 프롬프트와 설정은 파일로 넘긴다 (윈도우에서 따옴표 문제를 피한다)
let files = null;
async function cliFiles() {
  if (files) return files;
  const dir = await mkdtemp(join(tmpdir(), "fantasia-"));
  files = { system: join(dir, "system.txt"), settings: join(dir, "settings.json") };
  await writeFile(files.system, STYLE, "utf8");
  // 생각(thinking)을 끈다 — 켜 두면 한 번에 수천 토큰을 생각하느라 30~80초 걸린다. 끄면 5~10초.
  await writeFile(files.settings, JSON.stringify({ alwaysThinkingEnabled: false }), "utf8");
  return files;
}

// 구독: 헤드리스 Claude Code. 도구 끔, 세션 저장 안 함, 시스템 프롬프트 교체.
async function callCli(prompt) {
  const f = await cliFiles();
  const args = ["-p", "--output-format", "json", "--model", MODEL, "--tools", "", "--no-session-persistence", "--system-prompt-file", f.system, "--settings", f.settings];
  const win = process.platform === "win32";
  const finalArgs = win ? args.map((a) => `"${a.replace(/"/g, '\\"')}"`) : args;
  return new Promise((resolve, reject) => {
    const p = spawn("claude", finalArgs, { shell: win, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, MAX_THINKING_TOKENS: "0" } });
    let out = "", err = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("시간 초과 (90초)")); }, 90000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(timer); reject(new Error("claude 실행 실패 — Claude Code가 설치·로그인되어 있나요? " + e.message)); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude 종료 코드 ${code}: ${(err || out).slice(0, 300)}`));
      try {
        const env = JSON.parse(out);
        if (env.is_error) return reject(new Error("claude 오류: " + String(env.result).slice(0, 300)));
        resolve({ text: env.result, meta: { duration_ms: env.duration_ms, output_tokens: env.usage?.output_tokens, thinking_tokens: env.usage?.output_tokens_details?.thinking_tokens, cost_usd_equiv: env.total_cost_usd } });
      } catch (e) { reject(new Error("CLI 출력 해석 실패: " + out.slice(0, 200))); }
    });
    p.stdin.end(prompt, "utf8");
  });
}

// API: 공식 SDK. 키는 이 서버에만 둔다 (앱에 넣지 않는다).
let client = null;
async function callApi(prompt) {
  if (!client) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk").catch(() => { throw new Error("npm i @anthropic-ai/sdk 를 먼저 실행하세요"); });
    client = new Anthropic();
  }
  const t0 = Date.now();
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 2000,
    system: [{ type: "text", text: STYLE, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, meta: { duration_ms: Date.now() - t0, usage: msg.usage } };
}

async function llm(kind, prompt, debug) {
  if (PROVIDER === "offline") { debug.push({ kind, provider: "offline", note: "LLM 없이 대체 문장" }); return null; }
  try {
    const r = PROVIDER === "api" ? await callApi(prompt) : await callCli(prompt);
    const json = parseJson(r.text);
    debug.push({ kind, provider: PROVIDER, model: MODEL, meta: r.meta, prompt, raw: json });
    return json;
  } catch (e) {
    debug.push({ kind, provider: PROVIDER, error: String(e.message || e), prompt });
    return null;
  }
}

// ───────────────────────── 게임 진행 ─────────────────────────
let G = E.newGame();

async function narrate(outcome, res, debug) {
  const ids = G.over ? [] : E.affordances(G);
  const out = await llm("turn", turnPrompt(G, outcome, ids), debug);
  const v = E.validateTurn(G, out || {}, ids, res);
  if (v.problems.length) debug.push({ kind: "validate", problems: v.problems });
  const beats = v.beats || (res ? E.fallbackBeats(G, res) : ["빗물이 처마에서 떨어진다. 배급 줄 끝, 브람의 탁자 앞. 그가 귀리죽 한 국자를 당신 그릇에 붓는다. 눈은 들지 않는다.", "\"다음.\""]);
  for (const b of beats) G.transcript.push({ who: "bram", text: b });
  return { beats, choices: G.over ? [] : v.choices.map((c) => withOdds(c)) , usedFallback: !v.beats };
}
function withOdds(c) {
  const o = E.odds(G, c.affordance);
  return { ...c, skill: E.affSkill(c.affordance), band: E.affSkill(c.affordance) ? E.band(o.P) : null, p: Math.round(o.P * 100), math: o.parts };
}
function view(extra = {}) {
  return {
    provider: PROVIDER, model: PROVIDER === "offline" ? null : MODEL, loop: G.loop, over: G.over,
    bram: { like: G.bram.like, trust: G.bram.trust, fear: G.bram.fear, anger: G.bram.anger, warmth: G.bram.warmth, impressions: G.bram.impressions, memories: G.bram.memories, revealed: G.bram.revealed, patience: G.bram.patience },
    player: { items: G.player.items, knows: G.player.knows, future: G.player.future },
    notebook: G.notebook, lastRegressMemories: G.lastRegressMemories,
    ...extra,
  };
}

async function api(path, body) {
  const debug = [];
  if (path === "/api/start") {
    const r = await narrate(null, null, debug);
    return view({ ...r, debug });
  }
  if (path === "/api/act") {
    if (G.over) return view({ beats: [], choices: [], debug: [{ kind: "note", note: "대화가 끝났다" }] });
    const ids = E.affordances(G);
    let id = body.affordance, tags = [], actionText = body.text;
    if (body.free) {
      G.transcript.push({ who: "player", text: body.free });
      const out = await llm("interpret", interpretPrompt(G, body.free, ids), debug);
      const v = E.validateInterpret(G, out || E.keywordInterpret(G, body.free, ids), ids);
      if (!out) debug.push({ kind: "engine", note: "LLM 해석 없음 → 키워드 규칙으로 해석" });
      if (v.problems.length) debug.push({ kind: "validate", problems: v.problems });
      id = v.id; tags = v.tags; actionText = body.free;
      debug.push({ kind: "engine", note: `자유 입력 → ${id} (${E.affLabel(id)})`, tags });
    } else {
      if (!ids.includes(id)) return view({ error: "지금은 할 수 없는 행동", debug });
      G.transcript.push({ who: "player", text: actionText || E.affLabel(id) });
    }
    const res = E.resolve(G, id, { tags, playerText: actionText });
    debug.push({ kind: "engine", note: `판정 ${E.affSkill(id) || "없음"} → ${res.tier} (P ${Math.round(res.odds.P * 100)}%)`, math: res.odds.parts, changes: res.changes, reveal: res.reveal, futureUsed: res.futureUsed });
    const r = await narrate(E.outcomeBrief(G, res, actionText || E.affLabel(id)), res, debug);
    let memo = null;
    if (G.over) memo = await endConversation(debug);
    return view({ ...r, result: { tier: res.tier, p: Math.round(res.odds.P * 100), skill: E.affSkill(id) }, memo, debug });
  }
  if (path === "/api/end") {
    if (!G.over) G.over = true;
    const memo = await endConversation(debug);
    return view({ beats: ["당신은 자리에서 일어난다. 브람은 이미 다음 그릇을 채우고 있다."], choices: [], memo, debug });
  }
  if (path === "/api/regress") {
    G = E.regress(G);
    const r = await narrate(null, null, debug);
    return view({ ...r, regressed: true, debug });
  }
  if (path === "/api/reset") { G = E.newGame(); const r = await narrate(null, null, debug); return view({ ...r, debug }); }
  throw new Error("unknown " + path);
}

async function endConversation(debug) {
  if (G._memoDone) return null;
  G._memoDone = true;
  const out = await llm("memory", memoryPrompt(G), debug);
  const { accepted, rejected } = E.acceptMemories(G, out?.memories || []);
  const lines = E.insight(G);
  debug.push({ kind: "memory", accepted, rejected });
  return { accepted, rejected, insight: lines };
}

// ───────────────────────── HTTP ─────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(await readFile(join(HERE, "index.html")));
    }
    if (req.method === "POST" && req.url.startsWith("/api/")) {
      let body = "";
      for await (const c of req) body += c;
      const data = await api(req.url, body ? JSON.parse(body) : {});
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(data));
    }
    res.writeHead(404); res.end("not found");
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});
server.listen(PORT, () => {
  console.log(`브람 실험실 → http://localhost:${PORT}`);
  console.log(`LLM 공급자: ${PROVIDER}${PROVIDER === "offline" ? "" : ` (모델 ${MODEL})`}`);
});
