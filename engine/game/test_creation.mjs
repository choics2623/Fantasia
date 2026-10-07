// node engine/game/test_creation.mjs — 캐릭터 생성 (06): 셋째의 다섯 갈래 · 능력치 · 재능의 등급과 효과 · 결점 · 운명의 주사위 · 숨은 재능 · 회귀 각성
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import * as CR from "./creation.mjs";
import { createSession } from "./session.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ORIGINS = ["serf", "keep_servant", "smith_hand", "chapel_ringer", "hill_runaway"];
const mk = (build, { seed = 21, opening = true, run = {} } = {}) => G.boot(C, { ...G.newRun({ seed, opening }), ...run, build: CR.finalizeBuild(C, build, seed) });
const ids = (g) => G.options(g).map((o) => o.id);
const optOf = (g, id) => G.options(g).find((o) => o.id === id);
const named = (g) => { G.act(g, { id: "story_name", text: "하린|누나" }); return g; };
const toTime = (g, hhmm) => { const [h, m] = hhmm.split(":").map(Number); let target = Math.floor(g.t / 1440) * 1440 + h * 60 + m; if (target <= g.t) target += 1440; while (g.t < target && !g.ended) G.act(g, { id: "wait:60" }); };

// ── 검사: 점수와 한계 ──
{ const ok = CR.checkBuild(C, { origin: "smith_hand", alloc: { 근력: 2, 체질: 2 }, talents: { brawler: 2, iron_body: 1, pain_tolerance: 1, lock_hands: 1, iron_gut: 1 } });
  check("추천 조합은 10점에 딱 맞는다", ok.ok && ok.tp.left === 0, JSON.stringify(ok.tp));
  check("점수가 넘치면 막는다", !CR.checkBuild(C, { talents: { tongue: 3, deceit: 2 } }).ok);
  check("능력치는 자유 4점까지, 생성 때 15까지", !CR.checkBuild(C, { alloc: { 지능: 5 } }).ok && !CR.checkBuild(C, { origin: "hill_runaway", alloc: { 감각: 4 } }).ok && CR.checkBuild(C, { origin: "hill_runaway", alloc: { 감각: 3 } }).ok);
  check("천재는 셋까지", !CR.checkBuild(C, { talents: { night_eyes: 3, weather: 3, iron_gut: 3, people_memory: 3 }, flaws: ["lame", "deep_echo"] }).ok);
  const fl = CR.checkBuild(C, { flaws: ["lame", "deep_echo", "enemy_blood"], talents: { tongue: 3 } });
  check("결점의 환급은 여덟까지 (12점어치를 골라도 +8)", fl.tp.refund === 8 && fl.tp.refundRaw === 12, JSON.stringify(fl.tp));
  check("운명의 주사위는 +2", CR.checkBuild(C, { dice: true }).tp.left === 12);
  check("모르는 것은 막는다", !CR.checkBuild(C, { origin: "dragon_king" }).ok && !CR.checkBuild(C, { talents: { sword_god: 1 } }).ok && !CR.checkBuild(C, { flaws: ["nope"] }).ok); }

// ── 마무리: 주사위와 숨은 재능은 시드가 정한다 ──
{ const b = { origin: "serf", talents: { tongue: 1 }, dice: true };
  const a1 = CR.finalizeBuild(C, b, 99), a2 = CR.finalizeBuild(C, b, 99), a3 = CR.finalizeBuild(C, b, 100);
  check("같은 시드면 같은 주사위·같은 숨은 재능", JSON.stringify(a1) === JSON.stringify(a2) && a1.diceResult?.talent);
  check("숨은 재능 둘 — 고른 것·주사위와 겹치지 않는다", a1.hidden.length === 2 && !a1.hidden.includes("tongue") && !a1.hidden.includes(a1.diceResult.talent));
  check("다른 시드면 대개 다르다", JSON.stringify(a1) !== JSON.stringify(a3));
  const up = CR.finalizeBuild(C, { talents: Object.fromEntries(C.game.creation.talents.map((t) => [t.id, 1])), dice: true }, 5);
  check("주사위가 가진 재능을 고르면 한 등급 위로", up.diceResult.tier === 2 && up.diceResult.from === 1);
  check("탄생 서사 한 줄", /레이번 성채의 부엌데기\. .+\./.test(CR.birthLine(C, CR.finalizeBuild(C, { origin: "keep_servant", talents: { deceit: 2 } }, 3)))); }

// ── 다섯 갈래: 같은 저녁, 다른 자리 ──
for (const o of ORIGINS) {
  const def = CR.originDef(C, o), g = mk({ origin: o });
  const v = G.view(g);
  check(`${def.name}: 회귀점 (${def.start}) · 대본 장면 ${def.opening}`, g.at === def.start && v.story?.id === def.opening && v.origin.id === o, `${g.at} ${v.story?.id}`);
  check(`${def.name}: 소지품·돈`, v.player.coin === (def.coin ?? 3) && (def.items || []).every((it) => v.player.items.some((x) => x.name === (it.name || C.game.economy.goods[it.gid]?.name))), `${v.player.coin} ${v.player.items.map((i) => i.name)}`);
  named(g);
  check(`${def.name}: 이름 다음 장면에서 키트의 명단을 안다`, g.S.vars.goal_kit_known === true && G.view(g).goals.some((x) => x.who === "키트"), G.view(g).story?.id);
}
{ const sm = mk({ origin: "smith_hand" }), rn = mk({ origin: "hill_runaway" }), ri = mk({ origin: "chapel_ringer" }), ks = mk({ origin: "keep_servant" });
  check("풀무꾼: 근력 11 → 싸움이 쓸 만하다, 브란이 믿는다, 숨긴 창날을 안다", G.view(sm).skills.find((k) => k.name === "싸움").word === "어설프다" && sm.S.rel.get("npc_bran>player")?.trust === 30 && sm.P.knows.has("fact_gf_bran_spearheads"));
  check("종지기: 이름과 짧은 말을 읽는다, 납골실을 안다, 오스릭이 스승이 될 수 있다", G.view(ri).skills.find((k) => k.name === "읽고쓰기").word === "이름과 짧은 말을 읽는다" && ri.P.knowsPlaces.has("gf_chapel_ossuary") && ri.S.rel.get("npc_osric>player")?.trust >= 25);
  check("하인: 성채가 드나드는 곳이다 (몰래 들 필요 없이)", (() => { named(ks); return !optOf(ks, "go:gf_keep")?.skill; })(), optOf(ks, "go:gf_keep")?.label);
  check("탈주 노예: 처음부터 쫓긴다, 배고프다, 늑대굴을 안다", rn.S.vars.player_fugitive === true && G.view(rn).player.wantedWord && G.view(rn).player.hunger === 3 && rn.P.knows.has("fact_gf_wolf_den")); }

// ── 능력치 → 몸 ──
{ const a = mk({ origin: "serf" }, { opening: false }), b = mk({ origin: "serf", alloc: { 근력: 3, 의지: 1 } }, { opening: false }), f = mk({ origin: "serf", flaws: ["frail"] }, { opening: false });
  check("정본의 농노는 예전 몸 그대로 (근력 8, 감각 11)", a.P.mods.근력 === -0.5 && a.P.mods.감각 === 1 && a.P.mods.체질 === 0);
  check("자유 배분이 몸에 (근력 8+3 = 11)", b.P.mods.근력 === 1 && b.P.mods.의지 === 0.5);
  check("허약 체질 = 체질 −2 → 싸움의 몸 상한이 낮다", f.P.mods.체질 === -1 && G.bodyCap(f, "싸움") < G.bodyCap(a, "싸움"), `${G.bodyCap(f, "싸움")} < ${G.bodyCap(a, "싸움")}`);
  check("짐의 한도도 근력을 따른다", G.view(b).load.cap > G.view(a).load.cap); }

// ── 재능: 등급마다 ──
{ const base = mk({ origin: "serf" }, { opening: false }), t1 = mk({ origin: "serf", talents: { tongue: 1 } }, { opening: false }), t3 = mk({ origin: "serf", talents: { tongue: 3 }, flaws: ["lame"] }, { opening: false });
  check("처음부터 얹히는 손: 소질 +4 · 천재 +8", G.skill(t1, "화술") - G.skill(base, "화술") === 4 && G.skill(t3, "화술") - G.skill(base, "화술") === 8);
  const info = (g) => G.view(g).skills.find((k) => k.name === "화술").notes.map((n) => n.text).join(" ");
  check("성장의 눈금에 '타고났다 (등급)'", /타고났다 \(소질\)/.test(info(t1)) && /타고났다 \(천재\)/.test(info(t3)), info(t3));
  check("화면의 재능 목록에 등급과 효과", G.view(t3).talents.some((t) => t.id === "tongue" && t.tierName === "천재" && t.effect)); }
{ const hungry = (b) => { const g = mk({ origin: "serf", ...b }, { opening: false }); g.P.status.hunger = 2; return G.odds(g, { skill: "화술", id: "x" }).parts.some((p) => p.text.includes("배가 고프다")); };
  check("무쇠 위장: 출출한 배는 판정을 누르지 않는다", hungry({}) && !hungry({ talents: { iron_gut: 1 } })); }
{ const pain = (b) => { const g = mk({ origin: "serf", ...b }, { opening: false }); g.P.status.pain = 70; return G.odds(g, { skill: "화술", id: "x" }).S; };
  check("고통 내성: 아픔이 덜 누른다 (천재 > 소질 > 없음)", pain({ talents: { pain_tolerance: 3 } }) > pain({ talents: { pain_tolerance: 1 } }) && pain({ talents: { pain_tolerance: 1 } }) > pain({})); }
{ const dark = (b) => { const g = mk({ origin: "serf", ...b }, { opening: false }); g.t = Math.ceil(g.t / 1440) * 1440 - 120; return G.odds(g, optOf(g, "search")); };
  const d0 = dark({}), d3 = dark({ talents: { night_eyes: 3 } });
  check("어둠눈: 불 없이도 어둠이 걸리지 않는다", d0.parts.some((p) => p.text.includes("어둡다 — 손으로")) && !d3.parts.some((p) => p.text.includes("어둡다 — 손으로")) && d3.S - d0.S === 10, `${d0.S} → ${d3.S}`); }
{ const fist = (b, knife) => { const g = mk({ origin: "serf", ...b }, { opening: false }); if (knife) g.L.give("player", { ...C.game.economy.goods.knife, id: "it_k", gid: "knife" }); return G.odds(g, G.options(g).find((o) => o.id.startsWith("attack:"))).S; };
  check("무투가: 맨손일 때만 맨손의 덤 (수재: 손 +5, 맨손 +5)", fist({ talents: { brawler: 2 } }, false) - fist({}, false) === 10 && fist({ talents: { brawler: 2 } }, true) - fist({}, true) === 5, `${fist({}, false)} → ${fist({ talents: { brawler: 2 } }, false)}`);
  check("단검의 재능: 날을 쥐면 낫다", fist({ talents: { knife_hand: 3 } }, true) - fist({}, true) === 8 + 6); }
{ const g = mk({ origin: "serf", talents: { spatial: 1 } }, { opening: false });
  G.act(g, { id: "wait:60" });   // 수탉에 이미 있다 — 숨은 지하는 들어선 순간에만 (처음 들어설 때)
  const g2 = mk({ origin: "smith_hand", talents: { spatial: 1 } }, { opening: false });
  const r = G.act(g2, { id: "go:gf_rooster" });
  check("공간 지각: 처음 들어선 건물의 숨은 방을 알아챈다", g2.P.knowsPlaces.has("gf_rooster_cellar") && (r.feed || []).some((f) => f.text.includes("숨은 자리")), (r.feed || []).map((f) => f.text).join(" / ")); }
{ const g = mk({ origin: "serf", talents: { weather: 2 } }, { opening: false });
  const f = G.view(g).forecast;
  check("날씨 읽기: 사흘 앞의 비", f?.length === 3 && f.every((x, i) => x.rain === !!g.W.rainy(Math.floor(g.t / 1440) + i + 1)), JSON.stringify(f));
  check("재능이 없으면 예보도 없다", G.view(mk({ origin: "serf" }, { opening: false })).forecast === null); }
{ const s0 = G.smellOf({ ...mk({ origin: "serf" }, { opening: false }), run: { ...G.newRun({ seed: 1, loop: 4 }), build: CR.finalizeBuild(C, { origin: "serf" }, 1) } });
  const deep = mk({ origin: "serf", flaws: ["deep_echo"] }, { opening: false }), mute = mk({ origin: "serf", talents: { ash_mute: 3 }, flaws: ["deep_echo"] }, { opening: false });
  check("짙은 잔향: 첫 회차부터 세 번째 회차만큼", Math.abs(G.smellOf(deep) - 3 * 2 ** 0.7) < 1e-9, G.smellOf(deep).toFixed(2));
  check("재 냄새 억제: 천재면 −75%", Math.abs(G.smellOf(mute) - G.smellOf(deep) * 0.25) < 1e-9 && s0 > 0); }
{ const eb = mk({ origin: "serf", flaws: ["enemy_blood"] }, { opening: false });
  check("원수의 피: 첫 회차부터 볼크가 냄새를 쫓는다", eb.nem?.npc_volk?.grudge >= 2 && eb.nem.npc_volk.track >= 1);
  const cw = mk({ origin: "serf", flaws: ["coward"] }, { opening: false });
  check("겁쟁이: 용기 −40에서 시작", cw.P.temper.용기 === -40);
  const st = mk({ origin: "serf", flaws: ["stutter"] }, { opening: false }), plain = mk({ origin: "serf" }, { opening: false });
  check("말더듬: 화술 −10", G.odds(plain, { skill: "화술", id: "x" }).S - G.odds(st, { skill: "화술", id: "x" }).S === 10 && G.odds(st, { skill: "화술", id: "x" }).parts.some((p) => p.text.includes("말이 목에 걸린다")));
  const lm = mk({ origin: "serf", flaws: ["lame"] }, { opening: false });
  check("절름발이: 걷는 시간이 길다", optOf(lm, "go:gf_chapel").minutes > optOf(plain, "go:gf_chapel").minutes, `${optOf(plain, "go:gf_chapel").minutes} → ${optOf(lm, "go:gf_chapel").minutes}`); }

// ── 갈래의 의무 ──
{ const ks = named(mk({ origin: "keep_servant" }));
  G.act(ks, { id: G.options(ks).find((o) => o.id.startsWith("story:serve_on")) ? "story:serve_on" : G.options(ks)[0].id });
  if (ks.at !== "gf_keep_servants") G.act(ks, { id: "go:gf_keep_servants" });
  for (let i = 0; i < 4 && !ids(ks).includes("meal"); i++) G.act(ks, { id: "wait:60" });
  check("하인의 저녁: 부엌에서 남은 것 (하인 숙소)", ids(ks).includes("meal"), ids(ks).filter((x) => !x.startsWith("talk")).slice(0, 8).join(","));
  const h0 = ks.P.status.hunger; G.act(ks, { id: "meal" });
  check("먹으면 배가 찬다", ks.P.status.hunger === Math.max(0, h0 - 1));
  G.act(ks, { id: "go:gf_well_square" });
  toTime(ks, "21:30");
  check("마르타의 저녁 점고: 성채 밖에 있으면 점이 찍힌다", ks.S.vars.player_missed_count === 1);
  G.act(ks, { id: "go:gf_keep" }); G.act(ks, { id: "go:gf_keep_servants" }); G.act(ks, { id: "sleep" });   // 성문 안으로, 그리고 하인 숙소로
  check("하인은 새벽 점호 광장에 끌려가지 않는다", ks.at === "gf_keep_servants" && !ks.ended, ks.at); }
{ const sm = named(mk({ origin: "smith_hand" }));
  G.act(sm, { id: "story:keep_bellows" }); G.act(sm, { id: "sleep" });
  check("풀무꾼은 농노 — 새벽 점호", sm.at === "gf_whip_square", sm.at);
  toTime(sm, "07:00");
  const w = optOf(sm, "work_day");
  check("풀무꾼의 낮일: 대장간", w && /대장간/.test(w.label), w?.label);
  const t0 = sm.P.train; G.act(sm, { id: "work_day" });
  // 브란을 믿고 창날을 아는 풀무꾼이면, 대장간에서 봉기의 장면(bran_spears)이 먼저 열릴 수 있다 — 그것도 그 갈래의 하루다
  check("대장간 일은 몸을 단련한다 (아니면 브란의 장면이 먼저 열린다)", (sm.P.train > t0 && sm.at === "gf_rooster") || G.view(sm).story?.id === "bran_spears", `${t0} → ${sm.P.train} @${sm.at} ${G.view(sm).story?.id || ""}`); }
{ const rn = named(mk({ origin: "hill_runaway" }));
  G.act(rn, { id: "story:rest_den" });
  check("탈주자의 저녁: 늑대굴의 솥 (시그리드가 있어야)", ids(rn).includes("meal") || rn.P.lastRation === Math.floor(rn.t / 1440));
  G.act(rn, { id: "sleep" });
  check("탈주자는 점호가 없다 — 늑대굴에서 깬다", rn.at === "hungry_hill__wolf_den" && !rn.ended, rn.at);
  toTime(rn, "07:00");
  check("탈주자의 낮일: 언덕에서 먹을 것을 찾는다 (탈주 노예도)", /먹을 것/.test(optOf(rn, "work_day")?.label || ""));
  check("하루를 몰아 보내기도 늑대굴에서", /늑대굴/.test(optOf(rn, "routine_day")?.label || ""));
  const before = rn.S.wanted.player.local.greyford;
  for (let i = 0; i < 12; i++) G.act(rn, { id: "routine_day" });
  check("탈주 노예라는 이름은 고향에서 식지 않는다 (1 아래로는)", rn.S.wanted.player.local.greyford >= 1, `${before} → ${rn.S.wanted.player.local.greyford}`); }

// ── 숨은 재능: 스승이 알아본다 ──
{ const fin = { ...CR.finalizeBuild(C, { origin: "chapel_ringer" }, 3), hidden: ["memory_palace", "night_eyes"] };
  const g = G.boot(C, { ...G.newRun({ seed: 3, opening: false }), build: fin });
  g.t = Math.floor(g.t / 1440) * 1440 + 1440 + 8 * 60;   // 다음 날 아침 — 오스릭은 예배당에
  const tr = G.options(g).find((o) => o.id === "train:npc_osric:읽고쓰기");
  check("오스릭의 수업이 열려 있다 (종지기는 처음부터 믿음 30)", !!tr, ids(g).filter((x) => x.startsWith("train")).join(","));
  if (tr) { const r = G.act(g, { id: tr.id });
    check("스승이 처음 가르칠 때 숨은 재능이 드러난다 (기억의 궁전)", G.talentTier(g, "memory_palace") === 1 && (r.feed || []).some((f) => f.text.includes("숨은 재능")), (r.feed || []).map((f) => f.text).join(" / "));
    check("다른 숨은 재능은 그대로 잠든다", G.talentTier(g, "night_eyes") === 0 && G.view(g).build.hiddenLeft === 1);
    const next = G.boot(C, { ...G.regressRun(g), opening: false });
    check("드러난 재능은 회귀해도 남는다", G.talentTier(next, "memory_palace") === 1); } }

// ── 회귀: 같은 갈래, 같은 자리 · 남긴 점수로 깨운다 ──
{ const g = named(mk({ origin: "chapel_ringer", talents: { liar_nose: 1 } }, { seed: 8 }));   // 8점을 남긴다
  G.act(g, { id: "story:prepare_prayer" });
  g.ended = { kind: "dead", why: "시험", t: g.t, trace: { id: "blade" } };
  const run2 = G.regressRun(g);
  check("회귀해도 갈래와 생성은 그대로", run2.build?.origin === "chapel_ringer" && run2.build.talents.liar_nose === 1);
  check("남긴 점수는 첫 회귀에 잔향으로", run2.carry.soul.tp === 8, `tp ${run2.carry.soul.tp}`);
  const g2 = G.boot(C, run2);
  const v2 = G.view(g2);
  check("두 번째 회차도 종 줄에서 — 돌아온 냄새", v2.story?.id === "bell_rope_open" && G.storyIntro(g2).includes("나는 — 이 냄새를 안다") && v2.origin.sense === "꺼진 밀랍 냄새");
  check("이름은 영혼에 — 두 번째 회차는 묻지 않는다", ids(g2).includes("story:next"), ids(g2).join(","));
  G.act(g2, { id: "story:next" });
  G.act(g2, { id: "story:prepare_prayer" });
  let r = null; for (let i = 0; i < 3 && G.view(g2).story?.id !== "count_before_sleep"; i++) r = G.act(g2, { id: "sleep" });
  check("첫 잠자리: 갈래마다 다른 잠자리 글", G.view(g2).story?.id === "count_before_sleep" && /종 줄이 어둠 속에서/.test(G.storyIntro(g2)), G.view(g2).story?.id);
  const wakes = ids(g2).filter((x) => x.startsWith("story:wake:"));
  check("회귀 각성: 잔향의 점수로 재능을 깨우는 선택지", wakes.length >= 1 && wakes.length <= 4, wakes.join(","));
  const pick = wakes.includes("story:wake:liar_nose") ? "story:wake:liar_nose" : wakes[0];
  const before = G.talentTier(g2, pick.slice(11));
  G.act(g2, { id: pick });
  check("어둠 속에서 재능이 깨어나거나 자란다", G.talentTier(g2, pick.slice(11)) === before + 1 && G.view(g2).tp.free < 8, `${pick} ${before} → ${G.talentTier(g2, pick.slice(11))}`); }

// ── 재생: 갈래마다 같은 세계 ──
for (const o of ORIGINS) {
  const g = named(mk({ origin: o, talents: { iron_gut: 1, spatial: 1 }, flaws: ["lame"], dice: true }, { seed: 31 }));
  let n = 0; const R = (k) => { n = (n * 1103515245 + 12345 + k) % 2147483648; return n / 2147483648; };
  for (let i = 0; i < 40 && !g.ended; i++) { const op = G.options(g).filter((x) => !x.input && !/^(attack|fight_)/.test(x.id)); if (!op.length) break; G.act(g, { id: op[Math.floor(R(i) * op.length)].id }); }
  const again = G.boot(C, JSON.parse(JSON.stringify(g.run)));
  const fp = (x) => JSON.stringify({ t: x.t, at: x.at, st: x.P.status, k: [...x.P.knows].sort(), it: G.view(x).player.items.map((i) => i.id), v: x.S.vars });
  check(`${CR.originDef(C, o).name}: 다시 재생해도 같다`, fp(g) === fp(again), `${g.run.journal.length}걸음`);
}

// ── 이름: 만들 때 짓는다 (진짜 이름 · 형/누나 · 불리는 이름) ──
{ const ids2 = (g) => G.options(g).map((o) => o.id);
  const g = mk({ origin: "eldar_gardener", name: "하린", call: "이슬" }, { seed: 23 });
  check("이름을 지어 오면 첫 장면이 이름을 묻지 않는다", g.story?.id === "o3_dawn_open" && !ids2(g).includes("story_name"), ids2(g).join(","));
  check("첫 장면의 글이 그 이름을 부른다", /하린/.test(G.storyIntro(g) || ""), (G.storyIntro(g) || "").slice(-60));
  G.act(g, { id: G.options(g)[0].id });
  check("건너뛴 이름 장면의 효과도 일어난다 (은빛 핀)", G.view(g).player.items.some((i) => /핀/.test(i.name)) && g.S.vars.o3_nina_known === true, G.view(g).player.items.map((i) => i.name).join(","));
  check("불리는 이름을 지으면 세상이 그 이름으로 부른다", G.callName(g) === "이슬" && G.view(g).origin.call === "이슬");
  check("탄생 서사가 이름으로 시작한다", CR.birthLine(C, g.run.build).startsWith("하린, "), CR.birthLine(C, g.run.build));
  const s2 = mk({ origin: "serf", name: "도윤", sibling: "누나" }, { seed: 24 });
  check("셋째의 형/누나도 만들 때 정한다 (이름 칸 없이 첫 장면)", G.view(s2).story?.id === "ration_line_open" && s2.run.build.sibling === "누나" && !G.options(s2).some((o) => o.id === "story_name"));
  check("이름 칸의 글자 거르기: 자리표·구분자를 뺀다", CR.finalizeBuild(C, { origin: "serf", name: "{하}|린" }, 1).name === "하린");
  check("빈 이름은 첫 장면에서 정한다", !CR.finalizeBuild(C, { origin: "serf", name: "  " }, 1).name && mk({ origin: "serf" }).story && G.options(mk({ origin: "serf" }))[0].id === "story_name");
  // 회귀한 회차에도 이름 장면의 효과가 일어난다 (이름은 이미 안다)
  const d = mk({ origin: "eldar_gardener" }, { seed: 25 });
  for (let i = 0; i < 6 && d.story; i++) { const op = G.options(d); G.act(d, op[0].id === "story_name" ? { id: "story_name", text: "하린" } : { id: op[0].id }); }
  d.ended = { kind: "dead", why: "검사", t: d.t, trace: { id: "blade" } };
  const d2 = G.boot(C, G.regressRun(d));
  G.act(d2, { id: G.options(d2)[0].id });
  check("두 번째 회차: 이름 장면의 효과 (은빛 핀)", G.view(d2).player.items.some((i) => /핀/.test(i.name)), G.view(d2).player.items.map((i) => i.name).join(",")); }

// ── 세션: 새 판에 생성을 싣는다 ──
{ const prov = { kind: "mock", usage: { calls: 0, failures: 0 }, async complete() { this.usage.calls++; return "<서술>\n저녁이다.\n</서술>\n<선택지>\n{\"choices\": []}\n</선택지>"; } };
  const S = createSession(C, prov, {});
  const bad = await S.newGame(5, {}, "grim", "silent_god", { origin: "serf", talents: { tongue: 3, deceit: 3 } });
  check("세션: 점수가 넘치는 생성은 시작하지 않는다", !!bad.error, bad.error);
  const ok = await S.newGame(5, {}, "grim", "silent_god", { origin: "smith_hand", talents: { brawler: 1 }, dice: true });
  check("세션: 생성으로 새 판 — 대장간의 저녁", ok.view?.origin?.id === "smith_hand" && ok.view.story?.id === "forge_chains_open" && S.run.build?.diceResult, ok.error || "");
  const pv = S.creationPreview({ origin: "smith_hand", dice: true }, 5);
  check("세션: 미리보기의 주사위 = 시작한 판의 주사위", JSON.stringify(pv.dice) === JSON.stringify(CR.finalizeBuild(C, { origin: "smith_hand", dice: true }, 5).diceResult));
  const fresh = createSession(C, prov, {});
  check("처음 여는 판은 생성 화면을 연다 (fresh)", (await fresh.start({})).fresh === true && ok.fresh === false); }

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
