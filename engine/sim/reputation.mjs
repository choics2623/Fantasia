// 평판의 전파 (10 · 21 §8) — 마을 → 영지 → 지방 → 국가 → 대륙.
// 평판은 '저장하는 수치'가 아니라 **행적(deeds) + 그 행적을 아는 사람들(반응 층의 믿음)** 에서 언제든 계산한다.
// 그래서 재생(28)으로 저절로 맞고, 회귀하면 저절로 0이다.
//   - 행적이 알려지지 않았으면(본 사람도, 찾은 시체도 없으면) 어디에도 퍼지지 않는다 (10: 목격되지 않은 행동은 평판에 없다).
//   - 알려졌어도 누가 했는지 아무도 모르면 '사건'만 퍼지고 플레이어의 평판은 움직이지 않는다.
//   - 단계마다 늦어지고(규모별 날짜), 약해지고(계수), 왜곡된다(엔진이 고르고 LLM이 문장으로).
const H = (...p) => { let h = 2166136261 >>> 0; for (const ch of p.join("|")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } h ^= h >>> 13; return (h >>> 0) / 4294967296; };

export function classifyDeed(kind, victimProfile = {}, victimCard = {}) {
  if (kind === "kill" || kind === "assault") {
    const job = `${victimCard.job || ""} ${victimCard.rank || ""}`;
    const authority = victimProfile.role === "authority";
    if (kind === "assault") return authority ? "assault_overseer" : "assault";
    if (/남작|영주|가주|기사|후계/.test(job)) return "kill_lord";
    if (authority) return "kill_overseer";
    if (/사냥꾼|목줄|밀고/.test(job)) return "kill_hunter";
    return "kill_serf";
  }
  return kind;
}

export function createReputation(table, { seed = 1 } = {}) {
  const kinds = table.kinds || {}, scale = table.scale || [];
  // known: 그 행적을 아는 사람이 있나 / identified: 플레이어가 했다고 믿는 사람이 있나 — 반응 층에서 계산해 넘긴다
  function stagesOf(d, now) {
    const K = kinds[d.kind]; if (!K || !d.knownAt) return [];
    const out = []; let t = d.knownAt;
    for (const [i, s] of scale.entries()) {
      if (K.m < s.min_m) break;
      const [a, b] = s.days; const delay = Math.round((a + (b - a) * H(seed, d.id, s.id)) * 1440);
      t = i === 0 ? d.knownAt + delay : t + delay;
      if (t > now) break;
      const distortion = i === 0 ? null : (table.distortions || [])[Math.floor(H(seed, d.id, s.id, "d") * (table.distortions || []).length)];
      out.push({ scope: s.id, scopeName: s.name, t, k: s.k, distortion, identified: !!d.identifiedAt && d.identifiedAt <= t && distortion !== "신원 흐림" });
    }
    return out;
  }
  function summary(deeds, now) {
    const views = {}, titles = [], news = [];
    let reach = null;
    for (const d of deeds) {
      const K = kinds[d.kind]; if (!K) continue;
      for (const st of stagesOf(d, now)) {
        news.push({ deed: d.id, label: K.label, scope: st.scope, scopeName: st.scopeName, t: st.t, distortion: st.distortion, identified: st.identified, victim: d.victim, place: d.placeName });
        reach = st.scopeName;
        if (!st.identified) continue;
        for (const [gname, v] of Object.entries(K.views || {})) views[gname] = Math.round(((views[gname] || 0) + v * st.k) * 10) / 10;
        if (K.title && st.scope !== "village" && !titles.includes(K.title)) titles.push(K.title);
      }
    }
    return { views, titles, news, reach };
  }
  return { stagesOf, summary, kinds };
}
