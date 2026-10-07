// node engine/game/test_clock.mjs — 월드 클락 (03 §2.2): 세상이 마을을 찾아온다
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import { toMinutes } from "../sim/calendar.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const fresh = (seed = 7) => G.boot(C, G.newRun({ seed, opening: false }));
const until = (g, t) => { for (let i = 0; i < 2000 && g.t < t && !g.ended; i++) { g.P.status.hunger = 0; g.P.status.pain = 0; if (G.view(g).story) { g.storyDone.add(G.view(g).story.id); g.story = null; continue; } g.at = "gf_river_huts"; G.act(g, { id: ids(g).includes("routine_day") ? "routine_day" : "wait:60" }); } };

{ const g = fresh(); until(g, toMinutes(312, 10, 6));
  check("312 가을 — 북방 탈주자, 배급이 준다, 순찰이 는다", g.S.vars.ration_cut === true && g.S.vars.patrol_level === 1, `${g.S.vars.ration_cut} ${g.S.vars.patrol_level}`);
  let thin = 0; for (let d = 0; d < 10; d++) { g.P.status.hunger = 3; g.P.lastRation = -1; g.at = "gf_rooster"; const before = g.P.status.hunger; G.act(g, { id: "wait:60" }); }
  check("겨울의 수색 날짜는 아직", !g.S.vars.house_search); }
{ const g = fresh(); g.t = toMinutes(313, 5, 14) + 20 * 60; g.at = "gf_river_huts"; let st = null;
  for (let i = 0; i < 40 && !st; i++) { const sid = G.view(g).story?.id; if (sid === "conscription_decree") { st = sid; break; } if (sid) { g.storyDone.add(sid); g.story = null; continue; } g.P.status.hunger = 0; G.act(g, { id: "wait:60" }); }
  check("313 여름 〔고정〕 — 징발 포고, 플레이어도 대상", st === "conscription_decree");
  if (st) { G.act(g, { id: "story:go" }); check("줄에 서면 — 까마귀 문의 짐꾼이 된다", g.P.settlement === "crow_gate" && g.S.vars.conscripted === true, g.P.settlement); } }
{ const a = fresh(11), b = G.boot(C, G.newRun({ seed: 11, loop: 2, opening: false }));
  for (const g of [a, b]) { g.t = toMinutes(314, 2, 9) + 20 * 60; g.at = "gf_river_huts"; for (let i = 0; i < 12; i++) { if (G.view(g).story) { g.storyDone.add(G.view(g).story.id); g.story = null; } g.P.status.hunger = 0; G.act(g, { id: "wait:60" }); } }
  const va = a.g?.x; const pa = [...a.S.dead].filter((n) => !b.S.dead.has(n)), pb = [...b.S.dead].filter((n) => !a.S.dead.has(n));
  check("314 봄 〔표류〕 재열병 — 첫 환자는 회차마다 다르다", a.S.vars.plague && b.S.vars.plague && (pa.length || pb.length), `${pa.join(",")} / ${pb.join(",")}`); }
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
