"""
把 _test/shots/showcase/ 里的原始截图加工成 README 用的展示图，输出到 docs/。

产物：
    docs/hero.png       主图：制高点远景（1600×900）
    docs/biomes.png     3×2 生物群系图鉴（带中文标签）
    docs/glide.png      滑翔（1600×900）
    docs/worldmap.png   世界地图全屏（1600×900）

同时打印每张的体积，便于控制仓库大小。
"""
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '_test', 'shots', 'showcase')
DST = os.path.join(ROOT, 'docs')
os.makedirs(DST, exist_ok=True)

W, H = 1600, 900


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


def load(name):
    p = os.path.join(SRC, name)
    if not os.path.exists(p):
        raise SystemExit('缺少源图：' + p)
    im = Image.open(p).convert('RGB')
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    return im


def save(im, name, quality=88):
    """截图是大片纯色 + 硬边，用 JPEG 质量 88 通常只有 PNG 的 1/4 体积，
    肉眼在这个尺寸下看不出差别；UI 文字边缘也够干净。"""
    p = os.path.join(DST, os.path.splitext(name)[0] + '.jpg')
    im.save(p, 'JPEG', quality=quality, optimize=True, progressive=True, subsampling=1)
    kb = os.path.getsize(p) / 1024
    print(f'  {os.path.basename(p):16} {im.size[0]}×{im.size[1]}  {kb:7.1f} KB')
    return p


def load_worldmap():
    """世界地图那张两侧是空的背景，按卡片矩形裁掉，别让白边占掉一半版面。"""
    import json
    im = Image.open(os.path.join(SRC, 'worldmap.png')).convert('RGB')
    rp = os.path.join(SRC, 'worldmap-rect.json')
    if os.path.exists(rp):
        rect = json.load(open(rp, encoding='utf-8'))['card']
        pad = 6
        box = (max(0, int(rect[0]) - pad), max(0, int(rect[1]) - pad),
               min(im.width, int(rect[2]) + pad), min(im.height, int(rect[3]) + pad))
        im = im.crop(box)
        print(f'  （地图已按卡片矩形裁切 {box}）')
    return im


# ---------------------------------------------------------------- 单张
print('=== 单张展示图 ===')
save(load('vista-b.png'), 'hero.png')
save(load('glide-r25-p0-auto.png'), 'glide.png')
save(load_worldmap(), 'worldmap.png')

# ---------------------------------------------------------------- 群系图鉴
print('\n=== 生物群系图鉴 ===')
TILES = [
    ('grassland-b-clean.png', '风起平原', 'GRASSLAND'),
    # 林地用 a 机位：b 机位虽然也合规，但镜头正好贴在一棵大松树上，
    # 树干占掉右半张图，完全看不出"林地"；a 机位是林子内部，树冠层次最全。
    ('forest-a-clean.png',    '低语林地', 'FOREST'),
    ('desert-a-clean.png',    '烫金流沙', 'DESERT'),
    ('snow-b-clean.png',      '极寒雪原', 'SNOW'),
    ('beach-b-clean.png',     '珊瑚浅滩', 'BEACH'),
    ('mountain-c-clean.png',  '云脊山脉', 'MOUNTAIN'),
]

COLS, ROWS = 3, 2
MARGIN, GAP = 22, 13
BAR = 34                      # 每格底部的标签条高度
TW = (1668 - MARGIN * 2 - GAP * (COLS - 1)) // COLS
TH = int(TW * 9 / 16)
GW = MARGIN * 2 + TW * COLS + GAP * (COLS - 1)
GH = MARGIN * 2 + (TH + BAR) * ROWS + GAP * (ROWS - 1) + 44   # 顶部留标题

bg = (16, 21, 28)
grid = Image.new('RGB', (GW, GH), bg)
d = ImageDraw.Draw(grid)

f_title = font(25, True)
f_name = font(19, True)
f_asm = font(13)
d.text((MARGIN + 2, 14), '九种生物群系（图鉴取六种）', font=f_title, fill=(238, 243, 248))

for i, (fn, cn, en) in enumerate(TILES):
    r, c = divmod(i, COLS)
    x = MARGIN + c * (TW + GAP)
    y = 44 + MARGIN + r * (TH + BAR + GAP)
    tile = load(fn).resize((TW, TH), Image.LANCZOS)
    grid.paste(tile, (x, y))
    d.rectangle([x, y + TH, x + TW, y + TH + BAR], fill=(26, 33, 43))
    d.text((x + 12, y + TH + 7), cn, font=f_name, fill=(235, 241, 247))
    w = d.textbbox((0, 0), cn, font=f_name)[2]
    d.text((x + 12 + w + 10, y + TH + 12), en, font=f_asm, fill=(112, 130, 148))

save(grid, 'biomes.png', quality=90)

print('\n=== 完成 ===')
total = sum(os.path.getsize(os.path.join(DST, f)) for f in os.listdir(DST) if f.endswith('.jpg') or f.endswith('.png'))
print(f'docs/ 合计 {total / 1024:.0f} KB')
