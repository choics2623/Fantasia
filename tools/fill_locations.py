"""일과도 일정도 없는 인물에게 자리를 준다 (검토 #8 — 위치 엔진에 없으면 LLM이 연기할 기회도 없다).

  python3 tools/fill_locations.py          → content/base/routines/_auto.yaml 을 다시 쓴다
  python3 tools/fill_locations.py --check  → 쓰지 않고 보고만

카드의 home·places·schedule 글에서 장소를 찾는다:
  1. 정착지 장소의 이름·별칭(aka)이 글에 나오면 그 장소 (아침·낮·저녁·밤 글마다 따로 찾는다 → 네 칸 일과, 24 §3.5 B등급 LOD)
  2. 못 찾으면 그 지역의 정착지 중심, 그것도 없으면 지역 지도 노드 (그 지역 '어딘가' — 플레이어가 그 지역에 가면 만날 수 있다)
사람이 손으로 쓴 일과가 생기면 이 파일의 그 사람 항목은 다음 실행 때 빠진다. 이 파일은 손으로 고치지 않는다.
"""
import json, os, sys, glob, re
import yaml

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "content/base/routines/_auto.yaml")


def main():
    check = "--check" in sys.argv
    cards = json.load(open(os.path.join(ROOT, "content/base/npcs/cards.json"), encoding="utf-8"))["cards"]
    world = json.load(open(os.path.join(ROOT, "content/base/world/map.json"), encoding="utf-8"))
    settlements = {}
    for p in glob.glob(os.path.join(ROOT, "content/base/settlements/*.yaml")):
        s = yaml.safe_load(open(p, encoding="utf-8")); settlements[s["id"]] = s
    routines, events_npcs = {}, set()
    for p in glob.glob(os.path.join(ROOT, "content/base/routines/*.yaml")):
        if p.endswith("_auto.yaml"): continue
        routines.update(yaml.safe_load(open(p, encoding="utf-8")) or {})
    for p in glob.glob(os.path.join(ROOT, "content/base/events/*.yaml")):
        for e in yaml.safe_load(open(p, encoding="utf-8")) or []: events_npcs.update(e.get("npcs") or [])

    region_name = {r["id"]: r["name"] for r in world["regions"]}
    node_region = {n["id"]: region_name.get(n.get("region")) for n in world["nodes"]}
    # 지역 → 정착지들, 지역 → 대표 지도 노드
    reg_settlements, reg_node = {}, {}
    for sid, s in settlements.items():
        reg_settlements.setdefault(node_region.get(s.get("node")), []).append(sid)
    for n in world["nodes"]:
        r = region_name.get(n.get("region"))
        if r and (r not in reg_node or n.get("major")): reg_node[r] = n["id"]
    places = []   # (이름 조각, 장소 id, 정착지)
    for sid, s in settlements.items():
        for l in (s.get("locations") or []) + (s.get("outer") or []):
            names = [l.get("name", "")] + list(l.get("aka") or [])
            for nm in names:
                for piece in re.split(r"[·,()'\"/]", nm or ""):
                    piece = piece.strip()
                    if len(piece) >= 2: places.append((piece, l["id"], sid))
    places.sort(key=lambda x: -len(x[0]))   # 긴 이름부터 (방 이름이 건물 이름보다 먼저)

    def find(text, prefer=None):
        # 그 인물의 지역 정착지 안에서만 찾는다 (아르카스의 '서고'가 루멘 대성당 서고로 잘못 가지 않게)
        for piece, pid, sid in places:
            if piece in text and prefer and sid in prefer: return pid
        return None

    out, report = {}, []
    for n, c in sorted(cards.items()):
        if c.get("type") == "historical" or n in routines or n in events_npcs: continue
        region = c.get("region") or ""
        prefer = reg_settlements.get(region) or [sid for r, sids in reg_settlements.items() if r and (r in region or region in r) for sid in sids]
        home_text = f"{c.get('home') or ''} {' '.join(map(str, c.get('places') or []))}"
        home = find(str(c.get("home") or ""), prefer) or find(home_text, prefer)
        how = "장소 이름"
        if not home:
            if prefer: home = settlements[prefer[0]].get("node") if settlements[prefer[0]].get("node") in node_region else None
            if not home:
                reg = next((r for r in reg_node if r and (r in region or region in r)), None)
                home = reg_node.get(reg)
            how = "지역 노드"
        if not home:
            report.append(f"  ✗ {n} ({c.get('name')}) — 지역 '{region}'의 자리를 찾지 못함"); continue
        sch = c.get("schedule") or {}
        slots = [("아침", "06:00", "12:00"), ("낮", "12:00", "18:00"), ("저녁", "18:00", "22:00"), ("밤", "22:00", "06:00")]
        blocks = []
        for key, f, t in slots:
            text = str(sch.get(key) or "")
            at = find(text, prefer) if how == "장소 이름" else None
            blocks.append({"days": "all", "from": f, "to": t, "at": at or home, "doing": (text or "자기 자리에 있다")[:60]})
        out[n] = {"home": home, "blocks": blocks, "auto": how}
        report.append(f"  {'·' if how == '장소 이름' else '~'} {n} ({c.get('name')}) → {home} [{how}]")
    print("\n".join(report))
    print(f"자리를 준 인물 {len(out)}명 (· 장소 이름으로 찾음, ~ 지역 어딘가)")
    if not check:
        with open(OUT, "w", encoding="utf-8") as fh:
            fh.write("# 자동 생성 — tools/fill_locations.py. 손으로 고치지 않는다 (손으로 쓴 일과가 생기면 다음 실행 때 빠진다).\n")
            fh.write("# 24 §3.5: B등급 LOD — 아침·낮·저녁·밤 네 칸.\n")
            yaml.safe_dump(out, fh, allow_unicode=True, sort_keys=True, width=200)


if __name__ == "__main__":
    main()
