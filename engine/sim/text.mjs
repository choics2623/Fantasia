// 한국어 조사: 받침이 있으면 이/은/을/과, 없으면 가/는/를/와 — "페인이(가)" 대신 "페인이"
export function josa(text) {
  return String(text).replace(/([가-힣A-Za-z0-9])(['’")]?)(이\(가\)|은\(는\)|을\(를\)|과\(와\)|\(으\)로)/g, (_, ch, q, pair) => {
    const code = ch.charCodeAt(0) - 0xac00, batchim = code >= 0 && code < 11172 ? code % 28 !== 0 : false;
    if (pair === "(으)로") return ch + q + (batchim && code % 28 !== 8 ? "으로" : "로");   // ㄹ 받침은 '로'
    const [a, b] = pair.replace(")", "").split("("); return ch + q + (batchim ? a : b);
  });
}
