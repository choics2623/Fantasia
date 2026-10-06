// node engine/sim/test_agenda_regions.mjs — 1차 지역의 목표 행동: 바알카르 계승 클락, 루멘의 장작, 잿불의 봉기 조짐
import { readFileSync } from "node:fs";
import { createWorld } from "./whereabouts.mjs";
import { createState, createAgenda } from "./agenda.mjs";
import { toMinutes } from "./calendar.mjs";
const R = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
const bundle = R("content/build/whereabouts.json"), game = R("content/build/game.json"), cards = R("content/base/npcs/cards.json").cards;
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };

function season(seed, setup = []) {
  const W = createWorld(bundle, { loopSeed: seed });
  const S = createState({ cards, vars: game.agendas.vars, inventories: game.inventories });
  const A = createAgenda(W, S, game.agendas, { loopSeed: seed });
  let t = toMinutes(312, 9, 1); A.stepTo(t);
  for (const [when, fn] of setup) { A.stepTo(when); fn(A, S); }
  A.stepTo(toMinutes(313, 3, 1));
  return { S, A, W, log: (p) => S.log.filter((l) => l.agenda?.startsWith(p)) };
}
const base = season(7);
for (const [p, name] of [["ag_bk", "바알카르"], ["ag_lm", "루멘"], ["ag_em", "잿불 언덕"]]) {
  console.log(`\n── ${name} (플레이어 없이, 시드 7) ──`);
  for (const l of base.A.fmtLog().filter((x) => base.log(p).some((y) => x.includes(y.text)))) console.log("  " + l);
}
const at = (id) => base.S.log.find((l) => l.agenda === id)?.t;
check("바알카르: 원로회 초안이 숙청 안건보다 먼저", at("ag_bk_regency_draft") && at("ag_bk_purge_motion") && at("ag_bk_regency_draft") < at("ag_bk_purge_motion"));
check("바알카르: 숙청 안건은 틸데의 벽 틈을 거쳐 등잔 회합으로 간다", base.S.vars.bk_lamps_warned === true);
check("바알카르: 재받이 색출 → 화형이 일어난다", base.S.vars.bk_burned > 0, `탄 사람 ${base.S.vars.bk_burned}`);
check("루멘: 정화가 여러 번 일어난다", base.log("ag_lm_pyre").length >= 3, `${base.log("ag_lm_pyre").length}번`);
check("루멘: 대사제가 쓰러지면 마테우스가 의장석에", !base.S.vars.lm_succession_open || base.S.vars.lm_mateus_chair === true);
check("잿불: 조짐이 쌓여 밀고(진압) 또는 봉기로 간다", base.S.vars.em_crackdown || base.S.vars.em_rising, `조짐 ${base.S.vars.em_signs}`);

const freed = season(7, [[toMinutes(312, 10, 20), (A) => A.intervene(toMinutes(312, 10, 20), "set", "lm_alberic_escaped", true)]]);
check("알베릭을 빼내면 공물 명단이 여든이 된다", freed.S.vars.lm_tribute === 80);
const kept = season(7, [[toMinutes(312, 10, 30), (A) => A.intervene(toMinutes(312, 10, 30), "set", "bk_noeul_protected", true)]]);
check("노을을 숨겨 주면 계단에서 사라지지 않는다", !kept.S.dead.has("npc_noeul"));
const fed = season(7, [[toMinutes(312, 9, 2), (A, S) => { S.vars.em_quota_short = -999; }]]);
check("할당량을 채워 주면(비축 광석) 조짐이 덜 쌓인다", fed.S.vars.em_signs <= base.S.vars.em_signs, `${fed.S.vars.em_signs} ≤ ${base.S.vars.em_signs}`);
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
