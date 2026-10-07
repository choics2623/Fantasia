// node engine/game/test_rising.mjs — 봉기 (SCENARIOS §3.4)와 계승 전쟁의 칙허 (09 §3)
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const setup = (seed) => {
  const g = G.boot(C, { ...G.newRun({ seed, opening: false }), lethal: false });
  g.P.settlement = "greyford"; g.S.vars.bran_spears = true; g.S.vars.gunnar_trains = true;
  g.S.rel.set("npc_owen_raven>player", { like: 30, trust: 40 }); g.S.rel.set("npc_martha>player", { like: 30, trust: 50 });
  g.at = "gf_whip_square"; g.t = Math.floor(g.t / 1440) * 1440 + 23 * 60;
  return g;
};
const g = setup(3);
const ready = G.risingReady(g).filter((x) => x.ok).map((x) => x.label);
check("준비 지표 넷", ready.length === 4, ready.join(","));
check("밤의 채찍 기둥 광장 — 봉기를 부를 수 있다", ids(g).includes("rising"), ids(g).slice(0, 8).join(","));
const g0 = setup(3); g0.S.vars.gunnar_trains = false; g0.S.vars.bran_spears = false;
check("지표가 모자라면 부를 수 없다", !ids(g0).includes("rising"));
G.act(g, { id: "rising" });
check("봉기 장면", G.view(g).story?.id === "rising_call" && G.storyIntro(g).includes("브란의 창날"), G.storyIntro(g)?.slice(0, 120));
const od = G.optionOdds(g, G.options(g).find((o) => o.id === "story:rise"));
check("준비가 확률을 올린다", JSON.stringify(od || {}).includes("준비된 것 4가지"), JSON.stringify(od)?.slice(0, 200));
// 결과를 강제로 확인한다 — 성공/실패 두 갈래
const ok = setup(3); ok.S.vars.bran_spears = true; G.act(ok, { id: "rising" });
let free = false, failed = false;
for (let s = 1; s < 40 && !(free && failed); s++) {
  const h = setup(s); G.act(h, { id: "rising" }); G.act(h, { id: "story:rise" });
  if (h.S.vars.greyford_free && !free) {
    free = true; const d = G.view(h).domain;
    check("성공 — 해방구가 된다 (숨길 수 없는 땅)", d?.stage === "해방구" && d.exposure === 100, JSON.stringify(d)?.slice(0, 160));
    check("즈닉이 죽었다", h.S.dead.has("npc_znik"));
    let siege = null;
    for (let i = 0; i < 2000 && !siege && !h.ended; i++) { h.P.status.hunger = 0; h.P.status.pain = 0; const st = G.view(h).story?.id; if (st === "rising_siege") { siege = st; break; } if (st) { G.act(h, { id: ids(h).find((x) => x.startsWith("story:")) }); continue; } G.act(h, { id: ids(h).includes("sleep") ? "sleep" : "wait:60" }); }
    check("서른 날 안에 진압군이 온다", siege === "rising_siege", G.view(h).time);
  }
  if (h.S.vars.rising_failed && !failed) {
    failed = true;
    check("실패 — 두 번째 붉은 길: 스트레스와 처형", h.S.vars.red_road && (h.redRoad?.length || 0) >= 1, JSON.stringify(h.redRoad));
    const names = h.redRoad;
    if (!h.ended) h.ended = { kind: "dead", why: "test", t: h.t };
    const h2 = G.boot(C, { ...G.regressRun(h), opening: false });
    check("회귀해도 이름을 기억한다", (h2.run.carry.soul.redRoad || []).length === names.length);
  }
}
check("두 갈래 모두 나왔다", free && failed, `${free} ${failed}`);
// 계승: 용황이 죽고 카스파르가 경고를 받으면 살아남아 즉위한다
const k = G.boot(C, { ...G.newRun({ seed: 5, opening: false }), lethal: false });
k.P.knows.add("fact_dk_aurax_kaspar_contract");
k.S.vars.kaspar_warned = true; k.S.vars.faction_kaspar = 50;
k.S.rel.set("npc_kaspar>player", { like: 30, trust: 40 });
const days = 220; for (let i = 0; i < days * 24 && !k.S.vars.kaspar_throne && !k.ended; i++) { k.P.status.hunger = 0; k.P.status.pain = 0; if (G.view(k).story) { G.act(k, { id: ids(k).find((x) => x.startsWith("story:")) }); continue; } G.act(k, { id: ids(k).includes("sleep") ? "sleep" : "wait:60" }); }
check("용황이 죽는다", !!k.S.vars.varskar_dead, G.view(k).time);
check("경고받은 카스파르는 살아 즉위한다", !!k.S.vars.kaspar_throne && !k.S.dead.has("npc_kaspar"), `${k.S.vars.kaspar_throne} ${G.view(k).time}`);
const u = G.boot(C, { ...G.newRun({ seed: 5, opening: false }), lethal: false });
for (let i = 0; i < days * 24 && !u.S.dead.has("npc_kaspar") && !u.ended; i++) { u.P.status.hunger = 0; u.P.status.pain = 0; if (G.view(u).story) { G.act(u, { id: ids(u).find((x) => x.startsWith("story:")) }); continue; } G.act(u, { id: ids(u).includes("sleep") ? "sleep" : "wait:60" }); }
check("경고가 없으면 볼크가 카스파르를 죽인다", u.S.dead.has("npc_kaspar"), G.view(u).time);
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
