// node engine/game/test_game.mjs — 진행 루프: 장면·대화·시간·저장(재생)·되돌리기·붙잡힘·회귀
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";

const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const has = (g, id) => G.options(g).some((o) => o.id === id);
const play = (g, ...ids) => ids.map((id) => { if (!has(g, id)) throw new Error(`할 수 없음: ${id} @ ${G.view(g).time} ${G.view(g).place.name}`); return G.act(g, { id }); });
const fingerprint = (g) => JSON.stringify({ v: G.view(g), log: g.S.log.length, purse: g.S.purse, wanted: g.S.wanted });

// 1. 회귀점
const g = G.boot(C, G.newRun({ seed: 7 }));
const v0 = G.view(g);
check("회귀점: 낙엽월 1일 18:30, 절름발이 수탉", v0.time.includes("낙엽월 1일 18:30") && v0.place.id === "gf_rooster");
check("그 자리에 실제로 있는 사람만 장면에 나온다 (브람)", v0.people.some((p) => p.id === "npc_bram"), v0.people.map((p) => p.name).join(", "));
check("가진 돈: 부츠 속 3못", v0.player.coin === 3);

// 2. 대화 — 아는 것은 판정으로, 숨긴 것은 공개 조건으로
play(g, "talk:npc_bram");
const topics = G.options(g).filter((o) => o.id.startsWith("ask:")).map((o) => o.topic);
check("주제에 플레이어가 모르는 이름(에길·룬)이 새지 않는다", !topics.includes("에길") && !topics.includes("룬"), topics.join(", "));
const askRes = play(g, "ask:요즘 마을 사정")[0];
check("판정은 엔진이 한다 (등급·확률이 있다)", !!askRes.tier && askRes.P > 0 && askRes.P < 1, `${askRes.tier} ${Math.round(askRes.P * 100)}%`);
play(g, "leave");
check("대화를 끝내면 장면으로 돌아온다", !G.view(g).convo);

// 3. 저장 = 시드 + 기록 → 불러오기 = 재생
const saved = JSON.parse(JSON.stringify(g.run));
const g2 = G.boot(C, saved);
check("불러온 세계 = 저장한 세계 (재생)", fingerprint(g2) === fingerprint(g));

// 4. 되돌리기 (LLM 실패): 기록을 빼고 재생하면 그 턴은 일어나지 않은 것이 된다. 같은 번호 = 같은 주사위
const before = fingerprint(g);
const r1 = G.act(g, { id: "wait:60" });
const undo = G.boot(C, { ...g.run, journal: g.run.journal.slice(0, -1) });
check("되돌리면 턴 전과 같다", fingerprint(undo) === before);
const r2 = G.act(undo, { id: "wait:60" });
check("다시 시도해도 같은 주사위", r1.roll === r2.roll);

// 5. 밤: 하겐의 헛간에 숨어 들어가 자는 하겐을 죽이고 턴다 → 통금·점호·발견이 모두 시간으로 이어진다
//    판정이 있으니 시드마다 결과가 다르다 — 성공하는 시드를 찾아 그 회차를 따라간다
function nightOf(seed) {
  const n = G.boot(C, G.newRun({ seed }));
  while (G.view(n).hm < "23:00" && G.view(n).time.includes("1일")) play(n, "wait:60");
  play(n, "go:gf_hagen_shed");
  return n;   // 표류로 하겐이 없을 수도 있다

}
const n0 = nightOf(7);
const vh = G.view(n0);
check("밤 11시가 넘으면 하겐은 헛간에서 잔다", vh.people.some((p) => p.id === "npc_hagen" && p.asleep), `${vh.hm} ${vh.people.map((p) => `${p.name}(${p.doing}${p.asleep ? ", 잔다" : ""})`).join(", ")}`);
const atk0 = G.odds(n0, G.options(n0).find((o) => o.id === "attack:npc_hagen"));
check("자는 상대는 덤비기 쉽다 (그래도 맨손의 굶은 농노다)", atk0.parts.includes("자는 상대 +20"), `${Math.round(atk0.P * 100)}% (${atk0.parts.join(", ")})`);
let n = null;
for (let s = 1; s < 80 && !n; s++) { const x = nightOf(s); if (!has(x, "attack:npc_hagen") || x.ended) continue; play(x, "attack:npc_hagen"); if (x.S.dead.has("npc_hagen")) n = x; }
check("어떤 회차에서는 해낸다", !!n, n && `시드 ${n.run.seed}`);
if (n) {
  play(n, "loot:npc_hagen");
  check("칼과 돈을 챙겼다", G.view(n).player.items.some((i) => i.name === "뼈자루 접이칼") && G.view(n).player.coin > 3);
  play(n, "go:gf_north_barracks", "sleep");
  const vm = G.view(n);
  check("자고 일어나면 점호 광장이다", vm.place.id === "gf_whip_square", vm.time);
  check("통금에 막사 밖에 있었으니 대가가 있을 수 있다", true, `순찰에 걸린 횟수 ${n.S.vars.player_curfew || 0}`);
  for (let i = 0; i < 72 && !n.L.bodies[0].found && !n.ended; i++) play(n, has(n, "wait:60") ? "wait:60" : "sleep");
  check("사흘 안에 누군가 헛간에서 시체를 찾는다 (반응 층 — 일하러 오거나, 사라진 하겐을 찾다가)", !!n.L.bodies[0].found, n.L.bodies[0].found && `${n.L.bodies[0].found.by}`);
}

// 6. 사람들 앞에서 죽이면 — 고발되고, 윗선이 오면 붙잡힌다 (해내는 시드를 찾는다)
let c = null;
for (let s = 1; s < 200 && !c; s++) { const x = G.boot(C, G.newRun({ seed: s })); play(x, "attack:npc_hagen"); if (x.S.dead.has("npc_hagen") && !x.ended) c = x; }
check("수탉에서 사람들 앞에서 하겐을 죽이는 회차가 있다", !!c);
if (c) {
  for (let i = 0; i < 40 && !c.ended; i++) play(c, "wait:60");
  check("본 사람이 고하고, 윗선이 오면 붙잡힌다", c.ended?.kind === "captured", c.ended?.why || `수배 ${G.view(c).player.wanted}`);
  check("붙잡히면 할 수 있는 것은 회귀뿐", G.options(c).length === 1 && G.options(c)[0].id === "regress");
  // 7. 회귀: 세계는 처음으로, 수첩과 알게 된 사실은 남는다
  const next = G.boot(C, G.regressRun(c));
  check("회귀하면 하겐은 다시 살아 있다", !next.S.dead.has("npc_hagen") && G.view(next).people.some((p) => p.id === "npc_hagen"));
  check("회귀해도 지난 죽음·붙잡힘은 기록에 남는다", next.run.carry.deaths.length === 1, next.run.carry.deaths[0]?.why);
  check("회차가 하나 늘었다", next.run.loop === 2);
}

// 8. 지난 회차의 기억으로 숨긴 것을 들먹이면 — 의심을 산다 (잔향 징후)
const k = G.boot(C, G.newRun({ seed: 7, loop: 2, carry: { notebook: [], future: ["fact_gf_egil_family_in_cellar"], deaths: [] } }));
play(k, "talk:npc_bram");
const pr = G.options(k).find((o) => o.id === "press:fact_gf_egil_family_in_cellar");
check("지난 회차에 안 비밀로 몰아붙일 수 있다", !!pr);
if (pr) { const r = play(k, pr.id)[0]; check("아직 들은 적 없는 것을 알면 '이상함' 기억이 남는다", k.M.npc_bram.memories.some((m) => m.tag === "이상함"), r.tier); }

// 9. LLM이 뽑은 기억은 검증을 거쳐 기록에 들어간다
const transcript = [{ who: "player", text: "죽 한 그릇만 더 주세요. 장작은 제가 팰게요." }];
const vm = G.validateMemories(k, "npc_bram", transcript, [
  { npc: "npc_bram", kind: "impression", tag: "쓸모 있음", delta: 9, text: "장작을 패겠다고 했다", evidence: "장작은 제가 팰게요", salience: 3 },
  { npc: "npc_bram", kind: "impression", tag: "영리함", delta: 3, text: "지어낸 기억", evidence: "하지 않은 말", salience: 3 },
]);
check("근거 없는 기억은 버리고, 인상은 ±5로 깎는다", vm.accepted.length === 1 && vm.accepted[0].delta === 5 && vm.rejected.length === 1);
const likeBefore = (k.S.rel.get("npc_bram>player") || { like: 0 }).like;
G.recordMemories(k, "npc_bram", vm.accepted);
check("인상은 관계 수치로 이어진다 (반응 층이 쓰는 마음)", (k.S.rel.get("npc_bram>player")?.like || 0) > likeBefore);
check("기억도 재생된다", fingerprint(G.boot(C, JSON.parse(JSON.stringify(k.run)))) === fingerprint(k));

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
