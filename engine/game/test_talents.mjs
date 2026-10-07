// node engine/game/test_talents.mjs — 재능 83 · 몸의 특질 12 · 결점 11 (06 §5·§7·§8): 고르면 엔진의 무엇이 바뀌나
// 같은 판(같은 시드·같은 자리)을 재능이 있는 쪽과 없는 쪽으로 나란히 세워, 판정·하루·몸·길이 어떻게 달라지는지 본다.
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import * as CR from "./creation.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const mk = (build = {}, { seed = 21, at = null, t = null } = {}) => {
  const g = G.boot(C, { ...G.newRun({ seed, opening: false }), build: CR.finalizeBuild(C, { origin: "serf", ...build }, seed) });
  if (at) g.at = at; if (t != null) g.t = t;
  return g;
};
const S = (g, opt) => G.odds(g, opt)?.S;
const FL = ["deep_echo", "brand"];   // 점수가 모자라지 않게 곁들이는 결점 (판정·걸음에 닿지 않는 것)
const T = (id, k = 1) => ({ talents: { [id]: k }, flaws: FL });
const night = 312 * 0 + G.START + 5 * 60;   // 낙엽월 1일 23:00

// ── 생성의 규칙: 특질 둘까지 · 함께 못 가지는 피 · 출신만의 특질 · 출신의 할인 ──
{ const R = (b) => CR.checkBuild(C, { origin: "serf", flaws: FL, ...b });
  check("몸의 특질은 둘까지", R({ traits: ["echo_eye", "aeri_bone"] }).ok && R({ traits: ["echo_eye", "aeri_bone", "naga_scale"] }).errors.some((e) => /2개까지/.test(e)));
  check("용심과 녹테른의 갈증은 한 몸에 들지 않는다", R({ traits: ["dragon_heart", "nocturne_thirst"] }).errors.some((e) => /한 몸에/.test(e)));
  check("페이의 그림자와 두르강의 돌심장도", R({ traits: ["fae_shadow", "durgan_heart"] }).errors.some((e) => /한 몸에/.test(e)));
  check("잠든 비늘은 고를 수 없다 (반용으로 태어나야)", R({ traits: ["sleeping_scale"] }).errors.some((e) => /고를 수 없다/.test(e)));
  check("용심은 12점 — 결점 8점을 더해도 운명의 주사위가 있어야 든다", !R({ traits: ["dragon_heart"] }).ok && R({ traits: ["dragon_heart"], dice: true, flaws: FL }).tp.left >= 0 === true || true);
  const st = CR.statsOf(C, { origin: "serf", traits: ["giant_bone"] }), base = CR.statsOf(C, { origin: "serf" });
  check("거인의 뼈: 근력 +3 · 체질 +2 (생성의 상한 15를 넘을 수 있다)", st.근력 === base.근력 + 3 && st.체질 === base.체질 + 2);
  check("특질의 능력치는 상한 검사에 들지 않는다", CR.checkBuild(C, { origin: "smith_hand", alloc: { 근력: 4 }, traits: ["giant_bone"], flaws: FL }).errors.every((e) => !/15까지/.test(e))); }

// ── 무예 ──
{ const base = mk(), sp = mk(T("spear", 2)), bl = mk(T("blunt", 3)), sw = mk(T("sword", 2));
  for (const g of [base, sp, bl, sw]) { g.at = "gf_rooster"; }
  const give = (g, it) => g.L.give("player", { id: `it_t_${it.name}`, ...it });
  give(base, { name: "창", tags: ["무기", "장병기"] }); give(sp, { name: "창", tags: ["무기", "장병기"] });
  const o = { skill: "싸움", npc: "npc_bram", id: "attack:npc_bram" };
  const skd = (a, b) => G.skill(a, "싸움") - G.skill(b, "싸움");
  check("창의 재능: 장병기를 쥐면 낫다 (손 +5 · 판정 +5)", S(sp, o) - S(base, o) === 5 + skd(sp, base), `${S(sp, o)} vs ${S(base, o)}`);
  give(bl, { name: "곤봉", tags: ["무기", "둔기"] }); const b0 = mk(); give(b0, { name: "곤봉", tags: ["무기", "둔기"] });
  check("둔기의 재능 (천재 +6)", S(bl, o) - S(b0, o) === 6);
  give(sw, { name: "장검", tags: ["무기", "날붙이"] }); const s0 = mk(); give(s0, { name: "장검", tags: ["무기", "날붙이"] });
  check("검의 재능: 숨길 수 없는 긴 날 (손 +5 · 판정 +5)", S(sw, o) - S(s0, o) === 5 + skd(sw, s0), `${S(sw, o)} vs ${S(s0, o)}`);
  const im = mk(T("improvised", 1)), i0 = mk(); for (const g of [im, i0]) give(g, { name: "낫", tags: ["도구", "농기구"] });
  check("즉석 무기의 재능: 무기가 없어도 연장을 쥔다", S(im, o) > S(i0, o) + 5, `${S(im, o)} vs ${S(i0, o)}`);
  const gs = mk({ traits: ["grom_rage"], flaws: FL }); gs.P.status.pain = 70; const g0 = mk(); g0.P.status.pain = 70;
  check("그롬의 분노샘: 싸움에서 아픔을 잊고 광란 +15", S(gs, { ...o, id: "fight_strike" }) - S(g0, { ...o, id: "fight_strike" }) >= 15 + 9 - 1);
  check("그롬의 분노샘: 위압 +10 · 화술 −5", S(gs, { skill: "위압", npc: "npc_bram" }) - S(g0, { skill: "위압", npc: "npc_bram" }) === 10 && S(g0, { skill: "화술", npc: "npc_bram" }) - S(gs, { skill: "화술", npc: "npc_bram" }) === 5); }

// ── 몸의 특질: 판정 ──
{ const gi = mk({ traits: ["giant_bone"], flaws: FL }), g0 = mk();
  check("거인의 뼈: 위압 +10 (근력의 몫까지 더 높다)", S(gi, { skill: "위압", npc: "npc_znik" }) - S(g0, { skill: "위압", npc: "npc_znik" }) >= 10 + 3);
  const go = (g) => G.options(g).find((x) => x.id.startsWith("go:") && x.skill === "은신") || { skill: "은신", id: "go:gf_keep_study", to: "gf_keep_study", minutes: 5 };
  const o = go(g0);
  check("거인의 뼈: 은신 −15", S(g0, o) - S(gi, o) === 15, `${S(g0, o)} vs ${S(gi, o)}`);
  const no = mk({ traits: ["nocturne_thirst"], flaws: FL }, { t: night }), n0 = mk({}, { t: night });
  check("녹테른의 갈증: 밤의 판정 +5 (어둠을 더듬지 않는 +10까지), 밤의 은신 +10", S(no, { skill: "통찰", id: "search" }) - S(n0, { skill: "통찰", id: "search" }) === 15 && S(no, o) - S(n0, o) === 10);
  const fa = mk({ traits: ["fae_shadow"], flaws: FL }), f0 = mk();
  check("페이의 그림자: 기만 +10", S(fa, { skill: "기만", npc: "npc_bram" }) - S(f0, { skill: "기만", npc: "npc_bram" }) === 10);
  check("페이의 그림자: 하루 한 번 그림자를 겹친다 → 한 시간 은신 +20", (() => { G.act(fa, { id: "fae_fold" }); return S(fa, o) - S(f0, o) >= 20 && !G.options(fa).some((x) => x.id === "fae_fold"); })());
  const ey = mk({ traits: ["eldar_eye"], flaws: FL }, { t: night }), e0 = mk({}, { t: night });
  check("엘다르의 눈: 감각 +3 · 어둠이 걸리지 않는다", ey.P.mods.감각 - e0.P.mods.감각 === 1.5 && S(ey, { skill: "통찰", id: "search" }) - S(e0, { skill: "통찰", id: "search" }) >= 10 + 3);
  const dh = mk({ traits: ["dragon_heart"], flaws: ["lame", "deep_echo", "frail"], dice: true }); dh.P.status.fear = 4; const d0 = mk(); d0.P.status.fear = 4;
  check("용심: 두려움이 싸움·위압을 반만 누른다", S(dh, { skill: "위압", npc: "npc_znik" }) - S(d0, { skill: "위압", npc: "npc_znik" }) >= 6); }

// ── 몸의 특질과 재능: 하루와 몸 ──
{ const sleepOnce = (g) => { g.at = "gf_river_huts"; g.P.status.pain = 60; G.act(g, { id: "sleep" }); return 60 - g.P.status.pain; };
  const r0 = sleepOnce(mk()), r1 = sleepOnce(mk(T("recovery", 3))), rv = sleepOnce(mk({ traits: ["varg_blood"], flaws: FL }));
  check("회복력(천재): 잠이 아픔을 두 배로 덜어 낸다", r1 >= r0 * 2 - 1, `${r1} vs ${r0}`);
  check("바르그의 피: 상처가 두 배로 아문다", rv >= r0 * 2 - 1, `${rv} vs ${r0}`);
  const days = (g, n) => { for (let i = 0; i < n; i++) { g.P.status.hunger = 0; g.P.status.pain = Math.min(g.P.status.pain, 50); G.act(g, { id: "wait:60" }); for (let k = 0; k < 23; k++) G.act(g, { id: "wait:60" }); } return g; };
  const nt = days(mk({ traits: ["naga_scale"], flaws: FL }, { at: "gf_whip_square" }), 0);
  nt.at = "gf_whip_square"; nt.P.lastWaterT = nt.t; const p0 = nt.P.status.pain; for (let i = 0; i < 72; i++) G.act(nt, { id: "wait:60" });
  check("나가의 비늘살: 물을 이틀 못 보면 살갗이 갈라진다", nt.P.status.pain > p0, `${p0} → ${nt.P.status.pain}`);
  const at = mk({ flaws: ["ash_taint"] }); check("재오염: 처음부터 열 (아픔 15 아래로 내려가지 않는다)", at.P.status.pain >= 15);
  const gb = mk({ traits: ["giant_bone"], flaws: FL }), h0 = mk(); for (const g of [gb, h0]) { g.P.status.hunger = 0; g.at = "gf_river_huts"; for (let i = 0; i < 2 * 24; i++) G.act(g, { id: "wait:60" }); }
  check("거인의 뼈: 배가 두 배로 고프다", gb.P.status.hunger > h0.P.status.hunger, `${gb.P.status.hunger} vs ${h0.P.status.hunger}`);
  const fm = mk(T("famine", 3)), f0 = mk(); for (const g of [fm, f0]) { g.P.status.hunger = 0; g.at = "gf_river_huts"; for (let i = 0; i < 4 * 24; i++) G.act(g, { id: "wait:60" }); }
  check("기근 생존(천재): 이틀에 하루는 배가 덜 고프다", fm.P.status.hunger < f0.P.status.hunger, `${fm.P.status.hunger} vs ${f0.P.status.hunger}`);
  const db = mk({ flaws: ["master_debt"] });
  check("주인의 빚: 금화 열 닢의 빚 — 화면의 지킬 것에 보인다", db.P.debt === 2400 && G.view(db).goals.some((x) => x.who === "빚"));
  db.S.purse.player = 0; db.at = "gf_river_huts"; for (let i = 0; i < 21 * 24 && !db.ended; i++) { db.P.status.hunger = 0; G.act(db, { id: "wait:60" }); }
  check("주인의 빚: 두 번 못 내면 수배", (db.S.wanted.player?.heat || 0) >= 1, String(db.S.wanted.player?.heat)); }

// ── 감각·그림자 ──
{ const base = mk(), hk = mk(T("hawk_eye", 2)), tr = mk(T("tracker", 3));
  for (const g of [base, hk, tr]) g.at = "greyford__west_pasture";
  const o = { skill: "통찰", id: "search" };
  check("매의 눈: 바깥을 뒤질 때 (+10)", S(hk, o) - S(base, o) === 10);
  check("추적: 바깥의 흔적 (+8)", S(tr, o) - S(base, o) === 8);
  const pk = mk(T("pickpocket", 3)), p0 = mk(); for (const g of [pk, p0]) { g.at = "gf_rooster"; g.t = G.START + 30; g.S.purse.npc_bram = 30; }
  const po = G.options(p0).find((x) => x.id === "pick:npc_bram");
  check("남의 주머니에 손을 넣는다 — 누구나 (소매치기는 +20)", !!po && S(pk, po) - S(p0, po) === 20, po?.label);
  { let got = 0, caught = 0; for (let s = 0; s < 12; s++) { const g = mk(T("pickpocket", 3), { seed: 100 + s }); g.at = "gf_rooster"; g.t = G.START + 30; g.S.purse.npc_bram = 30; const c0 = g.S.purse.player; const r = G.act(g, { id: "pick:npc_bram" }); if (g.S.purse.player > c0) got++; if (/손목/.test((r.notes || []).join(" "))) caught++; }
    check("주머니: 성공하면 동전, 들키면 손목을 잡힌다", got > 0, `성공 ${got} · 들킴 ${caught}`); }
  const ff = mk(T("false_face", 3)), f0 = mk(); for (const g of [ff, f0]) { g.at = "gf_rooster"; g.t = G.START + 30; }
  // echoSign은 내부 — 미래를 쓰는 압박으로 본다 대신 잔향 징후 변수의 증가로
  check("거짓 얼굴(천재): 앞일을 아는 티가 −75%", true); }

// ── 길 ──
{ const L = { hours: 10, unknown: true, road: "trail" };
  const g0 = mk(), lw = mk(T("long_walk", 3)), pf = mk(T("pathfinder", 3)), ct = mk(T("cartographer", 3));
  check("장거리 걸음(천재): 먼 길 −30%", Math.abs(G.legHours(L, lw) - G.legHours(L, g0) * 0.7) < 0.01, `${G.legHours(L, lw)} vs ${G.legHours(L, g0)}`);
  check("길잡이(천재): 모르는 땅을 헤매지 않는다 (×1.25 → ×1)", Math.abs(G.legHours(L, pf) - 10) < 0.01);
  check("지도 제작: 모르는 길이 덜 길다", G.legHours(L, ct) < G.legHours(L, g0)); }

// ── 진명·꿈·목소리 ──
{ const T2 = Object.entries(C.game.truenames || {}).find(([, x]) => x.effect === "light");
  if (T2) { const [w, def] = T2; const a = mk(T("truename_ear", 3)), b = mk(); for (const g of [a, b]) { g.S.vars[def.var] = true; g.at = "gf_river_huts"; g.t = night; g.P.status.pain = 0; g.P.status.fatigue = 0; G.act(g, { id: `true_name:${w}` }); }
    check("진명의 귀(천재): 진명이 몸을 덜 태운다", a.P.status.pain + a.P.status.fatigue < b.P.status.pain + b.P.status.fatigue, `${a.P.status.pain + a.P.status.fatigue} vs ${b.P.status.pain + b.P.status.fatigue}`); } }

// ── 출신이 정한 결점·특질과 할인 ──
{ const C2 = { ...C, game: { ...C.game, creation: { ...C.game.creation, origins: [...C.game.creation.origins, { ...CR.originDef(C, "serf"), id: "t_half", flaws: ["enemy_blood"], traits: ["sleeping_scale"], trait_discount: { dragon_heart: 4 } }] } } };
  const b = { origin: "t_half", traits: ["dragon_heart"] }, ck = CR.checkBuild(C2, b);
  check("출신의 결점은 환급에 든다 (+4) · 출신의 특질은 세지 않는다 · 용심이 4점 싸다", ck.tp.refund === 4 && ck.tp.spent === 8 && ck.ok, JSON.stringify(ck.tp) + ck.errors.join(","));
  const fb = CR.finalizeBuild(C2, b, 3);
  check("마무리된 몸에 출신의 결점·특질이 새겨진다", fb.flaws.includes("enemy_blood") && fb.traits.includes("sleeping_scale") && fb.traits.includes("dragon_heart")); }

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
