// 달력 (WORLD_BIBLE §8): 1년 = 12달 × 30일 + 재의 날 5일 (13번째 '달'로 다룬다). 1주 = 6일, 6일째가 안식일.
// 시간은 붕괴력(AS) 0년 1월 1일 0시부터의 '분'으로 센다 → 정수 하나라 비교·저장이 쉽다.
export const MONTHS = ["해빙월", "파종월", "꽃월", "푸른월", "태양월", "건초월", "수확월", "포도월", "낙엽월", "서리월", "긴밤월", "굶주림월", "재의 날"];
const DAYS_IN = (m) => (m === 13 ? 5 : 30);

export function dayIndex(y, m, d) { return y * 365 + (m - 1) * 30 + (d - 1); }
export function toMinutes(y, m, d, hh = 0, mm = 0) { return dayIndex(y, m, d) * 1440 + hh * 60 + mm; }
export function parseDate(s) { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; }
export function parseClock(s) { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); }

export function fromMinutes(t) {
  const day = Math.floor(t / 1440), min = t - day * 1440;
  const y = Math.floor(day / 365); let r = day - y * 365;
  const m = Math.min(13, Math.floor(r / 30) + 1); const d = r - (m - 1) * 30 + 1;
  return { y, m, d, hh: Math.floor(min / 60), mm: min % 60, day, minOfDay: min };
}
export function weekday(day) { return (day % 6) + 1; }          // 1..6
export function isSabbath(day) { return weekday(day) === 6; }
export function fmt(t) {
  const c = fromMinutes(t);
  return `AS ${c.y} ${MONTHS[c.m - 1]} ${c.d}일 ${String(c.hh).padStart(2, "0")}:${String(c.mm).padStart(2, "0")}`;
}
export { DAYS_IN };
