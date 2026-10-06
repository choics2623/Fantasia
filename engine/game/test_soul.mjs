// node engine/game/test_soul.mjs — 영혼(03 §4.1): 회귀를 건너는 것, 근거 미리보기(01 §4.3), 해금(14 §8), 카드의 회귀 메모(22 §1)
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import { turnPrompt } from "./prompts.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };

const g = G.boot(C, G.newRun({ seed: 7, opening: false }));
let v = G.view(g);
check("처음엔 수첩·사람·평판이 잠겨 있다", !v.unlocked.includes("notebook") && !v.unlocked.includes("reputation") && !v.unlocked.includes("loop"), v.unlocked.join(","));
G.act(g, { id: "talk:npc_bram" });
const st = G.options(g).find((o) => o.id === "small_talk");
const od = G.odds(g, st);
check("판정 근거는 캐릭터가 아는 말로 (▲▼?)", od.parts.length >= 2 && od.parts.every((p) => ["▲", "▼", "?"].includes(p.sign) && typeof p.text === "string"), od.parts.map((p) => p.sign + p.text).join(" / "));
check("배고픔이 근거에 보인다", od.parts.some((p) => p.text.includes("배가 고프다")));
check("체감 등급은 6단", ["식은 죽 먹기", "확실해 보인다", "해볼 만하다", "반반이다", "운이 따라야 한다", "무모하다"].includes(G.band(G.perceived(g, od.P, "화술", "small_talk"))));
// 서툰 사람은 과신한다 (평균적으로 체감 > 실제)
let over = 0; for (let i = 0; i < 40; i++) over += G.perceived(g, 0.3, "싸움", "k" + i) - 0.3;
check("서툰 싸움꾼은 자기를 믿는다 (과신 편향)", over / 40 > 0.05, (over / 40).toFixed(3));
G.act(g, { id: "small_talk" });
G.act(g, { id: "leave" });
check("말을 섞으면 '사람' 해금", G.view(g).unlocked.includes("people"));

// 회귀: 아는 사람은 남는다 — 관계 수치는 아니고, 그 회차에 어떤 사이였는지만
const run2 = G.regressRun(g);
check("영혼에 브람이 남는다", !!run2.carry.soul.people.npc_bram && run2.carry.soul.people.npc_bram.loops[0].loop === 1);
check("회차 기록이 남는다", run2.carry.soul.records.length === 1 && run2.carry.soul.records[0].loop === 1, JSON.stringify(run2.carry.soul.records[0]).slice(0, 120));
const g2 = G.boot(C, { ...run2, opening: false });
v = G.view(g2);
const bram = v.people_known.find((p) => p.id === "npc_bram");
check("회귀 직후 '아는 사람들'에 브람이 있다 (이번 회차엔 나를 모른다)", bram && !bram.thisLoop && bram.past.length === 1 && bram.mood.includes("모른다"), JSON.stringify(bram));
check("회귀하면 회차 칩이 열린다", v.unlocked.includes("loop") && v.unlocked.includes("people"));
const rel = g2.S.rel.get("npc_bram>player") || { like: 0, trust: 0 };
check("관계 수치는 넘어가지 않는다", rel.like === (G.boot(C, G.newRun({ seed: 7, opening: false })).S.rel.get("npc_bram>player") || { like: 0 }).like);
// 이름 모르던 사람도, 지난 회차에 이름을 알았으면 이번엔 이름으로 보인다
const isolKnown = G.boot(C, { ...G.newRun({ seed: 7, opening: false }), carry: { ...G.newRun().carry, soul: { ...G.emptySoul(), people: { npc_isol: { loops: [{ loop: 1, like: 0, trust: 0, impressions: [], lines: [] }] } } } } });
check("지난 회차에 이름을 안 사람은 이름으로", G.displayName(isolKnown, "npc_isol") === C.cards.npc_isol.name, G.displayName(isolKnown, "npc_isol"));

// 카드의 회귀 메모: 하겐의 '18시 10분 빵' 줄이 장면 자료에 (그 날이면)
const tp = turnPrompt(g2, null, G.options(g2), {});
check("하겐: 매 회차 이 날 같은 일", tp.includes("18시 10분, 빵 한 덩이"));
check("메타 괄호는 지운다", !tp.includes("90% 이상 같다"));
check("2회차 장면에 주인공의 기억 한 줄", tp.includes("[주인공의 기억: 1회차엔"));

// 재생: 영혼은 회차 시작의 고정 입력 — 재생해도 같다
const again = G.boot(C, JSON.parse(JSON.stringify(g2.run)));
check("영혼이 있어도 재생하면 같다", JSON.stringify(G.view(again)) === JSON.stringify(G.view(g2)));

// ── 죽음에서 회귀까지 (14 §4·§6.5·§6.6) ──
const step = (g, pref) => { const ids = G.options(g).map((o) => o.id); const a = pref.map((x) => ids.find((i) => i.startsWith(x))).find(Boolean) || ids.find((x) => x.startsWith("story:")) || "wait:60"; return G.act(g, { id: a }); };
let dead = null;
for (let seed = 1; seed < 40 && !dead; seed++) {
  const d = G.boot(C, G.newRun({ seed }));
  G.act(d, { id: "story_name", text: "하린|형" }); G.act(d, { id: "story:stay_in_line" });
  for (let i = 0; i < 40 && !d.ended; i++) step(d, ["attack:npc_znik", "attack:npc_hagen"]);
  if (d.ended?.kind === "dead") dead = d;
}
check("맨손으로 덤비다 죽을 수 있다 (흔적: 목)", !!dead && dead.ended.trace?.id === "blade", dead?.ended?.why);
const E = G.view(dead).ended;
check("짧은 회차 기록 세 줄 — 기간·원인 사슬·가져가는 것", E.record.short.length === 3 && E.record.short[0].includes("하루") && E.record.short[1].startsWith("너는 ") && E.record.short[2].startsWith("가져가는 것"), E.record.short.join(" / "));
check("되감기의 마지막 줄은 낙엽월 1일", E.record.rewind[E.record.rewind.length - 1] === "낙엽월 1일");
check("시대의 첫 죽음", E.firstDeath === true);
const n2 = G.boot(C, G.regressRun(dead));
const intro = G.storyIntro(n2);
check("두 번째 회차의 첫 화면: 속마음 한 줄과 흔적이 깨운 줄, 기억 잉크", intro.includes("*나는 — 이 냄새를 안다.*") && intro.includes("목이 뜨겁다") && intro.includes("┊ 그 다음엔 사라가"), intro.slice(0, 80));
G.act(n2, { id: "story:next" });
const mopts = G.options(n2).filter((o) => o.memory);
check("◈ 기억 선택지 — 두 번째 회차부터 (사라보다 먼저)", mopts.some((o) => o.id === "story:mem_sara_first"), mopts.map((o) => o.id).join(","));
check("첫 회차엔 ◈가 없다", !G.options((() => { const x = G.boot(C, G.newRun({ seed: 3 })); G.act(x, { id: "story_name", text: "하|형" }); return x; })()).some((o) => o.memory));
const killer = dead.ended.trace.npc;
const r3 = G.act(n2, { id: "story:mem_sara_first" });
check("죽인 사람을 다시 보면 손이 먼저 기억한다 (┊ + 진동)", r3.feed.some((f) => f.kind === "ink" && f.buzz === "H4"), JSON.stringify(r3.feed));
check("사라가 멈칫한다 — 정오, 우물", n2.S.vars.sara_well_noon === true);
const atk = G.options(n2).find((o) => o.id === `attack:${killer}`);
if (atk) check("근거 미리보기에 흔적 한 줄", G.odds(n2, atk).parts.some((p) => p.text.includes("목이 먼저 기억한다")));
// 첫 잠자리: 잠들기 전, 너는 센다
step(n2, ["go:gf_river_huts"]);
const sl = G.act(n2, { id: "sleep" });
check("두 번째 회차의 첫 잠자리 — 잠들기 전, 너는 센다", sl.storyText?.includes("잠들기 전, 너는 센다") && G.options(n2)[0].id === "story:count");
const cnt = G.act(n2, { id: "story:count" });
check("센다 → 전체 회차 기록", cnt.storyText.includes("첫 번째 저녁부터") && cnt.storyText.includes("── 가져온 것 ──"), cnt.storyText.slice(0, 60));
// 세 회차 연속 고른 ◈는 표지가 빠진다 (습관)
const habit = G.boot(C, { ...n2.run, journal: [], loop: 5, carry: { ...n2.run.carry, soul: { ...n2.run.carry.soul, memUsed: { "story:mem_sara_first": [2, 3, 4] } } } });
G.act(habit, { id: "story:next" });
const hs = G.options(habit).find((o) => o.id === "story:mem_sara_first");
check("세 회차 연속 고른 ◈는 습관 — 표지가 빠진다", hs && !hs.memory);
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
