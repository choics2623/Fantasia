// node engine/sim/test_whereabouts.mjs — 위치 엔진 검사와 하루 시간표 출력
import { readFileSync } from "node:fs";
import { createWorld } from "./whereabouts.mjs";
import { toMinutes, fmt } from "./calendar.mjs";

const bundle = JSON.parse(readFileSync(new URL("../../content/build/whereabouts.json", import.meta.url), "utf8"));
const W = createWorld(bundle, { loopSeed: 7 });
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fail++; };
const at = (npc, y, m, d, hh, mm = 0) => W.where(npc, toMinutes(y, m, d, hh, mm));

// 1. 회귀점: 낙엽월 1일 19시, 브람은 수탉에서 배식 중 (fixed)
let w = at("npc_bram", 312, 9, 1, 19); check("회귀점 19:00 브람은 수탉", w.at === "gf_rooster", `${w.place} · ${w.doing}`);
// 2. 볼크는 9/14 전엔 없고, 9/20엔 굶주린 언덕 쪽
w = at("npc_volk", 312, 9, 10, 12); check("9/10 볼크는 부재", w.kind === "away", w.doing);
w = at("npc_volk", 312, 9, 20, 12); check("9/20 볼크는 회색여울 주변", ["hungry_hill", "gf_keep_guest", "hungry_hill__fang_fire"].includes(w.at), `${w.place} · ${w.doing}`);
w = at("npc_volk", 312, 9, 25, 12); check("9/25 볼크 대수색 (일정)", w.source === "event" && w.at === "hungry_hill", w.doing);
// 3. 카스파르 15일: 새벽엔 오는 길, 낮엔 성채 회의, 17:15엔 돌 고리, 그 뒤엔 귀로
w = at("npc_kaspar", 312, 9, 15, 7); check("9/15 07:00 카스파르 이동 중", w.kind === "travel", `${w.doing} ${w.leg ? w.leg.from + "→" + w.leg.to : ""}`);
w = at("npc_kaspar", 312, 9, 15, 13); check("9/15 13:00 카스파르 성채 회의", w.at === "gf_keep_hall", w.doing);
w = at("npc_kaspar", 312, 9, 15, 17, 15); check("9/15 17:15 카스파르 돌 고리", w.at === "old_stone_ring", w.doing);
w = at("npc_kaspar", 312, 9, 15, 18); check("9/15 18:00 카스파르 귀로", w.kind === "travel", w.doing);
w = at("npc_kaspar", 312, 9, 16, 12); check("9/16 카스파르는 까마귀 문", w.at === "crow_gate", w.doing);
// 4. 요한은 9/12까지 있고 9/20엔 순례 중
check("9/5 요한 체류", at("npc_johan", 312, 9, 5, 12).kind !== "away");
check("9/20 요한 부재", at("npc_johan", 312, 9, 20, 12).kind === "away");
// 5. 안식일 (6일째): 오스릭 22시 납골실
let sab = null; for (let d = 1; d <= 6; d++) if (Math.floor(toMinutes(312, 9, d) / 1440) % 6 === 5) sab = d;
w = at("npc_osric", 312, 9, sab, 22, 30); check(`안식일(9/${sab}) 22:30 오스릭 납골실`, w.at === "gf_chapel_ossuary", w.doing);
// 6. 걷기: 브람이 11시에 성채로 간다 → 11:03엔 걷는 중
w = at("npc_bram", 312, 9, 2, 11, 3); check("9/2 11:03 브람 성채로 걷는 중", w.kind === "walking" || w.at === "gf_keep_store", `${w.kind} ${w.doing}`);
// 7. 모든 NPC, 30일, 30분마다 — 장소가 실제로 존재하는가
let bad = 0, total = 0;
for (const npc of Object.keys(bundle.routines)) for (let t = toMinutes(312, 9, 1); t < toMinutes(312, 10, 1); t += 30) {
  const x = W.where(npc, t); total++;
  if (x.kind !== "away" && x.kind !== "dead" && !W.exists(x.at)) { bad++; if (bad < 5) console.log("   없는 장소:", npc, fmt(t), x.at); }
  if (x.kind === "away" && x.at && !W.exists(x.at)) { bad++; if (bad < 5) console.log("   없는 부재 장소:", npc, x.at); }
}
check(`모든 위치가 실제 장소 (${total}건)`, bad === 0, `${bad}건 문제`);
// 8. 결정성: 같은 시드 = 같은 답, 다른 시드 = 조금 다름
const W2 = createWorld(bundle, { loopSeed: 7 }), W3 = createWorld(bundle, { loopSeed: 8 });
let same = 0, diff = 0;
for (const npc of Object.keys(bundle.routines)) for (let t = toMinutes(312, 9, 1); t < toMinutes(312, 9, 11); t += 60) {
  const a = JSON.stringify(W.where(npc, t)), b = JSON.stringify(W2.where(npc, t)), c = JSON.stringify(W3.where(npc, t));
  if (a === b) same++; if (a !== c) diff++;
}
check("같은 시드 = 같은 답", same === Object.keys(bundle.routines).length * 240);
check("다른 시드 = 작은 일이 어긋남 (표류)", diff > 0, `${diff}건 다름`);
// 9. 덮어쓰기: 하겐이 죽으면
W2.override({ npc: "npc_hagen", from: toMinutes(312, 9, 4, 0), kind: "dead", at: "gf_graveyard", doing: "죽었다" });
check("덮어쓰기(죽음)가 일정보다 우선", W2.where("npc_hagen", toMinutes(312, 9, 5, 23)).kind === "dead");
// 10. 누가 어디에: 회귀점의 수탉
const here = W.whoIsAt("gf_rooster", toMinutes(312, 9, 1, 19, 10)).map((x) => x.place && x.npc.replace("npc_", ""));
console.log("\n9/1 19:10 수탉에 있는 사람:", here.join(", "));

// 하루 시간표
for (const npc of ["npc_fayne", "npc_znik", "npc_kaspar"]) {
  const day = npc === "npc_kaspar" ? 15 : 2;
  console.log(`\n── ${npc} · 낙엽월 ${day}일 ──`);
  for (const s of W.timeline(npc, toMinutes(312, 9, day, 0), toMinutes(312, 9, day + 1, 0), 10)) {
    const a = fmt(s.from).slice(-5), b = fmt(s.to).slice(-5);
    console.log(`  ${a}–${b}  ${s.w.kind === "travel" ? "🐎 " : s.w.kind === "walking" ? "👣 " : ""}${s.w.place ?? "-"} · ${s.w.doing}${s.w.note ? ` (${s.w.note})` : ""}`);
  }
}
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과");
process.exit(fail ? 1 : 0);
