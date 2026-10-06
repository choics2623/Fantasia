// node engine/game/test_story.mjs — 하루의 끝(18 §5)·지난 이야기·목소리(15)·맹세와 메아리(16)·인물 수첩(08 §5)
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const ids = (g) => G.options(g).map((o) => o.id);
const feedOf = (r, k) => (r.feed || []).filter((f) => f.kind === k);

check("'{n}째 저녁'", [1, 2, 3, 4, 10, 11, 20, 23].map(G.nthKo).join(",") === "첫째,둘째,셋째,넷째,열째,열한째,스무째,스물셋째", [1, 2, 3, 4, 10, 11, 20, 23].map(G.nthKo).join(","));

// 목소리: 첫 30분은 침묵, 그 뒤 아스테리온의 첫 줄
const g = G.boot(C, G.newRun({ seed: 7 }));
let r = G.act(g, { id: "story_name", text: "하린|형" });
check("회차 시작 30분은 침묵", !feedOf(r, "voice").length);
r = G.act(g, { id: "story:stay_in_line" });
let voices = [];
for (let i = 0; i < 6 && !voices.length; i++) { r = G.act(g, { id: "wait:60" }); voices = feedOf(r, "voice"); }
check("아스테리온 ⟨문의 목소리⟩의 첫 줄", voices[0]?.who === "문의 목소리" && voices[0].text.startsWith("문마다"), JSON.stringify(voices[0]));
// 맹세: 계기(키트의 명단)를 안 뒤 — 소리 내어 맹세하면 그 자리 사람들이 증인
check("맹세가 제안된다", ids(g).includes("oath:oath_kit"));
if (g.at !== "gf_rooster") G.act(g, { id: "go:gf_rooster" });
const before = G.view(g).people.length;
r = G.act(g, { id: "oath:oath_kit" });
check("맹세 — 증인과 수첩", G.view(g).oaths[0]?.line === "키트는 팔리지 않는다." && G.view(g).notebook.some((n) => n.startsWith("맹세 —")), JSON.stringify(G.view(g).oaths[0]));
// 하루의 끝: 잠들면 갈고리 한 줄 + 하루 카드
G.act(g, { id: "go:gf_river_huts" });
let de = null;
for (let i = 0; i < 4 && !de; i++) { if (G.view(g).story) { G.act(g, { id: ids(g)[0] }); continue; } r = G.act(g, { id: ids(g).includes("sleep") ? "sleep" : "wait:60" }); de = feedOf(r, "dayend")[0]; }
check("잠들면 하루의 끝 — 갈고리와 카드", !!de && de.text.length > 5 && de.card.includes("동화"), JSON.stringify(de));
// 서른여드레 남은 일은 '기한 없음'에 가깝다 (임박도 0.2) — 첫 밤은 대개 고요한 마감 문장
check("갈고리 또는 고요한 마감 문장", (C.game.director.quiet.includes(de?.text)) || C.game.director.beats.some((b) => b.near === de?.text || b.far === de?.text), de?.text);

// 지난 이야기: 9시간 비웠다면 한 줄, 닷새면 짧은 요약
check("6시간 미만이면 지난 이야기 없음", G.recap(g, 2).length === 0);
check("하룻밤 비웠으면 지난밤의 갈고리 한 줄", G.recap(g, 9)[0]?.startsWith("지난밤:"), G.recap(g, 9).join(" / "));
check("닷새면 짧은 요약 (지금 — …)", G.recap(g, 120).some((x) => x.startsWith("지금 —")));
// 인물 수첩: 키트에 대해 아는 사실이 그 사람의 장에
const kit = G.view(g).people_known.find((p) => p.id === "npc_kit") || null;
const g2 = G.boot(C, G.newRun({ seed: 7, opening: false }));
G.act(g2, { id: "talk:npc_bram" }); G.act(g2, { id: "leave" });
g2.P.knows.add("fact_gf_egil_family_in_cellar");
const bram = G.view(g2).people_known.find((p) => p.id === "npc_bram");
check("인물 수첩: 브람의 장에 아는 사실 (확신도 표지)", bram?.facts?.some((f) => f.text.includes("가짜 벽") && f.sure === "□"), JSON.stringify(bram?.facts));
check("인물 수첩: 사람 사이의 연결", bram?.links?.some((l) => l.other === "에길"), JSON.stringify(bram?.links));
// 메아리: 헨릭에게 담보를 말해 토비가 끌려가는 날, 원인을 불러 준다
const run = G.newRun({ seed: 7 }); run.carry.trueName = "하린"; run.loop = 2; run.carry.future = ["fact_gf_godric_debt"]; run.carry.soul = { ...G.emptySoul(), knowledge: { fact_gf_godric_debt: { first: 1, last: 1, seen: 1 } } };
const h = G.boot(C, run);
G.act(h, { id: "story:next" });
check("◈ 헨릭에게 담보", ids(h).includes("story:mem_henrik_harbek"));
let ok = false;
for (let seed = 1; seed < 30 && !ok; seed++) {
  const x = G.boot(C, { ...run, seed, journal: [] }); G.act(x, { id: "story:next" });
  G.act(x, { id: "story:mem_henrik_harbek" });
  if (x.S.vars.toby_on_list === true) { ok = true; x.S.vars.toby_sold = true; const rr = G.act(x, { id: G.view(x).story ? ids(x)[0] : "wait:60" }); const rr2 = feedOf(rr, "echo").length ? rr : G.act(x, { id: G.view(x).story ? ids(x)[0] : "wait:60" }); check("메아리: 원인 한 줄", [...feedOf(rr, "echo"), ...feedOf(rr2, "echo")].some((f) => f.text.includes("너는 헨릭에게 담보를 말했다"))); }
}
check("(헨릭 흥정이 성공하는 시드가 있다)", ok);
// 지난 회차의 나: 두 번째 회차의 첫 마디는 그 회차의 마지막 장면
const dead = G.boot(C, G.newRun({ seed: 7, opening: false })); dead.ended = { kind: "dead", why: "x", t: dead.t, trace: { id: "water", npc: "npc_hagen" } };
const n2 = G.boot(C, { ...G.regressRun(dead), opening: false });
G.act(n2, { id: "wait:60" }); const rv = G.act(n2, { id: "wait:60" });
const self = [...feedOf(rv, "voice")];
check("첫 회차의 나 — '물이 차가웠어. …하겐은 웃고 있었어.'", self.some((v) => v.who === "첫 회차의 나" && v.text.includes("물이 차가웠어") && v.text.includes("하겐")), JSON.stringify(self));
// 재생
const again = G.boot(C, JSON.parse(JSON.stringify(g.run)));
check("목소리·맹세·하루의 끝도 재생하면 같다", JSON.stringify(G.view(again)) === JSON.stringify(G.view(g)));
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
