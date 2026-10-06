// 즉석 인물을 콘텐츠로 (22 §2.1, 25): 사람이 적은 고장마다 지역 키트에서 C등급 주민을 뽑는다.
// (고장 id, 번호)가 시드 — 회귀해도 같은 우물가의 같은 노인. build_content.py가 부른다:
//   node tools/gen_people.mjs < {settlements, kits, counts} > {cards, routines, public}
import { generatePerson } from "../engine/gen/person.mjs";
const input = JSON.parse(await new Promise((r) => { let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => r(s)); }));
const { settlements, kits, counts, target = 12 } = input;
const KIND_KIT = { harbor: "kit_naga_harbor", ruin: "kit_ash_outpost", quarry: "kit_naga_harbor", road_post: "kit_border_fort", town: "kit_mine_slave", mine: "kit_mine_slave", shrine: "kit_holy_city",
  waystation: "kit_holy_city", swamp_gate: "kit_swamp_free", swamp_village: "kit_swamp_free", nocturne_pen: "kit_nocturne_estate", estuary_town: "kit_naga_harbor", hag_island: "kit_swamp_free",
  border_fort: "kit_border_fort", outpost_village: "kit_ash_outpost", village: "kit_human_serf" };
// 장소의 종류 → 키트 일과가 찾는 역할
const ROLE = { canteen: ["canteen"], barracks: ["barracks", "huts"], hut: ["huts", "barracks"], homes: ["huts", "barracks"], house: ["huts", "barracks"], quarters: ["barracks", "huts"], lodge: ["barracks"], lodging: ["barracks", "huts"],
  chapel: ["chapel"], shrine: ["chapel"], altar: ["chapel"], field: ["fields", "pasture"], work: ["fields", "weaving"], quarry: ["fields"], pens: ["fields", "pasture"], drift: ["fields"], cave: ["fields"],
  market: ["square", "market"], square: ["square"], district: ["square"], quay: ["square", "dock"], dock: ["square", "dock"], flat: ["fields"], post: ["post"], office: ["post"], gate: ["post", "gate"],
  checkpoint: ["post"], guardhouse: ["post"], customs: ["post"], well: ["well", "square"], forge: ["smithy"], smelter: ["smithy"], store: ["store"], inn: ["canteen", "tavern"], tavern: ["canteen", "tavern"], infirmary: ["clinic"], clinic: ["clinic"] };
// 키트마다 이름표의 모양이 다르다 (pure_male, ordained_male, male_nick…) — 생성기가 읽는 모양(male/female/given_by_master)으로 접는다
function normKit(kit, base) {
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const pick = (o, re, not) => Object.entries(o || {}).filter(([k, v]) => re.test(k) && !(not && not.test(k)) && arr(v).length).flatMap(([, v]) => arr(v));
  const names = {};
  const bn = base.names["인간"];
  for (const [race, o] of Object.entries(kit.names || {})) {
    const male = pick(o, /male|any/, /female/), female = pick(o, /female|any/);
    names[race] = { male: male.length ? male : arr(bn.male), female: female.length ? female : male.length ? male : arr(bn.female), given_by_master: (() => { const g = pick(o, /^given_by|contract_id|number/); return g.length ? g : ["{n}번"]; })() };
  }
  if (!names["인간"]) names["인간"] = { male: arr(bn.male), female: arr(bn.female), given_by_master: arr(bn.given_by_master) };
  return { ...kit, names, temperaments: kit.temperaments?.length ? kit.temperaments : base.temperaments, voices: kit.voices?.length ? kit.voices : base.voices };
}
const out = { cards: {}, routines: {}, public: {} };
for (const s of Object.values(settlements)) {
  const have = counts[s.id] || 0;
  if (have >= target || s.id === "greyford") continue;
  const kitId = Object.values(kits).find((k) => (k.applies_to || []).some((a) => s.name && (s.name.includes(a) || a.includes(s.name))))?.id || KIND_KIT[s.kind] || "kit_human_serf";
  const kit = normKit(Object.values(kits).find((k) => k.id === kitId) || kits.human_serf, kits.human_serf);
  const roles = {};
  for (const l of s.locations || []) for (const r of ROLE[l.kind] || []) (roles[r] ??= []).push(l.id);
  const st = { id: s.id, roles, locations: s.locations };
  for (let i = 0; i < target - have; i++) {
    let p; try { p = generatePerson(kit, st, i); } catch (e) { process.stderr.write(`${s.id} #${i}: ${e.message}\n`); continue; }
    const v = (kit.voices || []).find((x) => x.id === p.voice) || {};
    out.cards[p.id] = { id: p.id, tier: "C", generated: true, name: p.name, race: p.race, sex: p.sex, age: p.age, job: p.job, rank: p.class, region: s.name,
      personality: { temperament: p.temperament }, voice: { register: { to_player_default: v.register || "짧게" }, tics: v.tics || [], use: v.use || [], avoid: v.avoid || [], length: "짧게" },
      samples: v.sample ? [{ situation: "처음 보는 사람에게", line: v.sample }] : [], toward_player: "처음 보는 얼굴. 경계한다.", called_by_master: p.called_by_master };
    // 대안(alt·rain)의 역할 이름도 실제 장소로 — 없으면 그 블록의 장소에 머문다
    const locIds = new Set((s.locations || []).map((l) => l.id));
    for (const b of p.routine.blocks) for (const k of ["alt", "rain"]) if (b[k]?.at && !locIds.has(b[k].at)) { const ids = roles[b[k].at]; b[k] = { ...b[k], at: ids?.length ? ids[i % ids.length] : b.at }; }
    out.routines[p.id] = p.routine;
    out.public[p.id] = `?${p.job}`;
  }
}
process.stdout.write(JSON.stringify(out));
