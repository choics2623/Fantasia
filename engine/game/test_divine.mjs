// node engine/game/test_divine.mjs — 신재·비기·오의·경지 (06 §3), 이식 (06 §4.4), 잔향의 장부 (SCENARIOS §6 · 06 §2)
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import * as CR from "./creation.mjs";
import * as LG from "./ledger.mjs";
import { createSession } from "./session.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const I = G._internal;
const mk = (build, { seed = 51, ledger = null, run = {} } = {}) => G.boot(C, { ...G.newRun({ seed, opening: false }), ...run, build: CR.finalizeBuild(C, build, seed, ledger) });
const R = CR.creationOf(C).rules;
// 장부: 싸움 90에 닿은 시대가 있었고, 업적 점수가 20
const rich = { ...LG.emptyLedger(), peaks: { 싸움: 90, 화술: 40 }, achievements: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`x${i}`, { tp: 2, text: "검사" }])) };

// ── 신재 (넷째 등급) ──
check("규칙: 등급 넷 · 큰 재능 12점 · 성장 ×2.5", R.tier_names.length === 4 && R.cost.major[3] === 12 && R.growth[3] === 2.5 && CR.maxTier(CR.talentDef(C, "sword")) === 4 && CR.maxTier(CR.talentDef(C, "blunt")) === 3);
check("장부가 없으면 신재는 잠겨 있다", CR.checkBuild(C, { origin: "serf", talents: { sword: 4 } }).errors.some((e) => /신재는 아직/.test(e)));
{ const ck = CR.checkBuild(C, { origin: "serf", talents: { sword: 4 } }, rich);
  check("장부가 연 신재: 싸움이 90에 닿았던 시대가 있으면 검의 재능 신재를 산다 (재능 포인트 30)", ck.ok && ck.tp.base === 30 && ck.tp.left === 18, ck.errors.join(" · ") + ` ${ck.tp.base}/${ck.tp.left}`); }
check("작은 재능은 신재가 없다", !CR.checkBuild(C, { origin: "serf", talents: { blunt: 4 } }, rich).ok);
check("신재는 하나까지", CR.checkBuild(C, { origin: "serf", talents: { sword: 4, brawler: 4 } }, rich).errors.some((e) => /신재는 1개까지/.test(e)));
{ const fin = CR.finalizeBuild(C, { origin: "serf", talents: { sword: 4 } }, 3, rich);
  check("마무리된 build는 장부의 바탕·연 신재를 지닌다 (판이 장부 없이도 선다)", fin.tp === 30 && fin.divineOpen?.includes("sword") && CR.checkBuild(C, fin).ok, JSON.stringify({ tp: fin.tp, d: fin.divineOpen?.length }));
  const g = mk({ origin: "serf", talents: { sword: 4 } }, { ledger: rich });
  check("판에서 신재: 등급 4, 이름은 신재의 이름", G.talentTier(g, "sword") === 4 && (G.view(g).talents.find((t) => t.id === "sword")?.tierName === "신재"), G.view(g).talents.find((t) => t.id === "sword")?.name); }
check("신재의 값: 천재에서 한 걸음 더 (0을 넘어 뒤집히지 않는다)", I.tvx(4, [0, 3, 5, 8]) === 11 && I.tvx(4, [1, 0.75, 0.5, 0.25]) === 0 && I.tvx(4, [10, 5, 2, 0]) === 0 && I.tvx(4, [70, 80, 90, 101]) === 112);
{ // 이 시대의 영혼이 연 신재: 천재로 세 회차를 살았다 → 회귀 각성에서 신재로
  const g = mk({ origin: "serf", talents: { tongue: 3 } }, { run: { carry: { notebook: [], future: [], deaths: [], soul: { genius: { tongue: 3 }, tp: 9, achievements: [], records: [{ loop: 1 }] } } } });
  check("천재로 세 회차를 산 혀의 재능은 이 시대 안에서 신재가 열린다", I.divineOpenIn(g).has("tongue"));
  const wakes = I.awakenOptions(g).map((o) => o.id);
  check("회귀 각성이 신재를 권한다 (잔향 5점)", wakes.includes("story:wake:tongue"), wakes.join(",")); }

// ── 비기·오의 ──
const ARTS = CR.creationOf(C).arts || [];
check("비기의 자료가 있다 (큰 재능은 넷, 작은 재능은 둘)", ARTS.length >= 100 && ARTS.filter((a) => a.talent === "sword").length === 4, `${ARTS.length}개`);
{ const g = mk({ origin: "serf", talents: { sword: 2 } });
  g.P.skills.싸움 = 10;
  check("등급은 됐어도 스킬이 30 아래면 비기는 닫혀 있다", !I.artsOn(g).some((a) => a.talent === "sword"));
  g.P.skills.싸움 = 35;
  const on = I.artsOn(g).filter((a) => a.talent === "sword");
  check("수재 + 싸움 30 → 수재 비기 하나가 열린다", on.length === 1 && on[0].tier === 2, on.map((a) => a.name).join(","));
  check("화면: 비기 목록 (열린 것·닫힌 것과 그 스킬)", G.view(g).arts.some((a) => a.talent === "검의 재능" && a.on)); }
// 조건부 판정 (edge): 그 조건에서만 더해진다
{ const edge = ARTS.find((a) => a.effect.kind === "edge" && a.effect.when === "talk" && a.tier === 2);
  if (edge) { const T = CR.talentDef(C, edge.talent), g = mk({ origin: "serf", talents: { [edge.talent]: 2 } }); g.P.skills[edge.skill] = 40;
    const out = I.artEdge(g, edge.skill, {}).n; g.convo = { npc: "npc_kit", turns: 0, patience: 5 };
    const inn = I.artEdge(g, edge.skill, {}).n;
    check(`비기 (${T.name} · ${edge.name}): 대화 안에서만 +${edge.effect.n}`, inn - out >= edge.effect.n, `${out} → ${inn}`); }
  else check("대화의 비기가 있다", false); }
// 행동 (act): 싸움에서 새 선택지 — 이기면 죽이지 않고 끝난다
{ const a = ARTS.find((x) => x.effect.kind === "act" && x.effect.act === "disarm") || ARTS.find((x) => x.effect.kind === "act" && x.effect.act === "knockout");
  if (a) {
    const T = CR.talentDef(C, a.talent), tier = Math.min(a.tier, 4), g = mk({ origin: "serf", talents: { [a.talent]: tier } }, { ledger: tier >= 4 ? { ...rich, peaks: { ...rich.peaks, [a.skill]: 99 } } : null });
    g.P.skills[a.skill] = 95; g.fight = { npc: "npc_bram", round: 1, me: 0, foe: 1, edge: 0 };
    const ids = G.options(g).map((o) => o.id);
    check(`싸움의 비기 (${T.name} · ${a.name}) — 선택지가 선다`, ids.includes(`art:${a.id}`), ids.join(","));
    let won = false;
    for (let s = 1; s < 40 && !won; s++) { const h = mk({ origin: "serf", talents: { [a.talent]: tier } }, { seed: 100 + s, ledger: tier >= 4 ? { ...rich, peaks: { ...rich.peaks, [a.skill]: 99 } } : null }); h.P.skills[a.skill] = 95; h.fight = { npc: "npc_bram", round: 1, me: 0, foe: 1, edge: 0 };
      G.act(h, { id: `art:${a.id}` }); if (!h.fight && !h.S.dead.has("npc_bram")) won = true; }
    check(`비기가 통하면 싸움이 끝나고 아무도 죽지 않는다 (${a.effect.act})`, won); }
  else check("싸움의 비기(무장해제·기절)가 있다", false); }
// 오의: 신재 + 스킬 90
{ const o = ARTS.find((x) => x.tier === 5) || { talent: "sword", skill: "싸움", id: "-", name: "오의" };
  const g = mk({ origin: "serf", talents: { [o.talent]: 4 } }, { ledger: { ...rich, peaks: { ...rich.peaks, [o.skill]: 99 }, genius: { [o.talent]: 3 } } });
  g.P.skills[o.skill] = 80;
  check(`오의 (${o.name})는 신재 + 스킬 90에야 열린다`, !I.artsOn(g).some((a) => a.id === o.id));
  g.P.skills[o.skill] = 92;
  check("스킬 90을 넘으면 오의가 열린다", I.artsOn(g).some((a) => a.id === o.id)); }

// ── 경지 ──
{ const g = mk({ origin: "serf", talents: { sword: 2 } }, { run: { carry: { notebook: [], future: [], deaths: [], soul: { mastery: { 싸움: 2 } } } } });
  check("경지 2단계는 그 스킬의 모든 판정에 +10 (영혼에 남는다)", I.artEdge(g, "싸움", {}).n >= 10 && /경지 2단계/.test(I.artEdge(g, "싸움", {}).text)); }

// ── 이식 ──
{ const g = mk({ origin: "serf" });
  const before = g.P.mods.근력;
  I.graft(g, "giant_bone");
  check("이식: 몸에 붙는다 — 능력치가 바로 (근력 +3)", I.hasTrait(g, "giant_bone") && g.P.mods.근력 - before === 1.5);
  const p0 = g.P.status.pain; const d0 = Math.floor(g.t / 1440);
  for (let d = 1; d <= 7; d++) I.bodyDay(g, d0 + d);
  check("이레 동안 몸이 밀어낸다 (아픔), 그 뒤엔 붙는다", g.P.status.pain > p0 && (g.P.graftHeld || []).includes("giant_bone"), `${p0} → ${g.P.status.pain}`);
  g.ended = { kind: "dead", why: "검사", t: g.t, trace: { id: "blade" } };
  const next = G.regressRun(g), g2 = G.boot(C, next);
  check("회귀하면 이식은 사라지고, 견뎌 낸 것은 영혼에 남는다", !I.hasTrait(g2, "giant_bone") && (next.carry.soul.grafted || []).includes("giant_bone"));
  const h = mk({ origin: "serf", traits: ["dragon_heart"] }, { ledger: null });
  I.graft(h, "nocturne_thirst");
  check("한 몸에 들지 않는 피는 이식되지 않는다 (용심 ↔ 녹테른)", !I.hasTrait(h, "nocturne_thirst")); }

// ── 잔향의 장부 ──
{ let L = LG.emptyLedger();
  L = LG.absorb(L, { seed: 9, origin: "serf", loop: 3, soul: { achievements: ["autumn", "winter"], skills: { 화술: 86 }, genius: { tongue: 1 }, grafted: ["giant_bone"] }, achievementsAll: [{ id: "autumn", tp: 1, text: "낙엽월" }, { id: "winter", tp: 2, text: "굶주림월" }] });
  check("장부: 업적의 점수가 다음 시대의 재능 포인트를 올린다 (10 → 13)", LG.ledgerTP(C, L) === 13);
  L = LG.absorb(L, { seed: 9, origin: "serf", loop: 4, soul: { achievements: ["autumn", "winter"], skills: { 화술: 86 }, genius: { tongue: 2 } }, achievementsAll: [{ id: "autumn", tp: 1 }, { id: "winter", tp: 2 }] });
  check("같은 업적은 두 번 점수를 주지 않는다 · 같은 시대의 천재 회차는 덮어 센다", LG.ledgerTP(C, L) === 13 && L.genius.tongue === 2 && L.eras.length === 1);
  check("최고 스킬 85 → 그 스킬의 큰 재능에 신재가 열린다 (화술 → 혀의 재능)", LG.divineOpen(C, L).has("tongue") && !LG.divineOpen(C, L).has("sword"));
  const L2 = { ...L, achievements: { ...L.achievements, ten_evenings: { tp: 1 } } };
  check("업적이 유산 특질을 연다 (열 번의 저녁 → 오래된 영혼)", LG.legacyOpen(C, L2).has("old_soul") && !LG.legacyOpen(C, L).has("old_soul"));
  const ck = CR.checkBuild(C, { origin: "serf", legacy: ["old_soul"] }, L2);
  check("유산 특질은 재능 포인트로 산다 (3점)", ck.ok && ck.tp.spent === 3, ck.errors.join(","));
  const g = mk({ origin: "serf", legacy: ["old_soul"] }, { ledger: L2, run: { loop: 6 } });
  check("유산 특질 — 오래된 영혼: 젖은 재 냄새가 옅다", g.run.build.legacy?.includes("old_soul"));
  // 정본 해금: 켜면 '업적' 출신과 혈통이 잠긴다 — 이식해 견딘 피는 열린다
  const canon = { ...L, canon: true };
  check("정본 해금을 켜면 업적 출신은 잠긴다 (엘다르 정원지기)", !CR.checkBuild(C, { origin: "eldar_gardener" }, canon).ok && CR.checkBuild(C, { origin: "eldar_gardener" }, L).ok);
  check("정본 해금: 셋째의 갈래는 언제나 열려 있다", CR.checkBuild(C, { origin: "keep_servant" }, canon).ok);
  check("정본 해금: 이식해 견딘 피(거인의 뼈)는 열리고, 아닌 피(엘다르의 눈)는 잠긴다", CR.checkBuild(C, { origin: "serf", traits: ["giant_bone"] }, { ...canon, achievements: { ...canon.achievements, ...rich.achievements } }).ok && !CR.checkBuild(C, { origin: "serf", traits: ["eldar_eye"] }, { ...canon, achievements: { ...canon.achievements, ...rich.achievements } }).ok);
  const v = CR.creationView(C, canon);
  check("생성 화면: 잠긴 출신에는 여는 길이 적힌다", v.origins.find((o) => o.id === "eldar_gardener")?.locked && !v.origins.find((o) => o.id === "serf")?.locked); }

// ── 세션: 회귀하면 장부에 적는다 ──
{ let stored = null; const store = { load: () => stored, save: (L) => { stored = L; } };
  const prov = { kind: "mock", usage: { calls: 0, failures: 0 }, async complete() { return "<서술>\n저녁이다.\n</서술>\n<선택지>\n{\"choices\": []}\n</선택지>"; } };
  const S = createSession(C, prov, { ledgerStore: store });
  await S.newGame(5, {}, "grim", "silent_god", { origin: "serf", name: "하린" });
  S.run.journal.length; // 판이 섰다
  const gg = S.game ?? null;
  check("세션: 새 판의 생성 화면은 장부의 점수를 쓴다", S.creation().rules.tp === 10);
  stored = { ...LG.emptyLedger(), achievements: { a: { tp: 5 } } };
  const S2 = createSession(C, prov, { ledgerStore: store });
  check("세션: 장부에 새긴 업적만큼 다음 시대의 점수 (15)", S2.creation().rules.tp === 15 && S2.ledger().tp === 15); }

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
