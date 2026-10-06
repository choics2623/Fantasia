// 자리와 승계 (23 §2.1). 사람이 죽으면 자리는 비지 않는다 — 누군가 잇는다.
// 자리 데이터는 세력 파일(content/base/factions)의 offices. 승계 규칙(먼저 맞는 것):
//   1. 자리에 successor: <npc 또는 office id>가 적혀 있으면 그것
//   2. 그 자리에 보고하는 자리 중 이름이 '후계·부·대리·부관·버금'인 자리의 주인 (남작 → 후계자 오웬)
//   3. 그 자리에 보고하는 자리 중 실제 인물이 있는 첫 자리 (감독관 → 그 아래 첫 감독)
//   4. 없으면 공석 — 그 자리를 거치던 보고는 윗자리로 바로 간다
// 결정적이다: 죽음의 순서만으로 정해진다 (재생하면 같다).
export function createOffices(factions = {}) {
  const offices = new Map();             // "fac.off" → {fac, id, title, holder, reports_to, successor}
  for (const [fid, f] of Object.entries(factions)) for (const o of f.offices || []) offices.set(`${fid}.${o.id}`, { fac: fid, ...o, holder: typeof o.holder === "string" && o.holder.startsWith("npc_") ? o.holder : null, base: o.holder });
  const children = new Map();
  for (const [k, o] of offices) if (o.reports_to) { const pk = `${o.fac}.${o.reports_to}`; if (!children.has(pk)) children.set(pk, []); children.get(pk).push(k); }
  const holderNow = new Map([...offices].map(([k, o]) => [k, o.holder]));
  const history = [];
  const officesOf = (npc) => [...holderNow].filter(([, h]) => h === npc).map(([k]) => k);

  function pickSuccessor(k, dead) {
    const o = offices.get(k);
    if (o.successor) {
      if (o.successor.startsWith("npc_")) return dead.has(o.successor) ? null : o.successor;
      const h = holderNow.get(`${o.fac}.${o.successor}`); if (h && !dead.has(h)) return h;
    }
    const kids = children.get(k) || [];
    const deputy = kids.find((c) => /후계|부(?!락)|대리|부관|버금|차석|부장/.test(offices.get(c).title || "") && holderNow.get(c) && !dead.has(holderNow.get(c)));
    if (deputy) return holderNow.get(deputy);
    const any = kids.find((c) => holderNow.get(c) && !dead.has(holderNow.get(c)));
    return any ? holderNow.get(any) : null;
  }
  // 죽음 하나 → 그 사람의 모든 자리가 승계된다. 승계한 사람이 비운 자리도 (한 단계) 다시 승계된다
  function onDeath(npc, t, dead) {
    const changes = [];
    for (const k of officesOf(npc)) {
      const s = pickSuccessor(k, dead);
      holderNow.set(k, s);
      changes.push({ office: k, title: offices.get(k).title, from: npc, to: s, t });
      if (s) for (const k2 of officesOf(s)) {
        if (k2 === k) continue;
        // 더 높은 자리로 옮긴 사람의 옛 자리 (예: 후계자 자리) — 그 아래에서 잇거나 비운다
        const s2 = pickSuccessor(k2, new Set([...dead, s]));
        holderNow.set(k2, s2);
        changes.push({ office: k2, title: offices.get(k2).title, from: s, to: s2, t, moved: true });
      }
    }
    history.push(...changes);
    return changes;
  }
  // 그 사람의 '일'을 이을 사람 — 일과(24)를 물려받는다. 가장 높은 자리 기준
  function heirOf(npc, changes) { const c = changes.find((x) => x.from === npc && x.to && !x.moved); return c?.to || null; }
  return { onDeath, heirOf, officesOf, holder: (k) => holderNow.get(k), history, offices };
}
