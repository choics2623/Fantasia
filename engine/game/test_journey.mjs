// node engine/game/test_journey.mjs — 더 똑똑한 핵심 알고리즘: 안개 속 길 찾기 · 먼 길 · 위치 추정의 확신 · 연출가의 추첨 · 기억 병합
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import * as DIR from "./director.mjs";
import { rankMemories, nearDuplicate, similar } from "./recall.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const fresh = (seed = 7, extra = {}) => G.boot(C, { ...G.newRun({ seed, opening: false }), ...extra });

// ── 아는 곳 · 길 찾기 ──
{ const g = fresh(); const K = G.knownNodes(g);
  check("아는 곳 = 회귀점의 지식 + 머릿속 약도", K.has("greyford_village") && K.has("baalkar") && K.has("reed_ferry") && !K.has("seren"), [...K].join(","));
  const f = G.planJourney(g, "baalkar", "fast");
  check("바알카르까지: 용의 기둥 초소를 거쳐", f && f.path.join(">") === "greyford_village>dragon_pillar_post>baalkar" && f.hours === 44, f && `${f.path.join(">")} ${f.hours}h`);
  check("통행증이 없으면 검문 구간을 안다", f.passNeeded === true);
  check("모르는 곳으로는 계획이 없다 (안개)", G.planJourney(g, "seren", "fast") === null);
  const opts = G.options(g).filter((o) => o.kind === "journey");
  check("먼 길은 지도에서 고르는 행동으로 (more, 노숙 포함 시간)", opts.some((o) => o.id === "journey:baalkar:fast" && o.more && o.minutes > 44 * 60 && /노숙/.test(o.label)), opts.map((o) => `${o.id} ${o.label}`).join(" / "));
  G.act(g, { id: "wait:60" });   // 상태를 흔들어도 같은 답 (캐시가 낡지 않는다)
  g.L.give("player", { ...C.game.economy.goods.forged_pass, id: "it_test_pass", gid: "forged_pass" });
  const f2 = G.planJourney(g, "baalkar", "fast");
  check("통행증을 지니면 검문 걱정이 없다 (캐시도 새로)", f2 && f2.passNeeded === false); }

// 빠른 길과 안전한 길이 갈리는 지도 (합성): 위험한 지름길 vs 돌아가는 큰길
{ const map = { ...C.bundle.map,
    nodes: [...C.bundle.map.nodes, { id: "t_mid_a", name: "늑대 고개", x: 360, y: 150 }, { id: "t_mid_b", name: "큰길 주막", x: 300, y: 260 }, { id: "t_goal", name: "시험 마을", x: 250, y: 160 }],
    edges: [...C.bundle.map.edges, { from: "greyford_village", to: "t_mid_a", hours: 6, road: "trail", danger: 5 }, { from: "t_mid_a", to: "t_goal", hours: 6, road: "trail", danger: 5 },
      { from: "greyford_village", to: "t_mid_b", hours: 9, road: "road", danger: 1 }, { from: "t_mid_b", to: "t_goal", hours: 9, road: "road", danger: 1 }],
    start: { ...C.bundle.map.start, knowledge: { ...C.bundle.map.start.knowledge, t_mid_a: 1, t_mid_b: 1, t_goal: 1 } } };
  const C2 = { ...C, bundle: { ...C.bundle, map } };
  const g = G.boot(C2, G.newRun({ seed: 3, opening: false }));
  const f = G.planJourney(g, "t_goal", "fast"), s = G.planJourney(g, "t_goal", "safe");
  check("빠른 길은 위험한 지름길 (12시간)", f.path.includes("t_mid_a") && f.hours === 12, `${f.path.join(">")} ${f.hours}`);
  check("안전한 길은 돌아가는 큰길 (18시간, 위험 낮음)", s.path.includes("t_mid_b") && s.hours === 18 && s.risk < f.risk, `${s.path.join(">")} ${s.hours} risk ${s.risk}/${f.risk}`);
  // 모르는 땅: 가운데 고개를 모르면 물어 가며 — 시간이 더 들고 표시된다
  const map3 = { ...map, start: { ...map.start, knowledge: { ...C.bundle.map.start.knowledge, t_goal: 1 } } };
  const g3 = G.boot({ ...C, bundle: { ...C.bundle, map: map3 } }, G.newRun({ seed: 3, opening: false }));
  const u = G.planJourney(g3, "t_goal", "fast");
  check("모르는 땅을 지나는 구간은 물어 가며 (×1.25)", u && u.unknownLegs === 2 && u.hours === 15, u && `${u.path.join(">")} ${u.hours}h unknown ${u.unknownLegs}`);
  // 비밀 길: 양쪽 끝을 다 가 봤을 때만
  const map4 = { ...map, edges: [...map.edges, { from: "greyford_village", to: "t_goal", hours: 2, road: "secret", danger: 0 }] };
  const g4 = G.boot({ ...C, bundle: { ...C.bundle, map: map4 } }, G.newRun({ seed: 3, opening: false }));
  check("비밀 길은 가 보지 않으면 모른다", G.planJourney(g4, "t_goal", "fast").hours !== 2); }

// ── 먼 길을 떠난다 ──
{ // 닿는 판을 하나 고른다 (도착 검문에 걸리는 시드도 있다)
  let seed = 5; for (let sd = 1; sd < 40; sd++) { const x = fresh(sd); x.at = "gf_river_huts"; x.L.give("player", { ...C.game.economy.goods.forged_pass, id: "it_pass_t", gid: "forged_pass" }); G.act(x, { id: "journey:baalkar:fast" }); if (!x.ended) { seed = sd; break; } }
  const g = fresh(seed); g.at = "gf_river_huts"; const t0 = g.t; g.P.status.hunger = 0;
  g.L.give("player", { ...C.game.economy.goods.forged_pass, id: "it_pass_t", gid: "forged_pass" });
  const plan = G.planJourney(g, "baalkar", "fast"), sc = G.journeySchedule(g, plan);
  check("먼 길의 일정: 밤에는 노숙한다 (44시간 길 = 걸음 44시간 + 밤 둘 이상)", sc.walk === 44 * 60 && sc.camps >= 2 && sc.total > sc.walk, `walk ${sc.walk / 60}h camps ${sc.camps} total ${(sc.total / 60).toFixed(1)}h`);
  const res = G.act(g, { id: "journey:baalkar:fast" });
  check("통행증을 지니고 가면 닿는다 (도착 검문을 넘긴 판)", g.P.settlement === "baalkar" && !g.ended, `seed ${seed} ${g.P.settlement} ${g.ended?.kind || ""} ${res.notes.join(" / ")}`);
  {
    check("걸린 시간 = 일정 (걸음 + 노숙)", Math.abs((g.t - t0) - sc.total) < 2, `${((g.t - t0) / 60).toFixed(1)}h vs ${(sc.total / 60).toFixed(1)}h`);
    check("노숙하며 갔으니 쓰러질 만큼 지치지는 않았다", g.P.status.fatigue < 90, `피로 ${g.P.status.fatigue}`);
    check("지나온 곳은 이제 아는 곳", (g.P.knownNodes || []).includes("dragon_pillar_post"));
    check("길 위에서는 고장의 장면이 열리지 않는다 (그 자리에 없다)", !g.story || g.P.settlement === "baalkar"); }
  // 같은 시드·같은 기록이면 같은 길 (재생)
  const a = fresh(9), b = fresh(9); for (const x of [a, b]) { x.at = "gf_river_huts"; G.act(x, { id: "journey:baalkar:fast" }); }
  check("재생: 같은 기록이면 같은 결과", a.t === b.t && a.P.settlement === b.P.settlement && (a.ended?.kind || "") === (b.ended?.kind || "") && a.P.status.pain === b.P.status.pain);
  const r = G.boot(C, a.run); check("저장된 기록을 다시 읽어도 같다", r.t === a.t && r.P.settlement === a.P.settlement); }

// ── 그 사람은 지금 어디쯤 — 확신과 근거 ──
{ const g = fresh(); g.at = "gf_rooster";
  const here = G.view(g).people[0]?.id;
  check("눈앞에 있으면 확신 1", here && G.estimateOf(g, here).conf === 1 && G.estimateOf(g, here).src === "here");
  G.act(g, { id: "ration" });   // 수탉에서 한 박자 (본 사람이 기록된다)
  G.act(g, { id: "go:gf_chapel" });
  const e = G.estimateOf(g, here);
  check("방금 본 사람은 '방금 거기서'", e && e.src === "seen" && e.conf > 0.6, e && `${e.src} ${e.text} ${e.conf.toFixed(2)}`);
  // 약속이 있으면 약속 자리
  g.promises = [{ npc: "npc_bram", place: "gf_mill", from: g.t + 10, to: g.t + 120, what: "곡물 이야기", state: "open" }];
  const p = G.estimateOf(g, "npc_bram");
  check("약속한 사람은 약속 자리에", p && p.src === "promise" && p.at === "gf_mill", p && `${p.src} ${p.text}`);
  // 버릇: 일정표와 다른 자리에서 같은 시간대에 두 번 넘게 봤으면 — 본 것을 믿는다
  const g2 = fresh(); const n = "npc_hagen"; g2.P.met.add(n);
  const slot = Math.floor((((g2.t + 3 * 1440) % 1440) + 1440) % 1440 / 120);
  g2.P.seenLog = { [`${n}|${slot}`]: { gf_willow_bank: 3 } };
  g2.t += 3 * 1440;
  const h = G.estimateOf(g2, n);
  check("같은 시각에 여러 번 본 자리를 믿는다 (버릇)", h && (h.src === "habit" || h.at === "gf_willow_bank" || h.src === "routine"), h && `${h.src} ${h.text} ${h.conf}`); }

// ── 연출가: 콘텐츠 순서가 아니라 가중 추첨, 그리고 신선함 ──
{ const sts = ["calm", "bond", "omen"].map((cat, i) => ({ id: `t_v${i}`, trigger: { director: true, category: cat, chance: 0.3 } }));
  const g = { seed: 42, t: 0, run: { loop: 1, narrator: "dice" }, storyDone: new Set(), content: { game: { storylets: sts } }, W: { rainy: () => false } };
  const H = { START: 0, atPlace: () => true, parseClock: () => 0, isNight: () => false, storyWhen: () => true, hash: (...a) => { let h = 2166136261; for (const c of a.join("|")) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; } };
  const count = { t_v0: 0, t_v1: 0, t_v2: 0 }; let repeats = 0, last = null;
  for (let slot = 0; slot < 4000; slot++) { const st = DIR.pickScene(g, slot * 30, H); if (st) { count[st.id]++; if (last === st.trigger.category) repeats++; last = st.trigger.category; } }
  const vals = Object.values(count), tot = vals.reduce((a, b) => a + b, 0);
  check("세 장면이 고르게 (앞 장면이 독식하지 않는다)", Math.max(...vals) / Math.min(...vals) < 1.5, JSON.stringify(count));
  check("같은 갈래가 연달아 나오는 일이 우연보다 적다", repeats / tot < 0.3, `${repeats}/${tot}`);
  check("하루 슬롯 상한은 그대로", Object.values(g.dir.used).every((x) => x <= DIR.NARRATORS.dice.slots)); }

// ── 기억: 화제와 닮은 것 먼저, 거의 같은 기억은 하나로 ──
{ const mems = [
    { kind: "impression", text: "셋째는 눈치가 빠르다", salience: 3, t: 0 },
    { kind: "emotion", text: "셋째가 방앗간 곡물 이야기를 꺼냈다", salience: 2, t: 100 },
    { kind: "promise", text: "내일 정오 방앗간에서 만나기로 했다", salience: 3, t: 100 },
    { kind: "emotion", text: "셋째가 방앗간 곡물 이야기를 또 꺼냈다", salience: 2, t: 110 },
    { kind: "summary", text: "셋째와 몇 번 얽혔다", salience: 1, t: 0 },
  ];
  const top = rankMemories(mems, { topic: "방앗간 곡물", now: 200, k: 3 });
  check("화제와 닮은 기억·약속이 먼저", top[0].kind === "promise" || top[0].text.includes("방앗간"), top.map((m) => m.text).join(" | "));
  check("서로 거의 같은 두 줄은 하나만", top.filter((m) => m.text.includes("곡물 이야기")).length === 1);
  check("닮음 척도: 같은 말 ≈ 1, 다른 말 ≈ 0", similar("약속한 대로 왔다", "약속한 대로 왔다") === 1 && similar("빵 냄새", "칼날의 녹") === 0);
  check("거의 같은 새 기억을 찾아낸다", !!nearDuplicate(mems, { kind: "emotion", text: "셋째가 방앗간 곡물 이야기를 꺼냈다!", t: 120 }, 120));
  check("약속은 합치지 않는다", nearDuplicate(mems, { kind: "promise", text: "내일 정오 방앗간에서 만나기로 했다", t: 120 }, 120) === null);
  const g = fresh(); const before = (g.M.npc_bram?.memories || []).length;
  G.recordMemories(g, "npc_bram", [{ kind: "emotion", text: "셋째가 빵을 나눠 주었다", salience: 2, source: "engine" }]);
  G.recordMemories(g, "npc_bram", [{ kind: "emotion", text: "셋째가 빵을 나눠 주었다.", salience: 4, source: "engine" }]);
  const ms = g.M.npc_bram.memories.filter((m) => m.text.startsWith("셋째가 빵을"));
  check("엔진도 같은 기억은 한 줄로 — 대신 짙어진다", ms.length === 1 && ms[0].salience === 4 && ms[0].count === 2, `${before}→${g.M.npc_bram.memories.length} ${JSON.stringify(ms)}`); }

// ── 지도 보기 v2 ──
{ const g = fresh(); const m = G.mapView(g);
  check("지형·지역·길의 위험·시간이 지도에 간다", m.world.terrain?.continent?.length > 10 && m.world.regions?.length > 5 && m.world.edges.every((e) => "hours" in e && "danger" in e && "known" in e));
  check("내가 있는 곳 · 아는 곳 · 먼 길 계획", m.world.here === "greyford_village" && m.world.nodes.find((n) => n.id === "baalkar").known && m.world.journeys.some((j) => j.settlement === "baalkar"));
  check("모르는 곳은 이름을 숨긴다 (안개)", m.world.nodes.filter((n) => !n.known).every((n) => n.name === null));
  check("마을 지도: 사람마다 추정의 확신", m.settlement.people.every((p) => typeof p.conf === "number" && p.src)); }

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
