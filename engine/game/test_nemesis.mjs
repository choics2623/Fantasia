// node engine/game/test_nemesis.mjs — 숙적 본편 (17): 마음 네 수치와 성향, 교훈, 사냥꾼 판, 처음 보는 원수
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const fresh = (seed = 7) => G.boot(C, G.newRun({ seed, opening: false }));

check("성향 — 사냥개 (집착 70, 공포 낮음)", G.nemDisposition({ grudge: 2, obs: 75, fear: 10, resp: 0 }) === "사냥개");
check("성향 — 독사 (집착·공포 모두 높음)", G.nemDisposition({ grudge: 2, obs: 65, fear: 65, resp: 0 }) === "독사");
check("성향 — 꺾인 자", G.nemDisposition({ grudge: 2, obs: 20, fear: 85, resp: 0 }) === "꺾인 자");
check("존경 60 — 정직한 적", G.nemDisposition({ grudge: 2, obs: 75, fear: 10, resp: 65 }).includes("정직한 적"));
// 교훈: 놓친 수를 배운다 — 같은 회차에 같은 수는 어렵다
{ let g = null;
  for (let s = 1; s < 40 && !g; s++) {
    const x = fresh(s); x.at = "gf_rooster"; x.P.skills.은신 = 75; x.nem = { npc_volk: { grudge: 2, track: 4, since: x.t } };
    G.act(x, { id: "wait:60" }); if (G.view(x).story?.id !== "nemesis_found") continue;
    G.act(x, { id: "story:flee" }); if (!x.ended && x.nem?.npc_volk?.lessons?.includes("flee")) g = x;
  }
  check("달아나서 살아남으면 — 그가 그 수를 배운다 (집착 +10)", !!g && g.nem.npc_volk.obs >= 50, JSON.stringify(g?.nem?.npc_volk));
  if (g) {
    g.nem.npc_volk.track = 4; g.at = "gf_rooster";
    for (let i = 0; i < 6 && G.view(g).story?.id !== "nemesis_found"; i++) { if (G.view(g).story) { g.storyDone.add(G.view(g).story.id); g.story = null; } G.act(g, { id: "wait:60" }); }
    if (G.view(g).story?.id === "nemesis_found") { const o = G.options(g).find((x) => x.id === "story:flee"); const od = G.optionOdds(g, o); check("같은 회차에 같은 수 — D +15, 근거에 보인다", od.parts.some((p) => /지난번 수를 배웠다/.test(p.text)), od.parts.map((p) => p.text).join(" / ")); }
    check("사냥꾼 판 — 성향과 교훈", G.view(g).hunters.some((h) => h.now && h.lessons.length >= 1)); } }
// 독사: 직접 오지 않는다 — 대리 사냥 (밀고)
{ const g = fresh(); g.at = "gf_river_huts"; g.nem = { npc_volk: { grudge: 2, track: 0, since: g.t, obs: 70, fear: 70, resp: 0 } };
  const h0 = G.view(g).player.wanted; for (let i = 0; i < 9; i++) { if (G.view(g).story) { g.storyDone.add(G.view(g).story.id); g.story = null; } G.act(g, { id: "routine_day" }); }
  check("독사 — 직접 오지 않고 대신 고한다", g.nem.npc_volk.track === 0 && (g.S.wanted.player?.reasons || []).some((r) => /대신 고했다/.test(r)), `${g.nem.npc_volk.track} ${(g.S.wanted.player?.reasons || []).join("/")}`); }
// 처음 보는 원수: 지난 회차의 사냥꾼이 이번 회차에 처음 너를 본다
{ const g0 = fresh(); g0.nem = { npc_volk: { grudge: 2, track: 1, since: g0.t } }; g0.ended = { kind: "dead", why: "t", t: g0.t };
  const g = G.boot(C, { ...G.regressRun(g0), opening: false, lethal: true });
  let hit = null;
  const volkHere = () => { const w = g.W.where("npc_volk", g.t); return w?.kind === "at" && g.W.loc.get(w.at)?.settlement === "greyford" ? w.at : null; };
  for (let i = 0; i < 400 && !hit; i++) {
    const sid = G.view(g).story?.id; if (sid === "first_seen_enemy") { hit = sid; break; }
    if (sid) { g.storyDone.add(sid); g.story = null; continue; }
    g.P.status.hunger = 0; g.P.status.pain = 0; g.P.clearedUntil = Infinity;
    const at = volkHere(); if (at) g.at = at;
    G.act(g, { id: "wait:60" });
  }
  check("회귀 뒤 — 처음 보는 원수 (그는 모르고 너는 안다)", hit === "first_seen_enemy");
  check("사냥꾼 판 — 지난 회차의 원수는 휴면으로", G.view(g).hunters.some((h) => !h.now && /휴면/.test(h.disposition)) || hit === "first_seen_enemy");
  if (hit) { G.act(g, { id: "story:name" }); check("이름을 먼저 부르면 — 의심이 깨어나고 앎의 흔적이 된다", (g.nem?.npc_volk?.obs || 0) >= 25 && (g.S.vars.echo_signs || 0) >= 2); } }
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
