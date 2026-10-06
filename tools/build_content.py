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


def main():
    os.makedirs(OUT, exist_ok=True)
    settlements = {s["id"]: s for s in load("content/base/settlements/*.yaml")}
    routines = {}
    for r in load("content/base/routines/*.yaml"):
        routines.update(r or {})
    events = [e for f in load("content/base/events/*.yaml") for e in (f or [])]
    world = json.load(open(os.path.join(ROOT, "content/base/world/map.json"), encoding="utf-8"))
    bundle = {"settlements": settlements, "routines": routines, "events": events,
              "map": {"nodes": world["nodes"], "edges": world["edges"]}}
    p = os.path.join(OUT, "whereabouts.json")
    json.dump(bundle, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"정착지 {len(settlements)} · 일과 {len(routines)}명 · 일정 {len(events)} → {p}")


if __name__ == "__main__":
    main()
