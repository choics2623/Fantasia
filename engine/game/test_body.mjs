// node engine/game/test_body.mjs — 스킬 성장(01 §5·03 §3·06 §4)과 소지품(02 §2~3)
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);

// 성장: 말을 섞을수록 화술이 자란다 — 다만 잡담만으로는 40을 넘지 못한다
const g = G.boot(C, G.newRun({ seed: 7, opening: false }));
const s0 = G.skill(g, "화술");
for (let i = 0; i < 6; i++) { G.act(g, { id: "talk:npc_bram" }); for (let k = 0; k < 3 && ids(g).includes("small_talk"); k++) G.act(g, { id: "small_talk" }); if (ids(g).includes("leave")) G.act(g, { id: "leave" }); }
const s1 = G.skill(g, "화술");
const snap = JSON.parse(JSON.stringify(g.run)), snapView = JSON.stringify(G.view(g));
check("쓰는 스킬이 자란다", s1 > s0, `${s0.toFixed(1)} → ${s1.toFixed(2)}`);
g.P.gain.화술 = 40 - g.P.skills.화술;
const before = g.P.gain.화술;
G.act(g, { id: "talk:npc_bram" }); if (ids(g).includes("small_talk")) G.act(g, { id: "small_talk" });
check("잡담(안전한 실습)은 40에서 멈춘다", g.P.gain.화술 === before);
// 회귀: 머리의 스킬은 그대로, 몸의 스킬은 상한에 묶인다
const run2 = G.regressRun(g);
const g2 = G.boot(C, { ...run2, opening: false });
check("머리의 스킬은 회귀해도 그대로", Math.round(G.skill(g2, "화술")) === 40, G.skill(g2, "화술").toFixed(1));
const run3 = JSON.parse(JSON.stringify(run2)); run3.carry.soul.skills.은신 = 60;
const g3 = G.boot(C, { ...run3, opening: false });
const cap = G.bodyCap(g3, "은신");
check("몸의 스킬은 몸의 상한 + 넘는 만큼의 1/4", Math.abs(G.skill(g3, "은신") - (cap + (60 - cap) * 0.25)) < 0.01, `상한 ${cap} → ${G.skill(g3, "은신").toFixed(1)}`);
check("화면엔 '몸이 아직'", G.view(g3).skills.find((k) => k.name === "은신").lagging);

// 소지품: 칼을 허리에 차면 보이고, 부츠에 넣으면 숨는다
const h = G.boot(C, G.newRun({ seed: 7, opening: false }));
h.L.give("player", { ...C.game.economy.goods.knife, id: "it_knife_t", gid: "knife" });
check("칼은 처음엔 품에", G.view(h).player.items.find((i) => i.id === "it_knife_t").slot === "품");
check("부츠·소매·허리·손으로 옮길 수 있다", ["wear:it_knife_t:부츠", "wear:it_knife_t:소매", "wear:it_knife_t:허리", "wear:it_knife_t:손"].every((x) => ids(h).includes(x)));
const w = G.act(h, { id: "wear:it_knife_t:허리" });
check("허리에 차면 그 자리 사람들의 눈이 머문다", w.notes.some((n) => n.includes("눈이")), w.notes.join(" / "));
const sawAuth = w.notes.some((n) => /즈닉|헨릭/.test(n));
check("감독이 보면 수배가 붙는다 (아니면 안 붙는다)", sawAuth === ((h.S.wanted.player?.heat || 0) >= 1));
// 도구: 밧줄과 갈고리가 있으면 성채 담을 넘는 길이 열린다
const t = G.boot(C, G.newRun({ seed: 7, opening: false }));
const before2 = ids(t).filter((x) => x.startsWith("go:gf_granary"));
for (const gid of ["rope", "hook"]) t.L.give("player", { ...C.game.economy.goods[gid], id: `it_${gid}_t`, gid });
const gran = G.options(t).find((o) => o.id === "go:gf_granary");
check("밧줄·갈고리 없이는 곡창에 갈 수 없다", !before2.length);
check("밧줄·갈고리가 있으면 곡창 지붕으로", !!gran && gran.label.includes("환기창") && gran.skill === "은신", gran?.label);
check("근거 미리보기에 도구가 보인다", G.odds(t, gran).parts.some((p) => p.text.includes("갈고리")));
// 빵을 나누면 마음이 움직인다
const f = G.boot(C, G.newRun({ seed: 7, opening: false }));
f.L.give("player", { ...C.game.economy.goods.bread, id: "it_bread_t", gid: "bread" });
G.act(f, { id: "talk:npc_kit" });
const r0 = f.S.rel.get("npc_kit>player")?.like || 0;
G.act(f, { id: "give:it_bread_t" });
check("빵을 나누면 키트의 마음이 움직인다", (f.S.rel.get("npc_kit>player")?.like || 0) > r0);
// 재생
const again = G.boot(C, snap);
check("성장도 재생하면 같다", JSON.stringify(G.view(again)) === snapView && G.skill(again, "화술") === s1);
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
