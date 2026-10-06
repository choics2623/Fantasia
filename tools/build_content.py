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


if __name__ == "__main__":
    main()
