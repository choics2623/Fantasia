// node engine/game/test_ops.mjs — 작전 여섯 단계 (11 §3): 정보·접근·수단 → 실행 → 탈출 → 은폐·누명
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const give = (g, gid) => g.L.give("player", { ...C.game.economy.goods[gid], id: `it_${gid}_t${Math.random()}`, gid });

// 헨릭의 장부: 밤, 징세소, 헨릭이 없을 때
function ready(seed) {
  const g = G.boot(C, { ...G.newRun({ seed, opening: false }), lethal: true });
  g.P.knows.add("fact_gf_henrik_skims_baron"); g.P.knows.add("fact_gf_bram_pays_henrik");
  give(g, "candle"); give(g, "hook"); g.P.been.add("gf_willow_bank"); g.P.been.add("gf_tollhouse");
  for (let i = 0; i < 300 && !ids(g).includes("op_start:henrik_ledger") && !g.ended; i++) {
    if (G.view(g).story) { G.act(g, { id: ids(g)[0] }); continue; }
    const hm = G.view(g).hm;
    if (hm >= "20:40" && hm < "22:00" && g.at !== "gf_tollhouse" && ids(g).includes("go:gf_tollhouse")) { G.act(g, { id: "go:gf_tollhouse" }); continue; }
    G.act(g, { id: hm >= "20:40" && hm < "22:00" ? "wait:60" : ids(g).includes("routine_day") && hm < "17:00" ? "wait:60" : "wait:60" });
  }
  return g;
}
const g = ready(7);
check("밤, 징세소, 헨릭이 없으면 — 작전이 열린다", ids(g).includes("op_start:henrik_ledger"), G.view(g).time);
G.act(g, { id: "op_start:henrik_ledger" });
const ex = G.options(g).find((o) => o.id === "op_exec");
const od = G.odds(g, ex);
check("준비 하나에 +10 — 근거에 보인다", od.parts.filter((p) => p.sign === "▲").length === 6, od.parts.map((p) => p.sign + p.text).join(" / "));
check("준비를 다 갖추면 해볼 만하다", od.P >= 0.55, `${Math.round(od.P * 100)}%`);
const bare = G.boot(C, { ...G.newRun({ seed: 7, opening: false }), lethal: true }); bare.P.knows.add("fact_gf_henrik_skims_baron");
const op0 = G.view(bare).ops.find((o) => o.id === "henrik_ledger");
check("보안 2 — 정보만 있으면 열린다 (준비 없이 들이받기도 가능)", op0.missing.length === 0);
const ks = G.boot(C, G.newRun({ seed: 7, opening: false })); ks.P.knows.add("fact_gf_keep_strongbox");
check("보안 3 (성채 금고) — 접근이 없으면 열리지 않는다", G.view(ks).ops.find((o) => o.id === "keep_strongbox").missing.includes("접근"));
// 끝까지: 실행 → 탈출 → 누명
let done = null;
for (let seed = 1; seed < 30 && !done; seed++) {
  const x = ready(seed); if (!ids(x).includes("op_start:henrik_ledger")) continue;
  G.act(x, { id: "op_start:henrik_ledger" }); G.act(x, { id: "op_exec" });
  if (!x.op || x.op.phase !== "escape") continue;
  const fl = ids(x).find((i) => i === "op_flee:route") || ids(x)[0]; G.act(x, { id: fl });
  if (x.op?.phase === "cover") { G.act(x, { id: "op_cover:frame" }); done = x; }
}
check("실행 → 탈출 → 은폐: 끝까지 간 판이 있다", !!done);
if (done) {
  check("장부를 손에 넣었다", G.view(done).player.items.some((i) => i.name.includes("장부")));
  check("누명 — 토마스가 대신 채찍 기둥에, 얼룩이 된다", done.S.vars.framed_thomas === true && done.deeds.some((d) => d.kind === "inform" && d.victim === "npc_thomas"));
  check("작전은 한 번", !G.view(done).ops.find((o) => o.id === "henrik_ledger").missing.length && G.view(done).ops.find((o) => o.id === "henrik_ledger").done);
}
// 즈닉: 아무도 모르게 해냈으면 — 시체는 초소에 남고, 누가 했는지는 아직 아무도 모른다 (작전의 deed는 '본 사람 없음')
{
  let z = null;
  for (let seed = 1; seed < 40 && !z; seed++) {
    const x = G.boot(C, { ...G.newRun({ seed, opening: false }), lethal: true });
    give(x, "knife"); x.P.been.add("gf_whip_square"); x.P.been.add("gf_river_huts");
    x.at = "gf_whip_square"; x.t = Math.floor(x.t / 1440) * 1440 + 1440 + 2 * 60 + 40;
    if (!ids(x).includes("op_start:znik")) continue;
    G.act(x, { id: "op_start:znik" }); G.act(x, { id: "op_exec" });
    if (x.S.dead.has("npc_znik") && x.op && !x.op.caught) z = x;
  }
  check("즈닉 작전 — 해냈다", !!z);
  if (z) {
    check("세계 안에서 죽었다 — 시체가 초소에 남는다", z.L.bodies.some((b) => b.npc === "npc_znik"));
    const d = G.reputation(z);
    check("본 사람이 없으면 평판에 '셋째'라는 이름이 아직 붙지 않는다", !d.news.some((n) => n.identified), JSON.stringify(d.news.map((n) => n.text || n.kind)).slice(0, 160));
  }
}
// 지난 회차의 기억뿐인 정보는 절반
const m = G.boot(C, { ...G.newRun({ seed: 7, opening: false }), lethal: true }); m.run.carry.future.push("fact_gf_henrik_skims_baron");
for (let i = 0; i < 300 && !ids(m).includes("op_start:henrik_ledger") && !m.ended; i++) { if (G.view(m).story) { G.act(m, { id: ids(m)[0] }); continue; } const hm = G.view(m).hm; if (hm >= "20:40" && hm < "22:00" && m.at !== "gf_tollhouse" && ids(m).includes("go:gf_tollhouse")) { G.act(m, { id: "go:gf_tollhouse" }); continue; } G.act(m, { id: "wait:60" }); }
if (ids(m).includes("op_start:henrik_ledger")) { G.act(m, { id: "op_start:henrik_ledger" }); check("기억뿐인 정보는 +5", G.odds(m, G.options(m).find((o) => o.id === "op_exec")).parts.some((p) => p.text.includes("기억뿐"))); }
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
