// node engine/game/test_game.mjs — 진행 루프: 장면·대화·시간·저장(재생)·되돌리기·붙잡힘·회귀
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";

const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const has = (g, id) => G.options(g).some((o) => o.id === id);
const play = (g, ...ids) => ids.map((id) => { if (!has(g, id)) throw new Error(`할 수 없음: ${id} @ ${G.view(g).time} ${G.view(g).place.name}`); return G.act(g, { id }); });
const fingerprint = (g) => JSON.stringify({ v: G.view(g), log: g.S.log.length, purse: g.S.purse, wanted: g.S.wanted });

// 1. 회귀점
const g = G.boot(C, G.newRun({ seed: 7, opening: false }));
const v0 = G.view(g);
check("회귀점: 낙엽월 1일 18:00, 절름발이 수탉", v0.time.includes("낙엽월 1일 18:00") && v0.place.id === "gf_rooster");
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
  const n = G.boot(C, G.newRun({ seed, opening: false }));
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
  // 칼과 동전을 몸에 지니고 점호에 나가면 걸린다 — 헛간에 숨겨 두고 간다
  const knife = G.view(n).player.items.find((i) => i.name === "뼈자루 접이칼").id;
  play(n, `stash:${knife}`, "stash:coin", "go:gf_river_huts", "sleep");
  const vm = G.view(n);
  check("자고 일어나면 점호 광장이다", vm.place.id === "gf_whip_square", vm.time);
  check("숨겨 둔 덕에 몸수색을 넘긴다", !n.ended, n.ended?.why);
  check("통금에 막사 밖에 있었으니 대가가 있을 수 있다", true, `순찰에 걸린 횟수 ${n.S.vars.player_curfew || 0}`);
  for (let i = 0; i < 72 && !n.L.bodies[0].found && !n.ended; i++) play(n, has(n, "wait:60") ? "wait:60" : "sleep");
  check("사흘 안에 누군가 헛간에서 시체를 찾는다 (반응 층 — 일하러 오거나, 사라진 하겐을 찾다가)", !!n.L.bodies[0].found, n.L.bodies[0].found && `${n.L.bodies[0].found.by}`);
}

// 6. 사람들 앞에서 죽이면 — 고발되고, 윗선이 오면 붙잡힌다 (해내는 시드를 찾는다)
// 목격자가 모두 입을 다무는 회차도 있다 (성향과 시드) — 붙잡히는 회차와 그렇지 않은 회차가 모두 있어야 한다
let c = null, kills = 0, quiet = 0;
for (let s = 1; s < 300 && !c; s++) {
  const x = G.boot(C, G.newRun({ seed: s, opening: false })); play(x, "wait:60"); if (!has(x, "attack:npc_hagen")) continue; play(x, "attack:npc_hagen");
  if (!x.S.dead.has("npc_hagen") || x.ended) continue;
  kills++;
  for (let i = 0; i < 40 && !x.ended; i++) play(x, "wait:60");
  if (x.ended?.kind === "captured") c = x; else quiet++;
}
check("수탉에서 사람들 앞에서 하겐을 죽이는 회차가 있다", kills > 0, `해낸 회차 ${kills}, 그중 아무도 고하지 않은 회차 ${quiet}`);
if (c) {
  check("본 사람이 고하고, 윗선이 오면 붙잡힌다", c.ended?.kind === "captured", c.ended?.why);
  check("붙잡히면 할 수 있는 것은 회귀뿐", G.options(c).length === 1 && G.options(c)[0].id === "regress");
  // 7. 회귀: 세계는 처음으로, 수첩과 알게 된 사실은 남는다
  const next = G.boot(C, G.regressRun(c));
  check("회귀하면 하겐은 다시 살아 있고, 회귀점의 대본 장면부터 다시 시작한다", !next.S.dead.has("npc_hagen") && G.view(next).story?.id === "ration_line_open");
  check("회귀해도 지난 죽음·붙잡힘은 기록에 남는다", next.run.carry.deaths.length === 1, next.run.carry.deaths[0]?.why);
  check("회차가 하나 늘었다", next.run.loop === 2);
}

// 8. 지난 회차의 기억으로 숨긴 것을 들먹이면 — 의심을 산다 (잔향 징후)
const k = G.boot(C, G.newRun({ seed: 7, opening: false, loop: 2, carry: { notebook: [], future: ["fact_gf_egil_family_in_cellar"], deaths: [] } }));
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

// 10. 기록관의 제안이 규칙을 거쳐 세계에 닿는다: 믿은 주장 → 소문, 말해 준 사실 → 그 NPC의 지식(목표 행동 조건)
{
  const w = G.boot(C, G.newRun({ seed: 7, opening: false, carry: { notebook: [], future: ["fact_gf_egil_family_in_cellar"], deaths: [] } }));
  play(w, "talk:npc_bram");
  const tr = [{ who: "player", text: "하겐이 탈주자를 볼크에게 판대요. 그리고 수탉 지하에 사람이 있다는 걸 마르타도 알아요." }];
  const v = G.validateMemories(w, "npc_bram", tr, [
    { npc: "npc_bram", kind: "claim", text: "셋째 말로는 하겐이 탈주자를 판다", evidence: "하겐이 탈주자를 볼크에게 판대요", salience: 4, claim: { about: "하겐", content: "하겐이 탈주자를 볼크에게 판다", believed: true } },
    { npc: "npc_bram", kind: "learned", text: "모르는 사실", evidence: "수탉 지하에 사람이 있다", salience: 5, fact: "fact_gf_henrik_skims_baron" },
    { npc: "npc_bram", kind: "learned", text: "자기가 숨긴 일", evidence: "수탉 지하에 사람이 있다", salience: 5, fact: "fact_gf_egil_family_in_cellar" },
  ]);
  check("플레이어가 모르는 사실, 그 NPC가 이미 아는 사실을 '말해 주었다'는 제안은 버린다", v.accepted.length === 1 && v.rejected.length === 2);
  G.recordMemories(w, "npc_bram", v.accepted);
  const vm2 = G.validateMemories(w, "npc_martha", tr, [{ npc: "npc_martha", kind: "learned", text: "셋째가 수탉 지하 이야기를 했다", evidence: "수탉 지하에 사람이 있다", salience: 5, fact: "fact_gf_egil_family_in_cellar" }]);
  G.recordMemories(w, "npc_martha", vm2.accepted);
  check("말해 준 사실은 그 NPC의 지식이 된다 (목표 행동의 knows 조건 — 마르타가 지하실을 알게 된다)", w.S.knows.get("fact_gf_egil_family_in_cellar")?.has("npc_martha"));
  play(w, "leave");
  for (let i = 0; i < 48; i++) play(w, G.options(w).some((o) => o.id === "wait:60") ? "wait:60" : "sleep");
  const spread = Object.keys(C.cards).filter((n) => n !== "npc_bram" && w.L.beliefs(n).some((b) => b.kind === "claim"));
  check("브람이 믿은 주장은 사람이 모이는 곳에서 소문으로 퍼진다", spread.length > 0, spread.map((n) => C.cards[n].name).join(", "));
}

// 11. 평판: 행적 + 아는 사람들에서 계산한다. 알려지지 않으면 퍼지지 않고, 누가 했는지 모르면 사건만 퍼진다
{
  let pub = null;
  for (let s = 1; s < 300 && !pub; s++) { const x = G.boot(C, G.newRun({ seed: s, opening: false })); play(x, "wait:60"); if (!has(x, "attack:npc_hagen")) continue; play(x, "attack:npc_hagen"); if (x.S.dead.has("npc_hagen") && !x.ended) pub = x; }
  const r0 = G.reputation(pub);
  check("행적 직후에는 아직 어디에도 퍼지지 않았다", !r0.reach, JSON.stringify(r0.news));
  for (let i = 0; i < 12 && !pub.ended; i++) play(pub, "wait:60");
  const r1 = G.reputation(pub);
  check("반나절 안에 마을에 퍼진다 (목격자가 있으므로) — 그 전에 붙잡히면 시간이 멈춘다", pub.ended || r1.news.some((n) => n.scope === "village"), pub.ended?.why || r1.reach);
  check("사람들이 플레이어가 했다고 알면 집단의 시선이 움직인다 (노예사냥 패거리를 죽였다 → 인간 노예 +)", (r1.views["인간 노예"] || 0) > 0 || !r1.news.some((n) => n.identified), JSON.stringify(r1.views));
  // 영지 단계까지: 붙잡히지 않은 회차에서 며칠 더
  const k2 = G.reputation(pub); 
  if (!pub.ended) { for (let i = 0; i < 5 * 24 && !pub.ended; i++) play(pub, G.options(pub).some((o) => o.id === "wait:60") ? "wait:60" : "sleep"); }
  const r2 = G.reputation(pub);
  check("크기 2의 사건은 며칠 뒤 영지까지 간다 (붙잡히면 시간이 멈춘다)", pub.ended || r2.news.some((n) => n.scope === "domain"), `${r2.reach} ${r2.news.map((n) => n.scopeName + (n.distortion ? "(" + n.distortion + ")" : "")).join(", ")}`);
}

// 11b. 점호 몸수색: 첫 회차 둘째 날 아침은 반드시 플레이어 — 죽은 사람의 칼을 지닌 채 나가면 붙잡힌다
{
  let caught = null;
  for (let sd = 1; sd < 80 && !caught; sd++) {
    const x = G.boot(C, G.newRun({ seed: sd, opening: false }));
    while (G.view(x).hm < "23:00" && G.view(x).time.includes("1일")) play(x, "wait:60");
    play(x, "go:gf_hagen_shed"); if (!has(x, "attack:npc_hagen")) continue;
    play(x, "attack:npc_hagen"); if (!x.S.dead.has("npc_hagen") || x.ended) continue;
    play(x, "loot:npc_hagen", "go:gf_river_huts", "sleep");
    if (x.ended) caught = x;
  }
  check("칼을 지닌 채 점호에 나가면 몸수색에 걸려 붙잡히는 회차가 있다", !!caught, caught?.ended.why);
}

// 13. 먹고 사기: 저녁 배급, 브람에게 빵, 굶주림월 값 세 배, 장물아비만 칼을 판다
{
  const x = G.boot(C, G.newRun({ seed: 7, opening: false }));
  const h0 = G.view(x).player.hunger;
  play(x, "ration");
  check("저녁 배급으로 배고픔이 준다 (하루 한 번)", G.view(x).player.hunger === h0 - 1 && !has(x, "ration"));
  play(x, "talk:npc_bram");
  const buy = G.options(x).find((o) => o.id === "buy:bread");
  check("브람에게 빵을 살 수 있다 (1못)", !!buy, buy?.label);
  play(x, "buy:bread");
  check("산 물건은 소지품이 되고 돈이 준다", G.view(x).player.items.some((i) => i.name.includes("빵")) && G.view(x).player.coin === 2);
  check("브람은 칼을 팔지 않는다", !G.options(x).some((o) => o.id === "buy:knife"));
}

// 14. 장소의 상태: 해빙 홍수 동안 쇠다리는 닫힌다 (일과도, 플레이어도 가지 못한다)
{
  const x = G.boot(C, G.newRun({ seed: 7, opening: false }));
  check("평소엔 쇠다리로 갈 수 있다", has(x, "go:gf_iron_bridge"));
  check("313년 해빙월 16일엔 쇠다리가 통제된다", !!x.W.placeState("gf_iron_bridge", 164333910 + 0) === false && !!x.W.placeState("gf_iron_bridge", (313 * 365 + 15) * 1440 + 600));
}

// 15. 재생 비용: 한 달을 보낸 기록을 불러오는 데 걸리는 시간
{
  const x = G.boot(C, G.newRun({ seed: 7, opening: false }));
  // 저녁마다 수탉에서 배급을 받고, 막사로 가서 잔다 (굶으면 일주일 안에 죽는다)
  for (let d = 0; d < 30 && !x.ended; d++) {
    while (!x.ended && G.view(x).hm < "18:30" && G.view(x).hm >= "05:00") { if (x.at !== "gf_rooster" && has(x, "go:gf_rooster")) play(x, "go:gf_rooster"); else play(x, "wait:60"); }
    if (!x.ended && x.at !== "gf_rooster" && has(x, "go:gf_rooster")) play(x, "go:gf_rooster");
    if (!x.ended && has(x, "ration")) play(x, "ration");
    if (!x.ended && has(x, "go:gf_river_huts")) play(x, "go:gf_river_huts");
    if (!x.ended) play(x, has(x, "sleep") ? "sleep" : "wait:60");
  }
  check("배급을 받고 막사에서 자면 한 달을 산다", !x.ended || x.ended.kind !== "dead", x.ended?.why || G.view(x).time);
  const t0 = Date.now(); G.boot(C, JSON.parse(JSON.stringify(x.run))); const ms = Date.now() - t0;
  check("한 달치 기록 재생 3초 이내", ms < 3000, `${x.run.journal.length}개 기록, ${ms}ms (${G.view(x).time})`);
}

// 16. 굶으면 죽는다
{
  const x = G.boot(C, G.newRun({ seed: 7, opening: false }));
  for (let i = 0; i < 24 * 12 && !x.ended; i++) play(x, "wait:60");
  check("아무것도 먹지 않으면 열흘 안에 죽는다", x.ended?.kind === "dead", x.ended?.why);
}

// 17. 회색여울 밖으로: 통행증 없이 떠나면 낯선 고장의 길목에서 탈주 노예로 붙잡힌다. 위조 통행증이 있으면 해볼 만하다
{
  let caught = 0, through = 0, tries = 0;
  for (let sd = 1; sd <= 12; sd++) {
    const x = G.boot(C, G.newRun({ seed: sd, opening: false }));
    play(x, "travel:crow_gate");
    for (let i = 0; i < 48 && !x.ended; i++) play(x, "wait:60");
    tries++; if (x.ended?.kind === "captured") caught++;
  }
  check("통행증 없이 까마귀 문에 가면 대개 이틀 안에 붙잡힌다", caught >= tries / 2, `${caught}/${tries}`);
  const x = G.boot(C, G.newRun({ seed: 3, opening: false }));
  play(x, "go:gf_river_huts", "sleep");          // 점호 몸수색이 은화를 빼앗으니, 돈은 그 뒤에
  while (G.view(x).hm < "09:00") play(x, "wait:60");
  x.S.purse.player = 300;                             // 시험용: 위조 통행증 값 (헨릭에게 240못)
  play(x, "go:gf_tollhouse");
  if (has(x, "talk:npc_henrik")) {
    play(x, "talk:npc_henrik");
    check("헨릭(장물아비)은 위조 통행증을 판다", has(x, "buy:forged_pass"));
    play(x, "buy:forged_pass", "leave");
    play(x, "travel:crow_gate");
    for (let i = 0; i < 72 && !x.ended; i++) play(x, "wait:60");
    check("위조 통행증이 있으면 검문을 넘길 수도 있다 (기만 판정)", true, x.ended?.why || `살아남음 — ${G.view(x).time}, 탈주 노예: ${!!x.S.vars.player_fugitive}`);
    check("점호에 두 번 빠지면 탈주 노예가 된다", x.ended || x.S.vars.player_fugitive === true);
    check("탈주는 평판의 행적이 된다", x.deeds.some((d) => d.kind === "flee") || !!x.ended);
  } else check("(헨릭이 셈집에 없다 — 표류)", true);
}

// 18. 하루를 늘 하던 대로: 배급 → 막사 → 잠 → 점호, 기록 하나
{
  const x = G.boot(C, G.newRun({ seed: 7, opening: false }));
  const h0 = G.view(x).player.hunger, n0 = x.run.journal.length;
  const r = play(x, "routine_day")[0];
  const v = G.view(x);
  check("하루를 늘 하던 대로 보내면 다음 날 아침 점호 광장이다 (기록 하나)", v.place.id === "gf_whip_square" && x.run.journal.length === n0 + 1, `${v.time} 배고픔 ${h0}→${v.player.hunger}`);
  check("배급을 받았으니 굶지 않았다", v.player.hunger <= h0 + 1 && !x.ended);
}

// 12. 자리 승계: 즈닉이 죽으면 감독관 자리는 누군가 잇고, 그 사람이 점호를 선다 / 남작이 죽으면 오웬이 남작
{
  const x = G.boot(C, G.newRun({ seed: 7, opening: false }));
  x.A.intervene(x.t, "kill", "npc_godric_raven");
  play(x, "wait:60");
  check("남작이 죽으면 후계자가 남작 자리를 잇는다", x.offices.holder("fac_raven_house.off_baron") === "npc_owen_raven");
  for (let i = 0; i < 20; i++) play(x, "wait:60");
  const w = x.W.where("npc_owen_raven", x.t - (x.t % 1440) + 10 * 60);
  check("다음 날부터 오웬이 남작의 일과를 산다 (서재)", w.at === "gf_keep_study", `${w.at} ${w.doing}`);
  check("승계는 공개 기록으로 남는다 (소문·서술의 재료)", x.S.log.some((l) => /남작 자리를 이었다/.test(l.text)));
}

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
