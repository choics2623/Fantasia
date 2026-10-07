// node engine/game/test_dark.mjs — 어둠의 메커니즘 (13 §3.2·§4): 심문, 공포 정치, 얼룩 재회, 애착 마모, 피에 무뎌짐
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const give = (g, gid) => g.L.give("player", { ...C.game.economy.goods[gid], id: `it_${gid}_t${Math.random().toString(36).slice(2, 7)}`, gid });

// 심문: 칼을 쥐고 단둘이 — 결과는 진실·거짓 자백·침묵·죽음
const tiers = {};
let truth = null, lie = null;
for (let s = 1; s < 40 && !(truth && lie); s++) {
  const g = G.boot(C, G.newRun({ seed: s, opening: false }));
  const k = give(g, "knife"); g.L.items.get(k.id).worn = true;
  g.at = "gf_hagen_shed"; g.convo = { npc: "npc_henrik", turns: 0, patience: 8, transcript: [] };
  g.W.override({ npc: "npc_henrik", from: g.t - 60, to: g.t + 600, kind: "at", at: "gf_hagen_shed", doing: "붙잡혀 있다" });
  if (!ids(g).includes("interrogate")) continue;
  const r = G.act(g, { id: "interrogate" }); tiers[r.tier] = (tiers[r.tier] || 0) + 1;
  if (r.reveal && !truth) truth = g;
  if (g.P.notebook.some((n) => n.startsWith("□")) && !lie) lie = g;
}
check("칼끝 앞에서 — 숨긴 것을 털어놓는 판이 있다 (진실)", !!truth, JSON.stringify(tiers));
check("고통을 멈추려고 아무 말이나 — 확신도 □의 거짓 자백", !!lie);
if (truth) { check("고문당한 사람은 기억한다 — 위험한 아이", truth.M.npc_henrik.memories.some((m) => m.kind === "threat")); check("자비가 내려간다", truth.P.temper.자비 < 0); }
{ let g = null;
  for (let s = 1; s < 40 && !g; s++) {
    const x = G.boot(C, G.newRun({ seed: s, opening: false })); x.P.tortures = 2;
    const k = give(x, "knife"); x.L.items.get(k.id).worn = true; x.at = "gf_hagen_shed"; x.convo = { npc: "npc_henrik", turns: 0, patience: 8, transcript: [] };
    x.W.override({ npc: "npc_henrik", from: x.t - 60, to: x.t + 600, kind: "at", at: "gf_hagen_shed", doing: "붙잡혀 있다" });
    if (ids(x).includes("interrogate")) { G.act(x, { id: "interrogate" }); g = x; }
  }
  check("세 번째 — 피에 무뎌짐 (특성, 회귀해도 남는다)", g?.P.bloodNumb === true);
  if (g && !g.ended) g.ended = { kind: "dead", why: "t", t: g.t };
  check("회귀해도 남는다", !!g && G.boot(C, { ...G.regressRun(g), opening: false }).P.bloodNumb === true); }
// 애착 마모: 얼룩이 셋을 넘으면 마음을 들이는 것도 반만
{ const g = G.boot(C, G.newRun({ seed: 7, opening: false })); g.run.carry.soul = { ...G.emptySoul(), ...(g.run.carry.soul || {}), stains: [{ kind: "inform", victim: "npc_thomas" }, { kind: "betray", victim: "npc_sigrid" }, { kind: "inform", victim: "npc_toby" }] };
  const h = G.boot(C, G.newRun({ seed: 7, opening: false }));
  for (const x of [g, h]) { x.convo = { npc: "npc_kit", turns: 0, patience: 9, transcript: [] }; const b = give(x, "bread"); x.P.status.hunger = 0; G.act(x, { id: `give:${b.id}` }); }
  check("얼룩 셋 — 같은 빵이 반만 닿는다", (g.P.bond?.npc_kit || 0) < (h.P.bond?.npc_kit || 0), `${g.P.bond?.npc_kit} < ${h.P.bond?.npc_kit}`); }
// 공포 정치 (영역): 본보기 — 질서를 사고 사기를 판다
{ const g = G.boot(C, { ...G.newRun({ seed: 7, opening: false }), lethal: true });
  g.P.knows.add("fact_gf_wolf_den"); g.S.rel.set("npc_sigrid>player", { like: 20, trust: 25 }); g.at = "hungry_hill__wolf_den"; g.P.settlement = "greyford";
  G.act(g, { id: "found_domain" }); G.act(g, { id: "story:accept" });
  const m0 = g.domain.morale, o0 = G.view(g).domain.order;
  let rep = false; for (let i = 0; i < 400 && !rep; i++) { const sid = G.view(g).story?.id; if (sid === "domain_report") { rep = true; break; } if (sid) { G.act(g, { id: ids(g)[0] }); continue; } G.act(g, { id: ids(g).includes("sleep") ? "sleep" : "wait:60" }); }
  if (rep) { G.act(g, { id: "story:terror_example" }); G.act(g, { id: "wait:60" }); for (let i = 0; i < 30; i++) { if (G.view(g).story) { G.act(g, { id: ids(g)[0] }); continue; } G.act(g, { id: ids(g).includes("sleep") ? "sleep" : "wait:60" }); } }
  check("본보기 — 질서가 오르고 사기가 떨어진다", rep && G.view(g).domain.order > o0 && g.domain.morale < m0 + 5, `질서 ${o0} → ${G.view(g).domain.order} · 사기 ${m0} → ${g.domain.morale}`); }
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
