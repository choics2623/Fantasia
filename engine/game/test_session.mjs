// node engine/game/test_session.mjs — LLM 붙인 한 판 (가짜 LLM): 원자적 턴, 실패 되돌리기, 호출 절약, 기억, 저장
import { loadContent } from "./load.mjs";
import { createSession } from "./session.mjs";
import { createProvider } from "../llm/provider.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };

const prov = createProvider({ kind: "mock" });
let saved = null;
const s = createSession(C, prov, { onSave: (r) => (saved = JSON.parse(JSON.stringify(r))) });
const r0 = await s.start();
check("시작 장면에 서술과 선택지가 있다", r0.beats.length > 0 && r0.choices.length > 3);
check("선택지에 확률 띠가 붙는다 (판정이 있는 것만)", r0.choices.some((c) => c.band) && r0.choices.some((c) => !c.band));
let streamed = "";
const r1 = await s.act({ id: "talk:npc_bram" }, { onText: (t) => (streamed = t) });
check("서술이 흘러나온다 (스트리밍)", streamed.length > 0 && !streamed.includes("<선택지>"), streamed.slice(0, 40));
check("대화 중 선택지", r1.choices.some((c) => c.id === "small_talk"));
const calls0 = prov.usage.calls;
await s.act({ id: "leave" });
check("대화를 끝내는 턴은 기억까지 한 번에 (호출 1)", prov.usage.calls - calls0 === 1);
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
check("자동 저장된다 (기록)", saved && saved.journal.length === s.run.journal.length);
console.log(`LLM 호출 ${prov.usage.calls}회 (실패 ${prov.usage.failures})`);
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
