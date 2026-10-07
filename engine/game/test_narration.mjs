// node engine/game/test_narration.mjs — 서술의 문맥 (19 §3 · 21 · 22 보강): 줄기 · 문체 · 장소의 감각 · 대화의 흐름 · 되풀이 막기 · 기록관의 기억
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import { turnPrompt, validateTurn, recorderPrompt, SYSTEM } from "./prompts.mjs";
import { createSession } from "./session.mjs";
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

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
