#!/usr/bin/env python3
"""content/base/world/map.json 을 prototypes/map/template.html 에 인라인해 index.html 을 만든다."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
data = json.loads((ROOT / "content/base/world/map.json").read_text(encoding="utf-8"))
tpl = (ROOT / "prototypes/map/template.html").read_text(encoding="utf-8")
marker_start, marker_end = "/*MAP_DATA*/", "/*END_MAP_DATA*/"
i, j = tpl.index(marker_start), tpl.index(marker_end)
payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
out = tpl[: i + len(marker_start)] + payload + tpl[j:]
(ROOT / "prototypes/map/index.html").write_text(out, encoding="utf-8")
print(f"nodes={len(data['nodes'])} edges={len(data['edges'])} -> prototypes/map/index.html")
