// node engine/game/test_flags.mjs — 대본 장면이 남긴 깃발이 약속한 결과를 낳는가 (A13): 목표 행동·며칠 뒤의 결과·서술의 '알려진 사정'
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import { turnPrompt } from "./prompts.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const fresh = (seed = 7) => G.boot(C, G.newRun({ seed, opening: false }));
const days = (g, n) => { for (let i = 0; i < n * 24 && !g.ended; i++) { g.P.status.hunger = 0; g.P.status.pain = 0; if (G.view(g).story) { g.storyDone.add(G.view(g).story.id); g.story = null; continue; } G.act(g, { id: ids(g).includes("wait:60") ? "wait:60" : "sleep" }); } };
const logHas = (g, re) => g.S.log.some((l) => re.test(l.text));

{ const g = fresh(); g.S.vars.kit_whipped = true; days(g, 2);
  check("움막 바닥의 금 — 다음 점호에서 키트가 태형 셋", logHas(g, /키트가 태형 셋/)); }
{ const g = fresh(); g.S.vars.hagen_knows_escape_intent_via_fayne = true; g.t = Math.max(g.t, g.t); days(g, 7);
  check("페인에게 판 질문은 하겐에게 팔린다 — 치명적 자리 C의 조건이 켜진다", g.S.vars.hagen_knows_escape_intent === true); }
{ const g = fresh(); g.S.vars.henrik_suspects_sara = true; days(g, 5);
  check("헨릭의 의심 — 사라가 초소로 불려 간다", g.S.vars.sara_watched === true && logHas(g, /사라가 초소로/)); }
{ const g = fresh(); g.S.vars.list_burned = true; g.S.vars.sara_on_list = false; g.S.vars.kit_on_list = false; days(g, 31);
  check("명단을 태워도 서른 날 — 세렌의 사본으로 다시 적힌다", g.S.vars.list_restored === true && g.S.vars.sara_on_list === true, `${G.view(g).time}`); }
{ const g = fresh(); g.S.vars.hut12_marks_seen = true; g.at = "gf_river_huts";
  const before = g.P.hut12Searched; for (let i = 0; i < 3 && !g.P.hut12Searched; i++) { if (G.view(g).story) { g.storyDone.add(G.view(g).story.id); g.story = null; } g.at = "gf_river_huts"; G.act(g, { id: "sleep" }); }
  check("금을 본 감독은 다음 점호에 반드시 뒤진다", !before && g.P.hut12Searched === true); }
{ const g = fresh(); g.S.vars.bram_rewalled = true; g.at = "gf_rooster";
  const p = turnPrompt(g, null, G.options(g), {});
  check("서술은 '알려진 사정'을 받는다 (브람이 벽을 다시 발랐다)", p.includes("[알려진 사정]") && p.includes("벽을 다시 발랐다")); }
{ const g = fresh(); g.S.vars.volk_honest = true;
  const st = C.game.storylets.find((s) => s.id === "nemesis_found"); const bargain = st.choices.find((c) => c.id === "bargain");
  check("볼크가 기억하는 정직 — 흥정의 근거가 된다", (bargain.check.warn || []).includes("var volk_honest == true")); }
// 메아리 상한 (16 §3.3): 한 장면에 하나, 넘치면 대기열 → 잠자리의 「밤의 메아리」
{ const g = fresh(); g.at = "gf_river_huts";
  g.echoes = [1, 2, 3, 4].map((k) => ({ when: "loop >= 1", text: `〰 메아리 ${k}`, t: g.t, R: 60 + k * 5 }));
  const r = G.act(g, { id: "wait:60" });
  const shown = (r.feed || []).filter((f) => f.kind === "echo" && /메아리 \d/.test(f.text));
  check("한 장면에 메아리는 하나", shown.length === 1 && (g.P.echoQ || []).length === 3, `${shown.length} / 대기 ${(g.P.echoQ || []).length}`);
  let night = [];
  for (let i = 0; i < 3 && !night.length; i++) { if (G.view(g).story) { g.storyDone.add(G.view(g).story.id); g.story = null; } g.at = "gf_river_huts"; const r2 = G.act(g, { id: "sleep" }); night = (r2.feed || []).filter((f) => /밤의 메아리/.test(f.text)); }
  check("잠자리에 — 밤의 메아리 둘까지", night.length >= 1 && night.length <= 2, night.map((f) => f.text).join(" / ")); }
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
