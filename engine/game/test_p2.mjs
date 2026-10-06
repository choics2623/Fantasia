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

// 성향 (01 §1.3): 고른 것이 그 사람을 만든다. ±60이면 특성
{
  const g = fresh();
  for (let i = 0; i < 3; i++) { const a = G.options(g).find((o) => o.id === "attack:npc_kit"); if (!a || g.ended) break; G.act(g, { id: a.id }); }
  check("덤비면 자비가 줄고 용기가 는다", g.P.temper.자비 < 0 && g.P.temper.용기 > 0, JSON.stringify(g.P.temper));
  g.P.temper.자비 = -70;
  check("±60이면 특성 — 냉혹한", G.traits(g).includes("냉혹한"));
  const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
  check("성향은 영혼에 남는다", g2.P.temper.자비 === -70);
}
// 스트레스 이월 (14 §4.3)
{
  const g = fresh(); g.P.status.stress = 80; g.ended = { kind: "dead", why: "x", t: g.t, trace: { id: "water" } };
  const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
  check("스트레스 이월 = 30 + (80−30)×0.4 + 잔혹한 죽음 12 = 62", g2.P.status.stress === 62, g2.P.status.stress);
}
// 두려움이 손을 묶는다 / 피로가 판정을 깎는다
{
  const g = fresh(); g.P.status.fear = 3;
  check("두려움 3 — 덤벼드는 선택지가 사라진다", !ids(g).some((x) => x.startsWith("attack:")));
  g.P.status.fear = 0; g.P.status.fatigue = 80;
  const a = G.options(g).find((o) => o.id.startsWith("attack:"));
  check("지치면 근거에 '지쳤다'", G.odds(g, a).parts.some((p) => p.text.includes("지쳤다")));
}
// 들일 (14 §5.1): 첫날엔 낫 세 번과 키트, 그 뒤로는 몰아서
{
  const g = G.boot(C, G.newRun({ seed: 7 })); G.act(g, { id: "story_name", text: "하린|형" }); G.act(g, { id: "story:stay_in_line" });
  for (let i = 0; i < 30 && !ids(g).includes("work_day"); i++) G.act(g, { id: G.view(g).story ? ids(g)[0] : ids(g).includes("sleep") && G.view(g).night ? "sleep" : "wait:60" });
  check("아침이면 들일에 나갈 수 있다", ids(g).includes("work_day"), G.view(g).time);
  const r = G.act(g, { id: "work_day" });
  check("첫 들일 — 낫 세 번 (대본 장면)", G.view(g).story?.id === "znik_lash" && r.storyText.includes("세 번"));
  G.act(g, { id: "story:take_lash" });
  check("키트 대신 맞으면 키트의 마음이 움직이고 용기가 는다", (g.S.rel.get("npc_kit>player")?.like || 0) >= 10 && g.P.temper.용기 > 0);
  check("낫 신호를 배운다", g.P.knows.has("fact_gf_scythe_signal"));
  const h = fresh();
  for (let i = 0; i < 20 && !ids(h).includes("work_day"); i++) G.act(h, { id: ids(h).includes("sleep") && G.view(h).night ? "sleep" : "wait:60" });
  const f0 = h.P.status.fatigue; const w = G.act(h, { id: "work_day" });
  check("들일은 해 질 때까지 — 지치고, 할당을 채우거나 못 채운다", h.P.status.fatigue > f0 && w.notes.some((n) => /고랑|할당/.test(n)) && G.view(h).hm >= "18:00", `${G.view(h).hm} ${w.notes.join(" / ")}`);
}
// 이야기 모드: 마지막 아침으로 (03 §6)
{
  const { createSession } = await import("./session.mjs"); const { createProvider } = await import("../llm/provider.mjs");
  const S = createSession(C, createProvider({ kind: "mock" }), {});
  await S.newGame(7, {}, "story");
  await S.act({ id: "story_name", text: "하린|형" }); await S.act({ id: "story:stay_in_line" });
  let guard = 0;
  while (!G.morningMark(S.game) && guard++ < 30) { const o = G.options(S.game).map((x) => x.id); await S.act({ id: G.view(S.game).story ? o[0] : o.includes("sleep") && G.view(S.game).night ? "sleep" : "wait:60" }); }
  await S.act({ id: G.options(S.game).some((o) => o.id === "wait:60") ? "wait:60" : G.options(S.game)[0].id });
  const len = S.run.journal.length, mark = G.morningMark(S.game);
  const r = await S.rewind({});
  check("이야기 모드 — 마지막 아침으로 되돌린다", !r.error && S.run.journal.length === mark && mark < len, `${len} → ${S.run.journal.length}`);
  const S2 = createSession(C, createProvider({ kind: "mock" }), {});
  check("그림다크에서는 되돌릴 수 없다", !!(await S2.rewind({})).error);
}
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
