// node engine/game/test_narration.mjs — 서술의 문맥 (19 §3 · 21 · 22 보강): 줄기 · 문체 · 장소의 감각 · 대화의 흐름 · 되풀이 막기 · 기록관의 기억
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import { turnPrompt, validateTurn, recorderPrompt, SYSTEM } from "./prompts.mjs";
import { createSession } from "./session.mjs";
import { createProvider } from "../llm/provider.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const fresh = (seed = 7) => G.boot(C, G.newRun({ seed, opening: false }));

// ── 프롬프트의 새 블록 ──
{ const g = fresh(); g.at = "gf_rooster";
  g.promises = [{ npc: "npc_bram", place: "gf_mill", from: g.t + 120, to: g.t + 180, what: "곡물 이야기", state: "open" }];
  const thread = [{ t: g.t - 30, hm: "17:36", at: 1, text: "움막에서 키트의 이마를 짚는다" }];
  const tail = ["당신은 그릇을 내민다. 비가 온다. 국자가 멈춘다.", "당신은 그릇을 내민다. 브람이 고개를 든다.", "당신은 그릇을 내민다. 국자가 솥을 긁는다."];
  const p = turnPrompt(g, null, G.options(g), { sceneNew: true, thread, tail });
  check("문체: 화자의 결", p.includes("[문체 — 화자: 침묵하는 신]"));
  check("이야기의 줄기: 오늘 한 일 + 약속", p.includes("[이야기의 줄기") && p.includes("키트의 이마") && p.includes("약속 — 브람"), (p.match(/\[이야기의 줄기[^\]]*\]\n[^\[]*/) || [""])[0].slice(0, 200));
  check("새 장면이면 이곳의 감각 (배급 막사 → 솥의 김)", p.includes("[이곳의 감각") && p.includes("솥에서 오르는 김"));
  check("되풀이한 낱말·첫머리는 피할 표현으로", p.includes("[피할 표현") && p.includes("당신은 그릇"));
  const p2 = turnPrompt(g, null, G.options(g), { sceneNew: false, thread, tail: [] });
  check("같은 장면이면 감각 블록 없음", !p2.includes("[이곳의 감각"));
  G.setNarrator(g, "ash_teller");
  check("화자를 바꾸면 문체도", turnPrompt(g, null, G.options(g), {}).includes("징조"));
  check("주인공은 고른 것만 — 규칙", SYSTEM.includes("주인공은 고른 것만 한다")); }

// ── 대화의 흐름: 상대의 인내, 지난 대화 ──
{ const g = fresh(); g.at = "gf_rooster";
  G.act(g, { id: "talk:npc_bram" });
  const talkLog = { npc_bram: [{ when: "낙엽월 1일 12:00", asked: ["곡물 이야기"], last: "브람은 등을 돌렸다." }] };
  const p = turnPrompt(g, null, G.options(g), { transcript: [{ who: "player", text: "브람에게 말을 붙인다" }], talkLog });
  check("대화 중이면 흐름 블록 (인내 + 지난 대화)", p.includes("[대화의 흐름]") && p.includes("여유가 있다") && p.includes("곡물 이야기"));
  g.convo.patience = 1;
  check("인내가 바닥나면 짧게 끊는다고 알린다", turnPrompt(g, null, G.options(g), {}).includes("곧 자리를 뜨려 한다")); }

// ── 되풀이 검사 ──
{ const g = fresh(); const opts = G.options(g);
  const same = "당신은 그릇을 내민다. 브람은 국자를 솥 바닥까지 넣었다가 반 국자를 덜어 낸다.";
  const v1 = validateTurn(g, { beats: [same], choices: [] }, opts, { tail: [same] });
  check("앞 서술과 거의 같으면 반복으로 잡는다", v1.repeat && v1.ok, v1.problems.join(" / "));
  const v2 = validateTurn(g, { beats: ["처마 위에서 페인이 손바닥을 내민다. 빗물이 그 손금에 고인다."], choices: [] }, opts, { tail: [same] });
  check("다른 글은 통과", !v2.repeat && v2.ok); }

// ── 세션: 되풀이면 한 번 다시 쓰게, 줄기·대화 요지 저장, 새 판이면 비운다 ──
{ let calls = 0, prompts = [];
  const fixed = "<서술>\n당신은 그릇을 내민다. 브람은 국자를 솥 바닥까지 넣었다가 반 국자를 덜어 낸다.\n</서술>\n<선택지>\n{\"choices\": []}\n</선택지>";
  const prov = { kind: "mock", usage: { calls: 0, failures: 0 }, async complete(sys, prompt) { calls++; this.usage.calls++; prompts.push(prompt); return fixed; } };
  const S = createSession(C, prov, { run: G.newRun({ seed: 7, opening: false }) });
  await S.start();
  const g = S.game; g.at = "gf_rooster";
  const r1 = await S.act({ id: "talk:npc_bram" });
  const c1 = calls;
  const r2 = await S.act({ id: G.options(S.game).find((o) => o.id === "small_talk")?.id || "small_talk" });
  check("같은 글이 또 오면 한 번 더 부른다 (다시 쓰기 지시와 함께)", calls - c1 === 2 && prompts.at(-1).includes("[다시 쓰기]"), `${calls - c1}`);
  check("두 번째도 같으면 그대로 받는다 (턴은 깨지지 않는다)", !r2.broken && r2.beats.length > 0);
  await S.act({ id: "leave" });
  const run = S.run;
  check("줄기가 저장된다 (오늘 한 일)", (run.thread || []).length >= 2 && run.thread.some((x) => x.text.includes("브람")), (run.thread || []).map((x) => x.text).join(" → "));
  check("대화가 끝나면 그 사람의 대화 요지", (run.talkLog?.npc_bram || []).length === 1 && run.talkLog.npc_bram[0].asked.length >= 1, JSON.stringify(run.talkLog?.npc_bram));
  check("서술 꼬리 (되풀이 검사용)", (run.tail || []).length >= 1);
  await S.newGame(8);
  check("새 판이면 서술의 기억도 새로", !(S.run.thread || []).length && !Object.keys(S.run.talkLog || {}).length); }

// ── 기록관: 이미 가진 기억을 함께 보여 준다 ──
{ const g = fresh();
  G.recordMemories(g, "npc_bram", [{ kind: "emotion", text: "셋째가 빵을 나눠 주었다", salience: 3, source: "engine" }]);
  const p = recorderPrompt(g, [{ npc: "npc_bram", time: "낙엽월 1일 19:00", transcript: [{ who: "player", text: "빵 고마웠어요" }, { who: "narr", text: "브람이 고개를 끄덕인다." }] }]);
  check("기록관 프롬프트에 '이미 가진 기억'", p.includes("이미 가진 기억") && p.includes("셋째가 빵을 나눠 주었다")); }

// ── 사람별 기억 (21 §6.7): 기록관은 '그 사람이 셋째에 대해' 적는다 — 자기 설명·없는 숫자는 받지 않는다 ──
{ const g = fresh();
  const T = [{ who: "player", text: "\"키트는 내가 지킬게요.\"" }, { who: "narr", text: "헨릭이 외알 안경을 고쳐 쓴다. \"삼백십칠. 숫자는 숫자다.\"" }];
  const { accepted, rejected } = G.validateMemories(g, "npc_henrik", T, [
    { npc: "npc_henrik", kind: "impression", tag: "용감함", delta: 2, text: "헨릭은 말을 끝까지 듣는 사람이다", evidence: "키트는 내가 지킬게요", salience: 2 },
    { npc: "npc_henrik", kind: "impression", tag: "이상함", delta: 1, text: "셋째의 나이(317세)를 적었다", evidence: "삼백십칠", salience: 2 },
    { npc: "npc_henrik", kind: "promise", by: "player", text: "키트를 지키겠다고 했다", evidence: "키트는 내가 지킬게요", salience: 3 },
    { npc: "npc_henrik", kind: "unfinished", text: "숫자 이야기를 하다 말았다", evidence: "숫자는 숫자다", salience: 2 },
  ], { t: g.t - 10 });
  check("제 이름을 주어로 쓴 자기 설명은 받지 않는다", rejected.some((r) => r.text.startsWith("헨릭은") && r.why.some((w) => w.includes("자신의 설명"))), JSON.stringify(rejected.map((r) => r.why)));
  check("대화에 없는 숫자는 받지 않는다 ('삼백십칠' → '317세')", rejected.some((r) => r.text.includes("317") && r.why.includes("대화에 없는 숫자")));
  const pr = accepted.find((m) => m.kind === "promise");
  check("약속은 누가 했는지와 함께 — 기억의 시각은 대화가 끝난 때", pr?.by === "player" && pr.t === g.t - 10, JSON.stringify(pr));
  check("끝나지 않은 이야기 갈래를 받는다", accepted.some((m) => m.kind === "unfinished"));
  const flip = G.validateMemories(g, "npc_henrik", T, [{ npc: "npc_henrik", kind: "promise", by: "npc", text: "키트를 지키겠다고 했다", evidence: "키트는 내가 지킬게요", salience: 3 }], { t: g.t }).accepted[0];
  check("누가 한 약속인지는 근거가 있는 자리로 — 셋째의 말에 있으면 셋째의 약속", flip?.by === "player", JSON.stringify(flip));
  const rp = recorderPrompt(g, [{ npc: "npc_henrik", time: "낙엽월 1일 19:00", transcript: T }]);
  check("기록관은 그 사람이 셋째를 부르는 말을 안다 · 쓰는 법과 나쁜 줄", rp.includes("부르는 말·말투: 숫자로 본다") && rp.includes("unfinished") && rp.includes("그 사람의 이름으로 문장을 시작하지 않는다")); }

// ── 다시 만나면: 장면에서도 대화에서도 지난 이야기를 잇는다. 그 뒤에 또 만났으면 끝난 이야기 ──
{ const g = fresh(); g.at = "gf_rooster";
  const t0 = g.t;
  G.recordMemories(g, "npc_bram", [
    { kind: "unfinished", text: "에길 이야기를 하다 말았다 — 다음에 마저 하자고 했다", salience: 3, source: "llm", t: t0 },
    { kind: "promise", by: "player", text: "빵값은 내일 갚겠다고 했다", salience: 3, source: "llm", t: t0 },
  ]);
  const talkLog = { npc_bram: [{ t: t0, when: "낙엽월 1일 18:30", asked: ["에길은요?"], last: "브람이 국자를 내려놓는다.", said: "그 얘긴 여기서 하지 마라" }] };
  const p0 = turnPrompt(g, null, G.options(g), { sceneNew: true, talkLog, introduced: new Set(["npc_bram"]) });
  check("장면의 사람 줄: 전에 말을 섞었다 + 끝에 한 말 + 끝나지 않은 이야기", p0.includes("전에 말을 섞었다") && p0.includes("그 얘긴 여기서 하지 마라") && p0.includes("끝나지 않은 이야기: 에길"), (p0.match(/- 브람[^\n]*/) || [""])[0]);
  G.act(g, { id: "talk:npc_bram" });
  const p1 = turnPrompt(g, null, G.options(g), { transcript: [{ who: "player", text: "브람에게 말을 붙인다" }], talkLog });
  check("대화가 열리면: 다시 만난 사이 · 마지막 말 · 끝나지 않은 이야기", p1.includes("다시 만난 사이다") && p1.includes("이 사람의 마지막 말") && p1.includes("지난번에 끝나지 않은 이야기"));
  check("대화 카드의 약속에는 누가 한 약속인지", p1.includes("[셋째가 한 약속] 빵값은"));
  const talkLog2 = { npc_bram: [...talkLog.npc_bram, { t: t0 + 60, when: "낙엽월 1일 19:30", asked: ["…"], last: "", said: null }] };
  const p2 = turnPrompt(g, null, G.options(g), { transcript: [], talkLog: talkLog2 });
  check("그 뒤에 또 만났으면 지난번의 끝나지 않은 이야기는 꺼내지 않는다", !p2.includes("에길 이야기를 하다 말았다")); }

// ── 세션: 기록관에게는 그 대화만 — 앞 사람과의 대화 꼬리가 섞이지 않고, 긴 대화의 첫머리도 잘리지 않게. 지난 대화엔 그 사람의 마지막 말 칸 ──
{ const batches = [];
  const prov = createProvider({ kind: "mock" });
  const S = createSession(C, prov, { run: G.newRun({ seed: 7, opening: false }), mockRecords: (b) => { batches.push(...b); return []; } });
  await S.start(); S.game.at = "gf_rooster";
  await S.act({ id: "talk:npc_bram" }); await S.act({ id: "leave" });
  const other = G.options(S.game).find((o) => o.id.startsWith("talk:") && o.id !== "talk:npc_bram");
  await S.act({ id: other.id }); await S.act({ id: "small_talk" }); await S.act({ id: "leave" });
  await S.drain();
  const second = batches.find((j) => j.npc === other.id.slice(5));
  check("기록관에게 넘기는 글은 그 대화부터 그 대화까지", second && second.transcript[0].who === "player" && second.transcript[0].text.includes(C.cards[other.id.slice(5)].name) && second.transcript.filter((x) => x.who === "player").length === 3, second && second.transcript.map((x) => `${x.who}:${x.text.slice(0, 16)}`).join(" | "));
  check("지난 대화 요지에 그 사람의 마지막 말 칸", "said" in ((S.run.talkLog?.npc_bram || [])[0] || {}));
  check("꺼낸 말에는 여닫는 행동이 들지 않는다 (행동 id로 가린다)", (S.run.talkLog?.[other.id.slice(5)]?.[0]?.asked || []).length === 1, JSON.stringify(S.run.talkLog?.[other.id.slice(5)]?.[0]?.asked));
  check("사람 칸에 지난 이야기", (G.view(S.game).people_known.find((x) => x.id === "npc_bram")?.talks || []).length === 1); }

// ── 다시 열기: 마지막 화면을 그대로 보인다 — 열 때마다 LLM을 부르지 않는다 ──
{ let calls = 0;
  const prov = { kind: "mock", usage: { calls: 0, failures: 0 }, async complete(sys, prompt, { mock } = {}) { calls++; return mock ? mock() : ""; } };
  const S = createSession(C, prov, { run: G.newRun({ seed: 7, opening: false }) });
  await S.start(); S.game.at = "gf_rooster";
  const r1 = await S.act({ id: "talk:npc_bram" });
  const c1 = calls;
  const S2 = createSession(C, prov, { run: JSON.parse(JSON.stringify(S.run)) });
  const r2 = await S2.start();
  check("다시 열면 마지막 화면 그대로 — LLM을 부르지 않는다", calls === c1 && r2.beats.length > 0 && JSON.stringify(r2.beats) === JSON.stringify(r1.beats), `호출 ${calls - c1}`);
  check("선택지도 그대로 (서술이 다시 쓴 글까지)", r1.choices.every((c) => r2.choices.find((x) => x.id === c.id)?.text === c.text), r2.choices.map((c) => c.text).join(" / ").slice(0, 120));
  await S2.act({ id: "small_talk" });
  const S3 = createSession(C, prov, { run: JSON.parse(JSON.stringify({ ...S2.run, screen: { ...S2.run.screen, at: 0 } })) });
  const c3 = calls; await S3.start();
  check("기록이 화면보다 앞서 있으면 새로 쓴다", calls > c3, `호출 ${calls - c3}`); }

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
