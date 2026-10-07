// node engine/game/test_origins.mjs [출신 id …] — 모든 출신 (creation/origins*.yaml): 회귀점 · 첫 장면 · 하루의 의무 · 회귀 · 재생
// 출신을 하나 새로 쓰면 이 검사로 그 출신을 걷는다: node engine/game/test_origins.mjs ashfire_slave
//   ① 회귀점: 그 고장·그 시각·그 자리, 소지품·돈·관계·아는 것, 대본 장면이 열린다 (이름을 받는 장면이면 이름을 준다)
//   ② 첫 장면의 선택지를 하나씩 (각각 새 판에서) — 막히지 않고, 장면 사슬이 끝난다
//   ③ 이레를 늘 하던 대로 — 점호·저녁·낮일·잠이 그 출신의 것으로 돌고, 낯선 고장의 검문에 걸리지 않는다
//   ④ 죽고 돌아온다 — 같은 자리·같은 시각, 회귀의 첫 줄, 첫 잠의 '센다' 장면
//   ⑤ 같은 기록이면 같은 세계 (재생)
//   ⑥ 화면·지도·백과·서술 프롬프트가 깨지지 않는다 (회색여울 밖의 출신은 프롬프트에 '회색여울'이 매인 곳으로 남지 않는다)
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import * as CR from "./creation.mjs";
import * as X from "./codex.mjs";
import { systemFor, turnPrompt } from "./prompts.mjs";
import { fmt } from "../sim/calendar.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const want = process.argv.slice(2);
const ALL = CR.creationOf(C).origins.filter((o) => !want.length || want.includes(o.id));
if (!ALL.length) { console.log("그런 출신이 없다:", want.join(" ")); process.exit(1); }
const mk = (build, { seed = 31, opening = true, run = {} } = {}) => G.boot(C, { ...G.newRun({ seed, opening }), ...run, build: CR.finalizeBuild(C, build, seed) });
const ids = (g) => G.options(g).map((o) => o.id);
const NAME = "하린|누나";
// 대본 장면을 끝까지 넘긴다: 이름이면 이름, 고를 것이 있으면 pick(선택지들)이 고른 것, 없으면 ▸
function playStory(g, pick = (opts) => opts.find((o) => !o.check && !o.memory) || opts[0], limit = 25) {
  const seen = [];
  for (let i = 0; i < limit && g.story && !g.ended; i++) {
    seen.push(g.story.id);
    const opts = G.options(g);
    if (opts[0]?.id === "story_name") { G.act(g, { id: "story_name", text: NAME }); continue; }
    const o = pick(opts.filter((x) => x.id.startsWith("story:")), g); if (!o) break;
    G.act(g, { id: o.id });
  }
  return seen;
}
const hm = (g) => fmt(g.t).slice(-5);

for (const def of ALL) {
  const o = def.id, home = def.settlement || "greyford", label = `${def.name} (${o})`;
  console.log(`\n── ${label} ──`);
  // ① 회귀점
  const g = mk({ origin: o });
  const v = G.view(g);
  check(`${label}: 회귀점 — ${home} ${def.start} ${def.time || "18:00"}`, g.P.settlement === home && g.at === def.start && hm(g) === (def.time || "18:00"), `${g.P.settlement} ${g.at} ${hm(g)}`);
  check(`${label}: 대본 장면 ${def.opening}`, v.story?.id === def.opening, v.story?.id);
  check(`${label}: 소지품·돈`, v.player.coin === (def.coin ?? 3) && (def.items || []).every((it) => v.player.items.some((x) => x.name === (it.name || C.game.economy.goods[it.gid]?.name))), `${v.player.coin} ${v.player.items.map((i) => i.name)}`);
  check(`${label}: 관계·아는 것`, Object.entries(def.rel || {}).every(([n, [l, t]]) => (g.S.rel.get(`${n}>player`)?.trust || 0) === (t || 0) || (g.S.rel.get(`${n}>player`)?.like || 0) === (l || 0)) && (def.knows || []).every((f) => g.P.knows.has(f)));
  check(`${label}: 출신의 결점·특질이 몸에 있다`, (def.flaws || []).every((f) => CR.buildFlaws(g.run.build).includes(f)) && (def.traits || []).every((t) => (g.run.build.traits || []).includes(t)));
  // 첫 장면의 글: 비어 있지 않고, 채워지지 않은 자리표({…})가 없다
  const intro = G.storyIntro(g) || "";
  check(`${label}: 첫 장면의 글`, intro.length > 120 && !/\{[a-z_]+\}/.test(intro), intro.slice(0, 60));
  const chain = playStory(g);
  check(`${label}: 장면 사슬이 끝난다 (${chain.join(" → ")})`, !g.story && !g.ended, g.story?.id || g.ended?.why || "");
  check(`${label}: 첫 장면 뒤에도 매인 고장에 있다`, g.P.settlement === home && !!g.W.loc.get(g.at), `${g.P.settlement} ${g.at}`);
  // ② 둘째 화면의 선택지를 하나씩 — 새 판마다
  const second = (() => { const h = mk({ origin: o }); const first = []; for (let i = 0; i < 6 && h.story; i++) { const opts = G.options(h); if (opts[0]?.id === "story_name") { G.act(h, { id: "story_name", text: NAME }); continue; } const ch = opts.filter((x) => x.id.startsWith("story:") && x.id !== "story:next"); if (ch.length >= 2) return { id: h.story.id, choices: ch.map((x) => x.id) }; G.act(h, { id: (ch[0] || opts[0]).id }); } return null; })();
  if (second) for (const cid of second.choices) {
    for (const seed of [31, 32]) {
      const h = mk({ origin: o }, { seed });
      let ok = true, why = "";
      try {
        for (let i = 0; i < 8 && h.story && h.story.id !== second.id; i++) { const opts = G.options(h); G.act(h, { id: opts[0]?.id === "story_name" ? "story_name" : (opts.find((x) => x.id.startsWith("story:") && !x.check) || opts[0]).id, text: NAME }); }
        if (!G.options(h).some((x) => x.id === cid)) continue;   // 기억 선택지 등 — 이 판에는 없다
        G.act(h, { id: cid });
        playStory(h);
        if (!h.ended) G.act(h, { id: "wait:60" });
      } catch (e) { ok = false; why = e.message; }
      check(`${label}: ${second.id} · ${cid.replace("story:", "")} (시드 ${seed})`, ok && (!h.story || h.ended), why || h.ended?.why || "");
      break;
    }
  }
  // ③ 이레를 늘 하던 대로 (이야기가 끼면 넘긴다) — 처음 판에서
  // 수동적인 선택 (맨 뒤의 판정 없는 선택지 — 대개 '그대로 있는다')으로 지나간다: 이 검사는 하루의 틀을 본다
  const passive = (opts) => [...opts].reverse().find((x) => !x.check && !x.memory && !x.risk) || opts[opts.length - 1];
  const life = mk({ origin: o }); playStory(life, passive);
  const t0 = life.t; let days = 0, scenes = new Set(), err = "";
  try {
    for (let i = 0; i < 60 && days < 7 && !life.ended; i++) {
      if (life.story) { scenes.add(life.story.id); playStory(life, passive); continue; }
      const op = ids(life);
      if (op.includes("routine_day")) { G.act(life, { id: "routine_day" }); days++; }
      else if (op.includes("sleep")) { G.act(life, { id: "sleep" }); days++; }
      else G.act(life, { id: "wait:60" });
      life.P.status.hunger = Math.min(life.P.status.hunger, 2);   // 굶어 죽는 것은 이 검사의 일이 아니다
    }
  } catch (e) { err = e.message; }
  check(`${label}: 이레를 산다 (${days}일${scenes.size ? `, 장면 ${[...scenes].slice(0, 6).join(" ")}` : ""})`, !err && days >= 5, err || life.ended?.why || `${fmt(t0)} → ${fmt(life.t)}`);
  check(`${label}: 낯선 고장의 검문에 걸리지 않았다 (매인 고장)`, !/통행증|탈주 노예로 붙잡혔다/.test(life.ended?.why || ""), life.ended?.why || "");
  const rc = def.duty?.rollcall;
  if (rc && typeof rc === "object") check(`${label}: 점호가 그 자리에서 (${rc.at} ${rc.time || "05:00"})`, life.P.lastRollcall != null || life.ended, String(life.P.lastRollcall));
  // 낮일: 일의 창에 '낮일' 선택지가 뜬다
  if (def.duty?.work && def.duty.work !== false) {
    const w = mk({ origin: o }); playStory(w);
    const from = def.duty.work.from || "06:00"; let saw = false;
    for (let i = 0; i < 40 && !saw && !w.ended; i++) { if (w.story) { playStory(w); continue; } saw = ids(w).includes("work_day"); if (!saw) G.act(w, { id: ids(w).includes("wait:60") ? "wait:60" : "sleep" }); w.P.status.hunger = 1; }
    check(`${label}: 낮일이 열린다 (${from}~)`, saw, `${hm(w)} ${w.at}`);
    if (saw) { let ok = true, why = ""; try { G.act(w, { id: "work_day" }); playStory(w); } catch (e) { ok = false; why = e.message; } check(`${label}: 낮일을 한다`, ok, why || hm(w)); }
  }
  // ④ 죽고 돌아온다
  const d = mk({ origin: o }); playStory(d);
  d.ended = { kind: "dead", why: "검사의 죽음", t: d.t, trace: { id: "blade" } };
  const next = G.regressRun(d);
  const g2 = G.boot(C, next);
  check(`${label}: 회귀 — 같은 자리·같은 시각`, g2.at === def.start && hm(g2) === (def.time || "18:00") && g2.run.loop === 2, `${g2.at} ${hm(g2)}`);
  const ret = G.storyIntro(g2) || "";
  check(`${label}: 회귀한 첫 장면`, g2.story?.id === def.opening && ret.length > 80, ret.slice(0, 50));
  playStory(g2);
  let counted = false;
  for (let i = 0; i < 40 && !counted && !g2.ended; i++) {
    if (g2.story) { if (g2.story.id === "count_before_sleep") { counted = true; break; } playStory(g2); continue; }
    G.act(g2, { id: ids(g2).includes("sleep") ? "sleep" : "wait:60" }); g2.P.status.hunger = 1;
  }
  const cbs = counted ? G.storyIntro(g2) : "";
  check(`${label}: 둘째 회차의 첫 잠 — 센다 (그 출신의 잠자리)`, counted && cbs.length > 30 && (home === "greyford" || !/키트|게르다|움막/.test(cbs)), cbs.slice(0, 60));
  // ⑤ 재생
  const r = mk({ origin: o }, { seed: 41 }); playStory(r); for (let i = 0; i < 6 && !r.ended; i++) { if (r.story) { playStory(r); continue; } G.act(r, { id: ids(r).includes("routine_day") ? "routine_day" : "wait:60" }); }
  const r2 = G.boot(C, JSON.parse(JSON.stringify(r.run)));
  check(`${label}: 같은 기록이면 같은 세계`, r2.t === r.t && r2.at === r.at && JSON.stringify(G.view(r2).player) === JSON.stringify(G.view(r).player), `${fmt(r.t)} ${fmt(r2.t)}`);
  // ⑥ 화면·지도·백과·프롬프트
  let ok = true, why = "";
  try { G.view(r); G.mapView(r); X.codexIndex?.(r); const sys = systemFor(def); turnPrompt(r, null, G.options(r), {}); if (home !== "greyford" && /주인공이 매인 곳은 회색여울/.test(sys)) { ok = false; why = "프롬프트의 매인 곳이 회색여울"; } if (home !== "greyford" && !def.world) { ok = false; why = "world 줄이 없다"; } } catch (e) { ok = false; why = e.message; }
  check(`${label}: 화면·지도·백과·서술 프롬프트`, ok, why);
}
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
