// node engine/game/test_replay.mjs — 재생 결정성 (28 §1): 무작위로 놀고 20걸음마다 기록을 다시 돌려 같은 상태인지 본다.
// 물건 id·죽음 주사위·목소리가 실시간과 재생에서 같은 값을 봐야 한다 (journal.length가 아니라 기록 번호)
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const fp = (g) => JSON.stringify({ t: g.t, at: g.at, st: g.P.status, k: [...g.P.knows].sort(), items: G.view(g).player.items.map((i) => i.id), purse: g.S.purse.player, ended: g.ended?.why, story: g.story?.id, log: g.S.log.length });
let rng = 12345;
const R = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
// 죽음을 덜 고르는 플레이어: 위험한 행동은 가끔만 — 더 오래 살아야 물건과 장면이 쌓인다
const pickOpt = (opts) => { const safe = opts.filter((o) => !o.risk && !/^attack:|^fight_/.test(o.id)); const pool = safe.length && R() < 0.85 ? safe : opts; return pool[Math.floor(R() * pool.length)]; };
let steps = 0, regress = 0, items = 0;
for (let s = 0; s < 4; s++) {
  let g = G.boot(C, G.newRun({ seed: 300 + s })), bad = null;
  for (let i = 0; i < 160 && !bad; i++) {
    if (g.ended) { const nr = G.regressRun(g); if (!nr) break; g = G.boot(C, nr); regress++; continue; }
    const o = pickOpt(G.options(g)); const ch = { id: o.id };
    if (o.input) ch.text = o.input === "true_name" ? "에반|형" : o.input === "child_name" ? "새벽" : "이름|가훈";
    try { G.act(g, ch); steps++; } catch (e) { bad = `행동 ${o.id}: ${e.message}`; break; }
    items = Math.max(items, G.view(g).player.items.length);
    if (i % 20 === 19) {
      try { const g2 = G.boot(C, JSON.parse(JSON.stringify(g.run))); if (fp(g2) !== fp(g)) bad = `${i}걸음에서 갈렸다 (${g.run.journal.slice(-3).map((e) => e.id).join(",")})\n  실시간 ${fp(g)}\n  재생   ${fp(g2)}`; }
      catch (e) { bad = `${i}걸음 재생이 던졌다: ${e.message}`; }
    }
  }
  check(`시드 ${300 + s}: 재생이 실시간과 같다`, !bad, bad || `${g.run.loop}회차 · 기록 ${g.run.journal.length}`);
}
check("물건을 가진 채로 재생했다 (물건 id 검사가 의미 있다)", items > 0, `최대 ${items}개`);
console.log(`(걸음 ${steps} · 회귀 ${regress})`);
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
