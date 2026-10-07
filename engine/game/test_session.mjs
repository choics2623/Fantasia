// node engine/game/test_session.mjs — LLM 붙인 한 판 (가짜 LLM): 원자적 턴, 실패 되돌리기, 호출 절약, 기억, 저장
import { loadContent } from "./load.mjs";
import { createSession } from "./session.mjs";
import { createProvider } from "../llm/provider.mjs";
import * as G0 from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };

const prov = createProvider({ kind: "mock" });
let saved = null;
// 가짜 기록관: 대화에서 약속 하나와 인상 하나를 뽑았다고 치자
const mockRecords = (batch) => batch.flatMap((j) => [
  { npc: j.npc, kind: "promise", text: "셋째와 내일 정오 방앗간에서 보기로 했다", evidence: j.transcript.find((x) => x.who === "player")?.text || "", salience: 3, promise: { place: "방앗간", when: "내일 정오", what: "곡물 이야기" } },
  { npc: j.npc, kind: "impression", tag: "쓸모 있음", delta: 3, text: "말을 잘 듣는다", evidence: j.transcript.find((x) => x.who === "player")?.text || "", salience: 2 },
  { npc: j.npc, kind: "impression", tag: "영리함", delta: 2, text: "지어낸 것", evidence: "대화에 없던 말", salience: 2 },
]);
const s = createSession(C, prov, { onSave: (r) => (saved = JSON.parse(JSON.stringify(r))), mockRecords });
const r0 = await s.start();
check("첫 화면은 손으로 쓴 대본 장면 — LLM을 부르지 않는다", r0.beats.length > 0 && prov.usage.calls === 0 && r0.choices[0].input === "true_name", r0.beats[0]);
const rn = await s.act({ id: "story_name", text: "하린|형" });
check("이름을 넣으면 어머니가 부르고, 머릿수 장면의 선택지 여섯", rn.beats.some((b) => b.includes("하린")) && rn.choices.length === 6 && prov.usage.calls === 0);
check("대본 선택지에도 확률 띠가 붙는다 (판정이 있는 것만)", rn.choices.some((c) => c.band) && rn.choices.some((c) => !c.band));
await s.act({ id: "story:stay_in_line" });
check("대본 장면이 끝날 때까지 LLM 호출 0", prov.usage.calls === 0);
let streamed = "";
const r1 = await s.act({ id: "talk:npc_bram" }, { onText: (t) => (streamed = t) });
check("서술이 흘러나온다 (스트리밍)", streamed.length > 0 && !streamed.includes("<선택지>"), streamed.slice(0, 40));
check("대화 중 선택지", r1.choices.some((c) => c.id === "small_talk"));
const calls0 = prov.usage.calls;
const rl = await s.act({ id: "leave" });
check("대화를 끝내는 턴은 서술 호출 하나 — 기록관은 뒤에서", prov.usage.calls - calls0 >= 1 && rl.beats.length > 0);
await s.drain();
const g0 = s.game;
const bramMem = g0.M.npc_bram?.memories || [];
check("기록관의 제안 중 근거 있는 것만 들어간다", bramMem.some((m) => m.tag === "쓸모 있음") && !bramMem.some((m) => m.tag === "영리함"));
const prom = bramMem.find((m) => m.promise);
check("약속은 브람의 일정이 된다 (내일 정오 방앗간)", prom && g0.W.where("npc_bram", prom.promise.from + 10).at === "gf_mill", prom && JSON.stringify(prom.promise));
check("약속은 수첩에도 적힌다", G0.view(g0).notebook.some((n) => n.includes("약속")));
const calls1 = prov.usage.calls;
const rw = await s.act({ id: "go:gf_graveyard" });
check("아무도 없는 곳으로 걷기는 LLM을 부르지 않는다", prov.usage.calls === calls1 && rw.engineOnly, rw.beats.join(" "));

// 실패: 되돌리고, 다시 보내면 같은 주사위
await s.act({ id: "go:gf_rooster" });
process.env.MOCK_FAIL = "1";
const jl = s.run.journal.length;
const talkId = s.game && (await import("./game.mjs")).options(s.game).find((o) => o.id.startsWith("talk:")).id;
const broken = await s.act({ id: talkId });
check("LLM이 실패하면 그 턴은 일어나지 않는다 (기록이 그대로)", !!broken.broken && s.run.journal.length === jl, broken.broken);
process.env.MOCK_FAIL = "0";
const again = await s.act(broken.retry);
check("다시 시도하면 이어진다", !again.broken && s.run.journal.length === jl + 1);
check("다시 시도는 재생 없이 서술만 다시 부른다 (같은 주사위 — 엔진은 이미 굴렀다)", (again.debug || []).some((d) => d.kind === "renarrate"));
check("자동 저장된다 (기록)", saved && saved.journal.length === s.run.journal.length);
console.log(`LLM 호출 ${prov.usage.calls}회 (실패 ${prov.usage.failures})`);
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
