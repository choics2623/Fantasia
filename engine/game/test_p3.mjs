// node engine/game/test_p3.mjs — 큰 시스템의 가장 작은 판: 숨긴 곳·작전·연애·얼룩·진명·시대의 끝
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const fresh = (extra = {}) => G.boot(C, { ...G.newRun({ seed: 7, opening: false }), ...extra });

// 숨긴 곳: 늑대굴을 아는 밤, 키트를 데리고
{
  const g = fresh(); g.P.knows.add("fact_gf_wolf_den");
  G.act(g, { id: "go:gf_river_huts" });
  for (let i = 0; i < 8 && !ids(g).includes("hide_kit"); i++) G.act(g, { id: "wait:60" });
  check("늑대굴을 알면, 밤에 키트를 숨길 수 있다", ids(g).includes("hide_kit"), G.view(g).time);
  if (ids(g).includes("hide_kit")) {
    G.act(g, { id: "hide_kit" });
    const H = G.view(g).hide;
    check("숨긴 곳 — 머릿수·먹을 것·드러남", H && H.people.includes("키트") && H.food === 2 && /모른다/.test(H.exposure), JSON.stringify(H));
    check("키트는 명단에서 빠진다 (호송에 없다)", g.S.vars.kit_on_list === false && g.S.vars.kit_hidden === true);
    for (let i = 0; i < 12; i++) G.act(g, { id: ids(g).includes("routine_day") ? "routine_day" : "wait:60" });
    check("먹을 것이 떨어지고 드러남이 쌓이면 — 찾아온다", G.view(g).hide.lost === true || g.hide.exposure > 0.6, JSON.stringify(G.view(g).hide));
  }
}
// 작전 카드: 정보·접근·수단 — 갖춘 만큼
{
  const g = fresh();
  check("장부의 자리를 모르면 작전도 없다", G.view(g).ops.length === 0);
  g.P.knows.add("fact_gf_henrik_skims_baron");
  const op = G.view(g).ops.find((o) => o.id === "henrik_ledger");
  check("작전 카드 — 헨릭의 장부, 준비 항목", op && op.ready.length === 6 && op.ready[0].ok && !op.ready[3].ok, JSON.stringify(op?.ready));
}
// 연애: 가까워지면 고백의 장면이 열린다
{
  const g = fresh(); g.S.rel.set("npc_sara>player", { like: 45, trust: 35 }); g.P.talks = { npc_sara: 4 };
  check("호감40·신뢰30·함께한 일 셋 — '가까운' 단계", G.romanceStage(g, "npc_sara") === 2);
  g.S.vars.sara_lover = true; g.S.vars.sara_bound = true;
  const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
  check("가장 깊었던 단계는 영혼에 남는다", g2.run.carry.soul.romance.npc_sara === 4);
}
// 얼룩: 판 사람을 다시 보면
{
  const g = fresh(); g.deeds.push({ id: "dz", kind: "inform", victim: "npc_bram", at: "gf_rooster", placeName: "x", t: g.t });
  const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
  const s0 = g2.P.status.stress;
  let ink = null;
  for (let i = 0; i < 3 && !ink; i++) { const r = G.act(g2, { id: "wait:60" }); ink = (r.feed || []).find((f) => f.kind === "ink" && f.text.includes("팔았었다")); }
  check("지난 회차에 판 사람 — ┊ 그리고 짐이 무거워진다", !!ink && g2.P.status.stress > s0, ink?.text);
  check("회차 기록에 '손에 남은 것'", G.recordCard(G.loopRecord(g)).some((x) => x.includes("손에 남은 것")));
}
// 진명 — 불
{
  const g = fresh(); g.S.vars.true_name_fire = true;
  for (let i = 0; i < 6 && !ids(g).includes("true_name:불"); i++) G.act(g, { id: "wait:60" });
  check("불의 이름을 아는 밤 — 부를 수 있다", ids(g).includes("true_name:불"));
  const p0 = g.P.status.pain;
  const r = G.act(g, { id: "true_name:불" });
  check("몸이 값을 치른다 · 한 시간 빛이 된다", g.P.status.pain > p0 && G.view(g).player && r.notes.length >= 1);
  const seen = r.notes.some((n) => n.includes("보았다"));
  check("본 사람이 있으면 마녀 — 수배", seen === !!g.S.vars.witch_seen);
  const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
  check("진명은 영혼에 남는다", g2.run.carry.soul.trueNames.includes("불"));
}
// 시대의 끝: 회귀를 놓으면, 다음 죽음은 돌아오지 않는다
{
  const g = fresh(); g.run.release = true; g.ended = { kind: "dead", why: "x", t: g.t, trace: { id: "blade" } };
  const run2 = G.regressRun(g);
  check("놓은 뒤의 회차는 마지막", run2.carry.final === true);
  const g2 = G.boot(C, { ...run2, opening: false }); g2.ended = { kind: "dead", why: "y", t: g2.t, trace: { id: "blade" } };
  check("마지막 회차의 죽음 — 돌아오지 않는다", G.regressRun(g2) === null);
  const ep = G.view(g2).ended.epilogue;
  check("에필로그 세 줄", ep?.length === 3, ep?.join(" / "));
}
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
