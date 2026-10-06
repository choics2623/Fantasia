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
    bundle = {"settlements": settlements, "routines": routines, "events": events,
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
    facts = {}
    for f in load("content/base/facts/*.yaml"):
        for x in (f if isinstance(f, list) else (f or {}).get("facts", [])):
            facts[x["id"]] = {"text": x.get("text", ""), "names": x.get("names", []), "danger": x.get("danger", 0)}
    game = {"agendas": agendas, "inventories": inventories, "sim": sim, "facts": facts}
    p3 = os.path.join(OUT, "game.json")
    json.dump(game, open(p3, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"목표 행동 {len(agendas['agendas'])} · 소지품 {len(inventories)}명 · 성향 {len(sim['profiles'])}명 · 사실 {len(facts)} → {p3}")


if __name__ == "__main__":
    main()
