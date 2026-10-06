// node engine/game/test_opening.mjs — 회귀점의 대본 장면 (14 §6): 이름, 머릿수, 어머니의 기억, 첫 밤, 문설주의 원
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const opts = (g) => G.options(g).map((o) => o.id);

const g = G.boot(C, G.newRun({ seed: 7 }));
let v = G.view(g);
check("첫 화면은 18:00 배급 줄, 이름을 묻는 장면", v.hm === "18:00" && v.story?.id === "ration_line_open" && v.story.phase === "input");
check("첫 화면에는 이름 입력 하나뿐", opts(g).length === 1 && opts(g)[0] === "story_name");
let r = G.act(g, { id: "story_name", text: "하린|누나" });
check("어머니가 그 이름을 부른다", r.storyText.includes('"하린."') && r.storyText.includes("게르다"), r.storyText.slice(0, 60));
check("이어서 머릿수 장면 — 선택지 여섯 (돈이 있으면)", G.view(g).story?.id === "ration_line_count" && G.options(g).length === 6, opts(g).join(", "));
check("사라의 귓속말로 지킬 사람과 시한이 생긴다 (키트, 서리월 9일)", G.view(g).goals.some((x) => x.who === "키트" && x.days === 38), JSON.stringify(G.view(g).goals));
check("화면의 사람들에게 '누구인지'가 붙는다", G.view(g).people.find((p) => p.id === "npc_bram")?.who?.includes("배급"));
r = G.act(g, { id: "story:stay_in_line" });
check("줄에 그대로 서면 빵을 받고, 브람이 키트 그릇에 누룽지를 얹는다", r.storyText.includes("누룽지") && G.view(g).player.hunger === 1);
check("장면이 끝나면 자유롭게 움직인다", !G.view(g).story && opts(g).some((x) => x.startsWith("talk:")));

// 사라를 쫓아가면 줄을 비운다 — 15분이 넘으면 키트가 맞는다
const g2 = G.boot(C, G.newRun({ seed: 7 })); G.act(g2, { id: "story_name", text: "하린|형" });
const r2 = G.act(g2, { id: "story:osric_prayer" });
check("오스릭의 기도로 가면 배식을 놓치고, 키트가 자리를 맡다 맞는다", r2.storyText.includes("두 자리 맡는 쥐새끼") && g2.S.vars.kit_covered_for_you === true);
check("오스릭이 빛의 서신 조각을 맡긴다 (들키면 죽는 첫 물건)", G.view(g2).player.items.some((i) => i.name.includes("서신")));

// 밤: 움막으로 가서 잔다 → 21:30 어머니의 기억 → 01:40 첫 밤 → 04:30 문설주의 원
const h = G.boot(C, G.newRun({ seed: 7 })); G.act(h, { id: "story_name", text: "하린|형" }); G.act(h, { id: "story:stay_in_line" });
G.act(h, { id: "go:gf_river_huts" });
while (!G.view(h).story && G.view(h).hm < "23:00") G.act(h, { id: G.options(h).some((o) => o.id === "sleep") ? "sleep" : "wait:60" });
check("21:30 움막에서 어머니가 기억하는 너 — 카드 셋", G.view(h).story?.id === "serf_mother_memory" && G.options(h).length === 3, G.view(h).hm);
const skill0 = h.P.skills.은신;
G.act(h, { id: "story:talent_shadow" });
check("고른 카드가 재능이 된다 (은신 +8)", h.P.skills.은신 === skill0 + 8 && h.P.talent === "shadow");
G.act(h, { id: "sleep" });
check("자다가 01:40 첫 밤에 깬다 — 바닥의 글자", G.view(h).story?.id === "first_night_letter" && G.view(h).hm === "01:40", G.view(h).hm);
r = G.act(h, { id: "story:leave_it" });
check("그대로 두면 스니가 '이상한 금'을 본다", h.S.vars.hut12_marks_seen === true && h.S.vars.elsa_heard_sleeptalk === true);
G.act(h, { id: "sleep" });
check("04:30 첫 종 — 문설주의 숯 원", G.view(h).story?.id === "doorpost_circle", G.view(h).hm);
G.act(h, { id: "story:to_rollcall" });
check("그리고 점호 광장으로", h.at === "gf_whip_square" && !G.view(h).story);

// 재생: 대본 장면도 기록으로 다시 만들어진다
const again = G.boot(C, JSON.parse(JSON.stringify(h.run)));
check("대본 장면을 거친 판도 재생하면 같다", JSON.stringify(G.view(again)) === JSON.stringify(G.view(h)));
// 회귀: 이름은 남는다 — 두 번째 회차엔 이름을 묻지 않는다
const next = G.boot(C, G.regressRun(h));
check("회귀하면 이름을 다시 묻지 않는다 (어머니는 같은 이름을 부른다)", G.view(next).story?.phase === "choice" && next.run.carry.trueName === "하린" && next.run.carry.talent === "shadow");
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
