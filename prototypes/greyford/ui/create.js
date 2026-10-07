// 새 시대 — 잔향이 고를 사람 (06 캐릭터 생성 · §10 생성 화면). 출신 → 능력치 → 재능 → 결점·주사위 → 확인.
// 점수의 셈은 화면이 바로 한다 (누르는 대로 보이게). 주사위의 결과·탄생 서사·최종 검사는 서버가 한다 (/api/creation/preview)
// — 같은 시드로 미리 굴리므로, 미리보기에서 본 주사위가 시작한 판의 주사위다.

const STEPS = [["origin", "출신"], ["stats", "능력치"], ["talents", "재능"], ["flaws", "결점·주사위"], ["confirm", "확인"]];
const SKW = (v) => (v < 12 ? "서툴다" : v < 20 ? "어설프다" : v < 30 ? "쓸 만하다" : v < 42 ? "제법이다" : v < 55 ? "능숙하다" : v < 70 ? "뛰어나다" : "경지에 닿았다");
const WORD = { 읽고쓰기: (v) => (v < 1 ? "글을 모른다" : v < 10 ? "숫자만 읽는다" : v < 30 ? "이름과 짧은 말을 읽는다" : "글을 읽는다"), 용언: (v) => (v < 1 ? "쇳소리로만 들린다" : v < 20 ? "아는 낱말만 들린다" : v < 50 ? "반쯤 알아듣는다" : "알아듣는다") };
const NARR = [["silent_god", "침묵하는 신 — 세계는 제 무게대로"], ["old_teller", "늙은 이야기꾼 — 쉬어 가며 하마"], ["ash_teller", "재의 화자 — 가장 나쁜 때에 불탄다"], ["dice", "주사위 — 뼈가 던져진 대로"]];
let deps = null, D = null, S = null, timer = 0;
const $ = (id) => document.getElementById(id);

export function initCreate(d) {
  deps = d;
  $("createClose").onclick = () => closeCreate();
  $("createPane").addEventListener("keydown", (e) => { if (e.key === "Escape" && S?.canClose) { e.stopPropagation(); closeCreate(); } });
}
export const createOpen = () => !$("create").hidden;
export function closeCreate() { if (!S?.canClose) return; $("create").hidden = true; S = null; }

export async function openCreate({ canClose = true, narrator = "silent_god", mode = "grim", reason = "" } = {}) {
  $("create").hidden = false;
  $("createBody").innerHTML = `<p class="cr-empty">잔향이 고를 사람들을 불러오는 중…</p>`;
  try { D = await deps.post("/api/creation"); } catch (e) { $("createBody").innerHTML = `<p class="cr-empty">못 불렀다 — ${deps.esc(e.message)}</p>`; return; }
  S = { seed: D.seed, step: 0, area: "전부", build: { origin: (D.origins.find((o) => o.canon) || D.origins[0]).id, alloc: {}, talents: {}, traits: [], flaws: [], dice: false }, preview: null, canClose, narrator, mode, reason, error: null };
  $("createClose").hidden = !canClose;
  render(); refreshPreview();
  $("createPane").focus({ preventScroll: true });
}

// ── 셈 ──
const T = (id) => D.talents.find((t) => t.id === id);
const TR = (id) => D.traits.find((t) => t.id === id);
const F = (id) => D.flaws.find((t) => t.id === id);
const O = () => D.origins.find((o) => o.id === S.build.origin) || D.origins[0];
function tp() {
  const R = D.rules, b = S.build; let spent = 0, refund = 0;
  for (const [id, t] of Object.entries(b.talents)) spent += T(id)?.cost[t - 1] || 0;
  for (const id of b.traits) spent += TR(id)?.cost || 0;
  for (const id of b.flaws) refund += F(id)?.refund || 0;
  const r = Math.min(R.flaw_max, refund), dice = b.dice ? R.dice_refund : 0;
  return { base: R.tp, refund: r, refundRaw: refund, dice, spent, left: R.tp + r + dice - spent };
}
const used = () => Object.values(S.build.alloc).reduce((a, v) => a + v, 0);
function statsNow() {
  const o = O(), out = {};
  for (const s of D.rules.stats) out[s.id] = (o.stats?.[s.id] ?? 9) + (S.build.alloc[s.id] || 0);
  const fl = [...S.build.flaws, ...(S.build.dice && S.preview?.dice?.flaw ? [S.preview.dice.flaw] : [])];   // 주사위가 준 결점까지
  if (fl.includes("frail")) out.체질 -= 2;
  if (fl.includes("one_eye")) out.감각 -= 2;
  return out;
}
const geniusCount = () => Object.values(S.build.talents).filter((t) => t === 3).length;

// ── 그리기 ──
function render() {
  const esc = deps.esc, P = tp();
  $("createSteps").innerHTML = STEPS.map(([k, l], i) => `<button type="button" class="cr-step${i === S.step ? " on" : ""}${i < S.step ? " done" : ""}" data-step="${i}" aria-current="${i === S.step ? "step" : "false"}"><i>${i + 1}</i><span>${l}</span></button>`).join("");
  $("createSteps").querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => go(Number(b.dataset.step))));
  const body = $("createBody"), k = STEPS[S.step][0];
  body.innerHTML = k === "origin" ? originHTML() : k === "stats" ? statsHTML() : k === "talents" ? talentsHTML() : k === "flaws" ? flawsHTML() : confirmHTML();
  bind(k);
  const pips = (n, of) => Array.from({ length: Math.max(of, n) }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("");
  const free = D.rules.free_stats - used();
  $("createFoot").innerHTML = `<div class="cr-meters">
      <span class="cr-tp${P.left < 0 ? " over" : ""}" title="재능 포인트 — 기본 ${P.base}${P.refund ? ` + 결점 ${P.refund}` : ""}${P.dice ? ` + 주사위 ${P.dice}` : ""}"><b>재능 포인트</b><span class="pips">${pips(Math.max(0, P.left), P.base + P.refund + P.dice)}</span><em>${P.left}</em></span>
      <span class="cr-tp sm${free < 0 ? " over" : ""}"><b>능력치</b><em>${free}</em><small>점 남음</small></span></div>
    <div class="cr-nav">${S.step > 0 ? `<button type="button" class="btn" id="crPrev">‹ 이전</button>` : ""}${S.step < STEPS.length - 1 ? `<button type="button" class="btn primary" id="crNext">다음 ›</button>` : `<button type="button" class="btn primary" id="crStart"${P.left < 0 || free < 0 ? " disabled" : ""}>이 삶을 시작한다</button>`}</div>`;
  $("crPrev")?.addEventListener("click", () => go(S.step - 1));
  $("crNext")?.addEventListener("click", () => go(S.step + 1));
  $("crStart")?.addEventListener("click", start);
  $("createTitle").textContent = S.reason || "새 시대 — 잔향이 고를 사람";
}
function go(i) { S.step = Math.max(0, Math.min(STEPS.length - 1, i)); render(); $("createBody").scrollTop = 0; }

function originHTML() {
  const esc = deps.esc;
  return `<p class="cr-lead">잔향은 한 시대에 단 한 사람에게 깃든다. 첫 시대의 그 사람은 게르다의 셋째 — 진짜 이름도, 열 살 동생 키트도 어느 갈래에서나 같다. 다른 것은 열일곱 해를 어디서 어떻게 살았느냐다. 고른 갈래의 저녁 여섯 시가 회귀점이 된다.</p>
    <div class="cr-origins" role="radiogroup" aria-label="출신">${D.origins.map((o) => {
      const top = Object.entries(o.skills || {}).filter(([k]) => !WORD[k]).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const lit = Object.entries(o.skills || {}).filter(([k, v]) => WORD[k] && v > 0);
      return `<button type="button" class="cr-origin${o.id === S.build.origin ? " on" : ""}" role="radio" aria-checked="${o.id === S.build.origin}" data-origin="${esc(o.id)}">
        <span class="cr-oh"><b>${esc(o.name)}</b>${o.canon ? `<span class="cr-badge">정본</span>` : ""}<span class="cr-diff" title="어려움">${"★".repeat(o.difficulty)}${"☆".repeat(5 - o.difficulty)}</span></span>
        <span class="cr-ot">${esc(o.title)}</span>
        <span class="cr-ob">${esc(o.blurb)}</span>
        <span class="cr-skills">${top.map(([k, v]) => `<span>${esc(k)} <em>${SKW(v)}</em></span>`).join("")}${lit.map(([k, v]) => `<span>${esc(k)} <em>${WORD[k](v)}</em></span>`).join("")}</span>
        <span class="cr-pb"><span class="up">${o.perks.map((x) => `<span>▲ ${esc(x)}</span>`).join("")}</span><span class="down">${o.burdens.map((x) => `<span>▼ ${esc(x)}</span>`).join("")}</span></span>
        <span class="cr-oi">${o.items.length ? `지닌 것 — ${esc(o.items.join(", "))} · ` : ""}돈 — ${esc(coin(o.coin))}</span>
      </button>`;
    }).join("")}</div>`;
}
const coin = (n) => { if (!n) return "없다"; const parts = [[Math.floor(n / 240), "금화"], [Math.floor((n % 240) / 12), "은화"], [n % 12, "동화"]].filter(([v]) => v); return parts.map(([v, k]) => `${k} ${v}닢`).join(" "); };

function statsHTML() {
  const esc = deps.esc, st = statsNow(), o = O(), R = D.rules, free = R.free_stats - used();
  return `<p class="cr-lead">인간의 바탕은 모두 9. ${esc(o.name)}의 열일곱 해가 남긴 것 위에 <b>${R.free_stats}점</b>을 더한다. 생성 때는 ${R.stat_max}까지.</p>
    <div class="cr-stats">${R.stats.map((s) => {
      const base = o.stats?.[s.id] ?? 9, v = st[s.id], add = S.build.alloc[s.id] || 0, mod = v - base - add;
      return `<div class="cr-stat"><div class="cr-sn"><b>${esc(s.id)}</b><small>${esc(s.desc)}</small></div>
        <div class="cr-sv"><button type="button" class="btn" data-stat="${esc(s.id)}" data-d="-1" aria-label="${esc(s.id)} 빼기"${add <= 0 ? " disabled" : ""}>−</button>
        <span class="cr-num"><b>${v}</b>${add ? `<em>+${add}</em>` : ""}${mod ? `<em class="bad">${mod}</em>` : ""}</span>
        <button type="button" class="btn" data-stat="${esc(s.id)}" data-d="1" aria-label="${esc(s.id)} 더하기"${free <= 0 || v >= R.stat_max ? " disabled" : ""}>＋</button></div>
        <span class="cr-bar" aria-hidden="true"><i style="width:${Math.round(((v - 4) / 11) * 100)}%"></i><i class="base" style="left:${Math.round(((9 - 4) / 11) * 100)}%"></i></span></div>`;
    }).join("")}</div>
    <p class="cr-note">숫자는 이 화면에서만 보인다. 판에서는 몸의 말로 — "팔에 힘이 없다", "눈이 밝다".${S.build.flaws.some((f) => ["frail", "one_eye"].includes(f)) ? " 붉은 숫자는 결점이 깎은 것." : ""}</p>`;
}

function talentsHTML() {
  const esc = deps.esc, R = D.rules, P = tp(), o = O();
  const areas = ["전부", ...R.areas];
  const list = D.talents.filter((t) => S.area === "전부" || t.area === S.area);
  return `<p class="cr-lead">재능은 처음부터 강하게 만들지 않는다 — <b>얼마나 빨리, 얼마나 높이</b>를 정한다. 소질·수재·천재 (신재는 다음 시대). 남긴 점수는 첫 회귀 때 잔향에 남아, 어둠 속에서 재능을 깨우는 데 쓴다.</p>
    ${o.presets?.length ? `<div class="cr-presets"><span>추천 — ${esc(o.name)}</span>${o.presets.map((p, i) => `<button type="button" class="btn" data-preset="${i}">${esc(p.name)}</button>`).join("")}<button type="button" class="btn ghost" data-preset="clear">비우기</button></div>` : ""}
    <div class="cr-areas" role="tablist">${areas.map((a) => `<button type="button" role="tab" aria-selected="${a === S.area}" data-area="${esc(a)}">${esc(a)}${a !== "전부" && D.talents.some((t) => t.area === a && S.build.talents[t.id]) ? "<i></i>" : ""}</button>`).join("")}</div>
    <div class="cr-talents">${list.map((t) => {
      const cur = S.build.talents[t.id] || 0;
      const tiers = R.tier_names.map((nm, i) => {
        const k = i + 1, cost = t.cost[i], delta = cost - (cur ? t.cost[cur - 1] : 0), can = k === cur || P.left - delta >= 0 && !(k === 3 && cur !== 3 && geniusCount() >= R.genius_max);
        return `<button type="button" class="cr-tier${k <= cur ? " on" : ""}" data-talent="${esc(t.id)}" data-tier="${k}" aria-pressed="${k === cur}" title="${esc(nm)} — 누적 ${cost}점"${can ? "" : " disabled"}><span>${esc(nm)}</span><small>${cost}</small></button>`;
      }).join("");
      const eff = t.tiers[Math.max(0, cur - 1)] || "";
      const gr = t.grow.length ? `${t.grow.join("·")} — 성장 ×${R.growth[Math.max(0, cur - 1)]}${Object.keys(t.skills).length ? ` · 처음부터 ${Object.entries(t.skills).map(([k, v]) => `${k} +${Math.round(v * [1, 1.5, 2][Math.max(0, cur - 1)])}`).join(", ")}` : ""}` : "";
      return `<div class="cr-talent${cur ? " on" : ""}"><div class="cr-tn"><b>${esc(t.name)}</b><span class="cr-size">${t.size === "major" ? "큰" : "작은"}</span><span class="cr-area">${esc(t.area)}</span></div>
        <div class="cr-tiers">${tiers}${cur ? `<button type="button" class="cr-tier off" data-talent="${esc(t.id)}" data-tier="0" aria-label="${esc(t.name)} 빼기">✕</button>` : ""}</div>
        <div class="cr-te">${cur ? "" : "<span class='faint'>소질이면 — </span>"}${esc(eff)}${gr ? `<small>${esc(gr)}</small>` : ""}</div></div>`;
    }).join("")}</div>
    <h4 class="cr-h">몸의 특질 — 같은 몸으로 돌아오므로 시대 내내 그대로</h4>
    <div class="cr-flaws">${D.traits.map((t) => { const on = S.build.traits.includes(t.id); return `<button type="button" class="cr-flaw trait${on ? " on" : ""}" data-trait="${esc(t.id)}" aria-pressed="${on}"${!on && P.left < t.cost ? " disabled" : ""}><b>${esc(t.name)}</b><em>${t.cost}점</em><small>${esc(t.desc)}</small></button>`; }).join("")}
      <p class="cr-note">다른 혈통(용심·거인의 뼈·엘다르의 눈…)은 업적으로 열린다 — 다음 시대.</p></div>`;
}

function flawsHTML() {
  const esc = deps.esc, R = D.rules, P = tp(), pv = S.preview;
  return `<p class="cr-lead">결점은 점수를 돌려준다 — 합쳐서 <b>${R.flaw_max}점</b>까지. 돌려받은 점수: ${P.refund}${P.refundRaw > R.flaw_max ? ` <span class="bad">(${P.refundRaw}점어치를 골랐다 — ${R.flaw_max}점까지만)</span>` : ""}</p>
    <div class="cr-flaws">${D.flaws.map((f) => { const on = S.build.flaws.includes(f.id); return `<button type="button" class="cr-flaw${on ? " on" : ""}" data-flaw="${esc(f.id)}" aria-pressed="${on}"><b>${esc(f.name)}</b><em>+${f.refund}</em><small>${esc(f.desc)}</small></button>`; }).join("")}</div>
    <h4 class="cr-h">운명의 주사위</h4>
    <button type="button" class="cr-dice${S.build.dice ? " on" : ""}" id="crDice" aria-pressed="${S.build.dice}"><span class="die" aria-hidden="true">⚄</span><span><b>운명에 맡긴다</b><small>무작위 재능 하나(가진 것이면 한 등급 위) + ${R.dice_refund}점. 셋에 하나꼴로 결점도 하나 — 그 결점은 점수를 돌려주지 않는다.</small></span></button>
    ${S.build.dice ? `<div class="cr-roll" aria-live="polite">${pv?.dice ? `주사위 — <b>${esc(T(pv.dice.talent)?.name || pv.dice.talent)} ${esc(R.tier_names[pv.dice.tier - 1])}</b>${pv.dice.flaw ? ` · 결점 <b class="bad">${esc(F(pv.dice.flaw)?.name)}</b>` : " · 결점은 없다"}` : "주사위를 굴리는 중…"} <button type="button" class="btn ghost" id="crReroll" title="다른 시드로 — 숨은 재능도 바뀐다">다시 굴린다</button></div>` : ""}
    <h4 class="cr-h">숨은 재능</h4>
    <p class="cr-note">게임이 몰래 ${R.hidden}개를 심는다 — 고르지 않은 분야에. 위태로운 판정에서 크게 성공하거나 스승에게 처음 배울 때 드러나고, 드러나면 회귀해도 남는다.</p>`;
}

function confirmHTML() {
  const esc = deps.esc, R = D.rules, o = O(), P = tp(), st = statsNow(), pv = S.preview;
  const tl = Object.entries(S.build.talents).sort((a, b) => b[1] - a[1]);
  const errs = pv?.check?.errors || [];
  return `<div class="cr-sum">
      <p class="cr-birth">${esc(pv?.line || "…")}</p>
      <dl>
        <dt>출신</dt><dd><b>${esc(o.name)}</b> — ${esc(o.title)}</dd>
        <dt>능력치</dt><dd class="cr-sline">${R.stats.map((s) => `<span>${esc(s.id)} <b>${st[s.id]}</b></span>`).join("")}</dd>
        <dt>재능</dt><dd>${tl.length ? tl.map(([id, t]) => `<span class="cr-chip">${esc(T(id)?.name)} <em>${esc(R.tier_names[t - 1])}</em></span>`).join("") : "<span class='faint'>없다 — 평범한 인간처럼 자란다</span>"}${pv?.dice ? `<span class="cr-chip dice">⚄ ${esc(T(pv.dice.talent)?.name)} <em>${esc(R.tier_names[pv.dice.tier - 1])}</em></span>` : ""}</dd>
        ${S.build.traits.length ? `<dt>특질</dt><dd>${S.build.traits.map((id) => `<span class="cr-chip">${esc(TR(id)?.name)}</span>`).join("")}</dd>` : ""}
        ${S.build.flaws.length || pv?.dice?.flaw ? `<dt>결점</dt><dd>${[...S.build.flaws, ...(pv?.dice?.flaw ? [pv.dice.flaw] : [])].map((id) => `<span class="cr-chip bad">${esc(F(id)?.name)}</span>`).join("")}</dd>` : ""}
        <dt>남긴 점수</dt><dd>${P.left > 0 ? `${P.left}점 — 첫 회귀 때 잔향에 남는다` : "없다"}</dd>
        <dt>숨은 재능</dt><dd>${pv?.hidden ?? R.hidden}개 — 하다 보면 알게 된다</dd>
      </dl>
      <p class="cr-note">진짜 이름은 첫 장면에서 정한다 — 어머니가 부르는 이름. 회귀해도 남는다.</p>
      ${errs.length ? `<div class="cr-err">${errs.map((e) => `<div>${esc(e)}</div>`).join("")}</div>` : ""}
      ${S.error ? `<div class="cr-err">${esc(S.error)}</div>` : ""}
    </div>
    <h4 class="cr-h">이야기의 결</h4>
    <div class="cr-mode"><span class="seg" id="crMode">${[["grim", "그림다크"], ["story", "이야기 — 아침으로 되돌리기 3번"]].map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${S.mode === k}">${l}</button>`).join("")}</span>
      <select id="crNarr" aria-label="화자">${NARR.map(([id, lab]) => `<option value="${id}"${S.narrator === id ? " selected" : ""}>${lab}</option>`).join("")}</select></div>`;
}

function bind(k) {
  const body = $("createBody");
  body.querySelectorAll("[data-origin]").forEach((b) => (b.onclick = () => {
    if (S.build.origin === b.dataset.origin) return go(1);
    S.build.origin = b.dataset.origin; S.build.alloc = {};   // 바탕이 바뀌면 배분을 다시
    render(); refreshPreview();
  }));
  body.querySelectorAll("[data-stat]").forEach((b) => (b.onclick = () => {
    const k2 = b.dataset.stat, d = Number(b.dataset.d), cur = S.build.alloc[k2] || 0;
    if (d > 0 && (used() >= D.rules.free_stats || statsNow()[k2] >= D.rules.stat_max)) return;
    S.build.alloc[k2] = Math.max(0, cur + d); if (!S.build.alloc[k2]) delete S.build.alloc[k2];
    render(); body.querySelector(`[data-stat="${CSS.escape(k2)}"][data-d="${d}"]`)?.focus();
  }));
  body.querySelectorAll("[data-area]").forEach((b) => (b.onclick = () => { S.area = b.dataset.area; render(); }));
  body.querySelectorAll("[data-talent]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.talent, k2 = Number(b.dataset.tier);
    if (!k2 || S.build.talents[id] === k2) delete S.build.talents[id]; else S.build.talents[id] = k2;
    render(); refreshPreview();
  }));
  body.querySelectorAll("[data-trait]").forEach((b) => (b.onclick = () => { const id = b.dataset.trait; S.build.traits = S.build.traits.includes(id) ? S.build.traits.filter((x) => x !== id) : [...S.build.traits, id]; render(); refreshPreview(); }));
  body.querySelectorAll("[data-flaw]").forEach((b) => (b.onclick = () => { const id = b.dataset.flaw; S.build.flaws = S.build.flaws.includes(id) ? S.build.flaws.filter((x) => x !== id) : [...S.build.flaws, id]; render(); refreshPreview(); }));
  body.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => {
    if (b.dataset.preset === "clear") { S.build.talents = {}; S.build.traits = []; S.build.alloc = {}; }
    else { const p = O().presets[Number(b.dataset.preset)]; S.build.talents = { ...(p.talents || {}) }; S.build.traits = [...(p.traits || [])]; S.build.alloc = { ...(p.stats || {}) }; }
    render(); refreshPreview();
  }));
  const dice = $("crDice"); if (dice) dice.onclick = () => { S.build.dice = !S.build.dice; render(); refreshPreview(); };
  const rr = $("crReroll"); if (rr) rr.onclick = () => { S.seed = Math.floor(Math.random() * 1e6); S.preview = null; render(); refreshPreview(); };
  body.querySelectorAll("#crMode [data-mode]").forEach((b) => (b.onclick = () => { S.mode = b.dataset.mode; render(); }));
  const nr = $("crNarr"); if (nr) nr.onchange = () => { S.narrator = nr.value; };
}

// 서버의 미리보기: 주사위·탄생 서사·검사 (멈춘 뒤 한 번)
function refreshPreview() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!S) return;
    const want = JSON.stringify([S.build, S.seed]);
    try {
      const pv = await deps.post("/api/creation/preview", { build: S.build, seed: S.seed });
      if (!S || JSON.stringify([S.build, S.seed]) !== want) return;
      S.preview = pv;
      if (["flaws", "confirm"].includes(STEPS[S.step][0])) render();
    } catch { /* 미리보기가 없어도 시작은 서버가 다시 검사한다 */ }
  }, 180);
}

async function start() {
  const btn = $("crStart"); if (btn) { btn.disabled = true; btn.textContent = "시간이 접힌다…"; }
  S.error = null;
  const body = { build: S.build, seed: S.seed, mode: S.mode, narrator: S.narrator };
  const keep = S;
  $("create").hidden = true;
  const d = await deps.start(body);
  if (d?.error) { S = keep; S.error = d.error; S.step = STEPS.length - 1; $("create").hidden = false; render(); return; }
  S = null;
}
