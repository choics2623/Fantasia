// 숨긴 사실의 공개 조건 (22 §1.2). 엔진이 판정할 수 있는 조건 문법.
//
// 카드의 reveal_when은 사람이 쓴 글이다 ("신뢰 40 이상, 또는 헨릭이 죽거나 실각한 뒤").
// 엔진은 글을 판정할 수 없다 → 이 파일이 글을 조건 목록으로 옮긴다. 카드에 `reveal:`(구조화된 조건)이 있으면 그것을 먼저 쓴다.
// 조건 하나 = 대안(OR)들의 목록, 대안 하나 = 모두 참이어야 하는 항목(AND)들:
//   {trust: 40} {like: 40} {tier: "대성공", trust: 10} {dead: "npc_henrik"} {told_by: "npc_thomas"} {scene: "술자리"} {player_offer: "탈출로"}
// 옮기지 못한 조각은 `manual`로 남긴다 — 검사 도구가 목록을 뽑아 사람이 고친다.

const NUM = (s) => Number(s);

export function parseRevealText(text, names = {}) {
  const alts = [], manual = [];
  if (!text) return { alts, manual };
  // "또는"으로 대안을 나눈다. 괄호 안의 쉼표는 나누지 않는다.
  const parts = []; let depth = 0, cur = "";
  for (const ch of String(text)) {
    if (ch === "(" || ch === "（") depth++;
    if (ch === ")" || ch === "）") depth--;
    cur += ch;
  }
  for (const p of cur.split(/\s*,?\s*또는\s*/)) if (p.trim()) parts.push(p.trim().replace(/[,，]$/, ""));
  for (const p of parts) {
    const a = {};
    let m;
    if ((m = /신뢰\s*(\d+)\s*이상/.exec(p))) a.trust = NUM(m[1]);
    if ((m = /호감\s*(\d+)\s*이상/.exec(p))) a.like = NUM(m[1]);
    if (/대성공/.test(p)) a.tier = "대성공";
    else if (/판정\s*성공/.test(p)) a.tier = "성공";
    if ((m = /\(\s*신뢰\s*(\d+)\s*이상\s*\)/.exec(p))) a.trust = NUM(m[1]);
    // "<이름>이/가 죽거나 실각한 뒤", "<이름>이 죽은 뒤"
    if ((m = /([가-힣]+?)(?:이|가)?\s*죽(?:거나|은|으면)/.exec(p))) { const id = names[m[1]]; if (id) a.dead = id; }
    if ((m = /([가-힣]+?)(?:이|가)\s*먼저\s*말한\s*뒤/.exec(p))) { const id = names[m[1]]; if (id) a.told_by = id; }
    if (/술자리/.test(p)) a.scene = "술자리";
    if (/스스로\s*꺼낸다/.test(p)) a.self = true;
    if (/플레이어가.*(제시|내민|보여)/.test(p)) a.player_offer = p.replace(/.*플레이어가\s*/, "").replace(/\s*(판정\s*성공|제시하는|하는).*/, "");
    if (Object.keys(a).length) alts.push(a); else manual.push(p);
  }
  return { alts, manual };
}

// ctx: {trust, like, tier, dead:Set, toldBy:Set(npc가 이 사실을 플레이어에게 말한 사람들), scene, offer}
export function revealOK(alts, ctx) {
  return alts.some((a) => {
    if (a.self) return false;                                   // 그가 스스로 꺼내는 비밀 — 물어서는 열리지 않는다
    if (a.trust != null && !(ctx.trust >= a.trust)) return false;
    if (a.like != null && !(ctx.like >= a.like)) return false;
    if (a.tier === "대성공" && ctx.tier !== "대성공") return false;
    if (a.tier === "성공" && !["성공", "대성공"].includes(ctx.tier)) return false;
    if (a.dead && !ctx.dead.has(a.dead)) return false;
    if (a.told_by && !ctx.toldBy.has(a.told_by)) return false;
    if (a.scene && ctx.scene !== a.scene) return false;
    if (a.player_offer && !ctx.offer) return false;
    return true;
  });
}

// 카드 하나의 hides → [{fact, alts, cover, manual}]
export function cardReveals(card, names) {
  return (card.hides || []).map((h) => {
    if (Array.isArray(h.reveal)) return { fact: h.fact, alts: h.reveal, cover: h.cover, manual: [] };
    const { alts, manual } = parseRevealText(h.reveal_when, names);
    // 하나도 옮기지 못했으면 기본값: 신뢰 50, 또는 대성공 + 신뢰 25 (검사 도구가 '고칠 것'으로 표시한다)
    if (!alts.length) return { fact: h.fact, alts: [{ trust: 50 }, { tier: "대성공", trust: 25 }], cover: h.cover, manual: manual.length ? manual : [String(h.reveal_when || "")], defaulted: true };
    return { fact: h.fact, alts, cover: h.cover, manual };
  });
}
