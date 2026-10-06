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

// 싸움의 합: 한 번에 끝나지 않으면 — 다시 달려든다 / 막는다 / 달아난다 / 매달린다 / 무릎 꿇는다
{
  let found = null;
  for (let seed = 1; seed < 60 && !found; seed++) {
    const g = G.boot(C, G.newRun({ seed, opening: false }));
    const a = G.options(g).find((o) => o.id === "attack:npc_znik"); if (!a) continue;
    G.act(g, { id: a.id });
    if (g.fight) found = g;
  }
  check("부분 성공이면 싸움이 이어진다", !!found);
  if (found) {
    check("합마다 다섯 갈래", ["fight_strike", "fight_guard", "fight_flee", "fight_plead", "fight_yield"].every((x) => ids(found).includes(x)));
    G.act(found, { id: "fight_guard" });
    if (found.fight) { const o = G.options(found).find((x) => x.id === "fight_strike"); check("막아 낸 뒤엔 틈이 보인다 (또는 맞았다)", G.odds(found, o).parts.some((p) => p.text.includes("틈") || p.text.includes("맞았다"))); }
    let guard = 0; while (found.fight && guard++ < 10) G.act(found, { id: "fight_strike" });
    check("싸움은 끝난다 — 쓰러뜨리거나, 쓰러지거나, 물러나거나", !found.fight, `${found.ended?.why || ""} ${found.deeds.map((d) => d.kind).join(",")}`);
  }
}
// 기억대로 보낸다 (03 §3.5): 지난 회차의 이 하루를 다시 — 어긋나면 멈춘다
{
  const g = fresh();
  G.act(g, { id: "go:gf_well_square" }); G.act(g, { id: "wait:60" }); G.act(g, { id: "go:gf_rooster" }); G.act(g, { id: "wait:60" });
  const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
  check("두 번째 회차엔 '기억대로 보낸다'", ids(g2).includes("recall"));
  const r = G.act(g2, { id: "recall" });
  check("지난 회차처럼 걸음을 보낸다", r.notes.some((n) => /걸음을 보냈다/.test(n)), r.notes.join(" / "));
  check("기억대로 보낸 하루도 재생하면 같다", JSON.stringify(G.view(G.boot(C, JSON.parse(JSON.stringify(g2.run))))) === JSON.stringify(G.view(g2)));
}
// 업적 → 재능 점수 → 회귀 각성 (03 §4.2, 06 §8.3)
{
  const g = fresh(); g.S.vars.fayne_saved = true; g.S.vars.den_saved = true;
  const run2 = G.regressRun(g);
  check("업적이 잔향에 새겨진다 — 재능 점수", run2.carry.soul.tp >= 4 && run2.carry.soul.achievements.includes("fayne_saved"), `tp ${run2.carry.soul.tp}`);
  run2.carry.trueName = "하린"; run2.carry.talent = "shadow";
  const n2 = G.boot(C, run2);
  for (let i = 0; i < 40 && !G.view(n2).story?.id?.startsWith("count"); i++) { const o = ids(n2); G.act(n2, { id: G.view(n2).story ? (o.includes("story:stay_in_line") ? "story:stay_in_line" : o[0]) : n2.at !== "gf_river_huts" && o.includes("go:gf_river_huts") ? "go:gf_river_huts" : o.includes("sleep") ? "sleep" : "wait:60" }); }
  check("첫 잠자리 — 깨어날 재능을 고른다", ids(n2).includes("story:wake_voice") && !ids(n2).includes("story:wake_shadow"), ids(n2).join(","));
  const v0 = G.skill(n2, "화술");
  G.act(n2, { id: "story:wake_voice" });
  check("목소리가 깨어난다 (화술 +6)", G.skill(n2, "화술") === v0 + 6 && G.view(n2).talents.includes("voice"));
  const n3 = G.boot(C, { ...G.regressRun(n2), opening: false });
  check("깨어난 재능은 영혼에 남는다", G.view(n3).talents.includes("voice") && G.view(n3).talents.includes("shadow"));
}
// 앎의 흔적: 기억을 쓰면 징후가 쌓이고 — 엘사가 먼저 다가온다
{
  const run = G.newRun({ seed: 7 }); run.loop = 3; run.carry.trueName = "하린";
  const g = G.boot(C, run); G.act(g, { id: "story:next" });
  G.act(g, { id: "story:mem_sara_first" });
  check("◈를 쓰면 앎의 흔적이 쌓인다", (g.S.vars.echo_signs || 0) >= 1);
  const st = C.game.storylets.find((x) => x.id === "elsa_two_days");
  check("엘사의 장면은 회차가 쌓일수록 이르다 (3회차 → 2일)", st.trigger.window.from_loop["3"].startsWith("312-09-02"));
}

// C등급 사람들 · 이름 붙이기 · 애착과 밤의 의식 · 두 겹의 날 · 고요한 날의 소품
{
  check("토비·알도·떠돌이 개 (C등급)", ["npc_toby", "npc_aldo", "npc_stray_dog"].every((n) => C.cards[n]?.tier === "C"));
  const g = fresh();
  let dog = null;
  for (let i = 0; i < 30 && !dog; i++) { if (g.at !== "gf_willow_bank" && ids(g).includes("go:gf_willow_bank")) G.act(g, { id: "go:gf_willow_bank" }); dog = G.options(g).find((o) => o.id === "name:npc_stray_dog"); if (!dog) G.act(g, { id: ids(g).includes("wait:60") ? "wait:60" : ids(g)[0] }); }
  check("떠돌이 개에게 이름을 붙일 수 있다", !!dog && dog.input === "npc_name", G.view(g).time);
  if (dog) {
    G.act(g, { id: dog.id, text: "재" });
    check("이름을 붙이면 그 이름으로 보인다", G.displayName(g, "npc_stray_dog") === "재");
    const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
    check("회귀하면 그 이름은 너만 기억한다", G.displayName(g2, "npc_stray_dog") !== "재" && g2.run.carry.soul.names.npc_stray_dog === "재");
    check("애착은 회귀를 건넌다 (주는 쪽만)", (g2.run.carry.soul.bonds.npc_stray_dog || 0) >= 7);
  }
  // 키트 대신 맞은 채찍은 매듭이 된다 — 그리고 밤의 의식
  const h = G.boot(C, G.newRun({ seed: 7 })); G.act(h, { id: "story_name", text: "하린|형" }); G.act(h, { id: "story:stay_in_line" });
  G.act(h, { id: "go:gf_river_huts" });
  let rit = null;
  for (let i = 0; i < 8 && !rit; i++) { if (G.view(h).story) { G.act(h, { id: ids(h)[0] }); continue; } rit = ids(h).find((x) => x === "ritual:song"); if (!rit) G.act(h, { id: "wait:60" }); }
  check("밤, 움막, 키트 — 강물 노래", !!rit, G.view(h).time);
  if (rit) { const s0 = h.P.status.stress; G.act(h, { id: rit }); check("의식은 매듭을 묶고 짐을 덜어 준다", (h.P.bond?.npc_kit || 0) >= 3 && h.P.status.stress < s0); check("하룻밤에 한 번", !ids(h).includes("ritual:song")); }
  // 두 겹의 날: 지난 회차의 같은 날
  const d = fresh(); G.act(d, { id: "go:gf_well_square" }); G.act(d, { id: "wait:60" }); G.act(d, { id: "routine_day" });
  const d2 = G.boot(C, { ...G.regressRun(d), opening: false });
  check("두 겹의 날 — 지난 회차의 이 날이 있다", !!G.view(d2).twoDays?.then, JSON.stringify(G.view(d2).twoDays));
}

// 고요한 날의 소품 (18 §3.10): 긴장이 낮은 날, 그 자리에 있으면
{
  const g = G.boot(C, { ...G.newRun({ seed: 7, opening: false }), lethal: true });
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) { if (G.view(g).story) { hit = G.view(g).story.id; break; } if (g.at !== "gf_graveyard" && ids(g).includes("go:gf_graveyard")) G.act(g, { id: "go:gf_graveyard" }); else G.act(g, { id: ids(g).includes("wait:60") ? "wait:60" : ids(g)[0] }); }
  check("번호 묘지에 머물면 고요한 날의 소품", hit === "vg_graveyard_numbers", hit);
}
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
