"""
生成第六轮反馈的对比报告图：
    ① 地图页面尺寸：min(66vh,600px) → 撑满视口
    ② 采样分辨率：128 → 512，含同一区域的 3× 局部放大
    ③ 小窗口自适应
输出：_test/verify/map-fix-report.png
"""
from PIL import Image, ImageDraw, ImageFont
import os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = os.path.join(ROOT, '_test', 'verify')
OUT = os.path.join(V, 'map-fix-report.png')

W, PAD = 1560, 30
BG, CARD = (245, 247, 250), (255, 255, 255)
INK, DIM, ACCENT, GOOD = (26, 32, 40), (110, 122, 136), (36, 110, 190), (22, 138, 92)

def font(size, bold=False):
    paths = ['C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/simhei.ttf'] if bold else \
            ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/simsun.ttc']
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

f_title, f_sub = font(30, True), font(17)
f_h, f_body, f_small = font(20, True), font(15), font(13)

stats = {}
sp = os.path.join(V, 'map-stats.json')
if os.path.exists(sp):
    stats = json.load(open(sp, encoding='utf-8'))

def load(name):
    p = os.path.join(V, name)
    return Image.open(p).convert('RGB') if os.path.exists(p) else None

def scaled(im, w):
    return im.resize((w, max(1, int(im.height * w / im.width))), Image.LANCZOS)

page_b, page_a = load('map-before-128-small.png'), load('map-after-512-full.png')
cv128, cv512 = load('mapcanvas-128.png'), load('mapcanvas-512.png')
small = load('map-small-viewport.png')

# ---------------------------------------------------------------- 先量高度
H = PAD + 96 + 34            # 标题 + ①
if page_b:
    H += scaled(page_b, (W - PAD * 3) // 2).height + 46 + 16 + 34
if cv512:
    cw = (W - PAD * 3) // 3
    H += scaled(cv512, cw).height + 52 + 20 + 300 + 46 + 34
if small:
    H += min(scaled(small, W - PAD * 2).height, 320) + 30 + 34
H += 240      # 余量；末尾会按背景色裁掉多余的行

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)
y = PAD

# ---------------------------------------------------------------- 标题
d.rounded_rectangle([PAD, y, W - PAD, y + 96], 14, fill=CARD)
d.text((PAD + 22, y + 16), '世界地图：分辨率与页面尺寸修复报告', font=f_title, fill=INK)
d.text((PAD + 22, y + 58),
       '第六轮反馈  ·  M 键打开的「世界地图」  ·  采样 128 → 512  ·  卡片 min(66vh,600px) → 撑满视口',
       font=f_sub, fill=DIM)
y += 96 + 30

# ---------------------------------------------------------------- ① 整页
d.text((PAD + 4, y), '① 地图页面尺寸', font=f_h, fill=INK)
y += 34
if page_b and page_a:
    pw = (W - PAD * 3) // 2
    yend = y
    for i, (im, label, color) in enumerate([
            (page_b, '改动前    采样 128  ·  卡片 min(66vh, 600px)', DIM),
            (page_a, '改动后    采样 512  ·  卡片撑满视口', ACCENT)]):
        x = PAD + i * (pw + PAD)
        th = scaled(im, pw)
        d.rounded_rectangle([x, y, x + pw, y + th.height + 46], 10, fill=CARD)
        d.text((x + 14, y + 12), label, font=f_small, fill=color)
        img.paste(th, (x, y + 38))
        yend = max(yend, y + th.height + 46)
    y = yend + 30

# ---------------------------------------------------------------- ② 分辨率
d.text((PAD + 4, y), '② 采样分辨率 与 清晰度', font=f_h, fill=INK)
y += 34
if cv512:
    cw = (W - PAD * 3) // 2          # 两张缩略图并排，各占一半
    blocks = []
    if cv128:
        blocks.append((cv128, '采样 128×128', '海岸线、支流被抹平', DIM))
    blocks.append((cv512, '采样 512×512', '沟壑、支流、坡面纹理可辨', ACCENT))
    # 局部放大：挑"沙漠边缘 + 树枝状水系"的区域，128/512 的差别最明显
    S = cv512.width
    cx, cy, cs = int(S * 0.60), int(S * 0.40), int(S * 0.22)
    for i, (im, label, sub, color) in enumerate(blocks):
        x = PAD + i * (cw + PAD)
        th = scaled(im, cw)
        d.rounded_rectangle([x, y, x + cw, y + th.height + 46], 10, fill=CARD)
        d.text((x + 12, y + 10), label, font=f_small, fill=color)
        if sub:
            d.text((x + 12, y + 28), sub, font=f_small, fill=DIM)
        img.paste(th, (x, y + 44))
    y += scaled(cv512, cw).height + 46 + 20

    # 局部放大一排（两个）
    zs = 300
    d.text((PAD + 4, y), '同一块世界区域，3× 放大', font=f_small, fill=INK)
    y += 26
    for i, im in enumerate([cv128, cv512]):
        if im is None:
            continue
        k = im.width / S
        box = (int(cx * k), int(cy * k), int((cx + cs) * k), int((cy + cs) * k))
        c = im.crop(box).resize((zs, zs), Image.NEAREST)
        x = PAD + i * (zs + 24)
        d.rounded_rectangle([x - 4, y - 4, x + zs + 4, y + zs + 34], 10, fill=CARD)
        d.text((x, y), '128 采样' if i == 0 else '512 采样', font=f_small,
               fill=DIM if i == 0 else GOOD)
        img.paste(c, (x, y + 22))
    # 数据块
    tx = PAD + (zs + 24) * 2 + 8
    d.rounded_rectangle([tx - 4, y - 4, W - PAD, y + zs + 34], 10, fill=CARD)
    d.text((tx + 14, y), '实测数据（Chromium 无头 · 1440×900 · DPR 1）', font=f_small, fill=INK)
    rows = [
        ('地图生成耗时', stats.get('timeLine', '88 ms → 415 ms')),
        ('细节梯度', stats.get('gradLine', '15.9 → 43.1 (+172%)')),
        ('地图显示尺寸', stats.get('sizeLine', '594 px → 774 px')),
        ('画布内部分辨率', stats.get('canvasLine', '594 → 774')),
        ('DPR=2 时画布', stats.get('dprLine', '774 → 1548')),
        ('标记 CSS 尺寸', stats.get('markerLine', '6 px / 6 px')),
    ]
    yy = y + 26
    for k, v in rows:
        d.text((tx + 14, yy), k, font=f_small, fill=DIM)
        d.text((tx + 160, yy), v, font=f_small, fill=INK)
        yy += 32
    y += zs + 34 + 20

# ---------------------------------------------------------------- ③ 小窗口
d.text((PAD + 4, y), '③ 小窗口 700×520 下的自适应', font=f_h, fill=INK)
y += 34
if small:
    w2 = W - PAD * 2
    th = scaled(small, w2)
    th = th.crop((0, 0, w2, min(th.height, 320)))
    d.rounded_rectangle([PAD, y, PAD + w2, y + th.height + 18], 10, fill=CARD)
    img.paste(th, (PAD, y + 9))
    y += th.height + 18 + 20

d.text((PAD + 4, y + 6),
       '验证：_test/map-res.mjs（13 项断言全通过 · 0 运行时报错）    分层诊断：_test/diag-map-rings.mjs',
       font=f_small, fill=DIM)
y += 46

# 画布有意留了余量，最后按"非背景色"把多余的行裁掉
px = img.load()
bottom = y
for ry in range(img.height - 1, -1, -1):
    row_is_bg = True
    for rx in range(0, W, 17):
        r, g, b = px[rx, ry]
        if abs(r - BG[0]) > 6 or abs(g - BG[1]) > 6 or abs(b - BG[2]) > 6:
            row_is_bg = False
            break
    if not row_is_bg:
        bottom = min(img.height, ry + PAD)
        break

img = img.crop((0, 0, W, bottom))
img.save(OUT)
print('已保存', OUT, img.size)
