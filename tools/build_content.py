"""content/base/**/*.yaml → content/build/*.json (엔진은 JSON만 읽는다).

  python3 tools/build_content.py
"""
import json, os, glob
import yaml

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "content/build")


def load(pattern):
    out = []
    for p in sorted(glob.glob(os.path.join(ROOT, pattern))):
        out.append(yaml.safe_load(open(p, encoding="utf-8")))
    return out


BLOCK_KEYS = {"days", "from", "to", "at", "doing", "alt", "rain", "fixed", "outdoor", "jitter", "p"}


def check_routines(routines):
    """YAML 흐름 표기에서 쉼표가 든 값을 따옴표 없이 쓰면 값이 잘려 엉뚱한 키가 생긴다. 그것을 잡는다."""
    bad = []
    for npc, v in routines.items():
        for b in v.get("blocks", []):
            for d in [b, b.get("alt") or {}, b.get("rain") or {}]:
                extra = set(d) - BLOCK_KEYS
                if extra:
                    bad.append(f"{npc}: 모르는 키 {sorted(extra)} — 쉼표가 든 값은 따옴표로 감싸세요")
    return bad


def main():
    os.makedirs(OUT, exist_ok=True)
    settlements = {s["id"]: s for s in load("content/base/settlements/*.yaml")}
    routines = {}
    for r in load("content/base/routines/*.yaml"):
        routines.update(r or {})
    bad = check_routines(routines)
    if bad:
        print("\n".join(bad)); raise SystemExit(1)
    events = [e for f in load("content/base/events/*.yaml") for e in (f or [])]
    world = json.load(open(os.path.join(ROOT, "content/base/world/map.json"), encoding="utf-8"))
    place_states = [x for f in load("content/base/places/*.yaml") for x in (f or [])]
    bundle = {"settlements": settlements, "routines": routines, "events": events, "placeStates": place_states,
              "map": {"nodes": world["nodes"], "edges": world["edges"]}}
    p = os.path.join(OUT, "whereabouts.json")
    json.dump(bundle, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"정착지 {len(settlements)} · 일과 {len(routines)}명 · 일정 {len(events)} → {p}")

    # 게임 진행 루프(28)가 읽는 나머지: 목표 행동, 소지품, 행동 성향, 사실
    agendas = {"vars": {}, "agendas": []}
    for p2 in sorted(glob.glob(os.path.join(ROOT, "content/base/agendas/*.yaml"))):
        a = yaml.safe_load(open(p2, encoding="utf-8")) or {}
        agendas["vars"].update(a.get("vars") or {}); agendas["agendas"] += a.get("agendas") or []
    inventories = {}
    for f in load("content/base/inventories/*.yaml"):
        inventories.update(f or {})
    # 성향: 지역마다 기본값이 다르다 (회색여울 농노의 윗선은 즈닉, 바알카르는 다르다) → 묶을 때 지역 기본값을 사람마다 풀어 넣는다
    sim = {"profiles": {}, "social_places": [], "defaults_by_settlement": {}}
    for f in load("content/base/sim/*.yaml"):
        d = (f or {}).get("defaults") or {}
        for n, pr in ((f or {}).get("profiles") or {}).items():
            sim["profiles"][n] = {**d, **pr}
        sim["social_places"] += (f or {}).get("social_places") or []
        if (f or {}).get("settlement"):
            sim["defaults_by_settlement"][f["settlement"]] = d
        for n in ((f or {}).get("residents") or []):
            sim["profiles"].setdefault(n, dict(d))
    # ── 손으로 쓰지 않은 사람의 성향·돈은 카드에서 뽑는다 (27 §3.1) — 손으로 쓴 것이 언제나 이긴다 ──
    cards = json.load(open(os.path.join(ROOT, "content/base/npcs/cards.json"), encoding="utf-8"))["cards"]
    loc_settlement = {}
    for sid, st in settlements.items():
        for l in st.get("locations") or []: loc_settlement[l["id"]] = sid
        for o in st.get("outer") or []: loc_settlement[o["id"]] = sid
    home_of = {n: loc_settlement.get((r or {}).get("home")) for n, r in routines.items()}
    derived, coins = derive_profiles(cards, home_of)
    for n, pr in derived.items():
        sim["profiles"][n] = {**pr, **sim["profiles"].get(n, {}), "ties": {**pr.get("ties", {}), **(sim["profiles"].get(n, {}).get("ties") or {})}}
    for sid, chain in CHAINS.items():
        d = sim["defaults_by_settlement"].setdefault(sid, {})
        d.setdefault("report_to", chain)
    for n, c in coins.items():
        inventories.setdefault(n, {"coin": c})
    facts = {}
    for f in load("content/base/facts/*.yaml"):
        for x in (f if isinstance(f, list) else (f or {}).get("facts", [])):
            facts[x["id"]] = {"text": x.get("text", ""), "names": x.get("names", []), "danger": x.get("danger", 0)}
    rep = yaml.safe_load(open(os.path.join(ROOT, "content/base/reputation/table.yaml"), encoding="utf-8"))
    factions = {}
    for p4 in sorted(glob.glob(os.path.join(ROOT, "content/base/factions/*.yaml"))):
        f = yaml.safe_load(open(p4, encoding="utf-8")) or {}
        factions[f.get("id")] = {"name": f.get("name"), "offices": [{k: o.get(k) for k in ("id", "title", "holder", "reports_to", "successor")} for o in (f.get("offices") or [])]}
    economy = {"goods": {}, "shops": {}, "ration": {}}
    for f in load("content/base/economy/*.yaml"):
        for k in economy: (economy[k].update((f or {}).get(k) or {}))
    storylets = []
    for f in load("content/base/storylets/*.yaml"):
        storylets += (f or {}).get("storylets") or []
    public = {}
    for f in load("content/base/npcs/public_*.yaml"):
        public.update(f or {})
    access = {}
    for f in load("content/base/access/*.yaml"):
        access.update(f or {})
    voices = {}
    for f in load("content/base/voices/*.yaml"):
        voices.update((f or {}).get("voices") or {})
    director = {"beats": [], "quiet": []}
    for f in load("content/base/director/*.yaml"):
        director["beats"] += (f or {}).get("beats") or []; director["quiet"] += (f or {}).get("quiet") or []
    oaths = []
    for f in load("content/base/oaths/*.yaml"):
        oaths += (f or {}).get("oaths") or []
    lexicon = []
    for f in load("content/base/lexicon/*.yaml"):
        lexicon += (f or {}).get("words") or []
    game = {"lexicon": lexicon, "storylets": storylets, "public": public, "access": access, "voices": voices, "director": director, "oaths": oaths, "economy": economy, "agendas": agendas, "inventories": inventories, "sim": sim, "facts": facts, "reputation": rep, "factions": factions}
    p3 = os.path.join(OUT, "game.json")
    json.dump(game, open(p3, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"목표 행동 {len(agendas['agendas'])} · 소지품 {len(inventories)}명 · 성향 {len(sim['profiles'])}명 · 사실 {len(facts)} → {p3}")


import re, zlib
CHAINS = {}
AUTH = [(3, r"영주|남작|백작|가주|군주|칸\b|족장|여왕|왕\b|대사제|집정|원로회|섭정"), (2, r"기사|단장|사령관|대장|정화청장|재판|총독|관리관"), (1, r"감독|경비|순찰|간수|하사|십인장|관리인|집행")]
def derive_profiles(cards, home_of):
    """카드의 성향 6축·기질·관계에서 반응 층의 숫자를 뽑는다."""
    out = {}
    by_settlement = {}
    for n, c in cards.items():
        if c.get("type") == "historical": continue
        disp = (c.get("personality") or {}).get("disposition") or {}
        temp = " ".join(map(str, (c.get("personality") or {}).get("temperament") or []))
        habits = " ".join(map(str, (c.get("personality") or {}).get("habits") or []))
        text = f"{c.get('job','')} {c.get('rank','')}"
        g = lambda k: float(disp.get(k, 0) or 0)
        cl = lambda x, a, b: max(a, min(b, x))
        talk = 0.4
        if re.search(r"과묵|침묵|말이 없|입이 무거", temp + habits): talk = 0.15
        if re.search(r"수다|떠벌|입이 가벼|말이 많", temp + habits): talk = 0.8
        perception = 50 + (20 if re.search(r"의심|눈치|관찰|날카|예민|빈틈없", temp + habits) else 0) - (10 if re.search(r"둔|취해|술에", temp + habits) else 0)
        pr = {"perception": cl(perception, 10, 95), "nerve": round(cl(50 + g("용기") * 0.45, 5, 95)), "talk": talk,
              "greed": round(cl(0.4 + g("탐욕") / 200, 0, 1), 2), "duty": round(cl(0.4 + g("충성") / 250, 0, 1), 2)}
        ties = {}
        for r in c.get("relations") or []:
            v = ((r.get("like") or 0) * 0.6 + (r.get("trust") or 0) * 0.4) / 25
            t = int(cl(round(v), -3, 3))
            if t and r.get("to"): ties[r["to"]] = t
        if ties: pr["ties"] = ties
        rank = 0
        for lvl, pat in AUTH:
            if re.search(pat, text): rank = max(rank, lvl)
        if re.search(r"노예|농노", c.get("rank", "")) and rank < 3 and not re.search(r"감독", text): rank = 0   # 노예 감독(크릭)은 예외
        if rank: pr["role"] = "authority"; pr["duty"] = max(pr["duty"], 0.5)
        elif re.search(r"사냥꾼|추적자|현상금", text): pr["role"] = "hunter"
        elif re.search(r"장물|밀수|고리대|브로커|중개인", text): pr["role"] = "fence"
        out[n] = pr
        sid = home_of.get(n)
        if sid and rank: by_settlement.setdefault(sid, []).append((rank, n))
    for sid, lst in by_settlement.items():
        CHAINS[sid] = [n for _, n in sorted(lst)][:4]   # 가까운 윗선부터
    coins = {}
    for n, c in cards.items():
        if c.get("type") == "historical": continue
        rk = f"{c.get('rank','')} {c.get('job','')}"
        h = zlib.crc32(n.encode()) % 1000 / 1000
        if re.search(r"가주|영주|남작|귀족|군주|칸\b|여왕|대가문|원로", rk): base = (600, 3000)
        elif re.search(r"상인|중개|장인|대장장이|사제|학자|기사|단장", rk): base = (40, 300)
        elif re.search(r"감독|경비|병사|사냥꾼", rk): base = (20, 120)
        elif re.search(r"노예|농노|포로", rk): base = (0, 10)
        else: base = (5, 60)
        coins[n] = int(base[0] + (base[1] - base[0]) * h)
    return out, coins


if __name__ == "__main__":
    main()
