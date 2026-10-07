// node engine/game/test_domain.mjs — 영역 (09): 세우기·열흘 보고·시설·드러남과 수색대·관리자·회귀
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const setup = () => {
  const g = G.boot(C, { ...G.newRun({ seed: 7, opening: false }), lethal: true });
  g.P.knows.add("fact_gf_wolf_den"); g.S.rel.set("npc_sigrid>player", { like: 20, trust: 25 });
  g.at = "hungry_hill__wolf_den"; g.P.settlement = "greyford";
  return g;
};
const g = setup();
check("늑대굴을 알고 시그리드가 믿으면 — 영역을 세울 수 있다", ids(g).includes("found_domain"), ids(g).slice(0, 6).join(","));
G.act(g, { id: "found_domain" });
check("시그리드의 계약", G.view(g).story?.id === "domain_found" && G.storyIntro(g).includes("머릿수 47"), G.storyIntro(g)?.slice(0, 80));
G.act(g, { id: "story:accept" });
let v = G.view(g).domain;
check("숨은 마을 (47명) — 관리자 시그리드", v?.stage === "숨은 마을" && v.pop === 47 && v.steward === "시그리드", JSON.stringify(v));
const food0 = v.foodDays;
let rep = null;
for (let i = 0; i < 400 && !rep; i++) { if (G.view(g).story) { rep = G.view(g).story.id; break; } G.act(g, { id: ids(g).includes("sleep") ? "sleep" : "wait:60" }); }
check("열흘 뒤 보고가 온다", rep === "domain_report", `${rep} ${G.view(g).time}`);
check("먹을 것이 준다", G.view(g).domain.foodDays < food0, `${food0} → ${G.view(g).domain.foodDays}`);
check("보고: 방침과 사업", ["story:close", "story:open", "story:build_gate", "story:delegate"].every((x) => ids(g).includes(x)), ids(g).join(","));
const foodB = g.domain.food;
G.act(g, { id: "story:build_gate" });
check("짓기에는 날과 먹을 것이 든다 — 짓는 중", G.view(g).domain.building?.name === "위장 입구" && g.domain.food < foodB, JSON.stringify(G.view(g).domain.building));
for (let i = 0; i < 8 * 24 && !g.domain.built.includes("hidden_gate"); i++) { if (G.view(g).story) { G.act(g, { id: ids(g)[0] }); continue; } G.act(g, { id: ids(g).includes("sleep") ? "sleep" : "wait:60" }); }
check("닷새 뒤 — 위장 입구가 시설이 된다", G.view(g).domain.built.includes("위장 입구"), G.view(g).time);
// 드러남이 임계값을 넘으면 수색대
const h = setup(); G.act(h, { id: "found_domain" }); G.act(h, { id: "story:accept" }); h.domain.expMod = 80;
let raid = null;
for (let i = 0; i < 300 && !raid; i++) { const s = G.view(h).story?.id; if (s === "domain_raid") { raid = s; break; } if (s) { G.act(h, { id: ids(h)[0] }); continue; } G.act(h, { id: ids(h).includes("sleep") ? "sleep" : "wait:60" }); }
check("드러남이 이틀 넘치면 수색대", raid === "domain_raid");
if (raid) { const p0 = G.view(h).domain.pop; G.act(h, { id: "story:scatter" }); check("흩어지면 넷 중 하나를 잃는다 — 세계 변수와 같이", G.view(h).domain.pop < p0 && h.S.vars.sigrid_group === G.view(h).domain.pop, `${p0} → ${G.view(h).domain.pop}`); }
// 관리자가 죽으면 후임 다툼 (09 §6.3) — 너를 믿는 사람 가운데 솜씨가 나은 쪽이 맡는다
{
  const d = setup(); G.act(d, { id: "found_domain" }); G.act(d, { id: "story:accept" });
  d.S.rel.set("npc_bram>player", { like: 20, trust: 30 });
  d.A.doEffect("kill npc_sigrid", d.t);
  let rep2 = null;
  for (let i = 0; i < 60 && !rep2; i++) { const s2 = G.view(d).story?.id; if (s2 === "domain_report") { rep2 = G.storyIntro(d); break; } if (s2) { G.act(d, { id: ids(d)[0] }); continue; } G.act(d, { id: ids(d).includes("sleep") ? "sleep" : "wait:60" }); }
  check("관리자가 죽으면 — 후임이 맡고 보고가 온다", d.domain.steward === "npc_bram" && /후임 다툼/.test(rep2 || ""), `${d.domain.steward} ${String(rep2).slice(0, 200)}`);
}
// 관리자를 바꾼다 — 야심 큰 사람에게 맡기고 신뢰를 잃으면 찬탈
{
  const m = setup(); G.act(m, { id: "found_domain" }); G.act(m, { id: "story:accept" });
  m.S.rel.set("npc_martha>player", { like: 10, trust: 25 });
  let opened = false;
  for (let i = 0; i < 400 && !opened; i++) { const s2 = G.view(m).story?.id; if (s2 === "domain_report") { opened = true; break; } if (s2) { G.act(m, { id: ids(m)[0] }); continue; } G.act(m, { id: ids(m).includes("sleep") ? "sleep" : "wait:60" }); }
  check("보고에서 관리자를 바꿀 수 있다 (마르타)", opened && ids(m).includes("story:appoint_martha"), ids(m).join(","));
  if (ids(m).includes("story:appoint_martha")) {
    G.act(m, { id: "story:appoint_martha" });
    check("마르타가 관리자 — 질서가 오른다 (솜씨 75)", m.domain.steward === "npc_martha");
    m.S.rel.set("npc_martha>player", { like: -10, trust: -10 });
    let lost = false;
    for (let i = 0; i < 72 && !lost; i++) { if (G.view(m).story) { G.act(m, { id: ids(m)[0] }); continue; } G.act(m, { id: ids(m).includes("sleep") ? "sleep" : "wait:60" }); lost = !!m.domain.lost; }
    check("신뢰를 잃은 야심가는 영역을 제 것으로 삼는다 (찬탈)", lost && m.domain.usurped);
  }
}
// 관리자가 만드는 이야기 (09 §6.3): 생존·신중한 관리자는 위기 때 — 믿음이 얕으면 너를 판다
{
  const d = setup(); G.act(d, { id: "found_domain" }); G.act(d, { id: "story:accept" });
  d.S.rel.set("npc_sigrid>player", { like: 0, trust: -40 }); d.domain.expMod = 60;
  for (let i = 0; i < 24 * 15 && !(d.S.wanted.player?.reasons || []).some((r) => /밀고/.test(r)) && !d.ended; i++) { if (G.view(d).story) { G.act(d, { id: ids(d)[0] }); continue; } d.P.status.hunger = 0; d.domain.expMod = 60; G.act(d, { id: ids(d).includes("sleep") ? "sleep" : "wait:60" }); }
  check("생존·신중함의 관리자 — 위기에 믿음이 얕으면 너를 밀고한다", (d.S.wanted.player?.reasons || []).some((r) => /밀고/.test(r)) || d.ended?.kind === "captured", (d.S.wanted.player?.reasons || []).join("/"));
}
// 회귀: 관리자는 너를 잊는다. 너는 그녀를 안다
const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
check("회귀하면 영역은 없다", !G.view(g2).domain);
const sig = G.view(g2).people_known.find((p) => p.id === "npc_sigrid");
check("관리자의 숨은 수치를 관찰로 안다", !!sig?.facts?.some((f) => f.text.includes("야심")), JSON.stringify(sig?.facts));
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
