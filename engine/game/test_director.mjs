// node engine/game/test_director.mjs — 연출가 (18): 긴장도, 목표 곡선, 화자 넷, 연출 장면, 회차 비교 표지
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import * as DIR from "./director.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const H = { START: G.START, soul: (g) => g.run.carry.soul || G.emptySoul(), goals: () => [], threads: () => [], atPlace: () => true, storyWhen: () => true, parseClock: (x) => 0, isNight: () => false, hash: () => 0 };

const g = G.boot(C, { ...G.newRun({ seed: 7, opening: false }), lethal: true });
const t0 = DIR.tensionRaw(g, H);
g.P.status.hunger = 4; g.P.status.pain = 80; g.S.wanted.player = { heat: 3, by: new Set(), reasons: [] };
check("굶주림·부상·수배가 긴장을 올린다", DIR.tensionRaw(g, H) > t0 + 30, `${t0} → ${DIR.tensionRaw(g, H)}`);
// 목표 곡선: 고요 → 쌓임 → 정점 (침묵하는 신 4/6)
g.dir = { phase: "calm", since: Math.floor(g.t / 1440), T: 20, lastCrisis: null, losses: [], used: {} };
const d0 = Math.floor(g.t / 1440);
for (let d = 1; d <= 4; d++) DIR.directorDay(g, d0 + d);
check("고요가 나흘 지나면 쌓임", g.dir.phase === "build", g.dir.phase);
DIR.crisis(g, 4);
check("심각도 3 이상의 위기 → 여진", g.dir.phase === "aftershock");
DIR.directorDay(g, g.dir.since + 1);
check("여진 다음 날 → 숨 고르기 (목표가 기준보다 낮다)", g.dir.phase === "breather" && DIR.targetT(g) === 20, `${g.dir.phase} ${DIR.targetT(g)}`);
// 화자
for (const id of ["silent_god", "ash_teller", "old_teller", "dice"]) check(`화자: ${DIR.NARRATORS[id].name}`, !!DIR.NARRATORS[id].mult);
const r = G.boot(C, { ...G.newRun({ seed: 7, opening: false }), narrator: "ash_teller" });
check("새 판에서 고른 화자", G.view(r).narrator.id === "ash_teller");
G.setNarrator(r, "old_teller");
check("화자 바꾸기는 기록에 남아 재생된다", G.view(G.boot(C, JSON.parse(JSON.stringify(r.run)))).narrator.id === "old_teller");
check("주사위에는 목표 곡선이 없다", DIR.targetT({ ...r, narrator: "dice", dir: r.dir || { phase: "calm" } }) === null);
// 연출 장면이 실제로 나온다 (재의 화자, 여러 날)
const s = G.boot(C, { ...G.newRun({ seed: 3, opening: false }), lethal: true, narrator: "ash_teller" });
const seen = new Set();
for (let i = 0; i < 120 && !s.ended; i++) {
  const v = G.view(s);
  if (v.story) { seen.add(v.story.id); G.act(s, { id: ids(s)[ids(s).length - 1] }); continue; }
  if (s.fight) { G.act(s, { id: "fight_yield" }); continue; }
  if (s.convo) { G.act(s, { id: "leave" }); continue; }
  const places = ["gf_rooster", "gf_well_square", "gf_whip_square", "gf_river_huts"];
  const p = places[i % 4];
  G.act(s, { id: i % 6 === 0 && ids(s).includes(`go:${p}`) ? `go:${p}` : ids(s).includes("ration") ? "ration" : "wait:60" });
}
const dirScenes = [...seen].filter((x) => x.startsWith("dir_") || x.startsWith("vg_"));
check("연출가가 선택적 장면을 고른다", dirScenes.length >= 1, [...seen].join(","));
// 회차 비교 표지
const a = G.boot(C, G.newRun({ seed: 7, opening: false }));
G.act(a, { id: "go:gf_well_square" }); G.act(a, { id: "routine_day" });
const b = G.boot(C, { ...G.regressRun(a), opening: false });
G.act(b, { id: "routine_day" });
const two = G.view(b).twoDays;
check("두 겹의 날에 같음/달라짐 표지", two?.marks?.length >= 1 && /^[=≠+−]/.test(two.marks[0]), JSON.stringify(two?.marks));

// 회색여울 밖: 처음 닿는 장면 · 즉석 인물
{
  let ok = null;
  for (let seed = 1; seed < 20 && !ok; seed++) { const x = G.boot(C, { ...G.newRun({ seed, opening: false }), lethal: true }); G.act(x, { id: "travel:dragon_pillar_post" }); if (G.view(x).story) ok = G.view(x).story.id; }
  check("용주 역참에 처음 닿으면 — 그곳의 장면", ok === "arrive_dragon_pillar", ok);
  const gen = Object.values(C.cards).filter((c) => c.generated);
  check("사람이 적은 고장마다 즉석 인물 (결정적)", gen.length >= 50 && new Set(gen.map((c) => c.region)).size >= 8 && C.bundle.routines[gen[0].id], `${gen.length}명`);
  check("즉석 인물은 이름 대신 겉모습으로", String(C.game.public[gen[0].id]).startsWith("?"));
}
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
