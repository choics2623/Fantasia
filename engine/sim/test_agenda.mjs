// node engine/sim/test_agenda.mjs — 플레이어 없이 굴린 가을, 그리고 개입한 가을 셋
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createWorld } from "./whereabouts.mjs";
import { createState, createAgenda } from "./agenda.mjs";
import { toMinutes } from "./calendar.mjs";

const bundle = JSON.parse(readFileSync(new URL("../../content/build/whereabouts.json", import.meta.url), "utf8"));
const cards = JSON.parse(readFileSync(new URL("../../content/base/npcs/cards.json", import.meta.url), "utf8")).cards;
const ag = JSON.parse(execFileSync("python3", ["-c", "import yaml,json,sys;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))", new URL("../../content/base/agendas/greyford.yaml", import.meta.url).pathname]).toString());
const inv = JSON.parse(execFileSync("python3", ["-c", "import yaml,json,sys;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))", new URL("../../content/base/inventories/greyford.yaml", import.meta.url).pathname]).toString());
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };

function autumn(name, seed, setup) {
  const W = createWorld(bundle, { loopSeed: seed });
  const S = createState({ cards, vars: ag.vars, inventories: inv });
  const A = createAgenda(W, S, ag, { loopSeed: seed });
  const steps = setup || [];
  let t = toMinutes(312, 9, 1);
  for (const [when, fn] of steps) { A.run(t, when); fn(A, W, when); t = when; }
  A.run(t, toMinutes(312, 12, 30));
  console.log(`\n── ${name} ──`); for (const l of A.fmtLog()) console.log("  " + l);
  return { W, S, A };
}

// 1. 아무도 개입하지 않은 가을
const base = autumn("플레이어 없이", 7);
check("9/22 하겐이 셋을 넘긴다", base.S.log.some((l) => l.agenda === "ag_hagen_sell_three"));
check("볼크 대수색이 일어난다", base.S.log.some((l) => l.agenda === "ag_volk_sweep"));
check("헨릭이 값을 올린다", base.S.log.some((l) => l.agenda === "ag_henrik_raise"));
check("정본대로 12/10 마르타가 먼저 냄새를 맡는다 (헨릭이 넘기기 전에)", base.S.log.some((l) => l.agenda === "ag_martha_smell") && !base.S.log.some((l) => l.agenda === "ag_henrik_tidy_ledger"));
check("결국 수탉 지하가 털린다", base.S.vars.egil_hidden === false);
const raidAt = base.S.log.find((l) => l.agenda === "ag_znik_raid")?.t;
check("털린 뒤 에길은 붙잡혀 있다", raidAt && base.W.where("npc_egil", raidAt + 120).kind === "captive");
check("털린 날 아침 즈닉은 실제로 지하실에 있다", raidAt && base.W.where("npc_znik", raidAt - 30).at === "gf_rooster_cellar");

// 2. 플레이어가 9/20에 하겐을 죽인다
const noHagen = autumn("9/20 하겐을 죽였다", 7, [[toMinutes(312, 9, 20, 23), (A, W, t) => A.intervene(t, "kill", "npc_hagen")]]);
check("하겐이 죽으면 9/22 매매는 없다", !noHagen.S.log.some((l) => l.agenda === "ag_hagen_sell_three"));
check("대수색은 늑대굴을 찾지 못한다 (하겐이 팔지 못했으므로)", noHagen.S.vars.sigrid_group >= base.S.vars.sigrid_group);

// 3. 플레이어가 브람에게 돈을 대 준다 + 11/30에 에길 일가를 옮긴다
const saved = autumn("브람에게 돈을 대고, 11/30 에길 일가를 옮겼다", 7, [
  [toMinutes(312, 9, 7), (A, W, t) => A.intervene(t, "coin", "npc_bram", 2400)],
  [toMinutes(312, 11, 30), (A, W, t) => { A.intervene(t, "set", "egil_hidden", false); A.intervene(t, "set", "egil_moved", true); }],
]);
const noFloor = autumn("10/19에 방앗간 두 번째 바닥을 숨겨 주었다", 7, [[toMinutes(312, 10, 19), (A, W, t) => A.intervene(t, "set", "thomas_floor_hidden", true)]]);
check("두 번째 바닥을 숨기면 곡물 길이 살아 있다", noFloor.S.vars.grain_route === true);
check("옮기면 마르타는 아무것도 맡지 못하고, 지하실도 털리지 않는다", !saved.S.log.some((l) => l.agenda === "ag_znik_raid" || l.agenda === "ag_martha_smell"));

// 4. 결정성
const again = autumn("같은 시드 다시", 7);
check("같은 시드 = 같은 가을", JSON.stringify(again.S.log) === JSON.stringify(base.S.log));
const other = autumn("다른 회차 (시드 8)", 8);
check("다른 회차는 작은 일이 어긋난다 (하겐이 늑대굴을 알아내는 날 등)", JSON.stringify(other.S.log) !== JSON.stringify(base.S.log));

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
