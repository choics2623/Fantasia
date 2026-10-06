// 즉석 인물 (22 §2.1): 키트에서 뼈대를 뽑는다. 말을 거는 순간 LLM이 이 뼈대로 B등급 카드를 쓴다.
// (정착지, 번호)가 시드다 — 회귀해도 같은 배급 줄의 같은 노인.
import { seeded } from "./rng.mjs";

const FALLBACK = { chapel: ["square"], smithy: ["fields"], huts: ["barracks"], weaving: ["barracks"], keep: ["square"], pasture: ["fields"], woods: ["fields"], post: ["square"] };
function placeFor(settlement, role, r) {
  for (const rr of [role, ...(FALLBACK[role] || []), "square"]) {
    const ids = settlement.roles[rr];
    if (ids && ids.length) return r.pick(ids);
  }
  return settlement.locations[0].id;
}

export function generatePerson(kit, settlement, index) {
  const r = seeded("person", settlement.id, index);
  const job = r.weighted(kit.jobs);
  const race = job.race || "인간";
  const sex = job.sex || (r.next() < 0.5 ? "male" : "female");
  const names = kit.names[race] || kit.names["인간"];
  const age = job.age ? r.int(job.age[0], job.age[1]) : r.int(16, 48);
  const given = r.pick(names[sex] || names.male);
  const called = r.next() < 0.5 ? r.pick(names.given_by_master).replace("{n}", String(r.int(12, 399))) : null;
  const temperament = r.shuffle(kit.temperaments).slice(0, 2);
  const voice = r.pick(kit.voices);
  const home = placeFor(settlement, "barracks", r);
  const roleCache = {};
  const blocks = (kit.schedules[job.schedule] || []).map((b) => {
    const at = b.at === "barracks" ? home : (roleCache[b.at] ??= placeFor(settlement, b.at, r));
    return { ...b, at };
  });
  return {
    id: `c_${settlement.id}_${index}`,
    tier: "C",
    name: race === "크릭" ? `크릭 감독 ${r.int(2, 40)}호` : given,
    called_by_master: called,
    race, sex: sex === "male" ? "남" : "여", age,
    job: job.name, class: job.class,
    temperament, voice: voice.id,
    settlement: settlement.id,
    routine: { home, blocks },
    // 카드의 나머지(생애, 비밀, 말투 변주)는 말을 거는 순간 LLM이 이 뼈대와 키트의 voice로 쓴다 (21 §5, 22 §2.1)
  };
}
