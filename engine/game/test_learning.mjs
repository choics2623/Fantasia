// node engine/game/test_learning.mjs — 글과 말 (19 §4), 스승 (03 §3.1), 숨긴 사실의 대화 밖 공개 경로 (22 §1.2 · A10)
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const fresh = (seed = 7) => G.boot(C, G.newRun({ seed, opening: false }));
const give = (g, gid) => g.L.give("player", { ...C.game.economy.goods[gid], id: `it_${gid}_t${Math.random().toString(36).slice(2, 7)}`, gid });
const at = (g, place, hm) => { g.at = place; if (hm != null) g.t = Math.floor(g.t / 1440) * 1440 + 1440 + hm; };

// ── 문맹 (19 §4.2) ──
{ const g = fresh(); g.P.met.add("npc_sara");
  check("글을 모르면 글자 모양만", G.literacyFilter(g, "{read|사라 31 키트}") === "▯▯ ▯▯ ▯▯", G.literacyFilter(g, "{read|사라 31 키트}"));
  g.P.skills.읽고쓰기 = 5; check("1~9: 숫자만 읽힌다", G.literacyFilter(g, "{read|사라 31 키트}") === "▯▯ 31 ▯▯", G.literacyFilter(g, "{read|사라 31 키트}"));
  g.P.skills.읽고쓰기 = 15; check("10~29: 아는 이름과 숫자", G.literacyFilter(g, "{read|사라 31 키트}") === "사라 31 ▯▯", G.literacyFilter(g, "{read|사라 31 키트}"));
  g.P.skills.읽고쓰기 = 35; check("30+: 전부", G.literacyFilter(g, "{read|사라 31 키트}") === "사라 31 키트");
  check("모르는 말 — 용언은 쇳소리", /■/.test(G.literacyFilter(g, "{lang:용언|짐승 같은 것}")) && /알아들을 수 없다/.test(G.literacyFilter(g, "{lang:용언|짐승 같은 것}")), G.literacyFilter(g, "{lang:용언|짐승 같은 것}"));
  check("몸과 손 — 글은 '글을 읽는다'로 보인다", G.view(g).skills.find((k) => k.name === "읽고쓰기")?.word === "글을 읽는다"); }
// 장부: 못 읽으면 사실이 되지 않는다 — 글을 아는 사람에게 보이면 읽어 준다
{ const g = fresh(); const it = give(g, "henrik_ledger");
  check("글로 된 물건은 펼쳐 읽을 수 있다", ids(g).includes(`read:${it.id}`));
  const r = G.act(g, { id: `read:${it.id}` });
  check("글을 모르면 — 장부는 사실이 되지 않는다", !g.P.knows.has("fact_gf_henrik_seren_account") && r.notes.some((n) => n.includes("읽을 수 없다")), r.notes.join(" / "));
  const o = fresh(); const it2 = give(o, "henrik_ledger"); o.S.rel.set("npc_osric>player", { like: 20, trust: 30 });
  at(o, "gf_chapel", 19 * 60); o.convo = { npc: "npc_osric", turns: 0, patience: 6, transcript: [] };
  G.act(o, { id: `show:${it2.id}` });
  check("오스릭에게 보이면 읽어 준다 — 세렌 계좌", o.P.knows.has("fact_gf_henrik_seren_account") && o.S.knows.get("fact_gf_henrik_seren_account")?.has("npc_osric"));
  const l = fresh(); l.P.skills.읽고쓰기 = 30; const it3 = give(l, "henrik_ledger"); G.act(l, { id: `read:${it3.id}` });
  check("글을 알면 스스로 읽는다", l.P.knows.has("fact_gf_henrik_skims_baron") && l.P.knows.has("fact_gf_henrik_seren_account")); }
// 용언 보고서: 글을 알아도 말을 모르면
{ const g = fresh(); g.P.skills.읽고쓰기 = 30; const it = give(g, "lea_report"); const r = G.act(g, { id: `read:${it.id}` });
  check("레아의 보고서는 용언 — 글을 알아도 말을 모르면 못 읽는다", !g.P.knows.has("fact_gf_lea_report_route") && r.notes.some((n) => n.includes("용언")), r.notes.join(" / ")); }

// ── 스승 (03 §3.1) ──
{ let g = null;
  for (let i = 0; i < 48 && !g; i++) { const x = fresh(); x.S.rel.set("npc_gunnar>player", { like: 30, trust: 45 }); x.t += i * 60; x.at = x.W.where("npc_gunnar", x.t)?.at || x.at; if (ids(x).some((id) => id.startsWith("train:npc_gunnar"))) g = x; }
  check("군나르가 받아 준다 — 배울 수 있다 (신뢰 40)", !!g);
  if (g) {
    const s0 = G.skill(g, "싸움"); G.act(g, { id: "train:npc_gunnar:싸움" });
    check("두 시간 — 싸움이 는다 (연습보다 빠르게)", G.skill(g, "싸움") - s0 >= 3, `${s0.toFixed(1)} → ${G.skill(g, "싸움").toFixed(1)}`);
    check("시험을 통과했다 — trial 깃발 (시험이 여는 비밀)", g.S.vars["trial:npc_gunnar"] === true);
    check("하루에 한 번", !ids(g).some((id) => id.startsWith("train:npc_gunnar")));
  } }
{ let g = null;
  for (let i = 0; i < 48 && !g; i++) { const x = fresh(); x.S.rel.set("npc_osric>player", { like: 20, trust: 30 }); give(x, "candle"); x.t += i * 60; x.at = x.W.where("npc_osric", x.t)?.at || x.at; if (ids(x).includes("train:npc_osric:읽고쓰기")) g = x; }
  check("오스릭 — 글을 배울 수 있다 (양초 한 자루)", !!g);
  if (g) { G.act(g, { id: "train:npc_osric:읽고쓰기" }); check("글이 조금 는다 · 양초가 녹았다", G.skill(g, "읽고쓰기") > 0 && !G.view(g).player.items.some((i) => i.name === "수지 양초"), String(G.skill(g, "읽고쓰기"))); } }

// ── 제안 (player_offer) · 술자리 (scene) ──
{ const g = fresh(); g.P.skills.읽고쓰기 = 12; g.S.rel.set("npc_fayne>player", { like: 10, trust: 20 });
  g.convo = { npc: "npc_fayne", turns: 0, patience: 8, transcript: [] };
  check("글을 조금 알면 '글자를 가르쳐 줄게'를 제안할 수 있다", ids(g).includes("offer:letters"));
  G.act(g, { id: "offer:letters" });
  check("제안은 이 대화의 공개 조건이 된다", G.revealCtx(g, "npc_fayne", "성공").offer === true); }
{ const g = fresh(); at(g, "gf_rooster", 20 * 60); check("저녁의 수탉 — 술자리", G.revealCtx(g, "npc_volk", "성공").scene === "술자리");
  at(g, "gf_rooster", 9 * 60); check("아침의 수탉은 술자리가 아니다", G.revealCtx(g, "npc_volk", "성공").scene === null); }

// ── 장소가 알려 주는 것 ──
{ const g = fresh(); at(g, "gf_keep_study", 3 * 60);
  let got = false; for (let s = 0; s < 8 && !got; s++) { g.seed = 7 + s; const r = G.act(g, { id: "search" }); got = g.P.knows.has("fact_gf_keep_strongbox"); }
  check("남작 서재를 뒤지면 금고를 직접 본다", got);
  check("그래서 성채 금고 작전이 알려진다", G.view(g).ops.some((o) => o.id === "keep_strongbox")); }
{ const g = fresh(); at(g, "filth_marsh", 12 * 60);
  let r = null; for (let s = 0; s < 8 && !(r?.notes || []).some((n) => /말뚝/.test(n)); s++) { g.seed = 7 + s; r = G.act(g, { id: "search" }); }
  check("오물 습지 — 글을 모르면 말뚝의 이름을 못 읽는다", !g.P.knows.has("fact_hi_anne_grave") && r.notes.some((n) => /읽을 수 없다/.test(n)), r.notes.join(" / "));
  g.P.skills.읽고쓰기 = 12; let ok = false; for (let s = 0; s < 8 && !ok; s++) { g.seed = 20 + s; G.act(g, { id: "search" }); ok = g.P.knows.has("fact_hi_anne_grave"); }
  check("이름을 읽을 줄 알면 — 앤의 무덤", ok); }

// ── 함께 지난 장면 (flag story) ──
{ const g = G.boot(C, { ...G.newRun({ seed: 7, opening: false }), lethal: true });
  g.S.rel.set("npc_bran>player", { like: 20, trust: 35 }); g.P.knows.add("fact_gf_bran_spearheads");
  let done = false;
  for (let i = 0; i < 60 && !done; i++) { const sid = G.view(g).story?.id; if (sid === "bran_spears") { G.act(g, { id: "story:take" }); done = true; break; } if (sid) { G.act(g, { id: ids(g)[0] }); continue; } g.at = g.W.where("npc_bran", g.t)?.at || g.at; G.act(g, { id: "wait:60" }); }
  check("브란과 장면을 지나면 — '그 이야기를 아는 사이' (story:npc_bran)", done && g.S.vars["story:npc_bran"] === true); }
// ── 잠긴 선택지 (GAME_DESIGN §2.4): 있는 줄 아는 것은 회색과 이유로 ──
{ const g = fresh(); g.convo = { npc: "npc_henrik", turns: 0, patience: 6, transcript: [] };
  const L = G.lockedOptions(g);
  check("돈이 모자라면 — 살 수 없는 물건이 회색으로", L.some((l) => /위조 통행증/.test(l.label) && /못/.test(l.why)), JSON.stringify(L));
  const r = fresh(); r.at = "gf_whip_square"; r.t = Math.floor(r.t / 1440) * 1440 + 1440 + 23 * 60; r.S.vars.bran_spears = true; r.S.vars.gunnar_trains = true;
  const L2 = G.lockedOptions(r);
  check("준비가 모자란 봉기 — 이유와 함께 보인다 (고를 수는 없다)", L2.some((l) => /둘|2가지/.test(l.why)) && !G.options(r).some((o) => o.id === "rising"), JSON.stringify(L2));
  const m = fresh(); m.P.met.add("npc_gunnar"); m.at = m.W.where("npc_gunnar", m.t)?.at || m.at;
  if (G.view(m).people.some((p) => p.id === "npc_gunnar")) check("스승이 아직 받아 주지 않는다 — 회색", G.lockedOptions(m).some((l) => /군나르/.test(l.label))); }
// ── 몰아서 보내기 (03 §3.3) ──
{ const g = fresh(); g.at = "gf_river_huts"; const d0 = Math.floor(g.t / 1440);
  check("사흘·이레를 몰아서 보낼 수 있다", G.options(g).some((o) => o.id === "routine_days:7"));
  const r = G.act(g, { id: "routine_days:7" }); const d1 = Math.floor(g.t / 1440);
  check("세계는 그 사이에도 돈다 — 일이 생기면 멈춘다", d1 > d0 && (d1 - d0 <= 8) && (r.notes || []).some((x) => /일을 보냈다/.test(x)), `${d1 - d0}일 · ${r.notes.join(" / ")}`);
  check("재생해도 같다", JSON.stringify(G.view(G.boot(C, JSON.parse(JSON.stringify(g.run)))).time) === JSON.stringify(G.view(g).time)); }
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
