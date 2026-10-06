// node engine/gen/test_gen.mjs — 정착지·인물 생성기 검사 (+ 위치 엔진과의 연결)
import { readFileSync } from "node:fs";
import { generateSettlement } from "./settlement.mjs";
import { generatePerson } from "./person.mjs";
import { createWorld } from "../sim/whereabouts.mjs";
import { toMinutes } from "../sim/calendar.mjs";

const yaml = await import("node:child_process").then((cp) => (p) => JSON.parse(cp.execFileSync("python3", ["-c", `import yaml,json,sys;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))`, p]).toString()));
const kit = yaml(new URL("../../content/base/kits/human_serf.yaml", import.meta.url).pathname);
const tpl = kit.settlement_templates[0];
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };

const a = generateSettlement(tpl, { id: "willow_hamlet", name: "버들목", size: 0.6 });
const b = generateSettlement(tpl, { id: "willow_hamlet", name: "버들목", size: 0.6 });
const c = generateSettlement(tpl, { id: "ash_ford", name: "잿여울목", size: 0.6 });
check("같은 id = 같은 마을", JSON.stringify(a) === JSON.stringify(b));
check("다른 id = 다른 배치", JSON.stringify(a.locations.map((l) => l.xy)) !== JSON.stringify(c.locations.map((l) => l.xy)));
const tooClose = a.locations.some((p, i) => a.locations.some((q, j) => i < j && Math.hypot(p.xy[0] - q.xy[0], p.xy[1] - q.xy[1]) < 20));
check("건물끼리 겹치지 않음", !tooClose);
console.log("\n버들목 배치:"); for (const l of a.locations) console.log(`  ${l.name.padEnd(12)} (${l.xy.join(", ")}) ${l.access}`);
for (const o of a.outer) console.log(`  ${o.name.padEnd(12)} 마을에서 ${o.hours}h`);

const people = Array.from({ length: 40 }, (_, i) => generatePerson(kit, a, i));
check("같은 번호 = 같은 사람", JSON.stringify(generatePerson(kit, a, 7)) === JSON.stringify(people[7]));
console.log("\n배급 줄의 사람들 (앞 8명):");
for (const p of people.slice(0, 8)) console.log(`  ${p.name}${p.called_by_master ? ` ('${p.called_by_master}')` : ""} · ${p.sex}/${p.age} · ${p.job} · ${p.temperament.join("·")} · 말투 ${p.voice}`);

// 위치 엔진에 넣어 본다
const map = JSON.parse(readFileSync(new URL("../../content/build/whereabouts.json", import.meta.url), "utf8")).map;
const routines = Object.fromEntries(people.map((p) => [p.id, p.routine]));
const W = createWorld({ settlements: { [a.id]: a }, routines, events: [], map }, { loopSeed: 3 });
let bad = 0;
for (const p of people) for (let t = toMinutes(312, 9, 1); t < toMinutes(312, 9, 8); t += 30) { const w = W.where(p.id, t); if (!W.exists(w.at)) bad++; }
check("생성된 40명의 7일 위치가 모두 실제 장소", bad === 0, `${bad}건 문제`);
const supper = W.whoIsAt(a.roles.canteen[0], toMinutes(312, 9, 2, 19, 30)).length;
check("저녁 배급 시간에 배급소에 사람이 모인다", supper >= 15, `${supper}명`);
console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
