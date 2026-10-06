// 카드의 reveal_when(사람이 쓴 글) → reveal:(엔진 조건)을 카드 YAML에 적는다. 이미 reveal:이 있으면 건드리지 않는다.
//   node tools/write_reveals.mjs          — 적고, '이야기가 여는 열쇠'(story)로 남은 것을 목록으로 보여 준다
//   node tools/write_reveals.mjs --check  — 적지 않고 보고만
// 사람이 reveal:을 고치면 그것이 정본이다 (다시 돌려도 덮어쓰지 않는다).
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseRevealText } from "../engine/game/reveal.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const cards = JSON.parse(readFileSync(join(ROOT, "content/base/npcs/cards.json"), "utf8")).cards;
const names = {};
for (const c of Object.values(cards)) { if (!c.name) continue; names[c.name] = c.id; for (const p of c.name.split(/\s+/)) if (p.length > 1 && !names[p]) names[p] = c.id; }
const check = process.argv.includes("--check");
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".yaml") ? [p] : []; });
let wrote = 0, files = 0; const story = [];
for (const file of walk(join(ROOT, "content/base/npcs/cards"))) {
  const lines = readFileSync(file, "utf8").split("\n");
  let changed = false, inHides = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^hides:/.test(lines[i])) { inHides = true; continue; }
    if (inHides && /^\S/.test(lines[i])) inHides = false;
    if (!inHides) continue;
    const m = /^(\s+)reveal_when:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    // 같은 항목에 이미 reveal:이 있나
    let j = i + 1, has = false;
    while (j < lines.length && lines[j].startsWith(m[1]) && !/^\s+- /.test(lines[j])) { if (/^\s+reveal:/.test(lines[j])) has = true; j++; }
    if (has) continue;
    let text = m[2].trim();
    if (/^["']/.test(text)) text = text.slice(1, -1);
    const { alts, manual } = parseRevealText(text, names);
    const list = alts.length ? alts : [{ flag: "story" }];
    if (list.every((a) => a.flag === "story")) story.push(`${file.replace(ROOT, "")}: ${manual.join(" | ") || text}`);
    if (!check) { lines.splice(i + 1, 0, `${m[1]}reveal: ${JSON.stringify(list)}   # 엔진 조건 (28 §4) — 고치면 이것이 정본`); changed = true; wrote++; i++; }
  }
  if (changed) { writeFileSync(file, lines.join("\n")); files++; }
}
console.log(`${check ? "확인" : "적음"}: ${wrote}개 (${files}개 카드). 이야기가 여는 열쇠(story)로 남은 것 ${story.length}개 — 장면·목표 행동이 vars["story:<사실 id>"] = true 로 연다:`);
for (const s of story) console.log("  - " + s);
