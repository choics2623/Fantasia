// 목표 행동 데이터 검사 (26 §6): 문법, 존재하는 인물·장소·사실·변수.
//   node tools/validate_agendas.mjs
import { readFileSync } from "node:fs";
const R = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const game = R("content/build/game.json"), bundle = R("content/build/whereabouts.json"), cards = R("content/base/npcs/cards.json").cards;
const places = new Set(); for (const s of Object.values(bundle.settlements)) { for (const l of s.locations || []) places.add(l.id); for (const o of s.outer || []) places.add(o.id); }
for (const n of bundle.map.nodes) places.add(n.id);
const vars = game.agendas.vars, facts = game.facts;
const problems = [];
const P = (ag, msg) => problems.push(`${ag.id}: ${msg}`);
const ids = new Set();
const CONDS = { alive: 1, dead: 1, present: 1, knows: 2, var: 3, coin: 3, date: 2, believes: 2 };
function checkCond(ag, c) {
  const s = c.replace(/^not /, ""); const [k, a, b, d] = s.split(/\s+/);
  if (!CONDS[k]) return P(ag, `모르는 조건 '${c}'`);
  if (["alive", "dead", "present", "knows", "coin", "believes"].includes(k) && !cards[a]) P(ag, `조건의 인물 없음: ${a}`);
  if (k === "knows" && !facts[b]) P(ag, `조건의 사실 없음: ${b}`);
  if (k === "var" && !(a in vars)) P(ag, `선언되지 않은 변수: ${a}`);
  if ((k === "var" || k === "coin") && !["==", "!=", ">=", "<=", ">", "<"].includes(b)) P(ag, `연산자 '${b}'`);
  if ((k === "var" || k === "coin") && d?.startsWith("var:") && !(d.slice(4) in vars)) P(ag, `선언되지 않은 변수: ${d}`);
  if (k === "date" && !/^\d+-\d+-\d+$/.test(b || "")) P(ag, `날짜 형식 '${b}'`);
}
function checkEffect(ag, e) {
  if (e.startsWith("if ")) { const body = e.slice(3), cut = body.indexOf(": "); if (cut < 0) return P(ag, `if에 ': ' 없음`); checkCond(ag, body.slice(0, cut)); return body.slice(cut + 2).split(/\s*;\s*/).forEach((x) => checkEffect(ag, x)); }
  if (e.startsWith("else:")) return e.slice(5).trim().split(/\s*;\s*/).forEach((x) => checkEffect(ag, x));
  const p = e.split(/\s+/), k = p[0];
  if (k === "var") { if (!(p[1] in vars)) P(ag, `선언되지 않은 변수: ${p[1]}`); if (!["=", "+=", "-="].includes(p[2])) P(ag, `변수 연산 '${p[2]}'`); }
  else if (k === "learn") { if (!cards[p[1]]) P(ag, `learn 인물 없음 ${p[1]}`); if (!facts[p[2]]) P(ag, `learn 사실 없음 ${p[2]}`); }
  else if (k === "rel") { const [a, b] = (p[1] || "").split(">"); if (!cards[a] || !cards[b]) P(ag, `rel 인물 없음 ${p[1]}`); }
  else if (["capture", "punish"].includes(k)) { if (!cards[p[1]]) P(ag, `${k} 인물 없음 ${p[1]}`); if (!places.has(p[3])) P(ag, `${k} 장소 없음 ${p[3]}`); }
  else if (k === "kill") { if (!cards[p[1]]) P(ag, `kill 인물 없음 ${p[1]}`); }
  else if (k === "coin" || k === "pay") { if (!cards[p[1]] && p[1] !== "player") P(ag, `${k} 인물 없음 ${p[1]}`); }
  else if (k === "close" || k === "burn") { if (!places.has(p[1])) P(ag, `${k} 장소 없음 ${p[1]}`); }
  else if (k === "log") { for (const m of e.matchAll(/\{(\w+)\}/g)) if (!(m[1] in vars)) P(ag, `log의 변수 없음 {${m[1]}}`); }
  else P(ag, `모르는 효과 '${e}'`);
}
for (const ag of game.agendas.agendas) {
  if (ids.has(ag.id)) P(ag, "id 중복"); ids.add(ag.id);
  if (!cards[ag.npc]) P(ag, `인물 없음 ${ag.npc}`);
  if (!/^(once|daily|weekday:[1-6]|every:\d+)$/.test(ag.every || "")) P(ag, `every '${ag.every}'`);
  if (!ag.at?.place || !places.has(ag.at.place)) P(ag, `장소 없음 ${ag.at?.place}`);
  if (!/^\d\d:\d\d$/.test(ag.at?.from || "") || !/^\d\d:\d\d$/.test(ag.at?.to || "")) P(ag, "시각 형식");
  for (const c of ag.when || []) checkCond(ag, c);
  for (const e of ag.effects || []) checkEffect(ag, e);
}
console.log(problems.length ? problems.join("\n") : "");
console.log(`목표 행동 ${game.agendas.agendas.length}개 · 변수 ${Object.keys(vars).length}개 · 문제 ${problems.length}개`);
process.exit(problems.length ? 1 : 0);
