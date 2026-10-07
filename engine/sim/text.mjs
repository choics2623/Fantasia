// 한국어 조사: 받침이 있으면 이/은/을/과, 없으면 가/는/를/와 — "페인이(가)" 대신 "페인이"
export function josa(text) {
  return String(text).replace(/([가-힣A-Za-z0-9])(['’")]?)(이\(가\)|은\(는\)|을\(를\)|과\(와\)|\(으\)로|\(이\)라|\(이\)다)/g, (_, ch, q, pair) => {
    const code = ch.charCodeAt(0) - 0xac00, batchim = code >= 0 && code < 11172 ? code % 28 !== 0 : false;
    if (pair === "(으)로") return ch + q + (batchim && code % 28 !== 8 ? "으로" : "로");   // ㄹ 받침은 '로'
    if (pair === "(이)라" || pair === "(이)다") return ch + q + (batchim ? "이" : "") + pair.slice(-1);   // 코라는 · 칠번이라는
    const [a, b] = pair.replace(")", "").split("("); return ch + q + (batchim ? a : b);
  }).replace(/(?<![가-힣])너가(?![가-힣])/g, "네가");   // 주인공('너')이 주어일 때는 '네가'
}

// 돈 (WORLD_BIBLE §7.1): 속은 동화 단위 하나. 보일 때는 금화·은화·동화 — 금화 1 = 은화 20 = 동화 240. 세는 말은 '닢'
export const COPPER_PER = { 금화: 240, 은화: 12, 동화: 1 };
export function coinParts(n) {
  n = Math.max(0, Math.round(Number(n) || 0));
  return { 금화: Math.floor(n / 240), 은화: Math.floor((n % 240) / 12), 동화: n % 12 };
}
export function coinText(n) {
  const p = coinParts(n), out = Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k} ${v}닢`);
  return out.length ? out.join(" ") : "동화 0닢";
}
