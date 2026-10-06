// node engine/sim/test_living.mjs — 대본에 없는 일에 세계가 반응하는가
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createWorld } from "./whereabouts.mjs";
import { createState, createAgenda } from "./agenda.mjs";
import { createLivingWorld } from "./living.mjs";
import { toMinutes } from "./calendar.mjs";

const root = new URL("../../", import.meta.url);
const yaml = (p) => JSON.parse(execFileSync("python3", ["-c", "import yaml,json,sys;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))", new URL(p, root).pathname]).toString());
const bundle = JSON.parse(readFileSync(new URL("content/build/whereabouts.json", root), "utf8"));
const cards = JSON.parse(readFileSync(new URL("content/base/npcs/cards.json", root), "utf8")).cards;
const ag = yaml("content/base/agendas/greyford.yaml"), inv = yaml("content/base/inventories/greyford.yaml"), sim = yaml("content/base/sim/greyford.yaml");
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };

function make(seed = 7) {
  const W = createWorld(bundle, { loopSeed: seed });
  const S = createState({ cards, vars: ag.vars });
  const A = createAgenda(W, S, ag, { loopSeed: seed });
  const L = createLivingWorld({ world: W, state: S, agenda: A, inventories: inv, sim, cards, loopSeed: seed, active: ["greyford"], startAt: toMinutes(312, 9, 1) });
  return { W, S, A, L };
}
const show = (name, L, vis) => { console.log(`\n── ${name} ──`); for (const l of L.fmtLog(vis)) console.log("  " + l); };
const simLog = (S) => S.log.filter((l) => l.agenda === "sim");
const T = (m, d, h = 0, mi = 0) => toMinutes(312, m, d, h, mi);

// 0. 플레이어가 아무것도 하지 않으면 이 층은 조용하다 (정본이 흔들리지 않는다)
{
  const { S, L } = make();
  L.advance(T(10, 1));
  check("개입이 없으면 반응 층은 아무것도 만들지 않는다", simLog(S).length === 0);
  check("목표 행동은 그대로 굴러간다 (9/22 하겐의 매매)", S.log.some((l) => l.agenda === "ag_hagen_sell_three"));
}

// 1. 밤에 아무도 없는 헛간에서 하겐을 죽이고 소지품을 가져간다
const A1 = make();
{
  const { S, L, W } = A1;
  const seen = L.player.kill(T(9, 20, 23, 30), "npc_hagen", { stealth: 40 });
  const got = L.player.loot(T(9, 20, 23, 40), "npc_hagen");
  L.advance(T(9, 27));
  show("9/20 밤 하겐을 죽이고 털었다", L, ["public", "secret", "player"]);
  check("본 사람이 없다", seen.length === 0);
  check("칼과 돈을 가져왔다", got.includes("뼈자루 접이칼") && L.purse.get("player") > 0);
  check("9/22 매매는 일어나지 않는다 (목표 행동이 죽음을 안다)", !S.log.some((l) => l.agenda === "ag_hagen_sell_three"));
  const finder = L.bodies[0].found;
  check("누군가 실제로 그 자리에 가서 시체를 발견한다", !!finder, finder && `${finder.by}`);
  check("발견한 사람은 그 시각 헛간에 있다", finder && W.where(finder.by, finder.t).at === "gf_hagen_shed");
  check("시체 소식이 결국 감독관에게 닿는다", L.knowsAbout("npc_znik", "dead") || L.beliefs("npc_znik").some((b) => b.object === "npc_hagen"));
  check("증거가 없으니 아직 플레이어는 쫓기지 않는다", !(S.wanted.player?.heat > 0));
}

// 2. 같은 밤 + 9/23 저녁 수탉에서 하겐의 칼을 꺼내 든다
{
  const { S, L } = make();
  L.player.kill(T(9, 20, 23, 30), "npc_hagen", { stealth: 40 });
  L.player.loot(T(9, 20, 23, 40), "npc_hagen");
  const saw = L.player.show(T(9, 23, 19, 0), "it_hagen_knife", "gf_rooster");
  L.advance(T(9, 30));
  show("…그리고 9/23 수탉에서 하겐의 칼을 꺼냈다", L, ["public", "secret"]);
  const rec = ["npc_fayne", "npc_volk", "npc_dietmar", "npc_irma"].filter((n) => L.beliefs(n).some((b) => b.kind === "saw_item" && b.item === "it_hagen_knife"));
  check("그 자리의 누군가가 칼을 본다", saw.length > 0, saw.join(", "));
  check("알아보는 사람은 카드에 적힌 사람뿐이다", rec.every((n) => inv.npc_hagen.worn[0].recognizers.includes(n)), rec.join(", "));
  const sus = Object.keys(cards).filter((n) => L.beliefs(n).some((b) => b.kind === "suspect" && b.subject === "player"));
  check("칼 + 하겐의 죽음 → 누군가 플레이어를 의심한다", sus.length > 0, sus.join(", "));
}

// 3. 칼을 대장장이에게 맡겨 표시를 지우고 꺼내 보이면 — 아무도 알아보지 못한다 (대신 대장장이가 먼저 본다)
{
  const { L } = make();
  L.player.kill(T(9, 20, 23, 30), "npc_hagen", { stealth: 40 });
  L.player.loot(T(9, 20, 23, 40), "npc_hagen");
  const r = L.player.alter(T(9, 21, 10), "it_hagen_knife", "npc_bran", "gf_smithy");
  L.player.show(T(9, 23, 19, 0), "it_hagen_knife", "gf_rooster");
  L.advance(T(9, 25));
  check("표시를 지운 칼은 아무도 알아보지 못한다", !Object.keys(cards).some((n) => n !== "npc_bran" && L.beliefs(n).some((b) => b.kind === "saw_item" && b.item === "it_hagen_knife")));
  check("소유 이력은 남는다 (회귀 전까지 세계의 기록)", L.items.get("it_hagen_knife").provenance.length === 3, `대장장이가 알아봤나: ${r.knew}`);
}

// 4. 저녁 수탉, 사람들 앞에서 하겐을 죽인다
{
  const { S, L } = make();
  const seen = L.player.kill(T(9, 21, 19, 0), "npc_hagen", { at: "gf_rooster" });
  L.advance(T(9, 24));
  show("9/21 저녁 수탉에서 사람들 앞에서 하겐을 죽였다", L, ["public"]);
  check("본 사람이 여럿이다", seen.length >= 2, seen.join(", "));
  check("누군가 윗선에 고하고, 플레이어가 수배된다", S.wanted.player?.heat > 0, `수배 ${S.wanted.player?.heat} · ${[...(S.wanted.player?.by || [])].join(", ")}`);
  const choices = seen.flatMap((n) => L.beliefs(n).filter((b) => b.choice).map((b) => `${n}:${b.kind}→${b.choice}`));
  check("목격자마다 고르는 행동이 다르다 (성향과 마음이 다르다)", new Set(choices.map((c) => c.split("→")[1])).size >= 2, choices.join(" · "));
}

// 5. 인간이 칼을 감독관 앞에서 꺼낸다 — 그것만으로 죄다 (WORLD_BIBLE §7.1 단검 = 사형감)
{
  const { S, L } = make();
  L.player.kill(T(9, 20, 23, 30), "npc_hagen", { stealth: 40 });
  L.player.loot(T(9, 20, 23, 40), "npc_hagen");
  L.player.show(T(9, 22, 20, 30), "it_hagen_knife", "gf_whip_square");
  L.advance(T(9, 23));
  check("감독관 앞에서 칼을 꺼내면 쫓긴다", S.wanted.player?.heat > 0, S.wanted.player?.reasons.join(" / "));
}

// 5b. 조건부 일정: 세계 상태가 깨지면 일정도 사라진다
{
  const b2 = { ...bundle, events: [...bundle.events, { id: "ev_test_hagen_ferry", date: "312-09-26", npcs: ["npc_fayne"], from: "10:00", to: "12:00", at: "gf_willow_bank", doing: "하겐의 배를 대신 젓는다", when: ["alive npc_hagen"] }] };
  const run = (kill) => {
    const W = createWorld(b2, { loopSeed: 7 }); const S = createState({ cards, vars: ag.vars }); const A = createAgenda(W, S, ag, { loopSeed: 7 });
    const L = createLivingWorld({ world: W, state: S, agenda: A, inventories: inv, sim, cards, loopSeed: 7, active: ["greyford"], startAt: T(9, 1) });
    if (kill) L.player.kill(T(9, 20, 23, 30), "npc_hagen");
    L.advance(T(9, 26, 11)); return W.where("npc_fayne", T(9, 26, 11)).event;
  };
  check("일정의 when: 하겐이 살아 있으면 일어나고, 죽으면 일어나지 않는다", run(false) === "ev_test_hagen_ferry" && run(true) !== "ev_test_hagen_ferry");
}

// 6. 결정성
{
  const a = make(), b = make();
  for (const X of [a, b]) { X.L.player.kill(T(9, 21, 19, 0), "npc_hagen", { at: "gf_rooster" }); X.L.advance(T(9, 26)); }
  check("같은 시드 + 같은 행동 = 같은 결과", JSON.stringify(a.S.log) === JSON.stringify(b.S.log));
}

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
