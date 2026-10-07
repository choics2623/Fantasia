// node engine/game/test_family.mjs — 가족 (12 §6~8, 20 §6.1)과 진명의 여러 낱말 (GAME_DESIGN §5)
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const fresh = () => G.boot(C, { ...G.newRun({ seed: 7, opening: false }), lethal: true });
const waitFor = (g, pred, n = 400) => { for (let i = 0; i < n && !pred() && !g.ended; i++) { if (G.view(g).story && !pred()) { G.act(g, { id: ids(g)[0] }); continue; } G.act(g, { id: ids(g).includes("sleep") && G.view(g).night ? "sleep" : "wait:60" }); } return pred(); };

// 가문: 움막에서, 정을 붙인 사람이 있으면
{
  const g = fresh(); g.P.bond = { npc_kit: 20, npc_gerda: 12 };
  G.act(g, { id: "go:gf_river_huts" });
  const o = G.options(g).find((x) => x.id === "found_house");
  check("가문을 세울 수 있다 (이름과 가훈)", o?.input === "house");
  G.act(g, { id: "found_house", text: "재의집|우리는 서로의 이름을 안다" });
  const F = G.view(g).family;
  check("가문 — 이름·가훈·가문원", F.name === "재의집" && F.members.includes("키트") && F.members.includes("게르다"), JSON.stringify(F));
  const g2 = G.boot(C, { ...G.regressRun(g), opening: false }); g2.P.bond = { npc_kit: 20 };
  G.act(g2, { id: "go:gf_river_huts" });
  const o2 = G.options(g2).find((x) => x.id === "found_house");
  check("회귀하면 가문은 없다 — 이름과 가훈은 네가 기억한다", !G.view(g2).family && o2?.label.includes("재의집") && !o2.input);
  G.act(g2, { id: "found_house" });
  check("다시 세우면 처음 듣는 사람들이 따라 말한다", G.view(g2).family.motto === "우리는 서로의 이름을 안다");
}
// 입양: 페인
{
  const g = fresh(); g.S.rel.set("npc_fayne>player", { like: 30, trust: 35 }); g.P.bond = { npc_fayne: 12 };
  waitFor(g, () => ids(g).includes("adopt:npc_fayne"), 60);
  check("페인을 식구로 (신뢰 30·매듭)", ids(g).includes("adopt:npc_fayne"), G.view(g).time);
  if (ids(g).includes("adopt:npc_fayne")) { G.act(g, { id: "adopt:npc_fayne" }); check("식구가 된다", G.view(g).family.members.includes("페인")); }
}
// 끈혼례 → 임신 → 출산 (긴 회차)
{
  const g = fresh(); g.S.vars.sara_lover = true; g.S.vars.sara_bound = true;
  g.family = { members: ["npc_sara"], children: [], bound: g.t - 30 * 1440 };
  g.family.pregnant = { since: g.t - 269 * 1440, due: g.t + 600 };
  const born = waitFor(g, () => G.view(g).story?.id === "family_birth", 60);
  check("아홉 달 — 출산", born);
  if (born) {
    check("아이의 이름을 묻는다", G.options(g)[0].input === "child_name");
    G.act(g, { id: "story_childname", text: "새벽" });
    check("아이가 태어난다 — 이 회차에만 있다", G.view(g).family.children[0]?.name === "새벽");
    // 양육 (12 §7.2): 자란다 · 보고 배운다 · 가르친다 · 다섯 살의 질문
    const c = g.family.children[0];
    check("아이는 저만의 성향과 고집을 갖고 태어난다", Object.keys(c.temper).length === 6 && !!c.own);
    c.born = g.t - (5 * 365 - 1) * 1440; g.P.temper.자비 = 80; const before = c.temper.자비;
    g.P.skills.손재주 = 60; g.at = "gf_river_huts";
    for (let i = 0; i < 60 && G.view(g).story?.id !== "child_question"; i++) { if (G.view(g).story) { G.act(g, { id: G.options(g)[0].id }); continue; } G.act(g, { id: G.options(g).some((o) => o.id === "sleep") ? "sleep" : "wait:60" }); }
    check("다섯 살 — 아이가 묻는다", G.view(g).story?.id === "child_question" && G.storyIntro(g).includes("새벽"), G.view(g).story?.id);
    if (G.view(g).story?.id === "child_question") { const b = c.temper.용기; G.act(g, { id: "story:truth" }); check("사실대로 말하면 아이가 대담해진다", c.temper.용기 > b); }
    check("이정표 — 처음 걷는다·첫 말", c.seen.includes("first_steps") && c.seen.includes("first_word"), c.seen.join(","));
    check("보고 배운다 — 너의 자비 쪽으로", c.own === "자비" ? c.temper.자비 <= before : c.temper.자비 > before, `${before} → ${c.temper.자비}`);
    g.at = "gf_river_huts"; while (G.view(g).story) G.act(g, { id: G.options(g)[0].id });
    const tid = G.options(g).find((o) => o.id === "teach:0");
    check("세 살부터 가르칠 수 있다", !!tid, G.options(g).map((o) => o.id).slice(0, 12).join(","));
    if (tid) { const r = G.act(g, { id: "teach:0" }); check("가르친 것이 아이의 스킬이 된다", (c.skills.손재주 || 0) > 5 && G.view(g).family.children[0].skills.손재주 > 0, JSON.stringify(c.skills)); check("하루에 한 번", !G.options(g).some((o) => o.id === "teach:0")); }
    const rc = G.recordCard(G.loopRecord(g)).join("\n");
    check("회차 기록 — 그 회차에 세운 것: 다시 태어나지 않는다", rc.includes("그 회차에 세운 것") && rc.includes("새벽 — 그 회차에 태어났다"));
    const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
    check("회귀하면 아이는 없다", !G.view(g2).family);
    g2.at = "gf_river_huts"; const r = G.act(g2, { id: "wait:60" });
    check("태어난 자리에서 — ┊ 이번엔 태어나지 않는다", (r.feed || []).some((f) => f.text.includes("이번엔 태어나지 않는다")) || G.view(g2).place.id !== "gf_river_huts");
  }
}
// 인질: 수배가 높고 식구가 있으면
{
  const g = fresh(); g.family = { members: ["npc_kit"], children: [] }; g.S.wanted.player = { heat: 5, by: new Set(), reasons: [] };
  const h = waitFor(g, () => G.view(g).story?.id === "family_hostage", 40);
  check("가족은 약점이다 — 인질", h && G.storyIntro(g).includes("키트"));
  if (h) { G.act(g, { id: "story:turn_away" }); check("외면하면 — 키트는 명단으로, 짐은 무겁다", g.S.vars.kit_on_list === true && g.P.status.stress >= 50); }
}
// 진명: 넷, 네 근원
{
  check("진명 넷 — 근원이 다르다", new Set(Object.values(C.game.truenames).map((t) => t.source)).size === 4);
  const g = fresh(); g.S.vars.true_name_water = true; g.P.bloody = true;
  check("물의 이름 — 피 묻은 옷이 있을 때", ids(g).includes("true_name:물"));
  G.act(g, { id: "true_name:물" });
  check("핏물이 씻긴다, 몸이 값을 치른다", !g.P.bloody && g.P.status.fatigue > 20);
  g.S.vars.true_name_see = true; G.act(g, { id: "true_name:보다" });
  const s = G.options(g).find((o) => o.id === "search");
  check("'보다' — 한 시간 동안 뒤지기 +15", G.odds(g, s).parts.some((p) => p.text.includes("보다")));
  const g2 = G.boot(C, { ...G.regressRun(g), opening: false });
  check("진명은 영혼에 남는다 (물·보다)", ["물", "보다"].every((w) => g2.run.carry.soul.trueNames.includes(w)) && G.view(g2).trueNames.length === 2);
}
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
