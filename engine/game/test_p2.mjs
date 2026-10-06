// node engine/game/test_p2.mjs — P1 위에 쌓은 것들: 약속·낱말·좋은 행적·내 소문·지도 기억 …
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import { turnPrompt } from "./prompts.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const fresh = () => G.boot(C, G.newRun({ seed: 7, opening: false }));

// 약속: 안 가면 그 사람은 기다렸다 (21 §6.1)
{
  const g = fresh();
  G.act(g, { id: "talk:npc_bram" }); G.act(g, { id: "leave" });
  const r0 = g.S.rel.get("npc_bram>player")?.trust || 0;
  G.recordMemories(g, "npc_bram", [{ kind: "promise", text: "내일 우물에서", salience: 3, promise: { from: g.t + 60, to: g.t + 120, place: "gf_well_square", what: "우물에서 만나기로" } }]);
  let echo = null;
  for (let i = 0; i < 5 && !echo; i++) { const r = G.act(g, { id: "wait:60" }); echo = (r.feed || []).find((f) => f.kind === "echo"); }
  check("약속을 어기면 — 그 사람은 기다렸다", !!echo && echo.text.includes("기다렸다"), echo?.text);
  check("신뢰가 떨어진다", (g.S.rel.get("npc_bram>player")?.trust || 0) < r0);
}
// 낱말: 모르는 말은 소리로만, 배운 말은 회귀해도 풀린 채로 (19 §4)
{
  const g = fresh();
  check("처음엔 '하르벡'의 뜻을 모른다", G.view(g).lexicon.find((w) => w.word === "하르벡").meaning === null);
  g.P.knows.add("fact_gf_godric_debt");
  check("영지의 빚을 알면 '하르벡 = 담보'", G.view(g).lexicon.find((w) => w.word === "하르벡").meaning?.startsWith("담보"));
  const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
  check("배운 낱말은 회귀해도 남는다", G.view(g2).lexicon.find((w) => w.word === "하르벡").meaning?.startsWith("담보"));
  check("서술 자료: 아는 말과 모르는 말", turnPrompt(g, null, G.options(g), {}).includes("주인공이 아는 말: 하르벡=담보"));
}
// 상태가 문장을 바꾼다 (19 §3)
{
  const g = fresh(); g.P.status.hunger = 3; g.P.status.pain = 70;
  const tp = turnPrompt(g, null, G.options(g), {});
  check("굶주림·통증이 서술의 결로", tp.includes("[몸의 상태") && tp.includes("굶주림") && tp.includes("통증"));
}
// 좋은 일도 행적이다 — 본 사람이 있으면 퍼진다 (10 §2.2)
{
  const g = fresh();
  g.L.give("player", { ...C.game.economy.goods.bread, id: "it_bread_p2", gid: "bread" });
  // (기록에 없는 물건이므로 재생은 검사하지 않는다)
  G.act(g, { id: "talk:npc_kit" }); G.act(g, { id: "give:it_bread_p2" }); G.act(g, { id: "leave" });
  for (let i = 0; i < 16; i++) G.act(g, { id: G.view(g).story ? ids(g)[0] : "wait:60" });   // 마을에 퍼지는 데 반나절
  const rep = G.reputation(g);
  check("굶주린 아이에게 빵을 나누면 행적이 된다", g.deeds.some((d) => d.kind === "share_food"));
  check("본 사람이 있으니 마을에 알려진다", rep.news.some((n) => n.label.includes("빵")), JSON.stringify(rep.news.map((n) => n.label)));
}
// 내 소문이 돌아온다 — 누군가에게 들은 내 일
{
  let heard = null;
  for (let seed = 1; seed < 25 && !heard; seed++) {
    const g = G.boot(C, G.newRun({ seed, opening: false }));
    g.deeds.push({ id: "dx", kind: "rescue", victim: null, at: "gf_rooster", placeName: "배급 막사", t: g.t - 2000, seenAt: g.t - 2000 });
    G.act(g, { id: "talk:npc_bram" });
    for (let k = 0; k < 4 && ids(g).includes("small_talk") && !heard; k++) { const r = G.act(g, { id: "small_talk" }); if (r.rumor?.includes("셋째") || r.rumor?.includes("배급 막사")) heard = r.rumor; }
  }
  check("잡담에서 내 소문을 듣는다", !!heard, heard);
}
// 지도 기억: 가 본 고장은 회귀해도 지도에 남는다 (07 §3)
{
  const g = fresh(); g.P.visited = ["crow_gate"];
  const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
  const node = C.bundle.settlements.crow_gate?.node;
  check("가 본 고장은 '기억하는 곳'으로", G.mapView(g2).world.nodes.find((n) => n.id === node)?.remembered === true, node);
}
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
