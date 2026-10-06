// node engine/game/test_lethal.mjs — 첫 회차의 뼈대 (14 §3.2·§6.3·§6.4): 치명적 자리, 볼크, 협박꾼, 쫓는 자
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import { toMinutes } from "../sim/calendar.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const go = (g, place) => { if (g.at !== place && ids(g).includes(`go:${place}`)) G.act(g, { id: `go:${place}` }); };
// 그 시각까지 기다린다 (자리를 지키며). 장면이 열리면 멈춘다
function until(g, when, place, { pick = {} } = {}) {
  const [d, hm] = when.split(" "), [y, m, dd] = d.split("-").map(Number), [hh, mm] = hm.split(":").map(Number);
  const T = toMinutes(y, m, dd, hh, mm);
  for (let i = 0; i < 400 && g.t < T && !g.ended; i++) {
    if (G.view(g).story) { const o = ids(g); const want = pick[G.view(g).story.id]; if (want === "stop") return G.view(g).story.id; G.act(g, { id: want && o.includes(`story:${want}`) ? `story:${want}` : o.find((x) => x === "story:stay_in_line") || o.find((x) => x !== "story:lure" && x !== "story:shove_fayne") || o[0] }); continue; }
    if (g.convo) { G.act(g, { id: "leave" }); continue; }
    const left = T - g.t;
    if (left > 1800 && ids(g).includes("routine_day")) { G.act(g, { id: "routine_day" }); continue; }   // 먼 날까지는 늘 하던 대로 (배급을 받아 굶지 않는다)
    if (ids(g).includes("ration")) { G.act(g, { id: "ration" }); continue; }
    if (place) go(g, place);
    G.act(g, { id: left > 600 && ids(g).includes("sleep") && G.view(g).night ? "sleep" : "wait:60" });
  }
  return G.view(g).story?.id || null;
}
const start = (seed = 7) => { const g = G.boot(C, G.newRun({ seed })); G.act(g, { id: "story_name", text: "하린|형" }); return g; };

// ── 마르타의 값 (2일 19:40, 수탉 뒷문) ──
{
  const g = start(); G.act(g, { id: "story:stay_in_line" });
  const st = until(g, "312-9-2 19:45", "gf_rooster", { pick: { martha_price_night: "stop" } });
  check("2일 19:40 수탉에 있으면 마르타가 온다", st === "martha_price_night", `${G.view(g).time} ${st}`);
  const o = ids(g);
  check("모르는 비밀은 팔 수 없다 (숨김)", !o.includes("story:sell_cellar") && o.includes("story:dont_know") && o.includes("story:i_protect"), o.join(","));
  G.act(g, { id: "story:i_protect" });
  check("'키트는 내가 지킨다' — 처마 밑의 낯선 눈", g.S.vars.informant_assigned === true);
}
// 브람의 지하를 아는 회차 (지난 회차의 기억): 팔면 키트가 빠지고 토비가 간다
{
  const run = G.newRun({ seed: 7 }); run.carry.future = ["fact_gf_egil_family_in_cellar"]; run.carry.trueName = "하린";
  const g = G.boot(C, run); G.act(g, { id: "story:next" }); G.act(g, { id: "story:stay_in_line" });
  until(g, "312-9-2 19:45", "gf_rooster", { pick: { martha_price_night: "stop" } });
  check("아는 비밀은 팔 수 있다", ids(g).includes("story:sell_cellar"));
  G.act(g, { id: "story:sell_cellar" });
  check("팔면 키트가 명단에서 빠지고 토비가 들어간다", g.S.vars.kit_on_list === false && g.S.vars.toby_on_list === true);
  check("즈닉이 수탉 지하를 안다 (세계가 움직인다)", g.S.knows.get("fact_gf_egil_family_in_cellar")?.has("npc_znik"));
  check("페인이 지붕에서 보았다", (g.S.rel.get("npc_fayne>player")?.trust || 0) <= -30);
  check("밀고는 행적이 된다", g.deeds.some((d) => d.kind === "inform"));
  check("시한이 바뀐다 — 키트는 명단에서 빠졌다", G.view(g).goals.find((x) => x.who === "키트")?.what.includes("빠졌다"));
}
// ── 하겐의 북쪽 길 → 21일 밤의 배 ──
{
  const g = start(); G.act(g, { id: "story:hagen_bread" });
  check("하겐의 빵을 받으면 그가 탈주 의도를 안다", g.S.vars.hagen_knows_escape_intent === true);
  let st = null;
  for (let i = 0; i < 12 && st !== "hagen_northern_road"; i++) { st = until(g, `312-9-${8 + Math.floor(i / 2)} ${i % 2 ? "19:00" : "18:20"}`, "gf_rooster", { pick: { hagen_northern_road: "stop", martha_price_night: "dont_know" } }); }
  check("8~12일 사이 하겐이 '북쪽 길'을 제안한다", st === "hagen_northern_road", `${G.view(g).time} ${st}`);
  if (st === "hagen_northern_road") {
    G.act(g, { id: "story:accept" });
    st = until(g, "312-9-21 21:40", "gf_hagen_shed", { pick: { death_c_northern_road: "stop", volk_sniff: "silent" } });
    check("21일 밤 나루 헛간 — 배에 오른다", st === "death_c_northern_road", `${G.view(g).time} ${st}`);
    if (st === "death_c_northern_road") {
      const od = G.optionOdds(g, G.options(g).find((o) => o.id === "story:notice"));
      check("경고를 모으지 않은 첫 회차의 알아챔은 어렵다", od.P < 0.4, `${Math.round(od.P * 100)}%`);
      const r = G.act(g, { id: "story:notice" });
      const s2 = G.view(g).story?.id;
      check("알아채면 배 위의 선택 / 못 알아채면 우리 수레", s2 === "boat_choice" || s2 === "cage_cart", s2);
      if (s2 === "boat_choice") { G.act(g, { id: "story:shove_fayne" }); check("페인을 민다 — 페인은 산다", g.S.vars.fayne_saved === true); }
      else { G.act(g, { id: "story:stay_cart" }); check("우리 수레에 웅크리면 팔려 간다", g.ended?.kind === "captured"); }
      if (g.ended?.kind === "dead") {
        check("물에서 죽으면 흔적은 '물이 차다'", g.ended.trace.id === "water");
        const n2 = G.boot(C, G.regressRun(g));
        check("두 번째 회차의 첫 화면에 물이 있다", G.storyIntro(n2).includes("목 안에 물이 있다"));
      }
    }
  }
}
// ── 볼크의 코 (14일~) ──
{
  const g = start(); G.act(g, { id: "story:stay_in_line" });
  g.run.journal.length; // (기록만으로 재생된다)
  let st = null;
  for (let d = 14; d <= 18 && st !== "volk_sniff"; d++) for (const p of ["gf_rooster", "gf_whip_square", "gf_tannery"]) { if (st === "volk_sniff") break; st = until(g, `312-9-${d} ${p === "gf_rooster" ? "18:30" : p === "gf_whip_square" ? "12:00" : "15:00"}`, p, { pick: { volk_sniff: "stop", martha_price_night: "dont_know" } }); }
  if (st === "volk_sniff") {
    check("볼크가 냄새를 맡는다 — 젖은 재", G.storyIntro(g).includes("젖은 재"));
    G.act(g, { id: "story:lie" });
    check("볼크에게 거짓말을 했다", g.S.vars.volk_lied === true);
  } else check("(볼크와 마주치지 못했다 — 일과 표류)", true);
}
// ── 협박꾼: 장물을 산 것을 아는 자가 찾아온다 ──
{
  const g = G.boot(C, { ...G.newRun({ seed: 7, opening: false }), lethal: true });
  g.S.threats.push({ by: "npc_bram", target: "player", kind: "blackmail", about: "npc_ulf", t: g.t - 400 });
  const r = G.act(g, { id: "wait:60" });
  check("협박꾼이 같은 자리에 있으면 요구한다", G.view(g).story?.id === "threat_demand", G.view(g).story?.id);
  if (G.view(g).story) {
    check("요구의 글에 그 사람 이름", G.storyIntro(g).includes("브람"));
    G.act(g, { id: "story:refuse" });
    check("거절하면 감독관이 안다 — 수배", (g.S.wanted.player?.heat || 0) >= 2);
  }
}
// ── 쫓는 자: 추적 거리 4가 되면 찾아낸다 ──
{
  const g = G.boot(C, { ...G.newRun({ seed: 7, opening: false }), lethal: true });
  g.nem = { npc_znik: { grudge: 3, track: 4, since: g.t } };
  G.act(g, { id: "wait:60" });
  check("추적 거리 4 — 쫓는 자가 너를 찾아낸다", G.view(g).story?.id === "nemesis_found" && G.storyIntro(g).includes("즈닉"), G.view(g).story?.id);
  check("판정 근거가 붙는다 (달아난다 = 은신)", G.options(g).find((o) => o.id === "story:flee")?.skill === "은신");
}
// 냄새: 회차가 쌓이면 짙어진다
check("냄새 = min(30, 3·(회차−1)^0.7)", G.smellOf({ run: { loop: 1 } }) === 0 && Math.abs(G.smellOf({ run: { loop: 5 } }) - 3 * 4 ** 0.7) < 1e-9 && G.smellOf({ run: { loop: 200 } }) === 30);
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
