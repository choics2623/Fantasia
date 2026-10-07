// node engine/game/test_regions.mjs — 다른 거점의 대본 장면과 맹세: 정본 사건에 손을 댈 자리가 열리고, 고른 것이 목표 행동을 바꾼다
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
import { toMinutes, parseClock, parseDate } from "../sim/calendar.mjs";
const parseDT = (x) => { const [d, hm] = x.split(" "); const { y, m, d: dd } = parseDate(d); return toMinutes(y, m, dd) + parseClock(hm); };
// 거점에 서서 그 시각을 기다린다 — 다른 장면이 끼어들면 넘긴다
function at(sid, when, vars = {}, rel = {}) {
  const g = G.boot(C, { ...G.newRun({ seed: 11, opening: false }), lethal: true });
  Object.assign(g.S.vars, vars); for (const [n, t] of Object.entries(rel)) g.S.rel.set(`${n}>player`, { like: 30, trust: t });
  const st = C.bundle.settlements[sid]; g.P.settlement = sid; g.at = (st.locations.find((l) => (l.access || "public") === "public") || st.locations[0]).id; g.L.setActive([sid]);
  g.storyDone.add(`arrive_${sid === "dragon_pillar_post" ? "dragon_pillar" : sid}`);
  g.t = parseDT(when); g.P.status.hunger = 0;
  return g;
}
function waitStory(g, id, hours = 48) {
  for (let i = 0; i < hours; i++) {
    g.P.status.hunger = 0; g.P.status.pain = 0;
    const s = G.view(g).story?.id; if (s === id) return true;
    if (s) { g.storyDone.add(s); g.story = null; continue; }
    if (g.ended) return false;
    G.act(g, { id: ids(g).includes("wait:60") ? "wait:60" : "sleep" });
  }
  return false;
}
const pick = (g, choice) => G.act(g, { id: `story:${choice}` });
// 결과가 판정이면 여러 시드에서 성공 한 번을 찾는다
function trySeeds(make, id, choice, okf) {
  for (let s = 0; s < 30; s++) { const g = make(s); if (!waitStory(g, id)) return { opened: false }; pick(g, choice); if (okf(g)) return { opened: true, ok: true, g }; }
  return { opened: true, ok: false };
}
const C_ = (sid, when, vars, rel) => (s) => { const g = at(sid, when, vars, rel); g.seed = 11 + s; return g; };

// 까마귀 문
{ const g = at("crow_gate", "312-10-03 21:00", { cg_looked_away: true });
  check("까마귀 문 — 물빼기 굴의 밤", waitStory(g, "cg_drain_night")); pick(g, "watch");
  check("본 것이 남는다", g.S.vars.cg_drain_seen === true);
  check("맹세가 열린다 — 바알카르의 책상", ids(g).includes("oath:oath_cg_report")); }
{ const r = trySeeds(C_("crow_gate", "312-10-23 08:00", { cg_looked_away: true, cg_drain_seen: true }), "cg_lea_desk", "talk", (g) => g.S.vars.cg_report_stopped);
  check("레아의 책상 — 보고서를 막을 수 있다", r.opened && r.ok);
  if (r.ok) { const g = r.g; for (let i = 0; i < 4 * 24 && !g.ended; i++) { g.P.status.hunger = 0; if (G.view(g).story) { g.storyDone.add(G.view(g).story.id); g.story = null; } G.act(g, { id: "wait:60" }); }
    check("막으면 레아는 우편함에 넣지 않는다 (정본 10.25가 비틀린다)", g.S.vars.cg_report_filed !== true, String(g.S.vars.cg_report_filed)); } }
{ const r = trySeeds((s) => { const g = C_("crow_gate", "312-10-07 07:40")(s); g.at = "cg_drill_yard"; g.P.knows.add("fact_dk_aurax_kaspar_contract"); return g; }, "kaspar_warning", "warn", (g) => g.S.vars.kaspar_warned && g.S.vars.faction_kaspar === 30);
  check("훈련장의 카스파르 — 암살 의뢰를 알리면 세력이 15 오른다", r.opened && r.ok, r.g ? String(r.g.S.vars.faction_kaspar) : ""); }
// 용주 역참
{ const r = trySeeds(C_("dragon_pillar_post", "312-10-25 15:00", { cg_report_filed: true }), "dp_report_swap", "swap", (g) => g.S.vars.cg_report_filed === false);
  check("역참 우편함 — 바꿔치기", r.opened && r.ok); }
// 바알카르
{ const r = trySeeds(C_("baalkar", "312-10-16 09:00"), "bk_noeul_stairs", "hide", (g) => g.S.vars.bk_noeul_protected);
  check("계단의 아이 — 숨기면 노을은 정리되지 않는다", r.opened && r.ok); }
{ const g = at("baalkar", "312-10-16 09:00"); waitStory(g, "bk_noeul_stairs"); pick(g, "tell");
  check("노을의 맹세가 열린다", ids(g).includes("oath:oath_noeul")); }
{ const r = trySeeds(C_("baalkar", "312-11-21 09:00", { bk_tilde_heard: true }), "bk_lamp_carry", "carry", (g) => g.S.vars.bk_lamps_warned);
  check("등잔 회합에 안건을 넘긴다", r.opened && r.ok); }
// 잿불 언덕
{ const g = at("ember_mines", "312-09-05 09:00", {}, {});
  const opened = waitStory(g, "em_handprint", 96); check("9번 갱 막장 — 손바닥 자국", opened);
  if (opened) { const s0 = g.S.vars.em_signs || 0; pick(g, "press"); check("찍으면 조짐이 하나 는다", g.S.vars.em_signs === s0 + 1, `${s0} → ${g.S.vars.em_signs}`); check("칼렙의 맹세", ids(g).includes("oath:oath_caleb")); } }
{ const g = at("ember_mines", "312-09-05 09:00", { em_signs: 4, em_handprint_done: true }); g.S.purse.player = 30;
  const opened = waitStory(g, "em_nit_nose", 24 * 7); check("셋꼬리 닛의 코", opened);
  if (opened) { pick(g, "bribe"); check("입을 사면 밀고가 미뤄진다", g.S.vars.em_nit_bought === true && g.S.purse.player === 12); } }
// 루멘
{ const g = at("lumen", "312-11-11 19:00");
  const opened = waitStory(g, "lm_jonas_copy"); check("요나스의 사본", opened);
  if (opened) { pick(g, "take"); check("사본을 손에 넣는다 — 맹세가 열린다", g.S.vars.lm_list_copy === true && ids(g).includes("oath:oath_lumen")); } }
{ const r = trySeeds(C_("lumen", "312-11-11 19:00"), "lm_jonas_copy", "strike", (g) => g.S.vars.lm_impure < 26);
  check("원본에서 열둘을 지운다 (var -= 가 먹는다)", r.opened && r.ok, r.g ? String(r.g.S.vars.lm_impure) : ""); }
{ const r = trySeeds(C_("lumen", "312-11-13 22:00", { lm_list_copy: true }), "lm_silent_well", "down", (g) => g.S.vars.lm_alberic_escaped);
  check("침묵의 우물 — 알베릭", r.opened && r.ok); }
// 맹세 판정: 넷째 장작
{ const g = at("lumen", "312-12-10 09:00", { lm_list_copy: true });
  G.act(g, { id: "oath:oath_lumen" }); g.S.vars.lm_impure = 0;
  g.P.settlement = "greyford"; g.at = "gf_river_huts"; g.L.setActive(["greyford"]);   // 맹세는 어디서든 판정된다
  for (let i = 0; i < 4 * 24 && !g.ended; i++) { g.P.status.hunger = 0; g.S.vars.lm_impure = 0; if (G.view(g).story) { g.storyDone.add(G.view(g).story.id); g.story = null; continue; } G.act(g, { id: G.options(g).some((o) => o.id === "wait:60") ? "wait:60" : "sleep" }); }
  check("목록을 비우면 넷째 장작은 타지 않는다 — 지켜졌다", g.oaths[0].state === "kept", g.oaths[0].state); }
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
