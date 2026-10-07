// node engine/game/test_echo.mjs — 앎의 흔적 (03 §4.3)과 세력의 대응 사다리 (10 §5)
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const fresh = (seed = 7) => G.boot(C, G.newRun({ seed, opening: false }));
const days = (g, n) => { for (let i = 0; i < n * 24 && !g.ended; i++) { g.P.status.hunger = 0; g.P.status.pain = 0; if (G.view(g).story) { g.storyDone.add(G.view(g).story.id); g.story = null; continue; } G.act(g, { id: ids(g).includes("wait:60") ? "wait:60" : "sleep" }); } };
const greyfolk = (g) => Object.keys(C.cards).filter((n) => g.W.where(n, g.t)?.settlement === "greyford" && !g.S.dead.has(n));
const believe = (g, list) => { for (const n of list) g.L.believe(n, g.t, { kind: "echo_sign", subject: "player", at: g.at, source: "saw", heat: 0.9, content: "앞일" }, { react: false }); };

// 목격자 앞에서 미래를 쓰면 — 그 자리 사람들의 믿음이 된다
{ const g = fresh(); g.at = "gf_rooster"; g.t = Math.floor(g.t / 1440) * 1440 + 1440 + 19 * 60;
  g.run.carry.future.push("fact_gf_egil_family_in_cellar");
  g.convo = { npc: "npc_bram", turns: 0, patience: 8, transcript: [] };
  const pr = ids(g).find((x) => x === "press:fact_gf_egil_family_in_cellar");
  if (pr) { G.act(g, { id: pr }); const w = Object.keys(C.cards).filter((n) => g.L.beliefs(n).some((b) => b.kind === "echo_sign")); check("앎의 흔적 — 목격자의 믿음이 된다", w.includes("npc_bram"), w.join(",")); }
  else check("앎의 흔적 — 목격자의 믿음이 된다 (기억 선택지가 열린다)", false, ids(g).join(",")); }
// 소문 → 밀고 → 추적 (소문은 하루 사이에도 번진다 — 단계는 오르기만 한다)
{ const g = fresh(); const folk = greyfolk(g).filter((n) => n !== "npc_martha");
  believe(g, folk.slice(0, 3)); days(g, 1);
  const s1 = g.P.echoStage?.greyford || 0;
  check("셋이 믿으면 — 소문, '날을 아는 자'", s1 >= 1 && (g.P.titles || []).includes("날을 아는 자"), `단계 ${s1}`);
  believe(g, folk.slice(3, 5)); days(g, 1);
  check("다섯이면 — 목줄단의 밀고 (수배, 잿빛 탑의 밀정)", (g.P.echoStage.greyford || 0) >= 2 && (g.S.wanted.player?.reasons || []).some((r) => /징후/.test(r)) && (g.nem?.npc_isol?.grudge || 0) >= 1);
  believe(g, folk.slice(5, 9)); if (!g.ended) days(g, 1);
  check("여덟이면 — 추적, 그리고 대신 끌려가는 사람", g.P.echoStage.greyford === 3 && (g.P.scapegoats || []).length === 1 && (g.nem?.npc_volk?.grudge || 0) >= 2, (g.P.scapegoats || []).join(","));
  check("회귀하면 징후도 지워진다", !G.boot(C, { ...G.regressRun(g), opening: false }).P.echoStage); }
// 대응 사다리 — 숨은 곳에서 자정을 넘기며 본다 (낮의 수색에 걸리면 사다리를 보기 전에 끝난다)
{ const g = fresh(); g.at = "gf_mill_loft";
  const midnight = (heat) => { G.wantedAdd(g, heat, "검사", null, "greyford"); g.t = Math.floor(g.t / 1440) * 1440 + 1440 + 23 * 60; g.at = "gf_mill_loft"; G.act(g, { id: "wait:60" }); G.act(g, { id: "wait:60" }); };
  midnight(2); check("수배 2 — 지역 현상금 (검문이 강해진다)", G.view(g).ladder?.name === "지역 현상금", JSON.stringify(G.view(g).ladder));
  midnight(2); check("수배 4 — 바르그 사냥대 (볼크가 숙적이 된다)", g.P.ladder?.greyford === 2 && (g.nem?.npc_volk?.grudge || 0) >= 2, `${JSON.stringify(g.P.ladder)} ${g.ended?.why || ""}`);
  midnight(3); check("수배 7 — 수색령과 본보기", g.P.ladder?.greyford === 3, `${JSON.stringify(g.P.ladder)} ${g.ended?.why || ""}`); }
// 기시감: 셋째 회차부터 잿빛 탑이 일찍 온다
{ const g = G.boot(C, { ...G.newRun({ seed: 7, loop: 3, opening: false }) });
  check("셋째 회차 — 잿빛 탑의 밀정이 처음부터 낌새를 챈다", (g.nem?.npc_isol?.grudge || 0) >= 1); }
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
