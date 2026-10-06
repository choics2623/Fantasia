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
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
