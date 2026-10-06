"""목판화풍 SVG 삽화 생성기 (19_PRESENTATION §9).
종이 위 먹, 칼로 판 흰 선, 색은 핏빛 녹 하나. 결정적 시드 → 같은 그림.
사용: python3 tools/woodcut.py  → assets/illustrations/*.svg
"""
import math, random, os

W, H = 800, 1000
PAPER, INK, RUST = "#e6dcc6", "#15120f", "#8c2f1d"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "illustrations")


class Plate:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.defs, self.body, self.n = [], [], 0

    def uid(self, p):
        self.n += 1
        return f"{p}{self.n}"

    # ── 기본 도구 ──
    def jline(self, x1, y1, x2, y2, jit=1.2, seg=14):
        """칼자국처럼 살짝 떨리는 선."""
        L = math.hypot(x2 - x1, y2 - y1)
        k = max(2, int(L / seg))
        pts = []
        for i in range(k + 1):
            t = i / k
            x = x1 + (x2 - x1) * t + self.r.uniform(-jit, jit)
            y = y1 + (y2 - y1) * t + self.r.uniform(-jit, jit)
            pts.append(f"{x:.1f},{y:.1f}")
        return "M" + " L".join(pts)

    def hatch(self, clip_d, angle, gap, width, color, jit=1.2, taper=True, box=(0, 0, W, H), dash=None):
        """clip_d 모양 안을 평행 칼자국으로 채운다."""
        cid = self.uid("c")
        self.defs.append(f'<clipPath id="{cid}"><path d="{clip_d}"/></clipPath>')
        x0, y0, x1, y1 = box
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        R = math.hypot(x1 - x0, y1 - y0) / 2 + 20
        a = math.radians(angle)
        dx, dy = math.cos(a), math.sin(a)
        nx, ny = -dy, dx
        lines = []
        o = -R
        while o < R:
            px, py = cx + nx * o, cy + ny * o
            w = width * (self.r.uniform(0.55, 1.25) if taper else 1)
            d = self.jline(px - dx * R, py - dy * R, px + dx * R, py + dy * R, jit)
            extra = f' stroke-dasharray="{dash}"' if dash else ""
            lines.append(f'<path d="{d}" stroke-width="{w:.2f}"{extra}/>')
            o += gap * self.r.uniform(0.8, 1.2)
        self.body.append(f'<g clip-path="url(#{cid})" stroke="{color}" fill="none" stroke-linecap="round">{"".join(lines)}</g>')

    def shape(self, d, fill=INK, rough=True, extra=""):
        f = ' filter="url(#rough)"' if rough else ""
        self.body.append(f'<path d="{d}" fill="{fill}"{f} {extra}/>')

    def raw(self, s):
        self.body.append(s)

    def svg(self, title):
        head = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<title>{title}</title>
<defs>
<filter id="rough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="5"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.08  0 0 0 0 0.07  0 0 0 0 0.05  0 0 0 -1.6 1.05"/><feComposite in2="SourceGraphic" operator="in"/></filter>
<filter id="inkedge"><feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="1" seed="11"/><feDisplacementMap in="SourceGraphic" scale="2.2"/></filter>
{"".join(self.defs)}
</defs>
<rect width="{W}" height="{H}" fill="{PAPER}"/>
'''
        frame = f'<rect x="18" y="18" width="{W-36}" height="{H-36}" fill="none" stroke="{INK}" stroke-width="7" filter="url(#rough)"/>'
        grain = f'<rect width="{W}" height="{H}" fill="{PAPER}" filter="url(#grain)" opacity="0.55"/>'
        return head + '<g filter="url(#inkedge)">' + "".join(self.body) + frame + "</g>" + grain + "</svg>"


def rect_d(x, y, w, h):
    return f"M{x},{y} h{w} v{h} h{-w} Z"


def figure_d(x, y, s=1.0, lean=0.0, hood=True, r=None):
    """두건 쓴 구부정한 사람 (발 기준점 x,y, 키 약 100*s, 오른쪽을 본다)."""
    j = (lambda: r.uniform(-1.2, 1.2)) if r else (lambda: 0)
    pts = [(2,-100),(10,-100),(16,-92),(15,-82),(18,-74),(18,-66),(16,-60),(21,-40),(22,-20),(19,-6),
           (10,-6),(9,0),(3,0),(4,-6),(-2,-6),(-3,0),(-9,0),(-8,-6),(-18,-6),(-21,-24),(-22,-48),(-18,-66),(-16,-80),(-12,-94)]
    if not hood:
        pts[0:4] = [(0,-96),(8,-98),(12,-90),(12,-82)]
    def P(px, py):
        return f"{x + (px - lean * py * 0.25) * s + j():.1f},{y + py * s + j():.1f}"
    d = "M" + P(*pts[0])
    d += f" C{P(*pts[1])} {P(*pts[2])} {P(*pts[3])}"
    d += f" C{P(*pts[4])} {P(*pts[5])} {P(*pts[6])}"
    d += f" C{P(*pts[7])} {P(*pts[8])} {P(*pts[9])}"
    for q in pts[10:18]:
        d += f" L{P(*q)}"
    d += f" L{P(*pts[18])} C{P(*pts[19])} {P(*pts[20])} {P(*pts[21])} C{P(*pts[22])} {P(*pts[23])} {P(*pts[0])} Z"
    return d


def back_d(x, y, s=1.0, r=None):
    """뒤에서 본 선 사람 — 머리·어깨·망토가 또렷하다 (발 기준점, 키 약 100*s)."""
    j = (lambda: r.uniform(-0.8, 0.8)) if r else (lambda: 0)
    P = lambda a, b: f"{x + a * s + j():.1f},{y + b * s + j():.1f}"
    head = f"M{P(-9.5,-89)} a{9.5*s:.1f},{10.5*s:.1f} 0 1,1 {19*s:.1f},0 a{9.5*s:.1f},{10.5*s:.1f} 0 1,1 {-19*s:.1f},0 Z"
    body = (f"M{P(-5,-78)} C{P(-8,-76)} {P(-18,-75)} {P(-22,-68)} C{P(-25,-50)} {P(-22,-30)} {P(-25,-5)} L{P(-28,0)} "
            f"L{P(-10,-2)} L{P(-4,0)} L{P(4,-1)} L{P(12,0)} L{P(28,0)} L{P(25,-5)} C{P(22,-30)} {P(25,-50)} {P(22,-68)} "
            f"C{P(18,-75)} {P(8,-76)} {P(5,-78)} Z")
    return head + " " + body


# ───────────────────────── 1. 배급 줄 ─────────────────────────
def plate_ration():
    p = Plate(312)
    # 하늘 — 먹 위에 가로 칼자국, 위로 갈수록 촘촘한 어둠
    sky = "M0,0 H800 V560 H0 Z"
    p.shape(sky, rough=False)
    p.hatch(sky, 0, 9, 1.6, PAPER, jit=1.6, box=(0, 260, 800, 560))
    p.hatch("M0,380 H800 V560 H0 Z", 0, 6, 2.2, PAPER, jit=1.4, box=(0, 380, 800, 560))
    # 성채 실루엣 (멀리)
    p.shape("M0,420 L60,420 L60,330 L90,330 L90,300 L110,300 L110,330 L150,330 L150,400 L230,400 L230,350 L250,330 L270,350 L270,410 L340,410 L340,440 L0,440 Z")
    # 배급 막사
    hut = "M470,560 L470,350 L560,290 L720,290 L800,330 L800,560 Z"
    p.shape(hut)
    p.hatch(hut, -62, 11, 1.3, PAPER, box=(470, 290, 800, 560))
    roof = "M450,360 L560,280 L730,280 L815,330 L800,342 L720,300 L565,300 L465,372 Z"
    p.shape(roof)
    # 열린 문의 불빛 — 유일한 따뜻함, 녹빛
    door = "M600,560 L600,410 Q630,392 660,410 L660,560 Z"
    p.shape(door, fill=RUST)
    p.hatch(door, 90, 7, 1.0, "#d9a27a", box=(600, 392, 660, 560))
    # 땅 — 진창
    ground = "M0,560 H800 V1000 H0 Z"
    p.hatch(ground, 1, 7, 2.6, INK, jit=2.0, box=(0, 560, 800, 1000))
    p.hatch("M0,560 H800 V640 H0 Z", 0, 4, 2.4, INK, jit=1.2, box=(0, 560, 800, 640))
    # 문빛이 진창에 비친다 — 웅덩이마다 녹빛
    for (px, py, w) in [(630, 600, 70), (600, 690, 110), (560, 800, 150), (520, 930, 190)]:
        pd = f"M{px-w/2},{py} a{w/2},{w/9:.1f} 0 1,0 {w},0 a{w/2},{w/9:.1f} 0 1,0 {-w},0"
        p.shape(pd, fill=RUST)
        p.hatch(pd, 0, 5, 1.6, INK, box=(px - w/2, py - w/9, px + w/2, py + w/9))
    # 줄 선 사람들 — 원근으로 작아지며 문까지
    r = p.r
    xs = [(120, 960, 2.3), (210, 880, 1.95), (305, 815, 1.6), (380, 760, 1.32), (440, 715, 1.1), (490, 680, 0.92), (530, 655, 0.78), (565, 632, 0.66), (592, 615, 0.56)]
    for i, (x, y, s) in enumerate(xs):
        d = figure_d(x, y, s, lean=0.25 + r.uniform(-0.1, 0.15), r=r)
        p.shape(d)
        # 젖은 망토의 결 — 흰 칼자국 몇 줄 (등 쪽으로만)
        if s > 1.0:
            p.hatch(d, 80 + r.uniform(-6, 6), 9 * s, 0.8 * s, PAPER, box=(x - 24 * s, y - 70 * s, x - 6 * s, y - 8 * s))
    # 맨 앞의 작은 아이 (페인) — 소매를 잡는다
    kid = figure_d(30, 965, 1.15, lean=-0.1, hood=False, r=r)
    p.shape(kid)
    # 비 — 사선 흰 긁힘, 전면
    rain = "M0,0 H800 V1000 H0 Z"
    for _ in range(260):
        x = r.uniform(-100, 800); y = r.uniform(0, 1000); L = r.uniform(18, 60)
        p.raw(f'<path d="{p.jline(x, y, x + L * 0.32, y + L, 0.6, 20)}" stroke="{PAPER}" stroke-width="{r.uniform(0.6, 1.6):.2f}" opacity="{r.uniform(0.35, 0.85):.2f}" fill="none"/>')
    return p.svg("배급 줄")


# ───────────────────────── 2. 오물 습지 (첫 죽음) ─────────────────────────
def plate_marsh():
    p = Plate(9)
    r = p.r
    sky = "M0,0 H800 V520 H0 Z"
    p.shape(sky, rough=False)
    # 달 — 녹빛 테두리
    p.raw(f'<circle cx="560" cy="210" r="88" fill="{PAPER}" filter="url(#rough)"/>')
    p.hatch("M472,210 a88,88 0 1,0 176,0 a88,88 0 1,0 -176,0", 20, 12, 3.2, INK, box=(472, 122, 648, 298))
    p.raw(f'<circle cx="560" cy="210" r="96" fill="none" stroke="{RUST}" stroke-width="3" filter="url(#rough)"/>')
    # 달빛 동심 칼자국
    for k in range(1, 9):
        rr = 110 + k * 26
        p.raw(f'<circle cx="560" cy="210" r="{rr}" fill="none" stroke="{PAPER}" stroke-width="{max(0.5, 2.2 - k*0.22):.2f}" stroke-dasharray="{r.randint(30,90)} {r.randint(8,30)}" opacity="0.7"/>')
    # 늪 물 — 흰 바탕에 가로 먹선 (달빛 반사)
    water = "M0,520 H800 V1000 H0 Z"
    p.hatch(water, 0, 8, 3.4, INK, jit=1.8, box=(0, 520, 800, 1000))
    p.hatch("M500,520 H620 L700,1000 H420 Z", 0, 10, 2.2, PAPER, jit=2, box=(420, 520, 700, 1000))
    # 개들 — 갈대 사이로 낮게, 셋
    def dog(x, y, s, flip=1):
        P = lambda a, b: f"{x + a * s * flip:.1f},{y + b * s:.1f}"
        return (f"M{P(-60,0)} L{P(-52,-30)} C{P(-40,-44)} {P(10,-46)} {P(30,-40)} L{P(48,-56)} L{P(70,-58)} L{P(78,-50)} "
                f"L{P(92,-44)} L{P(86,-36)} L{P(64,-34)} L{P(50,-22)} L{P(46,0)} L{P(36,0)} L{P(34,-18)} L{P(-30,-18)} "
                f"L{P(-36,0)} L{P(-46,0)} L{P(-48,-24)} L{P(-68,-30)} L{P(-76,-44)} L{P(-70,-44)} L{P(-58,-34)} Z")
    for (x, y, s) in [(180, 600, 1.0), (330, 640, 1.25), (90, 660, 0.8)]:
        d = dog(x, y, s)
        p.shape(d)
        # 눈 — 녹빛 점
        p.raw(f'<circle cx="{x + 74*s:.1f}" cy="{y - 50*s:.1f}" r="{2.6*s:.1f}" fill="{RUST}"/>')
    # 갈대 — 앞쪽 높게, 먹
    for _ in range(70):
        x = r.uniform(-20, 820); base = r.uniform(820, 1010); h = r.uniform(240, 560)
        bend = r.uniform(-60, 60); w = r.uniform(3, 9)
        p.shape(f"M{x-w/2:.1f},{base:.1f} Q{x+bend*0.4:.1f},{base-h*0.6:.1f} {x+bend:.1f},{base-h:.1f} Q{x+bend*0.4+w:.1f},{base-h*0.6:.1f} {x+w/2:.1f},{base:.1f} Z")
        if r.random() < 0.35:
            hx, hy = x + bend, base - h
            p.shape(f"M{hx-5:.1f},{hy+30:.1f} Q{hx-7:.1f},{hy:.1f} {hx:.1f},{hy-18:.1f} Q{hx+7:.1f},{hy:.1f} {hx+5:.1f},{hy+30:.1f} Z")
    # 진창 속의 손 — 전면 아래, 손가락 다섯
    hand = ("M300,1000 L318,905 C320,890 334,888 336,902 L338,860 C340,846 356,846 356,860 L358,850 C360,836 376,836 376,852 "
            "L378,866 C380,852 396,852 396,868 L394,930 L412,900 C420,888 436,896 428,912 L392,1000 Z")
    p.shape(hand)
    p.hatch(hand, 75, 6, 0.9, PAPER, box=(300, 836, 436, 1000))
    for (x, y, rr) in [(420, 960, 6), (440, 940, 3.5), (402, 986, 4.5), (455, 975, 2.6)]:
        p.raw(f'<circle cx="{x}" cy="{y}" r="{rr}" fill="{RUST}" filter="url(#rough)"/>')
    return p.svg("오물 습지")


# ───────────────────────── 3. 시간이 접힌다 (회귀) ─────────────────────────
def plate_fold():
    p = Plate(1)
    r = p.r
    p.shape("M0,0 H800 V1000 H0 Z", rough=False)
    cx, cy = 400, 420
    # 접히는 날들 — 겹친 종이 띠가 소용돌이로 빨려든다
    for i in range(22):
        t = i / 22
        ang = t * 540 + r.uniform(-8, 8)
        rad = 330 * (1 - t) ** 1.2 + 24
        a = math.radians(ang)
        x, y = cx + math.cos(a) * rad, cy + math.sin(a) * rad * 0.9
        w, h = 150 * (1 - t) + 26, 34 * (1 - t) + 8
        rot = ang + 90 + r.uniform(-10, 10)
        fill = PAPER if i % 5 else RUST
        p.raw(f'<g transform="translate({x:.1f},{y:.1f}) rotate({rot:.1f})"><path d="M{-w/2:.1f},{-h/2:.1f} L{w/2:.1f},{-h/2-3:.1f} L{w/2+4:.1f},{h/2:.1f} L{-w/2-2:.1f},{h/2+2:.1f} Z" fill="{fill}" filter="url(#rough)"/>'
              f'<path d="M{-w/2+8:.1f},0 H{w/2-8:.1f}" stroke="{INK}" stroke-width="{max(1, h/9):.1f}" stroke-dasharray="{r.randint(3,9)} {r.randint(3,7)}"/></g>')
    # 중심의 빛 — 동심 칼자국
    for k in range(14):
        p.raw(f'<circle cx="{cx}" cy="{cy}" r="{8 + k*9}" fill="none" stroke="{PAPER}" stroke-width="{max(0.4, 2.6 - k*0.17):.2f}" stroke-dasharray="{r.randint(6,40)} {r.randint(4,16)}"/>')
    # 재 — 위로 떠오르는 점
    for _ in range(320):
        x = r.gauss(cx, 210); y = r.uniform(0, 1000)
        p.raw(f'<rect x="{x:.1f}" y="{y:.1f}" width="{r.uniform(1,3.4):.1f}" height="{r.uniform(1,3.4):.1f}" fill="{PAPER}" opacity="{r.uniform(0.25,0.9):.2f}" transform="rotate({r.uniform(0,90):.0f} {x:.1f} {y:.1f})"/>')
    # 아래 — 빨려드는 날들을 올려다보는 사람. 종이색으로 판다
    me = back_d(400, 960, 2.0, r=r)
    p.shape(me, fill=PAPER)
    p.hatch(me, 92, 8, 1.8, INK, box=(340, 740, 460, 960))
    p.raw(f'<path d="M150,962 Q400,948 650,962" stroke="{PAPER}" stroke-width="3" fill="none" filter="url(#rough)"/>')
    return p.svg("시간이 접힌다")


# ───────────────────────── 4. 진룡을 처음 봄 ─────────────────────────
def plate_dragon():
    p = Plate(23)
    r = p.r
    p.shape("M0,0 H800 V1000 H0 Z", rough=False)
    # 비늘 — 화면 전체를 덮는 비늘판, 흰 칼자국 테두리
    rows = 16
    for j in range(rows):
        for i in range(-1, 10):
            x = i * 92 + (46 if j % 2 else 0) + r.uniform(-3, 3)
            y = j * 52 - 40 + r.uniform(-2, 2)
            d = f"M{x-46:.1f},{y:.1f} Q{x-44:.1f},{y+52:.1f} {x:.1f},{y+70:.1f} Q{x+44:.1f},{y+52:.1f} {x+46:.1f},{y:.1f}"
            p.raw(f'<path d="{d}" fill="none" stroke="{PAPER}" stroke-width="{r.uniform(1.6,3.2):.2f}" filter="url(#rough)" opacity="0.85"/>')
            if r.random() < 0.5:
                p.raw(f'<path d="{p.jline(x-20, y+20, x+4, y+48, 0.8, 8)}" stroke="{PAPER}" stroke-width="1" fill="none" opacity="0.6"/>')
    # 눈 — 거대한 아몬드, 세로 동공, 녹빛 홍채
    eye = "M110,470 C250,330 560,330 700,470 C560,600 250,600 110,470 Z"
    p.shape(eye, fill=INK)
    p.raw(f'<path d="{eye}" fill="none" stroke="{PAPER}" stroke-width="7" filter="url(#rough)"/>')
    p.raw(f'<path d="M80,470 C240,300 570,300 730,470" fill="none" stroke="{PAPER}" stroke-width="3" filter="url(#rough)"/>')
    p.raw(f'<path d="M100,500 C250,640 560,640 710,500" fill="none" stroke="{PAPER}" stroke-width="2.4" filter="url(#rough)"/>')
    iris = "M260,470 a145,128 0 1,0 290,0 a145,128 0 1,0 -290,0"
    p.shape(iris, fill=RUST)
    for k in range(48):
        a = 2 * math.pi * k / 48
        p.raw(f'<path d="{p.jline(405 + math.cos(a)*40, 470 + math.sin(a)*36, 405 + math.cos(a)*140, 470 + math.sin(a)*124, 1.4, 10)}" stroke="#d9a27a" stroke-width="{r.uniform(0.8,2):.2f}" fill="none" opacity="0.8"/>')
    pupil = "M405,350 C432,410 432,530 405,590 C378,530 378,410 405,350 Z"
    p.shape(pupil, fill=INK)
    p.raw(f'<circle cx="455" cy="420" r="14" fill="{PAPER}" filter="url(#rough)"/>')
    # 눈 속에 비친 아주 작은 사람
    p.shape(figure_d(392, 528, 0.32, lean=0.0, r=r), fill=PAPER, rough=False)
    # 아래 — 땅 위의 진짜 사람, 작다
    p.raw(f'<path d="M0,800 Q400,780 800,800 V1000 H0 Z" fill="{PAPER}" filter="url(#rough)"/>')
    p.hatch("M0,800 Q400,780 800,800 V1000 H0 Z", 0, 9, 2.0, INK, box=(0, 780, 800, 1000))
    p.raw(f'<ellipse cx="400" cy="935" rx="60" ry="9" fill="{INK}" filter="url(#rough)"/>')
    p.shape(back_d(400, 935, 1.3, r=r))
    return p.svg("진룡")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, fn in [("01_ration_line", plate_ration), ("02_marsh", plate_marsh), ("03_time_fold", plate_fold), ("04_true_dragon", plate_dragon)]:
        s = fn()
        with open(os.path.join(OUT, name + ".svg"), "w", encoding="utf-8") as f:
            f.write(s)
        print(name, f"{len(s)//1024}KB")
